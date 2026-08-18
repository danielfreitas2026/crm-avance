/**
 * Controller HTTP de campanhas e recompensas.
 *
 * Calcula ciclos de metas, progresso por vendedora, resgates e administracao
 * das campanhas configuradas no sistema.
 */
const Campanha = require('../models/Campanha');
const Usuario = require('../models/Usuario');
const knex = require('../database/connection');
const { listarPermissoesEfetivas } = require('../utils/permissoes');
const TIME_ZONE = 'America/Sao_Paulo';

function dataHojeSaoPaulo(base = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(base).reduce((acc, parte) => ({ ...acc, [parte.type]: parte.value }), {});
  return `${partes.year}-${partes.month}-${partes.day}`;
}

function dataValidaISO(valor) {
  const texto = String(valor || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const [ano, mes, dia] = texto.split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}

function adicionarDiasISO(dataISO, dias) {
  const data = new Date(`${dataISO}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

function intervaloCampanha(campanha, hoje = dataHojeSaoPaulo()) {
  const inicio = String(campanha.data_inicio || '').slice(0, 10);
  const fimInclusivo = String(campanha.data_fim || '').slice(0, 10);
  const estado = hoje < inicio ? 'futura' : hoje > fimInclusivo ? 'encerrada' : 'ativa';
  const fimConsulta = estado === 'ativa' ? (hoje < fimInclusivo ? hoje : fimInclusivo) : fimInclusivo;
  return {
    periodo: 'personalizado',
    inicioStr: inicio,
    fimInclusivoStr: fimInclusivo,
    fimStr: adicionarDiasISO(fimConsulta, 1),
    estado
  };
}

function decorarCampanha(campanha, hoje = dataHojeSaoPaulo()) {
  return { ...campanha, estado_periodo: intervaloCampanha(campanha, hoje).estado };
}

function ocultarDetalhesExcecoes(campanha) {
  const { vendas_excecao, venda_excecao_ids, ...publica } = campanha;
  void vendas_excecao;
  void venda_excecao_ids;
  return publica;
}

function campanhaVisivelParaUsuario(campanha, current, claimed, hoje = dataHojeSaoPaulo()) {
  void campanha;
  void current;
  void claimed;
  void hoje;
  return true;
}

/**
 * Valida os campos obrigatorios e categorias permitidas de uma campanha.
 */
function validarCampanha(campanha) {
  if (!campanha.desc || !Number(campanha.target)) {
    return 'Alvo e descricao sao obrigatorios.';
  }

  if (Number(campanha.target) < 1) {
    return 'Alvo deve ser maior que zero.';
  }

  if (!Campanha.periodosValidos.includes(campanha.periodo)) {
    return 'Período inválido.';
  }

  if (!Campanha.categoriasValidas.includes(campanha.categoria)) {
    return 'Categoria inválida.';
  }

  if (!dataValidaISO(campanha.data_inicio) || !dataValidaISO(campanha.data_fim)) {
    return 'Informe datas inicial e final válidas.';
  }

  if (String(campanha.data_inicio).slice(0, 10) > String(campanha.data_fim).slice(0, 10)) {
    return 'A data inicial deve ser anterior ou igual à data final.';
  }

  if (campanha.categoria === 'outros' && !String(campanha.categoria_personalizada || '').trim()) {
    return 'Informe a categoria personalizada.';
  }

  if (campanha.publico_base && !Campanha.publicosBaseValidos.includes(campanha.publico_base)) {
    return 'Público de base inválido.';
  }

  if (campanha.regras !== undefined && !Array.isArray(campanha.regras)) {
    return 'Regras da campanha devem ser uma lista.';
  }

  if (campanha.venda_excecao_ids !== undefined && (!Array.isArray(campanha.venda_excecao_ids)
    || campanha.venda_excecao_ids.some(id => !Number.isInteger(Number(id)) || Number(id) <= 0))) {
    return 'Vendas de exceção devem ser uma lista de identificadores válidos.';
  }

  const regraInvalida = (campanha.regras || []).find(regra => (
    !Campanha.publicosBaseValidos.includes(regra?.publico_base)
    || !Campanha.tiposRegraValidos.includes(regra?.tipo)
    || (regra?.tipo_chip !== undefined && !Campanha.tiposChipRegraValidos.includes(regra.tipo_chip))
    || (regra?.operadora_id !== null && regra?.operadora_id !== ''
      && (!Number.isInteger(Number(regra.operadora_id)) || Number(regra.operadora_id) <= 0))
  ));
  if (regraInvalida) return 'Regra de elegibilidade inválida.';

  return null;
}

/**
 * Indica se a campanha representa uma recompensa resgatavel.
 */
function campanhaEhGift(campanha) {
  return campanha.is_gift === true || campanha.is_gift === 1 || campanha.is_gift === '1';
}

/**
 * Converte uma data para o formato YYYY-MM-DD usado nas consultas.
 */
function toDateStr(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Calcula o intervalo de datas do ciclo diario, semanal ou mensal.
 */
function getCiclo(periodo, baseDate = new Date()) {
  if (periodo === 'semanal') {
    const diaSemana = baseDate.getDay();
    const diasParaSegunda = diaSemana === 0 ? -6 : 1 - diaSemana;
    const inicio = new Date(baseDate);
    inicio.setDate(baseDate.getDate() + diasParaSegunda);
    inicio.setHours(0, 0, 0, 0);

    const fim = new Date(inicio);
    fim.setDate(inicio.getDate() + 7);

    return {
      periodo: 'semanal',
      inicio,
      fim,
      inicioStr: toDateStr(inicio),
      fimStr: toDateStr(fim)
    };
  }

  if (periodo === 'mensal') {
    const inicio = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
    const fim = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 1);

    return {
      periodo: 'mensal',
      inicio,
      fim,
      inicioStr: toDateStr(inicio),
      fimStr: toDateStr(fim)
    };
  }

  const inicio = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const fim = new Date(inicio);
  fim.setDate(inicio.getDate() + 1);

  return {
    periodo: 'diaria',
    inicio,
    fim,
    inicioStr: toDateStr(inicio),
    fimStr: toDateStr(fim)
  };
}

/**
 * Remove acentos e padroniza texto para comparacoes internas.
 */
function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Soma a quantidade de chips a partir do JSON detalhado ou do campo legado.
 */
function somarQuantidadeChips(valoresUnitariosChips, quantidadeLinhas, fallback = 0) {
  if (valoresUnitariosChips) {
    try {
      const itens = typeof valoresUnitariosChips === 'string'
        ? JSON.parse(valoresUnitariosChips)
        : valoresUnitariosChips;

      if (Array.isArray(itens)) {
        const total = itens.reduce((acc, item) => acc + Number(item?.quantidade || 0), 0);

        if (total > 0) {
          return total;
        }
      }
    } catch {
      // Usa fallback abaixo quando o JSON antigo estiver inválido.
    }
  }

  return Number(quantidadeLinhas || 0) || fallback;
}

/**
 * Normaliza o tipo de linha de chip para novo ou portabilidade.
 */
function normalizarTipoLinhaChip(valor) {
  const tipo = normalizarTexto(valor);
  return tipo.includes('porta') ? 'portabilidade' : 'novo';
}

/** Normaliza os itens detalhados de uma venda e aplica fallback para registros antigos. */
function parseItensVenda(venda) {
  try {
    const itens = typeof venda.valores_unitarios_chips === 'string'
      ? JSON.parse(venda.valores_unitarios_chips)
      : venda.valores_unitarios_chips;
    if (Array.isArray(itens) && itens.length) {
      const normalizados = itens.map((item, index) => ({
        chave: `item:${index}`,
        quantidade: Number(item?.quantidade || 0),
        valor_unitario: Number(item?.valor_unitario || 0),
        tipo: normalizarTipoLinhaChip(item?.tipo_linha || item?.tipo || item?.categoria),
        operadora_id: Number(item?.operadora_id || venda.operadora_id) || null,
        vendedora_id: Number(item?.vendedora_id || venda.vendedora_id) || null,
        detalhado: true
      })).filter(item => item.quantidade > 0);
      if (normalizados.length) return normalizados;
    }
  } catch {
    // Venda antiga: usa os campos principais abaixo.
  }

  const tipoVenda = normalizarTexto(venda.tipo_venda);
  return [{
    chave: 'venda',
    quantidade: Number(venda.quantidade_linhas || 0) || 1,
    valor_unitario: 0,
    tipo: tipoVenda.includes('porta') ? 'portabilidade' : 'novo',
    operadora_id: Number(venda.operadora_id) || null,
    vendedora_id: Number(venda.vendedora_id) || null,
    detalhado: false
  }];
}

/**
 * Soma chips de um tipo especifico quando os itens possuem classificacao.
 */
function somarQuantidadeChipsPorTipo(valoresUnitariosChips, tipoLinha) {
  if (!valoresUnitariosChips) return null;

  try {
    const itens = typeof valoresUnitariosChips === 'string'
      ? JSON.parse(valoresUnitariosChips)
      : valoresUnitariosChips;

    if (!Array.isArray(itens)) return null;

    const temTipoPorItem = itens.some(item => item?.tipo_linha || item?.tipo || item?.categoria);
    if (!temTipoPorItem) return null;

    return itens.reduce((acc, item) => (
      normalizarTipoLinhaChip(item?.tipo_linha || item?.tipo || item?.categoria) === tipoLinha
        ? acc + Number(item?.quantidade || 0)
        : acc
    ), 0);
  } catch {
    return null;
  }
}

/**
 * Calcula a quantidade da venda que conta para uma categoria de campanha.
 */
function quantidadeCategoriaVenda(venda, categoria) {
  const porTipo = categoria === 'chip_novo'
    ? somarQuantidadeChipsPorTipo(venda.valores_unitarios_chips, 'novo')
    : categoria === 'portabilidade'
      ? somarQuantidadeChipsPorTipo(venda.valores_unitarios_chips, 'portabilidade')
      : null;

  if (porTipo !== null) return porTipo;

  const tipoVenda = normalizarTexto(venda.tipo_venda);
  if (categoria === 'chip_novo' && tipoVenda === 'novo') {
    return somarQuantidadeChips(venda.valores_unitarios_chips, venda.quantidade_linhas);
  }

  if (categoria === 'portabilidade' && tipoVenda === 'portabilidade') {
    return somarQuantidadeChips(venda.valores_unitarios_chips, venda.quantidade_linhas);
  }

  return 0;
}

/**
 * Lista clientes criados por uma vendedora dentro do ciclo informado.
 */
async function listarClientesDoCiclo(usuarioId, ciclo) {
  return knex('clientes')
    .select('id', 'operadora_atual_id')
    .where('criado_por_id', usuarioId)
    .whereRaw('DATE(created_at) >= ?', [ciclo.inicioStr])
    .whereRaw('DATE(created_at) < ?', [ciclo.fimStr]);
}

/**
 * Lista vendas validas de uma vendedora dentro do ciclo informado.
 */
async function listarVendasDoCiclo(vendedoraId, ciclo) {
  const dataReferencia = "COALESCE(NULLIF(NULLIF(v.data_venda, '0000-00-00'), '1899-11-30'), NULLIF(DATE(v.criado_em), '0000-00-00'), DATE(v.created_at))";

  return knex('vendas as v')
    .leftJoin('tipos_venda as tv', 'v.tipo_venda_id', 'tv.id')
    .leftJoin('servicos as s', 'v.servico_id', 's.id')
    .select(
      'v.id',
      'v.vendedora_id',
      'v.operadora_id',
      'v.quantidade_linhas',
      'v.valores_unitarios_chips',
      'v.valor_total',
      'v.cliente_da_base',
      'v.categoria_campanha',
      'tv.nome as tipo_venda',
      's.nome as servico'
    )
    .where('v.vendedora_id', vendedoraId)
    .whereNot('v.status_funil', 'retorno')
    .whereRaw(`${dataReferencia} >= ?`, [ciclo.inicioStr])
    .whereRaw(`${dataReferencia} < ?`, [ciclo.fimStr]);
}

/**
 * Indica se a venda pertence a operadora filtrada.
 */
function operadoraIdsCampanha(campanha) {
  const ids = Array.isArray(campanha.operadora_ids) ? campanha.operadora_ids : [];
  return ids.length ? ids.map(Number) : (campanha.operadora_id ? [Number(campanha.operadora_id)] : []);
}

/** Lista de uma vez as vendas dos participantes dentro do intervalo da campanha. */
async function listarVendasDaCampanha(participanteIds, ciclo) {
  if (!participanteIds.length) return [];
  const dataReferencia = "COALESCE(NULLIF(NULLIF(v.data_venda, '0000-00-00'), '1899-11-30'), NULLIF(DATE(v.criado_em), '0000-00-00'), DATE(v.created_at))";

  return knex('vendas as v')
    .leftJoin('tipos_venda as tv', 'v.tipo_venda_id', 'tv.id')
    .leftJoin('servicos as s', 'v.servico_id', 's.id')
    .leftJoin('clientes as cli', 'v.cliente_id', 'cli.id')
    .leftJoin('usuarios as u', 'v.vendedora_id', 'u.id')
    .leftJoin('operadoras as o', 'v.operadora_id', 'o.id')
    .select(
      'v.id', 'v.cliente_id', 'v.vendedora_id', 'v.operadora_id', 'v.quantidade_linhas',
      'v.valores_unitarios_chips', 'v.valor_total', 'v.cliente_da_base',
      'v.categoria_campanha', 'tv.nome as tipo_venda', 's.nome as servico',
      'u.nome as vendedora_nome', 'o.nome as operadora_nome',
      knex.raw(`${dataReferencia} as data_contabilizada`),
      knex.raw("COALESCE(NULLIF(v.razao_social, ''), NULLIF(cli.razao_social, ''), NULLIF(v.nome, ''), NULLIF(cli.nome, ''), CONCAT('Venda #', v.id)) as cliente_nome")
    )
    .whereNot('v.status_funil', 'retorno')
    .whereRaw(`${dataReferencia} >= ?`, [ciclo.inicioStr])
    .whereRaw(`${dataReferencia} < ?`, [ciclo.fimStr])
    .where(builder => {
      builder.whereIn('v.vendedora_id', participanteIds).orWhereExists(function vendaCompartilhada() {
        this.select(knex.raw('1'))
          .from('venda_vendedoras as vv_campanha')
          .whereRaw('vv_campanha.venda_id = v.id')
          .whereIn('vv_campanha.usuario_id', participanteIds);
      });
    });
}

/** Busca exceções válidas sem aplicar período, participante ou regras. */
async function listarVendasExcecaoCampanha(vendaIds = []) {
  const ids = [...new Set(vendaIds.map(Number).filter(Boolean))];
  if (!ids.length) return [];
  return knex('vendas as v')
    .leftJoin('tipos_venda as tv', 'v.tipo_venda_id', 'tv.id')
    .leftJoin('servicos as s', 'v.servico_id', 's.id')
    .leftJoin('clientes as cli', 'v.cliente_id', 'cli.id')
    .leftJoin('usuarios as u', 'v.vendedora_id', 'u.id')
    .leftJoin('operadoras as o', 'v.operadora_id', 'o.id')
    .select(
      'v.id', 'v.cliente_id', 'v.vendedora_id', 'v.operadora_id', 'v.quantidade_linhas',
      'v.valores_unitarios_chips', 'v.valor_total', 'v.cliente_da_base',
      'v.categoria_campanha', 'tv.nome as tipo_venda', 's.nome as servico',
      'u.nome as vendedora_nome', 'o.nome as operadora_nome',
      knex.raw("COALESCE(NULLIF(NULLIF(v.data_venda, '0000-00-00'), '1899-11-30'), NULLIF(DATE(v.criado_em), '0000-00-00'), DATE(v.created_at)) as data_contabilizada"),
      knex.raw("COALESCE(NULLIF(v.razao_social, ''), NULLIF(cli.razao_social, ''), NULLIF(v.nome, ''), NULLIF(cli.nome, ''), CONCAT('Venda #', v.id)) as cliente_nome")
    )
    .whereIn('v.id', ids)
    .whereNull('v.excluido_em')
    .whereNull('v.cancelada_em')
    .where(builder => builder.whereNull('v.status_funil').orWhereNot('v.status_funil', 'retorno'));
}

/** Lista clientes registrados pelos participantes no intervalo da campanha. */
async function listarClientesDaCampanha(participanteIds, ciclo) {
  if (!participanteIds.length) return [];
  return knex('clientes')
    .select('id', 'operadora_atual_id', 'criado_por_id')
    .whereIn('criado_por_id', participanteIds)
    .whereRaw('DATE(created_at) >= ?', [ciclo.inicioStr])
    .whereRaw('DATE(created_at) < ?', [ciclo.fimStr]);
}

function vendaPertencePublicoBase(venda, campanha) {
  const publico = campanha.publico_base || 'ambos';
  if (publico === 'ambos') return true;
  if (venda.cliente_da_base === null || venda.cliente_da_base === undefined) return false;
  const eBase = venda.cliente_da_base === true || Number(venda.cliente_da_base) === 1;
  return publico === 'base' ? eBase : !eBase;
}

function regrasCampanha(campanha) {
  if (Array.isArray(campanha.regras) && campanha.regras.length) return campanha.regras;
  const ids = operadoraIdsCampanha(campanha);
  return (ids.length ? ids : [null]).map(operadora_id => ({
    operadora_id,
    publico_base: campanha.categoria === 'registro_cliente' ? 'ambos' : (campanha.publico_base || 'ambos'),
    tipo: 'categoria',
    tipo_chip: 'ambos'
  }));
}

function itemAtendeTipo(item, venda, tipo, categoriaCampanha) {
  const categoria = tipo === 'categoria' ? categoriaCampanha : tipo;
  if (categoria === 'chip_novo') return item.tipo === 'novo';
  if (categoria === 'portabilidade') return item.tipo === 'portabilidade';
  if (categoria === 'novo_portabilidade') return item.tipo === 'novo' || item.tipo === 'portabilidade';
  if (categoria === 'internet') return normalizarTexto(venda.servico) === 'internet';
  return true;
}

function itemAtendeTipoChip(item, tipoChip) {
  return !tipoChip || tipoChip === 'ambos' || item.tipo === tipoChip;
}

/** Retorna a união dos itens atendidos pelas regras OU, sem duplicá-los. */
function itensElegiveisCampanha(campanha, venda) {
  const itens = parseItensVenda(venda);
  const chaves = new Set();

  for (const regra of regrasCampanha(campanha)) {
    if (!vendaPertencePublicoBase(venda, { publico_base: regra.publico_base || 'ambos' })) continue;
    for (const item of itens) {
      const operadoraId = Number(regra.operadora_id) || null;
      if (operadoraId && operadoraId !== Number(item.operadora_id)) continue;
      if (!itemAtendeTipo(item, venda, regra.tipo || 'categoria', campanha.categoria)) continue;
      if (!itemAtendeTipoChip(item, regra.tipo_chip || 'ambos')) continue;
      chaves.add(item.chave);
    }
  }

  return itens.filter(item => chaves.has(item.chave));
}

/**
 * Classifica vendas e clientes nos totais usados pelo progresso geral.
 */
function classificarVendas(rows, clientes = []) {
  const totais = {
    registro_cliente: clientes.length,
    chip_novo: 0,
    portabilidade: 0,
    internet: 0
  };

  for (const row of rows) {
    const servico = normalizarTexto(row.servico);

    totais.portabilidade += quantidadeCategoriaVenda(row, 'portabilidade');

    if (servico === 'internet') {
      totais.internet += somarQuantidadeChips(row.valores_unitarios_chips, row.quantidade_linhas, 1);
    }

    totais.chip_novo += quantidadeCategoriaVenda(row, 'chip_novo');
  }

  return totais;
}

/**
 * Calcula o progresso de uma campanha especifica para vendas e clientes.
 */
function calcularValorCampanha(campanha, vendas, clientes) {
  const categoria = campanha.categoria || 'registro_cliente';
  if (categoria === 'registro_cliente') {
    const regras = regrasCampanha(campanha);
    return clientes.filter(cliente => regras.some(regra => (
      !regra.operadora_id || Number(regra.operadora_id) === Number(cliente.operadora_atual_id)
    ))).length + vendas.filter(venda => venda.__excecao).length;
  }

  return vendas.reduce((acc, venda) => {
    if (venda.__excecao) {
      if (categoria === 'venda' || categoria === 'outros') return acc + 1;
      if (categoria === 'valor_monetario') return acc + Number(venda.valor_total || 0);
      return acc + parseItensVenda(venda).reduce((total, item) => total + item.quantidade, 0);
    }
    const servico = normalizarTexto(venda.servico);
    if (categoria === 'outros'
      && normalizarTexto(venda.categoria_campanha) !== normalizarTexto(campanha.categoria_personalizada)) return acc;
    const itensElegiveis = itensElegiveisCampanha(campanha, venda);
    if (!itensElegiveis.length) return acc;

    if (categoria === 'venda') return acc + 1;

    if (categoria === 'chip_novo') {
      return acc + itensElegiveis
        .filter(item => item.tipo === 'novo')
        .reduce((total, item) => total + item.quantidade, 0);
    }

    if (categoria === 'portabilidade') {
      return acc + itensElegiveis
        .filter(item => item.tipo === 'portabilidade')
        .reduce((total, item) => total + item.quantidade, 0);
    }

    if (categoria === 'internet' && servico === 'internet') {
      return acc + itensElegiveis.reduce((total, item) => total + item.quantidade, 0);
    }

    if (categoria === 'quantidade_chip') {
      return acc + itensElegiveis.reduce((total, item) => total + item.quantidade, 0);
    }

    if (categoria === 'valor_monetario') {
      const valorItens = itensElegiveis.reduce((total, item) => total + (item.quantidade * item.valor_unitario), 0);
      return acc + (valorItens > 0 ? valorItens : Number(venda.valor_total || 0));
    }

    if (categoria === 'outros') return acc + 1;

    return acc;
  }, 0);
}

function adicionarContribuicao(mapa, participanteIds, usuarioId, valor, permitirExterno = false) {
  const id = Number(usuarioId);
  const quantidade = Number(valor || 0);
  if ((!participanteIds.has(id) && !permitirExterno) || !id || !Number.isFinite(quantidade) || quantidade <= 0) return;
  mapa.set(id, (mapa.get(id) || 0) + quantidade);
}

/** Distribui o total elegível pelos participantes sem contar a mesma venda ou item duas vezes. */
function calcularContribuicoesCampanha(campanha, vendas = [], clientes = [], participantes = []) {
  const participanteIds = new Set(participantes.map(item => Number(item.id ?? item)).filter(Boolean));
  const contribuicoes = new Map([...participanteIds].map(id => [id, 0]));
  const categoria = campanha.categoria || 'registro_cliente';

  if (categoria === 'registro_cliente') {
    const regras = regrasCampanha(campanha);
    for (const cliente of clientes) {
      if (!regras.some(regra => !regra.operadora_id || Number(regra.operadora_id) === Number(cliente.operadora_atual_id))) continue;
      adicionarContribuicao(contribuicoes, participanteIds, cliente.criado_por_id, 1);
    }
    vendas.filter(venda => venda.__excecao).forEach(venda => {
      adicionarContribuicao(contribuicoes, participanteIds, venda.vendedora_id, 1, true);
    });
  } else {
    for (const venda of vendas) {
      if (venda.__excecao) {
        if (categoria === 'venda' || categoria === 'outros') {
          adicionarContribuicao(contribuicoes, participanteIds, venda.vendedora_id, 1, true);
          continue;
        }
        if (categoria === 'valor_monetario') {
          const itens = parseItensVenda(venda);
          const valorDetalhado = itens.reduce((total, item) => total + (item.quantidade * item.valor_unitario), 0);
          if (valorDetalhado > 0) {
            const valorVenda = Number(venda.valor_total || valorDetalhado);
            const fator = valorVenda / valorDetalhado;
            itens.forEach(item => adicionarContribuicao(
              contribuicoes, participanteIds, item.vendedora_id, item.quantidade * item.valor_unitario * fator, true
            ));
          } else {
            adicionarContribuicao(contribuicoes, participanteIds, venda.vendedora_id, venda.valor_total, true);
          }
          continue;
        }
        parseItensVenda(venda).forEach(item => adicionarContribuicao(
          contribuicoes, participanteIds, item.vendedora_id, item.quantidade, true
        ));
        continue;
      }
      if (categoria === 'outros'
        && normalizarTexto(venda.categoria_campanha) !== normalizarTexto(campanha.categoria_personalizada)) continue;
      const itensElegiveis = itensElegiveisCampanha(campanha, venda);
      if (!itensElegiveis.length) continue;

      if (categoria === 'venda' || categoria === 'outros') {
        adicionarContribuicao(contribuicoes, participanteIds, venda.vendedora_id, 1);
        continue;
      }

      if (categoria === 'valor_monetario') {
        const valorDetalhado = itensElegiveis.reduce((total, item) => total + (item.quantidade * item.valor_unitario), 0);
        if (valorDetalhado > 0) {
          itensElegiveis.forEach(item => adicionarContribuicao(
            contribuicoes, participanteIds, item.vendedora_id, item.quantidade * item.valor_unitario
          ));
        } else {
          adicionarContribuicao(contribuicoes, participanteIds, venda.vendedora_id, venda.valor_total);
        }
        continue;
      }

      const servicoInternet = categoria === 'internet' && normalizarTexto(venda.servico) === 'internet';
      for (const item of itensElegiveis) {
        const elegivel = categoria === 'quantidade_chip'
          ? true
          : categoria === 'chip_novo'
          ? item.tipo === 'novo'
          : categoria === 'portabilidade'
            ? item.tipo === 'portabilidade'
            : servicoInternet;
        if (elegivel) adicionarContribuicao(contribuicoes, participanteIds, item.vendedora_id, item.quantidade);
      }
    }
  }

  return Object.fromEntries(contribuicoes);
}

function montarRanking(participantes, contribuicoes) {
  const ordenados = participantes.map(participante => ({
    id: Number(participante.id),
    nome: participante.nome,
    email: participante.email,
    foto_perfil: participante.foto_perfil || null,
    contribuicao: Number(contribuicoes[participante.id] || 0)
  })).sort((a, b) => b.contribuicao - a.contribuicao || String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
  const total = ordenados.reduce((soma, item) => soma + item.contribuicao, 0);
  let posicao = 0;
  let valorAnterior = null;

  return ordenados.map((item, index) => {
    if (valorAnterior === null || item.contribuicao !== valorAnterior) posicao = index + 1;
    valorAnterior = item.contribuicao;
    return {
      ...item,
      posicao,
      percentual_total: total > 0 ? Number(((item.contribuicao / total) * 100).toFixed(2)) : 0
    };
  });
}

/** Une vendas regulares e exceções, dando prioridade ao cálculo integral da exceção. */
function unirVendasCampanha(vendasRegulares = [], vendasExcecao = []) {
  const vendasPorId = new Map(vendasRegulares.map(venda => [Number(venda.id), venda]));
  vendasExcecao.forEach(venda => vendasPorId.set(Number(venda.id), { ...venda, __excecao: true }));
  return [...vendasPorId.values()];
}

/** Retorna somente as vendas que efetivamente acrescentam progresso à campanha. */
function montarVendasContabilizadas(campanha, vendas = []) {
  return vendas.map(venda => ({
    id: Number(venda.id),
    cliente_nome: venda.cliente_nome || `Venda #${venda.id}`,
    vendedora_nome: venda.vendedora_nome || 'Sem vendedor',
    operadora_nome: venda.operadora_nome || null,
    data_venda: venda.data_contabilizada || null,
    valor_total: Number(venda.valor_total || 0),
    contribuicao: Number(calcularValorCampanha(campanha, [venda], [])),
    excecao: Boolean(venda.__excecao)
  })).filter(venda => venda.contribuicao > 0)
    .sort((a, b) => String(b.data_venda || '').localeCompare(String(a.data_venda || '')) || b.id - a.id);
}

