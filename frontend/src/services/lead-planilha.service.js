/**
 * Cliente de API para importacao, divisao e acompanhamento de planilhas de leads.
 */
import { apiBlob, apiDelete, apiGet, apiPost, apiPut } from './api';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

/**
 * Monta query a partir dos dados informados.
 */
function montarQuery(filtros = {}) {
  const params = new URLSearchParams();

  Object.entries(filtros).forEach(([chave, valor]) => {
    if (Array.isArray(valor) && valor.length > 0) {
      params.set(chave, valor.join(','));
    } else if (valor !== undefined && valor !== null && valor !== '') {
      params.set(chave, valor);
    }
  });

  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Lista lead planilhas conforme os filtros e parametros informados.
 */
export function listarLeadPlanilhas() {
  return apiGet('/lead-planilhas');
}

/**
 * Cria lead planilha com os dados informados.
 */
export function criarLeadPlanilha(dados) {
  return apiPost('/lead-planilhas', dados);
}

/**
 * Processa upload lead planilha conforme as regras do dominio.
 */
export function uploadLeadPlanilha(file, onProgress) {
  return new Promise((resolve, reject) => {
    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/lead-planilhas/uploads`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error('Resposta inválida do servidor.')); }
      } else {
        try {
          const data = JSON.parse(xhr.responseText);
          reject(new Error(data?.message || data?.error || 'Erro no upload.'));
        } catch { reject(new Error('Erro no upload.')); }
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Erro de rede no upload.')));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelado.')));

    xhr.send(formData);
  });
}

/**
 * Importa uma planilha Excel de mailing no backend.
 */
export function importarLeadPlanilhaExcel(file, onProgress, opcoes = {}) {
  return new Promise((resolve, reject) => {
    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append('file', file);
    if (opcoes.baseAntiga) formData.append('base_antiga', 'true');
    if (opcoes.mapeamento) formData.append('mapeamento', JSON.stringify(opcoes.mapeamento));
    if (Array.isArray(opcoes.abas)) formData.append('abas', JSON.stringify(opcoes.abas));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/lead-planilhas/importar-excel`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error('Resposta invalida do servidor.')); }
      } else {
        try {
          const data = JSON.parse(xhr.responseText);
          reject(new Error(data?.message || data?.error || 'Erro ao importar XLSX.'));
        } catch { reject(new Error('Erro ao importar XLSX.')); }
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Erro de rede ao importar XLSX.')));
    xhr.addEventListener('abort', () => reject(new Error('Importacao cancelada.')));

    xhr.send(formData);
  });
}
export function importarBaseAntigaMailing(file, onProgress) {
  return new Promise((resolve, reject) => {
    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/lead-planilhas/importar-base-antiga`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error('Resposta invalida do servidor.')); }
      } else {
        try {
          const data = JSON.parse(xhr.responseText);
          reject(new Error(data?.message || data?.error || 'Erro ao importar base antiga.'));
        } catch { reject(new Error('Erro ao importar base antiga.')); }
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Erro de rede ao importar base antiga.')));
    xhr.addEventListener('abort', () => reject(new Error('Importacao cancelada.')));

    xhr.send(formData);
  });
}
/**
 * Busca lead planilha status conforme os parametros informados.
 */
export function buscarLeadPlanilhaStatus(id) {
  return apiGet(`/lead-planilhas/${id}/status`);
}

/**
 * Salva lead linhas com os dados informados.
 */
export function salvarLeadLinhas(planilhaId, linhas) {
  return apiPost(`/lead-planilhas/${planilhaId}/linhas`, { linhas });
}

/**
 * Executa a acao de finalizar lead planilha mantendo o estado da tela consistente.
 */
export function finalizarLeadPlanilha(planilhaId, dados = {}) {
  return apiPost(`/lead-planilhas/${planilhaId}/finalizar`, dados);
}

/**
 * Marca erro lead planilha conforme a acao solicitada.
 */
export function marcarErroLeadPlanilha(planilhaId, message) {
  return apiPost(`/lead-planilhas/${planilhaId}/erro`, { message });
}

/**
 * Atualiza lead schema com os dados informados.
 */
export function atualizarLeadSchema(planilhaId, schema_colunas) {
  return apiPut(`/lead-planilhas/${planilhaId}/schema`, { schema_colunas });
}

/**
 * Exclui lead planilha conforme a regra de negocio.
 */
export function excluirLeadPlanilha(planilhaId) {
  return apiDelete(`/lead-planilhas/${planilhaId}`);
}

/**
 * Lista lead linhas conforme os filtros e parametros informados.
 */
export function listarLeadLinhas(filtros = {}) {
  return apiGet(`/lead-planilhas/linhas${montarQuery(filtros)}`);
}

/**
 * Exporta lead linhas no formato esperado.
 */
export function exportarLeadLinhas(dados = {}) {
  return apiBlob('/lead-planilhas/exportar', {
    method: 'POST',
    body: JSON.stringify(dados)
  });
}

/** Baixa uma planilha individual em formato Excel. */
export function exportarLeadPlanilhaXlsx(planilhaId) {
  return apiBlob(`/lead-planilhas/exportar-xlsx/${planilhaId}`, { method: 'POST' });
}
/**
 * Processa dividir lead linhas conforme as regras do dominio.
 */
export function dividirLeadLinhas(dados) {
  return apiPost('/lead-planilhas/dividir', dados);
}

/**
 * Lista lead envios conforme os filtros e parametros informados.
 */
export function listarDestinatariosEnviosPlanilha(planilhaId) { return apiGet('/lead-planilhas/' + planilhaId + '/destinatarios-envios'); }
export function cancelarEnviosPlanilha(planilhaId, usuarioId = null) { return apiPost('/lead-planilhas/' + planilhaId + '/cancelar-envios', usuarioId ? { usuario_id: usuarioId } : {}); }

export function listarLeadEnvios() {
  return apiGet('/lead-planilhas/envios');
}

/**
 * Lista meus lead envios conforme os filtros e parametros informados.
 */
/**
 * Atualiza apenas o nome de um envio de mailing.
 */
export function atualizarNomeLeadEnvio(envioId, nome) {
  return apiPut('/lead-planilhas/envios/' + envioId, { nome });
}

export function listarMeusLeadEnvios() {
  return apiGet('/lead-planilhas/me/envios');
}

export function listarMeusMailings(filtros = {}) {
  return apiGet(`/lead-planilhas/me/mailings${montarQuery(filtros)}`);
}

/**
 * Lista minhas lead linhas conforme os filtros e parametros informados.
 */
export function listarMinhasLeadLinhas(filtros = {}) {
  return apiGet(`/lead-planilhas/me/linhas${montarQuery(filtros)}`);
}

/**
 * Exporta minhas lead linhas no formato esperado.
 */
export function exportarMinhasLeadLinhas(dados = {}) {
  return apiBlob('/lead-planilhas/me/exportar', {
    method: 'POST',
    body: JSON.stringify(dados)
  });
}

/**
 * Atualiza campo lead recebido com os dados informados.
 */
export function atualizarCampoLeadRecebido(linhaId, dados) {
  return apiPut(`/lead-planilhas/me/linhas/${linhaId}/campo-atualizado`, dados);
}

/**
 * Marca futuro cliente lead conforme a acao solicitada.
 */
export function marcarFuturoClienteLead(linhaId, dados) {
  return apiPost(`/lead-planilhas/me/linhas/${linhaId}/futuro-cliente`, dados);
}

/**
 * Avalia a assertividade da primeira ligacao.
 */
export function avaliarPrimeiraLigacaoLead(linhaId, avaliacao) {
  return apiPost(`/lead-planilhas/me/linhas/${linhaId}/avaliacao-primeira-ligacao`, { avaliacao });
}

export function listarVendasCandidatasLead(linhaId, cnpj) {
  const query = cnpj ? `?cnpj=${encodeURIComponent(cnpj)}` : '';
  return apiGet(`/lead-planilhas/linhas/${linhaId}/vendas-candidatas${query}`);
}

export function adminVincularVendaLead(linhaId, vendaId, cnpj) {
  const payload = { venda_id: vendaId };
  if (cnpj) payload.cnpj = cnpj;
  return apiPost(`/lead-planilhas/linhas/${linhaId}/venda`, payload);
}

export function adminDesvincularVendaLead(linhaId) {
  return apiDelete(`/lead-planilhas/linhas/${linhaId}/venda`);
}

export function marcarVendaRecusadaLead(linhaId, motivo) {
  return apiPost(`/lead-planilhas/me/linhas/${linhaId}/venda-recusada`, { motivo });
}

/**
 * Registra que o cliente recusou o contato na primeira ligacao.
 */
export function marcarClienteRecusouLead(linhaId, motivo) {
  return apiPost(`/lead-planilhas/me/linhas/${linhaId}/cliente-recusou`, { motivo });
}

/**
 * Reverte a recusa do cliente e devolve o lead para a fila de trabalho.
 */
export function reverterClienteRecusouLead(linhaId) {
  return apiPost(`/lead-planilhas/me/linhas/${linhaId}/cliente-recusou/reverter`, {});
}

/**
 * Registra que a ligacao nao foi atendida (motivo opcional).
 */
export function marcarChamadaNaoAtendidaLead(linhaId, dados = {}) {
  return apiPost(`/lead-planilhas/me/linhas/${linhaId}/chamada-nao-atendida`, dados);
}

/**
 * Reverte a marcacao de chamada nao atendida.
 */
export function reverterChamadaNaoAtendidaLead(linhaId) {
  return apiPost(`/lead-planilhas/me/linhas/${linhaId}/chamada-nao-atendida/reverter`, {});
}

/**
 * Agenda (ou limpa, com retorno nulo) a data e hora de retorno do lead.
 */
export function marcarRetornoLead(linhaId, retorno, observacao = '') {
  return apiPost(`/lead-planilhas/me/linhas/${linhaId}/retorno`, { retorno, observacao });
}

// ─── Ações administrativas por linha (Planilha de Mailing / gerenciar_leads) ──
// Operam em qualquer lead, sem exigir que o admin seja o vendedor atribuído.

export function adminAtualizarCampoLead(linhaId, dados) {
  return apiPut(`/lead-planilhas/linhas/${linhaId}/campo`, dados);
}

export function adminMarcarFuturoClienteLead(linhaId, dados) {
  return apiPost(`/lead-planilhas/linhas/${linhaId}/futuro-cliente`, dados);
}

export function adminReverterFuturoClienteLead(linhaId) {
  return apiPost(`/lead-planilhas/linhas/${linhaId}/futuro-cliente/reverter`, {});
}

export function adminMarcarVendaRecusadaLead(linhaId, motivo) {
  return apiPost(`/lead-planilhas/linhas/${linhaId}/venda-recusada`, { motivo });
}

export function adminReverterVendaRecusadaLead(linhaId) {
  return apiPost(`/lead-planilhas/linhas/${linhaId}/venda-recusada/reverter`, {});
}

export function adminMarcarClienteRecusouLead(linhaId, motivo) {
  return apiPost(`/lead-planilhas/linhas/${linhaId}/cliente-recusou`, { motivo });
}

export function adminReverterClienteRecusouLead(linhaId) {
  return apiPost(`/lead-planilhas/linhas/${linhaId}/cliente-recusou/reverter`, {});
}

export function adminMarcarChamadaNaoAtendidaLead(linhaId, motivo) {
  return apiPost(`/lead-planilhas/linhas/${linhaId}/chamada-nao-atendida`, { motivo });
}

export function adminReverterChamadaNaoAtendidaLead(linhaId) {
  return apiPost(`/lead-planilhas/linhas/${linhaId}/chamada-nao-atendida/reverter`, {});
}

export function adminMarcarRetornoLead(linhaId, retorno, observacao = '') {
  return apiPost(`/lead-planilhas/linhas/${linhaId}/retorno`, { retorno, observacao });
}

export function listarQuadroFuturosClientes(filtros = {}) {
  return apiGet(`/lead-planilhas/futuros-clientes${montarQuery(filtros)}`);
}

export function listarResponsaveisFuturosClientes() {
  return apiGet('/lead-planilhas/futuros-clientes/responsaveis');
}

export function listarMetricasFuturosClientes(filtros = {}) {
  return apiGet(`/lead-planilhas/futuros-clientes/metricas${montarQuery(filtros)}`);
}

/**
 * Baixa a produtividade dos consultores de primeira ligação em Excel.
 */
export async function exportarMetricasFuturosClientesExcel(filtros = {}) {
  const blob = await apiBlob(`/lead-planilhas/futuros-clientes/metricas/exportar${montarQuery(filtros)}`);
  const sufixo = filtros.data_inicio || filtros.data_fim
    ? `${filtros.data_inicio || 'inicio'}-a-${filtros.data_fim || 'hoje'}`
    : 'todo-periodo';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `produtividade-primeira-ligacao-${sufixo}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Lista futuros clientes leads conforme os filtros e parametros informados.
 */
export function listarFuturosClientesLeads(filtros = {}) {
  return apiGet(`/lead-planilhas/me/futuros-clientes${montarQuery(filtros)}`);
}

export function listarFuturosClientesRecebidos(filtros = {}) {
  return apiGet(`/lead-planilhas/me/futuros-clientes/recebidos${montarQuery(filtros)}`);
}

/** Carrega a jornada comercial completa de um futuro cliente da visão Todos. */
export function obterHistoricoFuturoCliente(linhaId) {
  return apiGet(`/lead-planilhas/futuros-clientes/${linhaId}/historico`);
}

export function listarEstatisticasFuturosClientes(filtros = {}) {
  return apiGet(`/lead-planilhas/futuros-clientes/estatisticas/resumo${montarQuery(filtros)}`);
}

export function listarEstatisticasMailingsUsuario(usuarioId, filtros = {}) {
  return apiGet(`/lead-planilhas/futuros-clientes/estatisticas/usuarios/${usuarioId}/mailings${montarQuery(filtros)}`);
}

export function listarEstatisticasLinhasMailing(usuarioId, envioId, filtros = {}) {
  return apiGet(`/lead-planilhas/futuros-clientes/estatisticas/usuarios/${usuarioId}/mailings/${envioId}/linhas${montarQuery(filtros)}`);
}

/** Aceita a indicacao e libera seus detalhes. */
export function aceitarFuturoCliente(linhaId) {
  return apiPost(`/lead-planilhas/me/futuros-clientes/${linhaId}/aceitar`, {});
}

/** Recusa a indicacao e a devolve para novo encaminhamento. */
export function recusarFuturoCliente(linhaId, motivo = '') {
  return apiPost(`/lead-planilhas/me/futuros-clientes/${linhaId}/recusar`, { motivo });
}

/** Envia um futuro cliente reservado na carteira para a distribuicao do Telegram. */
export function enviarFuturoClienteParaDistribuicao(linhaId) {
  return apiPost(`/lead-planilhas/me/futuros-clientes/${linhaId}/distribuir`, {});
}

/**
 * Lista futuros clientes lixeira conforme os filtros e parametros informados.
 */
export function listarFuturosClientesLixeira(filtros = {}, escopoTodos = false) {
  const escopo = escopoTodos ? '' : '/me';
  return apiGet(`/lead-planilhas${escopo}/futuros-clientes/lixeira${montarQuery(filtros)}`);
}

/**
 * Exclui futuro cliente conforme a regra de negocio.
 */
export function excluirFuturoCliente(linhaId, escopoTodos = false) {
  const escopo = escopoTodos ? '' : '/me';
  return apiDelete(`/lead-planilhas${escopo}/futuros-clientes/${linhaId}`);
}

/**
 * Restaura futuro cliente quando a regra de negocio permite.
 */
export function restaurarFuturoCliente(linhaId, escopoTodos = false) {
  const escopo = escopoTodos ? '' : '/me';
  return apiPost(`/lead-planilhas${escopo}/futuros-clientes/${linhaId}/restaurar`, {});
}

/**
 * Exclui futuro cliente definitivo conforme a regra de negocio.
 */
export function excluirFuturoClienteDefinitivo(linhaId, escopoTodos = false) {
  const escopo = escopoTodos ? '' : '/me';
  return apiDelete(`/lead-planilhas${escopo}/futuros-clientes/${linhaId}/definitivo`);
}
