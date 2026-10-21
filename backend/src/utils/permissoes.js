const Permissao = require('../models/Permissao');

const PERMISSOES_ADMIN_EXPLICITAS = new Set([
  'clientes_secretos_ver_todos',
  'clientes_antigos_ver_historico',
  'configurar_horario_acesso',
  'configurar_acesso_rede',
  'problemas_pos_venda_responsavel',
  'funil_automacoes',
  'vendas_alterar_data'
]);

const PERMISSOES_ADMIN_VENDAS_OBRIGATORIAS = new Set([
  'vendas',
  'vendas_ver_proprias',
  'vendas_ver_todas',
  'vendas_criar',
  'vendas_auto_pos_venda',
  'vendas_editar',
  'vendas_permitir_reversoes',
  'vendas_excluir_reversoes',
  'compartilhar_venda',
  'vendas_atribuir_qualquer_vendedor',
  'ver_vendas_compartilhadas',
  'editar_vendas_compartilhadas',
  'vendas_excluir',
  'vendas_cancelar',
  'vendas_reverter_cancelamento',
  'vendas_documentos',
  'adicionar_documentos',
  'pos_venda',
  'vendas_marcar_problema',
  'vendas_fechamento_mensal',
  'vendas_cruzar',
  'vendas_aprovacoes_visualizar',
  'vendas_aprovacoes_decidir',
  'funil_vendas',
  'dashboard_resumo_vendas',
  'relatorios_visualizar',
  'notificacoes_vendas_paradas'
]);

const PERMISSAO_ADMIN_VENDAS_SEM_LIMITE = 'vendas_limitar_ultimos_6_meses';

/** Retorna a decisao obrigatoria de uma permissao de vendas para ADM. */
function permissaoObrigatoriaAdminVendas(permissao) {
  if (permissao === PERMISSAO_ADMIN_VENDAS_SEM_LIMITE) return false;
  if (PERMISSOES_ADMIN_VENDAS_OBRIGATORIAS.has(permissao)) return true;
  return null;
}

/**
 * Converte permissoes em array de chaves ativas.
 *
 * @param {string|string[]|Record<string, boolean>|null|undefined} permissoes - Permissoes em JSON, array ou mapa.
 * @returns {string[]} Lista de chaves permitidas.
 */
function parsePermissoes(permissoes) {
  if (!permissoes) return [];
  if (Array.isArray(permissoes)) return permissoes;

  if (typeof permissoes === 'string') {
    try {
      return parsePermissoes(JSON.parse(permissoes));
    } catch {
      return [];
    }
  }

  return Object.entries(permissoes)
    .filter(([, permitido]) => permitido === true)
    .map(([chave]) => chave);
}

/**
 * Converte permissoes em mapa booleano.
 *
 * @param {string|string[]|Record<string, boolean>|null|undefined} permissoes - Permissoes em JSON, array ou mapa.
 * @returns {Record<string, boolean>} Mapa de permissao por chave.
 */
function normalizarPermissoes(permissoes) {
  if (!permissoes) return {};

  if (typeof permissoes === 'string') {
    try {
      return normalizarPermissoes(JSON.parse(permissoes));
    } catch {
      return {};
    }
  }

  if (Array.isArray(permissoes)) {
    return permissoes.reduce((acc, permissao) => {
      acc[permissao] = true;
      return acc;
    }, {});
  }

  return permissoes;
}

/**
 * Verifica se uma permissao foi explicitamente negada para usuario admin.
 *
 * @param {Record<string, unknown>} usuario - Usuario com role e permissoes.
 * @param {string} permissao - Chave da permissao.
 * @returns {boolean} Verdadeiro quando o admin possui negacao local.
 */
function adminTemPermissaoNegada(usuario, permissao) {
  if (usuario?.role?.nome !== 'admin') {
    return false;
  }

  return normalizarPermissoes(usuario.permissoes)[permissao] === false;
}

/**
 * Verifica permissoes que tambem precisam estar marcadas para usuarios admin.
 *
 * @param {Record<string, unknown>} usuario - Usuario com role e permissoes.
 * @param {string} permissao - Chave da permissao.
 * @returns {boolean} Verdadeiro quando a permissao esta explicitamente liberada.
 */