/** Calcula uma campanha coletiva uma única vez e retorna seu ranking. */
async function calcularCampanhaColetiva(campanha, hoje = dataHojeSaoPaulo()) {
  const participantes = Array.isArray(campanha.participantes) ? campanha.participantes : [];
  const participanteIds = participantes.map(item => Number(item.id)).filter(Boolean);
  const ciclo = intervaloCampanha(campanha, hoje);
  let vendasRegulares = [];
  let clientes = [];

  if (ciclo.estado !== 'futura') {
    [vendasRegulares, clientes] = await Promise.all([
      listarVendasDaCampanha(participanteIds, ciclo),
      listarClientesDaCampanha(participanteIds, ciclo)
    ]);
  }

  const vendasExcecao = await listarVendasExcecaoCampanha(campanha.venda_excecao_ids || []);
  const vendas = unirVendasCampanha(vendasRegulares, vendasExcecao);

  const contribuicoes = calcularContribuicoesCampanha(campanha, vendas, clientes, participantes);
  const idsExternos = Object.keys(contribuicoes).map(Number).filter(id => !participanteIds.includes(id));
  const usuariosExternos = idsExternos.length
    ? await knex('usuarios').whereIn('id', idsExternos).select('id', 'nome', 'email', 'foto_perfil')
    : [];
  const ranking = montarRanking([...participantes, ...usuariosExternos], contribuicoes);
  const current = calcularValorCampanha(campanha, vendas, clientes);
  const target = Number(campanha.target || 0);
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

  const vendasContabilizadas = montarVendasContabilizadas(campanha, vendas);

  return {
    current, target, pct, achieved: current >= target, estado_periodo: ciclo.estado,
    ranking, contribuicoes, vendasContabilizadas
  };
}

