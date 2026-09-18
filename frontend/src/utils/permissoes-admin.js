export const PERMISSOES_ADMIN_EXPLICITAS = new Set([
  'clientes_secretos_ver_todos',
  'clientes_antigos_ver_historico',
  'configurar_horario_acesso',
  'problemas_pos_venda_responsavel',
  'funil_automacoes',
  'vendas_alterar_data'
]);

export const PERMISSOES_ADMIN_VENDAS_OBRIGATORIAS = new Set([
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

export const PERMISSAO_ADMIN_VENDAS_SEM_LIMITE = 'vendas_limitar_ultimos_6_meses';

export function permissaoObrigatoriaAdminVendas(permissao) {
  if (permissao === PERMISSAO_ADMIN_VENDAS_SEM_LIMITE) return false;
  if (PERMISSOES_ADMIN_VENDAS_OBRIGATORIAS.has(permissao)) return true;
  return null;
}
