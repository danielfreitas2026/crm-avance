/**
 * Cliente de API para configuracoes, cadastros auxiliares e listas administrativas.
 */
import { apiDelete, apiGet, apiPost, apiPut } from './api';

/**
 * Lista operadoras conforme os filtros e parametros informados.
 */
export async function listarAparenciasNotificacao() { return apiGet('/config/notificacao-aparencias'); }
export async function listarAparenciasNotificacaoAdmin() { return apiGet('/config/notificacao-aparencias'); }
export async function atualizarAparenciaNotificacao(id, dados) { return apiPut('/config/admin/notificacao-aparencias/' + id, dados); }
export async function buscarHorarioAcesso() { return apiGet('/config/admin/horario-acesso'); }
export async function atualizarHorarioAcesso(dados) { return apiPut('/config/admin/horario-acesso', dados); }

export async function listarOperadoras() {
  return apiGet('/config/operadoras');
}

/**
 * Lista links externos conforme os filtros e parametros informados.
 */
export async function listarLinksExternos() {
  return apiGet('/config/links-externos');
}

/**
 * Lista tipos produto conforme os filtros e parametros informados.
 */
export async function listarTiposProduto() {
  return apiGet('/config/tipos-produto');
}

/**
 * Lista tipos venda conforme os filtros e parametros informados.
 */
export async function listarTiposVenda() {
  return apiGet('/config/tipos-venda');
}

/**
 * Lista servicos conforme os filtros e parametros informados.
 */
export async function listarServicos() {
  return apiGet('/config/servicos');
}

/**
 * Lista etapas funil conforme os filtros e parametros informados.
 */
export async function listarEtapasFunil() {
  return apiGet('/config/funil-etapas');
}

/**
 * Lista regras comissao conforme os filtros e parametros informados.
 */
export async function listarRegrasComissao() {
  return apiGet('/config/regras-comissao');
}

/**
 * Lista operadoras admin conforme os filtros e parametros informados.
 */
export async function listarOperadorasAdmin() {
  return apiGet('/config/admin/operadoras');
}

/**
 * Cria operadora com os dados informados.
 */
export async function criarOperadora(dados) {
  return apiPost('/config/admin/operadoras', dados);
}

/**
 * Atualiza operadora com os dados informados.
 */
export async function atualizarOperadora(id, dados) {
  return apiPut(`/config/admin/operadoras/${id}`, dados);
}

/**
 * Exclui operadora conforme a regra de negocio.
 */
export async function excluirOperadora(id) {
  return apiDelete(`/config/admin/operadoras/${id}`);
}

/**
 * Lista tipos produto admin conforme os filtros e parametros informados.
 */
export async function listarTiposProdutoAdmin() {
  return apiGet('/config/admin/tipos-produto');
}

/**
 * Cria tipo produto com os dados informados.
 */
export async function criarTipoProduto(dados) {
  return apiPost('/config/admin/tipos-produto', dados);
}

/**
 * Atualiza tipo produto com os dados informados.
 */
export async function atualizarTipoProduto(id, dados) {
  return apiPut(`/config/admin/tipos-produto/${id}`, dados);
}

/**
 * Exclui tipo produto conforme a regra de negocio.
 */
export async function excluirTipoProduto(id) {
  return apiDelete(`/config/admin/tipos-produto/${id}`);
}

/**
 * Lista tipos venda admin conforme os filtros e parametros informados.
 */
export async function listarTiposVendaAdmin() {
  return apiGet('/config/admin/tipos-venda');
}

/**
 * Cria tipo venda com os dados informados.
 */
export async function criarTipoVenda(dados) {
  return apiPost('/config/admin/tipos-venda', dados);
}

/**
 * Atualiza tipo venda com os dados informados.
 */
export async function atualizarTipoVenda(id, dados) {
  return apiPut(`/config/admin/tipos-venda/${id}`, dados);
}

/**
 * Exclui tipo venda conforme a regra de negocio.
 */
export async function excluirTipoVenda(id) {
  return apiDelete(`/config/admin/tipos-venda/${id}`);
}

/**
 * Lista servicos admin conforme os filtros e parametros informados.
 */
export async function listarServicosAdmin() {
  return apiGet('/config/admin/servicos');
}

/**
 * Cria servico com os dados informados.
 */
export async function criarServico(dados) {
  return apiPost('/config/admin/servicos', dados);
}

/**
 * Atualiza servico com os dados informados.
 */
export async function atualizarServico(id, dados) {
  return apiPut(`/config/admin/servicos/${id}`, dados);
}

/**
 * Exclui servico conforme a regra de negocio.
 */
export async function excluirServico(id) {
  return apiDelete(`/config/admin/servicos/${id}`);
}

/**
 * Lista etapas funil admin conforme os filtros e parametros informados.
 */
export async function listarEtapasFunilAdmin() {
  return apiGet('/config/admin/funil-etapas');
}

/**
 * Cria etapa funil com os dados informados.
 */
export async function criarEtapaFunil(dados) {
  return apiPost('/config/admin/funil-etapas', dados);
}

/**
 * Atualiza etapa funil com os dados informados.
 */
export async function atualizarEtapaFunil(id, dados) {
  return apiPut(`/config/admin/funil-etapas/${id}`, dados);
}

/**
 * Exclui etapa funil conforme a regra de negocio.
 */
export async function excluirEtapaFunil(id) {
  return apiDelete(`/config/admin/funil-etapas/${id}`);
}

/**
 * Processa reordenar etapas funil conforme as regras do dominio.
 */
export async function reordenarEtapasFunil(ordens) {
  return apiPut('/config/admin/funil-etapas/reorder', { ordens });
}

/**
 * Lista regras comissao admin conforme os filtros e parametros informados.
 */
export async function listarRegrasComissaoAdmin() {
  return apiGet('/config/admin/regras-comissao');
}

/**
 * Cria regra comissao com os dados informados.
 */
export async function criarRegraComissao(dados) {
  return apiPost('/config/admin/regras-comissao', dados);
}

/**
 * Atualiza regra comissao com os dados informados.
 */
export async function atualizarRegraComissao(id, dados) {
  return apiPut(`/config/admin/regras-comissao/${id}`, dados);
}

/**
 * Exclui regra comissao conforme a regra de negocio.
 */
export async function excluirRegraComissao(id) {
  return apiDelete(`/config/admin/regras-comissao/${id}`);
}

/**
 * Lista links externos admin conforme os filtros e parametros informados.
 */
export async function listarLinksExternosAdmin() {
  return apiGet('/config/admin/links-externos');
}

/**
 * Cria link externo com os dados informados.
 */
export async function criarLinkExterno(dados) {
  return apiPost('/config/admin/links-externos', dados);
}

/**
 * Atualiza link externo com os dados informados.
 */
export async function atualizarLinkExterno(id, dados) {
  return apiPut(`/config/admin/links-externos/${id}`, dados);
}

/**
 * Exclui link externo conforme a regra de negocio.
 */
export async function excluirLinkExterno(id) {
  return apiDelete(`/config/admin/links-externos/${id}`);
}