/**
 * Calcula o progresso geral e por campanha de uma vendedora no ciclo.
 */
async function calcularProgresso(usuarioId, ciclo, campanhas = []) {
  const [clientes, vendas] = await Promise.all([
    listarClientesDoCiclo(usuarioId, ciclo),
    listarVendasDoCiclo(usuarioId, ciclo)
  ]);

  const geral = classificarVendas(vendas, clientes);
  const campanhasProgresso = {};

  campanhas.forEach((campanha) => {
    campanhasProgresso[campanha.id] = calcularValorCampanha(campanha, vendas, clientes);
  });

  return {
    geral,
    campanhas: campanhasProgresso
  };
}

/** Calcula o progresso coletivo das campanhas visíveis para um participante. */
async function calcularCampanhasParaUsuario(usuarioId, campanhas, hoje = dataHojeSaoPaulo()) {
  const resultado = {};
  const visiveis = [];

  for (const campanha of campanhas) {
    const participantes = Array.isArray(campanha.participante_ids) ? campanha.participante_ids.map(Number) : [];
    if (participantes.length && !participantes.includes(Number(usuarioId))) continue;
    const calculo = await calcularCampanhaColetiva(campanha, hoje);
    resultado[campanha.id] = calculo;
    visiveis.push(campanha);
  }
  return { campanhas: resultado, visiveis };
}

