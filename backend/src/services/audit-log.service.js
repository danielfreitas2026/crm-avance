/**
 * Servico de registro e consulta de eventos de auditoria.
 */
const AuditLog = require('../models/AuditLog');

const CAMPOS_SENSIVEIS = [
  'senha',
  'password',
  'token',
  'authorization',
  'jwt'
];

/**
 * Processa limitar texto conforme as regras do dominio.
 */
function limitarTexto(valor, tamanho) {
  if (valor === undefined || valor === null) {
    return null;
  }

  return String(valor).slice(0, tamanho);
}

/**
 * Sanitiza  removendo caracteres nao esperados.
 */
function sanitizar(valor) {
  if (Array.isArray(valor)) {
    return valor.map(sanitizar);
  }

  if (valor && typeof valor === 'object') {
    return Object.entries(valor).reduce((acc, [chave, item]) => {
      const chaveNormalizada = chave.toLowerCase();

      if (CAMPOS_SENSIVEIS.some(campo => chaveNormalizada.includes(campo))) {
        acc[chave] = '[removido]';
        return acc;
      }

      acc[chave] = sanitizar(item);
      return acc;
    }, {});
  }

  return valor;
}

/**
 * Obtem usuario id a partir dos dados informados.
 */
function obterUsuarioId(req, usuarioId) {
  return usuarioId || req?.usuario?.id || req?.user?.id || null;
}

/**
 * Monta registro a partir dos dados informados.
 */
function montarRegistro(req, dadosAuditoria) {
  return {
    usuario_id: obterUsuarioId(req, dadosAuditoria.usuario_id),
    acao: dadosAuditoria.acao,
    entidade: limitarTexto(dadosAuditoria.entidade, 80),
    entidade_id: limitarTexto(dadosAuditoria.entidade_id, 80),
    metodo: limitarTexto(req?.method, 10),
    rota: limitarTexto(req?.originalUrl || req?.url, 255),
    ip: limitarTexto(req?.ip, 80),
    user_agent: limitarTexto(req?.headers?.['user-agent'], 255),
    dados: JSON.stringify(sanitizar(dadosAuditoria.dados || {}))
  };
}

/**
 * Processa registrar conforme as regras do dominio.
 */
async function registrar(req, dadosAuditoria, trx = null) {
  if (!dadosAuditoria?.acao) {
    throw new Error('A ação da auditoria é obrigatória.');
  }

  return AuditLog.query(trx).insert(montarRegistro(req, dadosAuditoria));
}

/**
 * Registra sem bloquear no historico ou log.
 */
async function registrarSemBloquear(req, dadosAuditoria) {
  try {
    return await registrar(req, dadosAuditoria);
  } catch (error) {
    console.error('Erro ao registrar auditoria:', error);
    return null;
  }
}

/**
 * Normaliza paginacao para uso interno consistente.
 */
function normalizarPaginacao({ page, per_page } = {}) {
  const opcoesPorPagina = new Set([20, 50, 100]);
  const pagina = Math.max(Number.parseInt(page, 10) || 1, 1);
  const perPageInformado = Number.parseInt(per_page, 10);
  const perPage = opcoesPorPagina.has(perPageInformado) ? perPageInformado : 20;
  return { page: pagina, perPage };
}

/**
 * Aplica tipo sobre a consulta ou conjunto informado.
 */
function aplicarTipo(query, tipo) {
  switch (tipo) {
    case 'acoes':
      query.whereNot('audit_logs.acao', 'like', 'auth.%');
      break;
    case 'acessos':
      query.where('audit_logs.acao', 'like', 'auth.%');
      break;
    case 'falhas':
      query.where('audit_logs.acao', 'like', '%falha%');
      break;
    case 'cancelamentos':
      query.where('audit_logs.acao', 'like', '%cancel%');
      break;
    default:
      break;
  }
}

/**
 * Lista  conforme os filtros e parametros informados.
 */