function adminTemPermissaoExplicita(usuario, permissao) {
  if (usuario?.role?.nome !== 'admin') {
    return false;
  }

  const permissoesUsuario = normalizarPermissoes(usuario.permissoes);
  return permissoesUsuario[permissao] === true;
}

/**
 * Verifica permissao ja carregada no objeto do usuario, sem consultar o banco.
 *
 * @param {Record<string, unknown>} usuario - Usuario com role e permissoes.
 * @param {string} permissao - Chave da permissao.
 * @returns {boolean} Verdadeiro quando o usuario esta ativo e possui a permissao.
 */
function usuarioTemPermissaoLocal(usuario, permissao) {
  if (!usuario || !usuario.ativo) return false;

  if (usuario.role?.nome === 'admin') {
    if (permissao === 'acesso_rede_sem_codigo') return true;
    const permissaoObrigatoria = permissaoObrigatoriaAdminVendas(permissao);
    if (permissaoObrigatoria !== null) return permissaoObrigatoria;

    if (PERMISSOES_ADMIN_EXPLICITAS.has(permissao)) {
      return adminTemPermissaoExplicita(usuario, permissao);
    }

    return !adminTemPermissaoNegada(usuario, permissao);
  }

  const permitidas = new Set([
    ...parsePermissoes(usuario.permissoes),
    ...parsePermissoes(usuario.role?.permissoes)
  ]);

  return permitidas.has(permissao);
}

/**
 * Monta o mapa completo de permissoes efetivas do usuario.
 *
 * @param {Record<string, unknown>} usuario - Usuario com role e permissoes.
 * @returns {Promise<Record<string, boolean>>} Mapa de chaves ativas por permissao.
 */
async function montarMapaPermissoesEfetivas(usuario) {
  const todasPermissoes = await Permissao.query()
    .where('ativo', true)
    .orderBy('nome', 'asc');

  const permitidas = new Set([
    ...parsePermissoes(usuario?.permissoes),
    ...parsePermissoes(usuario?.role?.permissoes)
  ]);

  return todasPermissoes.reduce((acc, permissao) => {
    if (usuario?.role?.nome === 'admin') {
      if (permissao.chave === 'acesso_rede_sem_codigo') {
        acc[permissao.chave] = true;
        return acc;
      }
      const permissaoObrigatoria = permissaoObrigatoriaAdminVendas(permissao.chave);
      acc[permissao.chave] = permissaoObrigatoria !== null
        ? permissaoObrigatoria
        : PERMISSOES_ADMIN_EXPLICITAS.has(permissao.chave)
          ? adminTemPermissaoExplicita(usuario, permissao.chave)
          : !adminTemPermissaoNegada(usuario, permissao.chave);
    } else {
      acc[permissao.chave] = permitidas.has(permissao.chave);
    }

    return acc;
  }, {});
}

/**
 * Lista somente as chaves de permissoes efetivas de um usuario.
 *
 * @param {Record<string, unknown>} usuario - Usuario com role e permissoes.
 * @returns {Promise<string[]>} Chaves permitidas.
 */
async function listarPermissoesEfetivas(usuario) {
  if (usuario?.role?.nome === 'admin') {
    const todasPermissoes = await Permissao.query()
      .where('ativo', true)
      .select('chave');

    return todasPermissoes
      .map(permissao => permissao.chave)
      .filter(chave => (
        chave === 'acesso_rede_sem_codigo'
        || permissaoObrigatoriaAdminVendas(chave) === true
        || (
          permissaoObrigatoriaAdminVendas(chave) === null
          && (PERMISSOES_ADMIN_EXPLICITAS.has(chave)
            ? adminTemPermissaoExplicita(usuario, chave)
            : !adminTemPermissaoNegada(usuario, chave))
        )
      ));
  }

  return parsePermissoes([
    ...parsePermissoes(usuario?.permissoes),
    ...parsePermissoes(usuario?.role?.permissoes)
  ]);
}

module.exports = {
  parsePermissoes,
  normalizarPermissoes,
  PERMISSOES_ADMIN_EXPLICITAS,
  PERMISSOES_ADMIN_VENDAS_OBRIGATORIAS,
  PERMISSAO_ADMIN_VENDAS_SEM_LIMITE,
  permissaoObrigatoriaAdminVendas,
  usuarioTemPermissaoLocal,
  montarMapaPermissoesEfetivas,
  listarPermissoesEfetivas
};