/**
 * Agrupa campanhas ja resgatadas por usuario para consulta rapida.
 */
function agruparResgatesPorUsuario(resgates = []) {
  return resgates.reduce((acc, resgate) => {
    const usuarioId = Number(resgate.usuario_id);
    const campanhaId = Number(resgate.campanha_id);

    if (!acc[usuarioId]) {
      acc[usuarioId] = new Set();
    }

    acc[usuarioId].add(campanhaId);
    return acc;
  }, {});
}

function normalizarIdsEntrada(valor) {
  const itens = Array.isArray(valor) ? valor : String(valor || '').split(',');
  return [...new Set(itens.map(Number).filter(id => Number.isInteger(id) && id > 0))];
}

/** Monta uma campanha calculável a partir do estado ainda não salvo da tela administrativa. */
async function montarPreviaCampanha(campanhaPersistida, rascunho = {}) {
  const camposEditaveis = [
    'data_inicio', 'data_fim', 'categoria', 'categoria_personalizada', 'target', 'desc',
    'reward', 'publico_base', 'operadora_id', 'operadora_ids', 'participante_ids', 'regras'
  ];
  const previa = { ...campanhaPersistida };

  camposEditaveis.forEach(campo => {
    if (Object.prototype.hasOwnProperty.call(rascunho, campo)) previa[campo] = rascunho[campo];
  });

  const erroValidacao = validarCampanha(previa);
  if (erroValidacao) {
    const erro = new Error(erroValidacao);
    erro.code = 'CAMPANHA_PREVIA_INVALIDA';
    throw erro;
  }

  let participanteIds = normalizarIdsEntrada(previa.participante_ids);
  if (!participanteIds.length) {
    participanteIds = (await knex('usuarios').where('ativo', true).pluck('id')).map(Number);
  }
  const participantes = participanteIds.length
    ? await knex('usuarios').whereIn('id', participanteIds).select('id', 'nome', 'email', 'foto_perfil')
    : [];

  if (!participantes.length) {
    const erro = new Error('A campanha precisa ter pelo menos um participante ativo.');
    erro.code = 'CAMPANHA_SEM_PARTICIPANTES';
    throw erro;
  }

  return {
    ...previa,
    participante_ids: participantes.map(item => Number(item.id)),
    participantes,
    // As exceções atuais são excluídas da lista separadamente e não devem alterar
    // a identificação das vendas que já atendem às regras normais da campanha.
    venda_excecao_ids: []
  };
}