async function listar({ busca, entidade, tipo, page, per_page } = {}) {
  const { page: pagina, perPage } = normalizarPaginacao({ page, per_page });

  const query = AuditLog.query()
    .select('audit_logs.*')
    .leftJoinRelated('usuario')
    .withGraphFetched('usuario')
    .orderBy('audit_logs.created_at', 'desc');

  if (entidade) {
    query.where('audit_logs.entidade', entidade);
  }

  aplicarTipo(query, tipo);

  if (busca) {
    const termo = `%${busca}%`;

    query.where(builder => {
      builder
        .where('audit_logs.acao', 'like', termo)
        .orWhere('audit_logs.entidade', 'like', termo)
        .orWhere('audit_logs.entidade_id', 'like', termo)
        .orWhere('audit_logs.rota', 'like', termo)
        .orWhere('usuario.nome', 'like', termo)
        .orWhere('usuario.email', 'like', termo)
        .orWhereRaw('CAST(audit_logs.dados AS CHAR) LIKE ?', [termo]);
    });
  }

  const result = await query.page(pagina - 1, perPage);
  return { data: result.results, total: result.total };
}

/**
 * Aplica status venda sobre a consulta ou conjunto informado.
 */
function aplicarStatusVenda(builder, status) {
  if (status === 'lixeira') {
    builder.whereNotNull('v.excluido_em');
  } else if (status === 'canceladas') {
    builder.whereNull('v.excluido_em').whereNotNull('v.cancelada_em');
  } else {
    builder.whereNull('v.excluido_em').whereNull('v.cancelada_em');
  }
}

/**
 * Monta base vendas agrupado a partir dos dados informados.
 */
function montarBaseVendasAgrupado({ status, busca }) {
  const knex = AuditLog.knex();

  const query = knex('audit_logs as a')
    .join('vendas as v', 'v.id', 'a.entidade_id')
    .where('a.entidade', 'vendas');

  aplicarStatusVenda(query, status);

  if (busca) {
    const termo = `%${busca}%`;
    query.leftJoin('usuarios as u', 'u.id', 'a.usuario_id');
    query.where(builder => {
      builder
        .where('a.acao', 'like', termo)
        .orWhere('a.entidade_id', 'like', termo)
        .orWhere('a.rota', 'like', termo)
        .orWhere('u.nome', 'like', termo)
        .orWhere('u.email', 'like', termo)
        .orWhereRaw('CAST(a.dados AS CHAR) LIKE ?', [termo]);
    });
  }

  return query;
}

// Pagina por VENDA (1 grupo = 1 venda com todos os seus eventos), nao por linha de log.
/**
 * Lista historico vendas agrupado conforme os filtros e parametros informados.
 */
async function listarHistoricoVendasAgrupado({ status, busca, page, per_page } = {}) {
  const { page: pagina, perPage } = normalizarPaginacao({ page, per_page });
  const statusNorm = ['ativas', 'canceladas', 'lixeira'].includes(status) ? status : 'ativas';

  const idsRows = await montarBaseVendasAgrupado({ status: statusNorm, busca })
    .select('a.entidade_id')
    .groupBy('a.entidade_id')
    .orderByRaw('MAX(a.created_at) DESC')
    .limit(perPage)
    .offset((pagina - 1) * perPage);

  const ids = idsRows.map(linha => linha.entidade_id);

  const totalRow = await montarBaseVendasAgrupado({ status: statusNorm, busca })
    .countDistinct('a.entidade_id as total')
    .first();
  const total = Number(totalRow?.total || 0);

  if (ids.length === 0) {
    return { data: [], total };
  }

  const logs = await AuditLog.query()
    .select('audit_logs.*')
    .where('audit_logs.entidade', 'vendas')
    .whereIn('audit_logs.entidade_id', ids)
    .withGraphFetched('usuario')
    .orderBy('audit_logs.created_at', 'desc');

  return { data: logs, total };
}

module.exports = {
  registrar,
  registrarSemBloquear,
  listar,
  listarHistoricoVendasAgrupado,
  sanitizar
};
