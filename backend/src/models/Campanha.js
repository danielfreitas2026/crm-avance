const db = require('../database/connection');

const PERIODOS_VALIDOS = ['diaria', 'semanal', 'mensal'];
const CATEGORIAS_VALIDAS = ['registro_cliente', 'chip_novo', 'portabilidade', 'internet', 'valor_monetario', 'outros'];
const PUBLICOS_BASE_VALIDOS = ['ambos', 'base', 'nao_base'];

function isGift(campanha) {
  return campanha.is_gift === true || campanha.is_gift === 1 || campanha.is_gift === '1';
}

function idsValidos(valor) {
  return [...new Set((Array.isArray(valor) ? valor : []).map(Number).filter(Number.isInteger).filter(id => id > 0))];
}

function normalizarCampanha(campanha) {
  const periodo = PERIODOS_VALIDOS.includes(campanha.periodo) ? campanha.periodo : 'diaria';
  const categoria = CATEGORIAS_VALIDAS.includes(campanha.categoria) ? campanha.categoria : 'registro_cliente';
  const publicoBase = categoria === 'registro_cliente'
    ? 'ambos'
    : (PUBLICOS_BASE_VALIDOS.includes(campanha.publico_base) ? campanha.publico_base : 'ambos');
  const operadoraIds = idsValidos(campanha.operadora_ids);
  const participantes = idsValidos(campanha.participante_ids);

  return {
    tipo: isGift(campanha) ? `${periodo}_${categoria}` : (campanha.tipo || 'diaria'),
    periodo,
    categoria,
    target: Number(campanha.target || 0),
    desc: String(campanha.desc || '').trim(),
    reward: campanha.reward || null,
    is_gift: campanha.is_gift !== undefined ? campanha.is_gift : true,
    // Mantem o campo legado coerente para integrações antigas.
    operadora_id: operadoraIds[0] || (campanha.operadora_id ? Number(campanha.operadora_id) : null),
    publico_base: publicoBase,
    categoria_personalizada: categoria === 'outros' ? String(campanha.categoria_personalizada || '').trim() : null,
    operadora_ids: operadoraIds,
    participante_ids: participantes
  };
}

class Campanha {
  static tableName = 'campanhas';
  static get periodosValidos() { return PERIODOS_VALIDOS; }
  static get categoriasValidas() { return CATEGORIAS_VALIDAS; }
  static get publicosBaseValidos() { return PUBLICOS_BASE_VALIDOS; }

  static async anexarRelacoes(campanhas) {
    if (!campanhas.length) return campanhas;
    const ids = campanhas.map(c => c.id);
    const [operadoras, participantes] = await Promise.all([
      db('campanha_operadoras as co').join('operadoras as o', 'co.operadora_id', 'o.id')
        .whereIn('co.campanha_id', ids).select('co.campanha_id', 'o.id', 'o.nome'),
      db('campanha_participantes as cp').join('usuarios as u', 'cp.usuario_id', 'u.id')
        .whereIn('cp.campanha_id', ids).select('cp.campanha_id', 'u.id', 'u.nome', 'u.email')
    ]);
    const porCampanha = (rows, chave) => rows.reduce((acc, row) => {
      (acc[row.campanha_id] ||= []).push(chave(row)); return acc;
    }, {});
    const ops = porCampanha(operadoras, r => ({ id: r.id, nome: r.nome }));
    const users = porCampanha(participantes, r => ({ id: r.id, nome: r.nome, email: r.email }));
    return campanhas.map(c => ({
      ...c,
      operadoras: ops[c.id] || (c.operadora_id ? [{ id: c.operadora_id, nome: c.operadora_nome }].filter(o => o.nome) : []),
      operadora_ids: (ops[c.id] || (c.operadora_id ? [{ id: c.operadora_id }] : [])).map(o => Number(o.id)),
      participantes: users[c.id] || [],
      participante_ids: (users[c.id] || []).map(u => Number(u.id)),
      em_grupo: (users[c.id] || []).length > 1
    }));
  }

  static async findAll() {
    const campanhas = await db(`${this.tableName} as c`).leftJoin('operadoras as o', 'c.operadora_id', 'o.id')
      .select('c.*', 'o.nome as operadora_nome').orderBy('c.id', 'asc');
    return this.anexarRelacoes(campanhas);
  }

  static async syncRelacoes(trx, campanhaId, dados) {
    await Promise.all([trx('campanha_operadoras').where({ campanha_id: campanhaId }).del(), trx('campanha_participantes').where({ campanha_id: campanhaId }).del()]);
    if (dados.operadora_ids.length) await trx('campanha_operadoras').insert(dados.operadora_ids.map(operadora_id => ({ campanha_id: campanhaId, operadora_id })));
    if (dados.participante_ids.length) await trx('campanha_participantes').insert(dados.participante_ids.map(usuario_id => ({ campanha_id: campanhaId, usuario_id })));
  }

  static async updateAll(campanhasArray) {
    return db.transaction(async trx => {
      for (const campanha of campanhasArray) {
        const dados = normalizarCampanha(campanha);
        await trx(this.tableName).where({ id: campanha.id }).update({
          tipo: dados.tipo, periodo: dados.periodo, categoria: dados.categoria, target: dados.target,
          desc: dados.desc, reward: dados.reward, operadora_id: dados.operadora_id,
          publico_base: dados.publico_base, categoria_personalizada: dados.categoria_personalizada, updated_at: db.fn.now()
        });
        // A ausência de campos de relação preserva campanhas legadas no update.
        if (Array.isArray(campanha.operadora_ids) || Array.isArray(campanha.participante_ids)) await this.syncRelacoes(trx, campanha.id, dados);
      }
    });
  }

  static async create(data) {
    const dados = normalizarCampanha(data);
    const [id] = await db.transaction(async trx => {
      const [campanhaId] = await trx(this.tableName).insert({
        tipo: dados.tipo, periodo: dados.periodo, categoria: dados.categoria, target: dados.target, desc: dados.desc,
        reward: dados.reward, is_gift: dados.is_gift, operadora_id: dados.operadora_id, publico_base: dados.publico_base,
        categoria_personalizada: dados.categoria_personalizada, created_at: db.fn.now(), updated_at: db.fn.now()
      });
      await this.syncRelacoes(trx, campanhaId, dados);
      return [campanhaId];
    });
    return (await this.findAll()).find(c => Number(c.id) === Number(id));
  }

  static async deleteById(id) { return db(this.tableName).where({ id }).where('is_gift', true).del(); }
}

module.exports = Campanha;