/**
 * Controller das rotas de campanhas, progresso de metas e resgates.
 */
class CampanhaController {
  async vendasExcecao(req, res) {
    try {
      const campanhaId = Number(req.params.id);
      const campanhaPersistida = (await Campanha.findAll()).find(item => Number(item.id) === campanhaId);
      if (!campanhaPersistida || !campanhaEhGift(campanhaPersistida)) {
        return res.status(404).json({ error: 'Campanha não encontrada.' });
      }

      const pagina = Math.max(Number.parseInt(req.body?.page, 10) || 1, 1);
      const porPagina = Math.min(Math.max(Number.parseInt(req.body?.per_page, 10) || 20, 1), 100);
      const busca = String(req.body?.busca || '').trim();
      const idsExcluidos = normalizarIdsEntrada(req.body?.excluir_ids);
      const campanhaPrevia = await montarPreviaCampanha(campanhaPersistida, req.body?.campanha || {});
      const calculo = await calcularCampanhaColetiva(campanhaPrevia);
      const idsContribuintes = calculo.vendasContabilizadas.map(venda => Number(venda.id));
      const base = knex('vendas as v')
        .leftJoin('clientes as cli', 'v.cliente_id', 'cli.id')
        .leftJoin('usuarios as u', 'v.vendedora_id', 'u.id')
        .leftJoin('operadoras as o', 'v.operadora_id', 'o.id')
        .whereNull('v.excluido_em')
        .whereNull('v.cancelada_em')
        .where(builder => builder.whereNull('v.status_funil').orWhereNot('v.status_funil', 'retorno'));

      base.whereNotExists(function vendaJaIncluida() {
        this.select(knex.raw('1'))
          .from('campanha_vendas_excecoes as cve_lista')
          .whereRaw('cve_lista.venda_id = v.id')
          .where('cve_lista.campanha_id', campanhaId);
      });
      if (idsContribuintes.length) base.whereNotIn('v.id', idsContribuintes);
      if (idsExcluidos.length) base.whereNotIn('v.id', idsExcluidos);

      if (busca) {
        const termo = `%${busca}%`;
        base.where(builder => {
          if (/^\d+$/.test(busca)) builder.orWhere('v.id', Number(busca));
          builder
            .orWhere('v.nome', 'like', termo)
            .orWhere('v.razao_social', 'like', termo)
            .orWhere('v.cnpj', 'like', termo)
            .orWhere('cli.nome', 'like', termo)
            .orWhere('cli.razao_social', 'like', termo)
            .orWhere('cli.cnpj', 'like', termo)
            .orWhere('u.nome', 'like', termo)
            .orWhereExists(function vendedorCompartilhado() {
              this.select(knex.raw('1'))
                .from('venda_vendedoras as vv_busca')
                .join('usuarios as uv_busca', 'vv_busca.usuario_id', 'uv_busca.id')
                .whereRaw('vv_busca.venda_id = v.id')
                .where('uv_busca.nome', 'like', termo);
            });
        });
      }

      const totalRow = await base.clone().clearSelect().clearOrder().countDistinct({ total: 'v.id' }).first();
      const vendas = await base.clone()
        .select(
          'v.id', 'v.data_venda', 'v.razao_social', 'v.cnpj', 'v.valor_total',
          'v.quantidade_linhas', 'u.nome as vendedora_nome', 'o.nome as operadora_nome',
          knex.raw("COALESCE(NULLIF(v.razao_social, ''), NULLIF(cli.razao_social, ''), NULLIF(v.nome, ''), NULLIF(cli.nome, ''), CONCAT('Venda #', v.id)) as cliente_nome")
        )
        .orderBy('v.data_venda', 'desc')
        .orderBy('v.id', 'desc')
        .limit(porPagina)
        .offset((pagina - 1) * porPagina);

      res.json({
        data: vendas.map(venda => ({
          ...venda,
          id: Number(venda.id),
          valor_total: Number(venda.valor_total || 0),
          quantidade_linhas: Number(venda.quantidade_linhas || 0)
        })),
        total: Number(totalRow?.total || 0)
      });
    } catch (error) {
      if (error?.code === 'CAMPANHA_PREVIA_INVALIDA' || error?.code === 'CAMPANHA_SEM_PARTICIPANTES') {
        return res.status(400).json({ error: error.message });
      }
      console.error(error);
      res.status(500).json({ error: 'Erro ao buscar vendas disponíveis para exceção.' });
    }
  }

