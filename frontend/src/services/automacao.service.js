import { apiGet, apiPost } from './api';

export const obterResumoAutomacoes = () => apiGet('/automacoes/resumo');
export const listarAutomacoes = ({ status = '', classificacao = '', titulo = '', operadora = '', page = 1, perPage = 20 } = {}) => {
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (status) params.set('status', status);
  if (classificacao) params.set('classificacao', classificacao);
  if (titulo.trim()) params.set('titulo', titulo.trim());
  if (operadora) params.set('operadora', operadora);
  return apiGet(`/automacoes?${params.toString()}`);
};
export const coletarHistoricoAutomacoes = (origem = 'gmail_vivo') => apiPost('/automacoes/coletar-historico', { origem });
export const diagnosticarImapClaro = () => apiPost('/automacoes/diagnostico-imap', {});
export const obterDiagnosticoClaro = () => apiGet('/automacoes/diagnostico-claro');
export const listarVendasCandidatasAutomacao = (id, cnpj) => {
  const digitos = String(cnpj || '').replace(/\D/g, '');
  return apiGet(`/automacoes/${id}/vendas-candidatas${digitos ? `?cnpj=${digitos}` : ''}`);
};
export const revisarAutomacao = (id, dados) => apiPost(`/automacoes/${id}/revisar`, dados);
export const repetirAutomacao = id => apiPost(`/automacoes/${id}/repetir`, {});
export const repetirAutomacoesEmRevisao = () => apiPost('/automacoes/repetir-revisoes', {});
export const repetirInvalidosClaro = () => apiPost('/automacoes/repetir-invalidos-claro', {});
export const descartarAutomacao = (id, justificativa) => apiPost(`/automacoes/${id}/descartar`, { justificativa });
export const listarInconsistenciasHistoricoAutomacoes = () => apiGet('/automacoes/inconsistencias-historico');
export const obterPreviaCorrecaoHistoricoAutomacao = historicoId => apiGet(`/automacoes/inconsistencias-historico/${historicoId}`);
export const corrigirHistoricoAutomacao = (historicoId, dados) => apiPost(`/automacoes/inconsistencias-historico/${historicoId}/corrigir`, dados);
export const listarProblemasAutomaticos = ({ status = 'abertos', page = 1, perPage = 20 } = {}) => (
  apiGet(`/problemas?status=${encodeURIComponent(status)}&page=${page}&per_page=${perPage}`)
);
export const resolverProblemaAutomatico = (id, mensagem) => apiPost(`/problemas/${id}/resolver`, { mensagem });
export const obterVendaProblemaAutomatico = id => apiGet(`/problemas/${id}/venda`);
