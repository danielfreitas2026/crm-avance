import { apiGet, apiPost } from './api';

export const obterResumoAutomacoes = () => apiGet('/automacoes/resumo');
export const listarAutomacoes = ({ status = '', page = 1, perPage = 20 } = {}) => {
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (status) params.set('status', status);
  return apiGet(`/automacoes?${params.toString()}`);
};
export const coletarHistoricoAutomacoes = () => apiPost('/automacoes/coletar-historico', {});
export const revisarAutomacao = (id, dados) => apiPost(`/automacoes/${id}/revisar`, dados);
export const repetirAutomacao = id => apiPost(`/automacoes/${id}/repetir`, {});
export const repetirAutomacoesEmRevisao = () => apiPost('/automacoes/repetir-revisoes', {});
export const descartarAutomacao = (id, justificativa) => apiPost(`/automacoes/${id}/descartar`, { justificativa });
export const listarProblemasAutomaticos = ({ status = 'abertos', page = 1, perPage = 20 } = {}) => (
  apiGet(`/problemas?status=${encodeURIComponent(status)}&page=${page}&per_page=${perPage}`)
);
export const resolverProblemaAutomatico = (id, mensagem) => apiPost(`/problemas/${id}/resolver`, { mensagem });
export const obterVendaProblemaAutomatico = id => apiGet(`/problemas/${id}/venda`);