  async participantes(req, res) {
    try {
      const usuarios = await knex('usuarios').where('ativo', true).select('id', 'nome', 'email').orderBy('nome', 'asc');
      res.json(usuarios);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao buscar participantes de campanhas.' });
    }
  }

  async index(req, res) {
    try {
      const campanhas = await Campanha.findAll();
      const usuario = await Usuario.query().findById(req.usuario.id).withGraphFetched('role');
      const permissoes = await listarPermissoesEfetivas(usuario);
      const podeGerenciar = permissoes.includes('gerenciar_campanhas');
      const permitidas = podeGerenciar ? campanhas : campanhas.filter(campanha => (
        !campanha.participante_ids.length || campanha.participante_ids.map(Number).includes(Number(req.usuario.id))
      ));
      res.json(permitidas.map(campanha => decorarCampanha(podeGerenciar ? campanha : ocultarDetalhesExcecoes(campanha))));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao buscar campanhas.' });
    }
  }

  async updateBulk(req, res) {
    try {
      const { campanhas } = req.body;
      if (!Array.isArray(campanhas)) {
        return res.status(400).json({ error: 'Formato inválido. Esperado um array de campanhas.' });
      }

      const invalida = campanhas.find(campanha => campanhaEhGift(campanha) && validarCampanha(campanha));
      if (invalida) {
        return res.status(400).json({ error: validarCampanha(invalida) });
      }

      await Campanha.updateAll(campanhas);
      const updatedCampanhas = await Campanha.findAll();

      res.json({ message: 'Campanhas atualizadas com sucesso.', campanhas: updatedCampanhas.map(campanha => decorarCampanha(campanha)) });
    } catch (error) {
      if (error?.code === 'CAMPANHA_PERIODO_BLOQUEADO') {
        return res.status(409).json({ error: error.message });
      }
      if (error?.code === 'CAMPANHA_SEM_PARTICIPANTES') {
        return res.status(400).json({ error: error.message });
      }
      if (error?.code === 'CAMPANHA_VENDA_EXCECAO_INVALIDA') {
        return res.status(400).json({ error: error.message });
      }
      console.error(error);
      res.status(500).json({ error: 'Erro ao atualizar campanhas.' });
    }
  }

