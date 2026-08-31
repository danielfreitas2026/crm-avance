import { apiGet, apiPost } from './api';

export const obterResumoAutomacoes = () => apiGet('/automacoes/resumo');
export const listarAutomacoes = (status = '') => apiGet(`/automacoes${status ? `?status=${encodeURIComponent(status)}` : ''}`);
export const coletarHistoricoAutomacoes = () => apiPost('/automacoes/coletar-historico', {});
export const revisarAutomacao = (id, dados) => apiPost(`/automacoes/${id}/revisar`, dados);
export const repetirAutomacao = id => apiPost(`/automacoes/${id}/repetir`, {});
export const descartarAutomacao = (id, justificativa) => apiPost(`/automacoes/${id}/descartar`, { justificativa });
export const listarProblemasAutomaticos = () => apiGet('/problemas');
export const resolverProblemaAutomatico = (id, mensagem) => apiPost(`/problemas/${id}/resolver`, { mensagem });
