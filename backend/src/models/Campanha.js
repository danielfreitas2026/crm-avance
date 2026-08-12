const db = require('../database/connection');

const PERIODOS_VALIDOS = ['personalizado'];
const CATEGORIAS_VALIDAS = ['registro_cliente', 'venda', 'chip_novo', 'portabilidade', 'internet', 'valor_monetario', 'outros'];
const PUBLICOS_BASE_VALIDOS = ['ambos', 'base', 'nao_base'];
const TIPOS_REGRA_VALIDOS = ['categoria', 'chip_novo', 'portabilidade', 'internet'];

function isGift(campanha) {
  return campanha.is_gift === true || campanha.is_gift === 1 || campanha.is_gift === '1';
}

function idsValidos(valor) {
  return [...new Set((Array.isArray(valor) ? valor : []).map(Number).filter(Number.isInteger).filter(id => id > 0))];
}

function normalizarDataISO(valor) {
  const texto = String(valor || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : null;
}

function periodoFoiAlterado(atual, proximo) {
  return normalizarDataISO(atual?.data_inicio) !== normalizarDataISO(proximo?.data_inicio)
    || normalizarDataISO(atual?.data_fim) !== normalizarDataISO(proximo?.data_fim);
}

function normalizarRegras(campanha, categoria, operadoraIds, publicoBase) {
  const recebidas = Array.isArray(campanha.regras) ? campanha.regras : null;
  const origem = recebidas && recebidas.length
    ? recebidas
    : (operadoraIds.length ? operadoraIds : [null]).map(operadora_id => ({
      operadora_id,
      publico_base: publicoBase,
      tipo: 'categoria'
    }));
  const vistas = new Set();

  return origem.reduce((regras, regra) => {
    const operadora = Number(regra?.operadora_id);
    const operadoraId = Number.isInteger(operadora) && operadora > 0 ? operadora : null;
    const publico = categoria === 'registro_cliente'
      ? 'ambos'
      : (PUBLICOS_BASE_VALIDOS.includes(regra?.publico_base) ? regra.publico_base : 'ambos');
    const tipo = categoria === 'registro_cliente'
      ? 'categoria'
      : (TIPOS_REGRA_VALIDOS.includes(regra?.tipo) ? regra.tipo : 'categoria');
    const chave = `${operadoraId || 'todas'}:${publico}:${tipo}`;
    if (vistas.has(chave)) return regras;
    vistas.add(chave);
    regras.push({ operadora_id: operadoraId, publico_base: publico, tipo });
    return regras;
  }, []);
}

function normalizarCampanha(campanha) {
  const periodo = 'personalizado';
  const categoria = CATEGORIAS_VALIDAS.includes(campanha.categoria) ? campanha.categoria : 'registro_cliente';
  const publicoBase = categoria === 'registro_cliente'
    ? 'ambos'
    : (PUBLICOS_BASE_VALIDOS.includes(campanha.publico_base) ? campanha.publico_base : 'ambos');
  const operadoraIds = idsValidos(campanha.operadora_ids);
  const participantes = idsValidos(campanha.participante_ids);
  const vendasExcecao = idsValidos(campanha.venda_excecao_ids);
  const regras = normalizarRegras(campanha, categoria, operadoraIds, publicoBase);
  const operadorasRegras = [...new Set(regras.map(regra => regra.operadora_id).filter(Boolean))];
  const publicosRegras = [...new Set(regras.map(regra => regra.publico_base))];

  return {
    tipo: isGift(campanha) ? `${periodo}_${categoria}` : (campanha.tipo || 'personalizado'),
    periodo,
    data_inicio: normalizarDataISO(campanha.data_inicio),
    data_fim: normalizarDataISO(campanha.data_fim),
    categoria,
    target: Number(campanha.target || 0),
    desc: String(campanha.desc || '').trim(),
    reward: campanha.reward || null,
    is_gift: campanha.is_gift !== undefined ? campanha.is_gift : true,
    // Mantem o campo legado coerente para integrações antigas.
    operadora_id: operadorasRegras[0] || operadoraIds[0] || (campanha.operadora_id ? Number(campanha.operadora_id) : null),
    publico_base: publicosRegras.length === 1 ? publicosRegras[0] : 'ambos',
    categoria_personalizada: categoria === 'outros' ? String(campanha.categoria_personalizada || '').trim() : null,
    operadora_ids: operadorasRegras,
    participante_ids: participantes,
    venda_excecao_ids: vendasExcecao,
    regras
  };
}

class Campanha {
  static tableName = 'campanhas';
  static get periodosValidos() { return PERIODOS_VALIDOS; }
  static get categoriasValidas() { return CATEGORIAS_VALIDAS; }
  static get publicosBaseValidos() { return PUBLICOS_BASE_VALIDOS; }
  static get tiposRegraValidos() { return TIPOS_REGRA_VALIDOS; }

  static async anexarRelacoes(campanhas) {
    if (!campanhas.length) return campanhas;
    const ids = campanhas.map(c => c.id);
    const [operadoras, participantes, regras, vendasExcecao, campanhasComResgate] = await Promise.all([
      db('campanha_operadoras as co').join('operadoras as o', 'co.operadora_id', 'o.id')
        .whereIn('co.campanha_id', ids).select('co.campanha_id', 'o.id', 'o.nome'),
      db('campanha_participantes as cp').join('usuarios as u', 'cp.usuario_id', 'u.id')
        .whereIn('cp.campanha_id', ids).select('cp.campanha_id', 'u.id', 'u.nome', 'u.email', 'u.foto_perfil', 'u.ativo'),
      db('campanha_regras as cr').leftJoin('operadoras as o', 'cr.operadora_id', 'o.id')
        .whereIn('cr.campanha_id', ids)
        .select('cr.id', 'cr.campanha_id', 'cr.operadora_id', 'cr.publico_base', 'cr.tipo', 'o.nome as operadora_nome')
        .orderBy('cr.id', 'asc'),
      db('campanha_vendas_excecoes as cve')
        .join('vendas as v', 'cve.venda_id', 'v.id')
        .leftJoin('clientes as cli', 'v.cliente_id', 'cli.id')
        .leftJoin('usuarios as u', 'v.vendedora_id', 'u.id')
        .leftJoin('operadoras as o', 'v.operadora_id', 'o.id')
        .whereIn('cve.campanha_id', ids)
        .select(
          'cve.campanha_id', 'v.id', 'v.data_venda', 'v.razao_social', 'v.cnpj',
          'v.valor_total', 'v.quantidade_linhas', 'v.status_funil', 'v.cancelada_em',
          'v.excluido_em', 'u.nome as vendedora_nome', 'o.nome as operadora_nome',
          db.raw("COALESCE(NULLIF(v.razao_social, ''), NULLIF(cli.razao_social, ''), NULLIF(v.nome, ''), NULLIF(cli.nome, ''), CONCAT('Venda #', v.id)) as cliente_nome")
        )
        .orderBy('v.data_venda', 'desc')
        .orderBy('v.id', 'desc'),
      db('campanha_resgates').whereIn('campanha_id', ids).distinct('campanha_id')
    ]);
    const porCampanha = (rows, chave) => rows.reduce((acc, row) => {
      (acc[row.campanha_id] ||= []).push(chave(row)); return acc;
    }, {});
    const ops = porCampanha(operadoras, r => ({ id: r.id, nome: r.nome }));
    const users = porCampanha(participantes, r => ({
      id: r.id, nome: r.nome, email: r.email, foto_perfil: r.foto_perfil || null, ativo: Boolean(r.ativo)
    }));
    const regrasPorCampanha = porCampanha(regras, r => ({
      id: r.id,
      operadora_id: r.operadora_id ? Number(r.operadora_id) : null,
      operadora_nome: r.operadora_nome || null,
      publico_base: r.publico_base,
      tipo: r.tipo
    }));
    const excecoesPorCampanha = porCampanha(vendasExcecao, r => ({
      id: Number(r.id),
      data_venda: r.data_venda,
      cliente_nome: r.cliente_nome,
      razao_social: r.razao_social,
      cnpj: r.cnpj,
      valor_total: Number(r.valor_total || 0),
      quantidade_linhas: Number(r.quantidade_linhas || 0),
      status_funil: r.status_funil,
      vendedora_nome: r.vendedora_nome,
      operadora_nome: r.operadora_nome,
      valida: !r.excluido_em && !r.cancelada_em && r.status_funil !== 'retorno'
    }));
    const idsComResgate = new Set(campanhasComResgate.map(item => Number(item.campanha_id)));
    return campanhas.map(c => ({
      ...c,
      operadoras: ops[c.id] || (c.operadora_id ? [{ id: c.operadora_id, nome: c.operadora_nome }].filter(o => o.nome) : []),
      operadora_ids: (ops[c.id] || (c.operadora_id ? [{ id: c.operadora_id }] : [])).map(o => Number(o.id)),
      participantes: users[c.id] || [],
      participante_ids: (users[c.id] || []).map(u => Number(u.id)),
      regras: regrasPorCampanha[c.id] || [{
        operadora_id: c.operadora_id ? Number(c.operadora_id) : null,
        operadora_nome: c.operadora_nome || null,
        publico_base: c.categoria === 'registro_cliente' ? 'ambos' : (c.publico_base || 'ambos'),
        tipo: 'categoria'
      }],
      vendas_excecao: excecoesPorCampanha[c.id] || [],
      venda_excecao_ids: (excecoesPorCampanha[c.id] || []).map(venda => Number(venda.id)),
      periodo_bloqueado: idsComResgate.has(Number(c.id)),
      em_grupo: (users[c.id] || []).length > 1
    }));
  }

  static async findAll() {
    const campanhas = await db(`${this.tableName} as c`).leftJoin('operadoras as o', 'c.operadora_id', 'o.id')
      .select('c.*', 'o.nome as operadora_nome').orderBy('c.id', 'asc');
    return this.anexarRelacoes(campanhas);
  }

  static async syncFiltros(trx, campanhaId, dados) {
    await Promise.all([
      trx('campanha_operadoras').where({ campanha_id: campanhaId }).del(),
      trx('campanha_regras').where({ campanha_id: campanhaId }).del()
    ]);
    if (dados.operadora_ids.length) await trx('campanha_operadoras').insert(dados.operadora_ids.map(operadora_id => ({ campanha_id: campanhaId, operadora_id })));
    if (dados.regras.length) await trx('campanha_regras').insert(dados.regras.map(regra => ({ campanha_id: campanhaId, ...regra })));
  }

  static async syncParticipantes(trx, campanhaId, dados) {
    await trx('campanha_participantes').where({ campanha_id: campanhaId }).del();
    const participanteIds = dados.participante_ids.length
      ? dados.participante_ids
      : (await trx('usuarios').where('ativo', true).pluck('id')).map(Number);
    if (!participanteIds.length) {
      const erro = new Error('A campanha precisa ter pelo menos um participante ativo.');
      erro.code = 'CAMPANHA_SEM_PARTICIPANTES';
      throw erro;
    }
    await trx('campanha_participantes').insert(participanteIds.map(usuario_id => ({ campanha_id: campanhaId, usuario_id })));
  }

  static async syncVendasExcecao(trx, campanhaId, dados) {
    const atuais = new Set((await trx('campanha_vendas_excecoes').where({ campanha_id: campanhaId }).pluck('venda_id')).map(Number));
    const adicionadas = dados.venda_excecao_ids.filter(id => !atuais.has(Number(id)));
    if (adicionadas.length) {
      const validas = await trx('vendas')
        .whereIn('id', adicionadas)
        .whereNull('excluido_em')
        .whereNull('cancelada_em')
        .where(builder => builder.whereNull('status_funil').orWhereNot('status_funil', 'retorno'))
        .pluck('id');
      if (validas.length !== adicionadas.length) {
        const erro = new Error('Uma ou mais vendas selecionadas não estão mais disponíveis para exceção.');
        erro.code = 'CAMPANHA_VENDA_EXCECAO_INVALIDA';
        throw erro;
      }
    }
    await trx('campanha_vendas_excecoes').where({ campanha_id: campanhaId }).del();
    if (dados.venda_excecao_ids.length) {
      await trx('campanha_vendas_excecoes').insert(dados.venda_excecao_ids.map(venda_id => ({
        campanha_id: campanhaId,
        venda_id
      })));
    }
  }

  static async updateAll(campanhasArray) {
    return db.transaction(async trx => {
      for (const campanha of campanhasArray) {
        const dados = normalizarCampanha(campanha);
        const atual = await trx(this.tableName).where({ id: campanha.id }).select('data_inicio', 'data_fim').first();
        const temResgate = await trx('campanha_resgates').where({ campanha_id: campanha.id }).first('id');
        if (temResgate && atual && periodoFoiAlterado(atual, dados)) {
          const erro = new Error('O período não pode ser alterado após o primeiro resgate.');
          erro.code = 'CAMPANHA_PERIODO_BLOQUEADO';
          throw erro;
        }
        await trx(this.tableName).where({ id: campanha.id }).update({
          tipo: dados.tipo, periodo: dados.periodo, categoria: dados.categoria, target: dados.target,
          data_inicio: dados.data_inicio, data_fim: dados.data_fim,
          desc: dados.desc, reward: dados.reward, operadora_id: dados.operadora_id,
          publico_base: dados.publico_base, categoria_personalizada: dados.categoria_personalizada, updated_at: db.fn.now()
        });
        // A ausência de campos de relação preserva campanhas legadas no update.
        if (Array.isArray(campanha.regras) || Array.isArray(campanha.operadora_ids)) await this.syncFiltros(trx, campanha.id, dados);
        if (Array.isArray(campanha.participante_ids)) await this.syncParticipantes(trx, campanha.id, dados);
        if (Array.isArray(campanha.venda_excecao_ids)) await this.syncVendasExcecao(trx, campanha.id, dados);
      }
    });
  }

  static async create(data) {
    const dados = normalizarCampanha(data);
    const [id] = await db.transaction(async trx => {
      const [campanhaId] = await trx(this.tableName).insert({
        tipo: dados.tipo, periodo: dados.periodo, categoria: dados.categoria, target: dados.target, desc: dados.desc,
        data_inicio: dados.data_inicio, data_fim: dados.data_fim,
        reward: dados.reward, is_gift: dados.is_gift, operadora_id: dados.operadora_id, publico_base: dados.publico_base,
        categoria_personalizada: dados.categoria_personalizada, created_at: db.fn.now(), updated_at: db.fn.now()
      });
      await Promise.all([
        this.syncFiltros(trx, campanhaId, dados),
        this.syncParticipantes(trx, campanhaId, dados),
        this.syncVendasExcecao(trx, campanhaId, dados)
      ]);
      return [campanhaId];
    });
    return (await this.findAll()).find(c => Number(c.id) === Number(id));
  }

  static async deleteById(id) {
    return db.transaction(async trx => {
      const campanha = await trx(this.tableName).where({ id }).where('is_gift', true).first('id');
      if (!campanha) return 0;

      await trx('campanha_resgates').where({ campanha_id: id }).del();
      await trx('campanha_regras').where({ campanha_id: id }).del();
      await trx('campanha_operadoras').where({ campanha_id: id }).del();
      await trx('campanha_participantes').where({ campanha_id: id }).del();
      await trx('campanha_vendas_excecoes').where({ campanha_id: id }).del();
      return trx(this.tableName).where({ id }).where('is_gift', true).del();
    });
  }
}

Campanha._internals = { normalizarDataISO, periodoFoiAlterado };
module.exports = Campanha;