  async store(req, res) {
    try {
      const erro = validarCampanha(req.body);
      if (erro) {
        return res.status(400).json({ error: erro });
      }

      const campanha = await Campanha.create({
        periodo: 'personalizado',
        data_inicio: req.body.data_inicio,
        data_fim: req.body.data_fim,
        categoria: req.body.categoria,
        target: Number(req.body.target),
        desc: req.body.desc,
        reward: req.body.reward,
        operadora_id: req.body.operadora_id,
        operadora_ids: req.body.operadora_ids,
        publico_base: req.body.publico_base,
        regras: req.body.regras,
        categoria_personalizada: req.body.categoria_personalizada,
        participante_ids: req.body.participante_ids,
        venda_excecao_ids: req.body.venda_excecao_ids,
        is_gift: true
      });

      res.status(201).json(decorarCampanha(campanha));
    } catch (error) {
      if (error?.code === 'CAMPANHA_SEM_PARTICIPANTES') {
        return res.status(400).json({ error: error.message });
      }
      if (error?.code === 'CAMPANHA_VENDA_EXCECAO_INVALIDA') {
        return res.status(400).json({ error: error.message });
      }
      console.error(error);
      res.status(500).json({ error: 'Erro ao criar campanha.' });
    }
  }

  async progresso(req, res) {
    try {
      const vendedoraId = req.usuario.id;
      const cicloDiario = getCiclo('diaria');
      const cicloSemanal = getCiclo('semanal');
      const cicloMensal = getCiclo('mensal');
      const campanhas = (await Campanha.findAll()).filter(campanhaEhGift);

      const [progressoDiario, progressoSemanal, progressoMensal, progressoPersonalizado] = await Promise.all([
        calcularProgresso(vendedoraId, cicloDiario),
        calcularProgresso(vendedoraId, cicloSemanal),
        calcularProgresso(vendedoraId, cicloMensal),
        calcularCampanhasParaUsuario(vendedoraId, campanhas)
      ]);

      const diaria = progressoDiario.geral;
      const semanal = progressoSemanal.geral;
      const mensal = progressoMensal.geral;
      const resgates = await knex('campanha_resgates').where('usuario_id', vendedoraId).pluck('campanha_id');
      const resgatadas = new Set(resgates.map(Number));
      const campanhasVisiveis = progressoPersonalizado.visiveis;
      const progressoVisivel = Object.fromEntries(campanhasVisiveis.map(campanha => [
        campanha.id,
        {
          ...(progressoPersonalizado.campanhas[campanha.id] || {
            current: 0, target: Number(campanha.target || 0), pct: 0, achieved: false,
            estado_periodo: intervaloCampanha(campanha).estado
          }),
          ranking: undefined,
          contribuicoes: undefined,
          claimed: resgatadas.has(Number(campanha.id))
        }
      ]));

      res.json({
        diaria_registro_cliente: diaria.registro_cliente,
        diaria_chip_novo: diaria.chip_novo,
        diaria_portabilidade: diaria.portabilidade,
        diaria_internet: diaria.internet,
        semanal_registro_cliente: semanal.registro_cliente,
        semanal_chip_novo: semanal.chip_novo,
        semanal_portabilidade: semanal.portabilidade,
        semanal_internet: semanal.internet,
        mensal_registro_cliente: mensal.registro_cliente,
        mensal_chip_novo: mensal.chip_novo,
        mensal_portabilidade: mensal.portabilidade,
        mensal_internet: mensal.internet,
        campanhas: progressoVisivel,
        campanhas_visiveis: campanhasVisiveis.map(campanha => Number(campanha.id)),
        estados_campanhas: Object.fromEntries(campanhasVisiveis.map(campanha => [campanha.id, intervaloCampanha(campanha).estado])),
        resgatadas: [...resgatadas],
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao calcular progresso.' });
    }
  }

  async progressoUsuarios(req, res) {
    try {
      const cicloDiario = getCiclo('diaria');
      const cicloSemanal = getCiclo('semanal');
      const cicloMensal = getCiclo('mensal');
      const campanhas = await Campanha.findAll();
      const campanhasGift = campanhas.filter(campanhaEhGift);
      const usuarios = await knex('usuarios as u')
        .leftJoin('roles as r', 'u.role_id', 'r.id')
        .select(
          'u.id',
          'u.nome',
          'u.email',
          'u.foto_perfil',
          'u.ativo',
          'r.nome as role_nome'
        )
        .where('u.ativo', true)
        .orderBy('u.nome', 'asc');
      const usuarioIds = usuarios.map(usuario => usuario.id);
      const resgates = usuarioIds.length > 0
        ? await knex('campanha_resgates')
          .whereIn('usuario_id', usuarioIds)
          .select('usuario_id', 'campanha_id')
        : [];
      const resgatesPorUsuario = agruparResgatesPorUsuario(resgates);
      const calculos = Object.fromEntries(await Promise.all(campanhasGift.map(async campanha => (
        [Number(campanha.id), await calcularCampanhaColetiva(campanha)]
      ))));

      const usuariosComProgresso = usuarios.map((usuario) => {
        const campanhasUsuario = campanhasGift.filter(campanha => {
          const participantes = campanha.participante_ids || [];
          return participantes.map(Number).includes(Number(usuario.id));
        }).map((campanha) => {
          const calculo = calculos[Number(campanha.id)];
          const current = Number(calculo?.contribuicoes?.[usuario.id] || 0);
          const target = Number(campanha.target || 0);
          const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
          const achieved = pct >= 100;
          const claimed = resgatesPorUsuario[Number(usuario.id)]?.has(Number(campanha.id)) || false;
          const estadoPeriodo = intervaloCampanha(campanha).estado;

          return {
            id: campanha.id,
            periodo: campanha.periodo,
            data_inicio: campanha.data_inicio,
            data_fim: campanha.data_fim,
            estado_periodo: estadoPeriodo,
            categoria: campanha.categoria,
            desc: campanha.desc,
            reward: campanha.reward,
            target,
            current,
            pct,
            achieved,
            claimed,
            operadora_id: campanha.operadora_id,
            operadora_nome: campanha.operadora_nome,
            operadora_ids: campanha.operadora_ids,
            participantes: campanha.participantes,
            em_grupo: true,
            progresso_coletivo: calculo?.current || 0,
            meta_coletiva_atingida: Boolean(calculo?.achieved)
          };
        });
        const atingidas = campanhasUsuario.filter(campanha => campanha.achieved).length;
        const resgatadas = campanhasUsuario.filter(campanha => campanha.claimed).length;

        return {
          id: usuario.id,
          nome: usuario.nome,
          email: usuario.email,
          foto_perfil: usuario.foto_perfil,
          role: { nome: usuario.role_nome },
          campanhas: campanhasUsuario,
          resumo: {
            total: campanhasUsuario.length,
            atingidas,
            pendentes: campanhasUsuario.length - atingidas,
            resgatadas
          }
        };
      });

      res.json({
        ciclo: {
          diaria: {
            inicio: cicloDiario.inicioStr,
            fim: cicloDiario.fimStr
          },
          semanal: {
            inicio: cicloSemanal.inicioStr,
            fim: cicloSemanal.fimStr
          },
          mensal: {
            inicio: cicloMensal.inicioStr,
            fim: cicloMensal.fimStr
          }
        },
        usuarios: usuariosComProgresso
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao calcular progresso por usuário.' });
    }
  }

  async ranking(req, res) {
    try {
      const campanha = (await Campanha.findAll()).find(item => Number(item.id) === Number(req.params.id));
      if (!campanha || !campanhaEhGift(campanha)) {
        return res.status(404).json({ error: 'Campanha não encontrada.' });
      }

      const usuarioId = Number(req.usuario.id);
      const participa = campanha.participante_ids.map(Number).includes(usuarioId);
      const usuario = await Usuario.query().findById(usuarioId).withGraphFetched('role');
      const permissoes = await listarPermissoesEfetivas(usuario);
      const podeGerenciar = permissoes.includes('gerenciar_campanhas');
      if (!participa && !podeGerenciar) {
        return res.status(403).json({ error: 'Você não participa desta campanha.' });
      }

      const [calculo, resgate] = await Promise.all([
        calcularCampanhaColetiva(campanha),
        participa
          ? knex('campanha_resgates').where({ usuario_id: usuarioId, campanha_id: campanha.id }).first()
          : Promise.resolve(null)
      ]);
      const claimed = Boolean(resgate);

      res.json({
        campanha: {
          ...decorarCampanha(podeGerenciar ? campanha : ocultarDetalhesExcecoes(campanha)),
          current: calculo.current,
          target: calculo.target,
          pct: calculo.pct,
          achieved: calculo.achieved,
          claimed,
          pode_resgatar: participa && calculo.estado_periodo !== 'futura' && calculo.achieved && !claimed
        },
        participantes: calculo.ranking,
        vendas: calculo.vendasContabilizadas
      });
    } catch (error) {
      if (error?.code === 'CAMPANHA_SEM_PARTICIPANTES') {
        return res.status(400).json({ error: error.message });
      }
      console.error(error);
      res.status(500).json({ error: 'Erro ao carregar ranking da campanha.' });
    }
  }

  async resgatar(req, res) {
    try {
      const usuarioId = req.usuario.id;
      const campanha = (await Campanha.findAll()).find(item => Number(item.id) === Number(req.params.id));

      if (!campanha) {
        return res.status(404).json({ error: 'Campanha não encontrada.' });
      }

      if (!campanhaEhGift(campanha)) {
        return res.status(400).json({ error: 'Esta campanha não possui recompensa para resgate.' });
      }

      if (campanha.participante_ids?.length && !campanha.participante_ids.map(Number).includes(Number(usuarioId))) {
        return res.status(403).json({ error: 'Você não participa desta campanha.' });
      }

      const ciclo = intervaloCampanha(campanha);
      if (ciclo.estado === 'futura') {
        return res.status(400).json({ error: 'Esta campanha ainda não começou.' });
      }
      const existente = await knex('campanha_resgates')
        .where({
          usuario_id: usuarioId,
          campanha_id: campanha.id
        })
        .first();

      if (existente) {
        return res.json({
          message: 'Campanha já resgatada neste ciclo.',
          resgatada: true,
          jaResgatada: true,
          campanhaId: campanha.id,
          reward: existente.reward_snapshot || campanha.reward,
          resgate: existente
        });
      }

      const progresso = await calcularCampanhaColetiva(campanha);
      const current = progresso.current;
      const target = Number(campanha.target) || 0;

      if (current < target) {
        return res.status(400).json({
          error: 'Campanha ainda não atingida.',
          current,
          target
        });
      }

      const dadosResgate = {
        usuario_id: usuarioId,
        campanha_id: campanha.id,
        periodo: 'personalizado',
        periodo_inicio: ciclo.inicioStr,
        periodo_fim: ciclo.fimInclusivoStr,
        reward_snapshot: campanha.reward || null,
        claimed_at: knex.fn.now(),
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      };

      let id;
      try {
        [id] = await knex('campanha_resgates').insert(dadosResgate);
      } catch (insertError) {
        if (insertError && insertError.code === 'ER_DUP_ENTRY') {
          const resgateExistente = await knex('campanha_resgates')
            .where({
              usuario_id: usuarioId,
              campanha_id: campanha.id
            })
            .first();

          return res.json({
            message: 'Campanha já resgatada neste ciclo.',
            resgatada: true,
            jaResgatada: true,
            campanhaId: campanha.id,
            reward: resgateExistente?.reward_snapshot || campanha.reward,
            resgate: resgateExistente
          });
        }

        throw insertError;
      }

      const resgate = await knex('campanha_resgates').where({ id }).first();

      res.status(201).json({
        message: 'Campanha resgatada com sucesso.',
        resgatada: true,
        jaResgatada: false,
        campanhaId: campanha.id,
        reward: resgate.reward_snapshot || campanha.reward,
        resgate
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao resgatar campanha.' });
    }
  }

  async destroy(req, res) {
    try {
      const deleted = await Campanha.deleteById(req.params.id);

      if (!deleted) {
        return res.status(404).json({ error: 'Campanha não encontrada.' });
      }

      res.status(204).send();
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao excluir campanha.' });
    }
  }
}

module.exports = new CampanhaController();
module.exports.__testables = {
  adicionarDiasISO,
  campanhaVisivelParaUsuario,
  calcularContribuicoesCampanha,
  montarRanking,
  montarVendasContabilizadas,
  calcularValorCampanha,
  dataHojeSaoPaulo,
  dataValidaISO,
  intervaloCampanha,
  itensElegiveisCampanha,
  montarPreviaCampanha,
  parseItensVenda,
  unirVendasCampanha,
  validarCampanha
};
