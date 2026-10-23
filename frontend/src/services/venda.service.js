/**
 * Cliente de API para vendas, arquivos, importacoes, aprovacoes e pos-venda.
 */
import { apiBlob, apiDelete, apiGet, apiPost, apiPut, apiRequest, tratarErroAutenticacao } from './api';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

/**
 * Monta query a partir dos dados informados.
 */
function montarQuery(filtros = {}) {
  const params = new URLSearchParams();

  Object.entries(filtros).forEach(([chave, valor]) => {
    if (valor !== undefined && valor !== null && valor !== '') {
      params.append(chave, valor);
    }
  });

  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Lista vendas conforme os filtros e parametros informados.
 */
export async function listarVendas(filtros) {
  return apiGet(`/vendas${montarQuery(filtros)}`);
}

/** Lista vendas no estado comparativo da automacao. */
export async function listarVendasFunilAutomacoes(filtros = {}) {
  return apiGet(`/vendas/funil-automacoes${montarQuery(filtros)}`);
}

/**
 * Exporta vendas excel no formato esperado.
 */
export async function exportarVendasExcel(filtros = {}) {
  const blob = await apiBlob(`/vendas/exportar${montarQuery(filtros)}`);
  const data = new Date().toISOString().slice(0, 10);
  baixarBlob(blob, `vendas-${data}.xlsx`);
}

/**
 * Conta vendas concluidas por cliente conforme os dados informados.
 */
export async function contarVendasConcluidasPorCliente() {
  return apiGet('/vendas/contagem-por-cliente');
}

/**
 * Obtem referencias clientes vendas a partir dos dados informados.
 */
export async function obterReferenciasClientesVendas() {
  return apiGet('/vendas/referencias-clientes');
}

/**
 * Lista vendas lixeira conforme os filtros e parametros informados.
 */
export async function listarVendasLixeira(filtros) {
  return apiGet(`/vendas/lixeira${montarQuery(filtros)}`);
}

/**
 * Obtem resumo vendas a partir dos dados informados.
 */
export async function obterResumoVendas() {
  return apiGet('/vendas/resumo');
}

/**
 * Obtem relatorios vendas a partir dos dados informados.
 */
export async function obterRelatoriosVendas(filtros) {
  return apiGet(`/vendas/relatorios${montarQuery(filtros)}`);
}

/**
 * Busca venda por id conforme os parametros informados.
 */
export async function buscarVendaPorId(id) {
  return apiGet(`/vendas/${id}`);
}

/**
 * Gera email venda a partir dos dados informados.
 */
export async function gerarEmailVenda(id) {
  return apiPost(`/vendas/${id}/email-template`, {});
}

/**
 * Baixa xlsx claro para o usuario.
 */
export async function baixarXlsxClaro(id, nomeCliente) {
  const blob = await apiBlob(`/vendas/${id}/xlsx-claro`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `CHECKLIST PADRÃO - ${nomeCliente || id}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Baixa blob para o usuario.
 */
function baixarBlob(blob, nomeArquivo) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Lista arquivos venda conforme os filtros e parametros informados.
 */
export async function listarArquivosVenda(id) {
  return apiGet(`/vendas/${id}/arquivos`);
}

/**
 * Processa upload arquivo venda conforme as regras do dominio.
 */
export function uploadArquivoVenda(id, file, dados = {}, onProgress) {
  return new Promise((resolve, reject) => {
    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append('arquivo', file);
    formData.append('categoria', dados.categoria || 'outro');
    formData.append('descricao', dados.descricao || '');

    const xhr = new XMLHttpRequest();
    xhr.withCredentials = true;
    xhr.open('POST', `${API_URL}/vendas/${id}/arquivos`);

    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.addEventListener('progress', event => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      try {
        const data = xhr.responseText ? JSON.parse(xhr.responseText) : null;

        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
          return;
        }

        tratarErroAutenticacao({ status: xhr.status }, data, token, xhr.responseURL);
        reject(new Error(data?.message || data?.error || 'Erro no upload.'));
      } catch {
        reject(new Error('Erro no upload.'));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Erro de rede no upload.')));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelado.')));
    xhr.send(formData);
  });
}

/**
 * Exclui arquivo venda conforme a regra de negocio.
 */
export async function excluirArquivoVenda(vendaId, arquivoVendaId) {
  return apiDelete(`/vendas/${vendaId}/arquivos/${arquivoVendaId}`);
}

/**
 * Obtem pacote arquivos venda a partir dos dados informados.
 */
export async function obterPacoteArquivosVenda(vendaId) {
  return apiGet(`/vendas/${vendaId}/arquivos/pacote`);
}

/**
 * Gera pacote arquivos venda a partir dos dados informados.
 */
export async function gerarPacoteArquivosVenda(vendaId) {
  return apiPost(`/vendas/${vendaId}/arquivos/pacote`, {});
}

/**
 * Baixa arquivo venda para o usuario.
 */
export async function baixarArquivoVenda(vendaId, arquivoVendaId, nomeArquivo) {
  const blob = await apiBlob(`/vendas/${vendaId}/arquivos/${arquivoVendaId}/download`);
  baixarBlob(blob, nomeArquivo || `venda-${vendaId}-arquivo`);
}

/**
 * Processa url visualizar arquivo venda conforme as regras do dominio.
 */
export function urlVisualizarArquivoVenda(vendaId, arquivoVendaId) {
  return `${API_URL}/vendas/${vendaId}/arquivos/${arquivoVendaId}/view`;
}

/**
 * Processa visualizar arquivo venda conforme as regras do dominio.
 */
export async function visualizarArquivoVenda(vendaId, arquivoVendaId) {
  const blob = await apiBlob(`/vendas/${vendaId}/arquivos/${arquivoVendaId}/view`);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Baixa pacote arquivos venda para o usuario.
 */
export async function baixarPacoteArquivosVenda(vendaId) {
  const blob = await apiBlob(`/vendas/${vendaId}/arquivos/pacote/download`);
  baixarBlob(blob, `venda-${vendaId}-documentos.zip`);
}

/**
 * Lista as etapas de conferencia de uma venda.
 */
export async function listarEtapasVenda(vendaId) {
  return apiGet(`/vendas/${vendaId}/etapas`);
}

/**
 * Registra o resultado da etapa 1 (verificacao com o 0800).
 * Enviar `null` volta a etapa para pendente.
 */
export async function atualizarEtapa0800(vendaId, resultado) {
  return apiRequest(`/vendas/${vendaId}/etapas/0800`, {
    method: 'PATCH',
    body: JSON.stringify({ resultado: resultado || null })
  });
}

/**
 * Busca o conteudo de um arquivo da venda como blob (usado nas miniaturas das etapas).
 */
export async function blobArquivoVenda(vendaId, arquivoVendaId) {
  return apiBlob(`/vendas/${vendaId}/arquivos/${arquivoVendaId}/view`);
}

/**
 * Cria venda com os dados informados.
 */
export async function criarVenda(dados) {
  return apiPost('/vendas', dados);
}

/**
 * Monta form data importacao a partir dos dados informados.
 */
function montarFormDataImportacao(arquivo, mapeamento) {
  const formData = new FormData();
  formData.append('arquivo', arquivo);
  if (mapeamento) {
    formData.append('mapeamento', JSON.stringify(mapeamento));
  }
  return formData;
}

/**
 * Processa preview importacao vendas empresas conforme as regras do dominio.
 */
export async function previewImportacaoVendasEmpresas(arquivo, mapeamento) {
  return apiRequest('/vendas/importar-empresas/preview', {
    method: 'POST',
    body: montarFormDataImportacao(arquivo, mapeamento)
  });
}

/**
 * Importa vendas empresas a partir dos dados recebidos.
 */
export async function importarVendasEmpresas(arquivo, mapeamento) {
  return apiRequest('/vendas/importar-empresas', {
    method: 'POST',
    body: montarFormDataImportacao(arquivo, mapeamento)
  });
}

/**
 * Atualiza venda com os dados informados.
 */
export async function atualizarVenda(id, dados) {
  return apiPut(`/vendas/${id}`, dados);
}

/** Registra uma reversao auditada na venda. */
export async function registrarReversaoVenda(id, venda, observacao, versao) {
  return apiPost(`/vendas/${id}/reversoes`, { venda, observacao, versao });
}

/** Oculta uma reversao mantendo sua auditoria no servidor. */
export async function excluirReversaoVenda(vendaId, reversaoId, motivo) {
  return apiDelete(`/vendas/${vendaId}/reversoes/${reversaoId}`, { motivo });
}

/**
 * Envia venda para pos venda para processamento.
 */
export async function enviarVendaParaPosVenda(id, dados = {}) {
  return apiPost(`/vendas/${id}/enviar-pos-venda`, dados);
}

/**
 * Reenvia manualmente uma venda elegível para a integração do dashboard.
 */
export async function reenviarVendaParaDashboard(id) {
  return apiPost(`/vendas/${id}/enviar-dashboard`, {});
}

/**
 * Lista aprovacoes venda conforme os filtros e parametros informados.
 */
export async function listarAprovacoesVenda(filtros) {
  return apiGet(`/vendas/aprovacoes${montarQuery(filtros)}`);
}

/**
 * Processa aprovar solicitacao venda conforme as regras do dominio.
 */
export async function aprovarSolicitacaoVenda(id, dados = {}) {
  return apiPost(`/vendas/aprovacoes/${id}/aprovar`, dados);
}

/**
 * Processa recusar solicitacao venda conforme as regras do dominio.
 */
export async function recusarSolicitacaoVenda(id, dados = {}) {
  return apiPost(`/vendas/aprovacoes/${id}/recusar`, dados);
}

/**
 * Atualiza status venda com os dados informados.
 */
export async function atualizarStatusVenda(id, dados) {
  return apiRequest(`/vendas/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify(dados)
  });
}

/** Atualiza a data efetiva de conclusao de uma venda finalizada. */
export async function atualizarConclusaoVenda(id, concluidaEm) {
  return apiRequest(`/vendas/${id}/conclusao`, {
    method: 'PATCH',
    body: JSON.stringify({ concluida_em: concluidaEm })
  });
}

/** Atualiza somente etapa e prioridade do funil comparativo. */
export async function atualizarStatusVendaFunilAutomacoes(id, dados) {
  return apiRequest(`/vendas/${id}/funil-automacoes/status`, {
    method: 'PATCH',
    body: JSON.stringify(dados)
  });
}

/**
 * Atualiza um marcador de aceite ou biometria da venda.
 */
export async function atualizarAceiteBiometriaVenda(id, marcador, concluido) {
  return apiRequest(`/vendas/${id}/aceite-biometria`, {
    method: 'PATCH',
    body: JSON.stringify({ marcador, concluido })
  });
}

/**
 * Processa cancelar venda conforme as regras do dominio.
 */
export async function cancelarVenda(id, motivo) {
  return apiPost(`/vendas/${id}/cancelar`, { motivo });
}

/**
 * Processa reverter cancelamento venda conforme as regras do dominio.
 */
export async function reverterCancelamentoVenda(id, observacao) {
  return apiPost(`/vendas/${id}/reverter-cancelamento`, { observacao });
}

/**
 * Remove venda conforme a regra de negocio.
 */
export async function deletarVenda(id) {
  return apiDelete(`/vendas/${id}`);
}

/**
 * Busca problema ativo venda conforme os parametros informados.
 */
export async function buscarProblemaAtivoVenda(id) {
  return apiGet(`/vendas/${id}/problemas/ativo`);
}

/**
 * Lista problemas venda conforme os filtros e parametros informados.
 */
export async function listarProblemasVenda(id) {
  return apiGet(`/vendas/${id}/problemas`);
}

/**
 * Lista destinatarios problema venda conforme os filtros e parametros informados.
 */
export async function listarDestinatariosProblemaVenda() {
  return apiGet('/vendas/problemas/destinatarios');
}

/**
 * Marca problema venda conforme a acao solicitada.
 */
export async function marcarProblemaVenda(id, dados) {
  return apiPost(`/vendas/${id}/problemas`, dados);
}

/**
 * Resolve problema venda a partir do contexto atual.
 */
export async function resolverProblemaVenda(problemaId, dados) {
  return apiPost(`/vendas/problemas/${problemaId}/resolver`, dados);
}

/**
 * Executa a acao de solicitar correcao problema venda mantendo o estado da tela consistente.
 */
export async function solicitarCorrecaoProblemaVenda(problemaId, dados) {
  return apiPost(`/vendas/problemas/${problemaId}/correcao`, dados);
}

/**
 * Processa verificar problema venda conforme as regras do dominio.
 */
export async function verificarProblemaVenda(problemaId) {
  return apiPost(`/vendas/problemas/${problemaId}/verificar`, {});
}

/**
 * Restaura venda quando a regra de negocio permite.
 */
export async function restaurarVenda(id) {
  return apiPost(`/vendas/${id}/restaurar`, {});
}

/**
 * Remove venda definitivo conforme a regra de negocio.
 */
export async function deletarVendaDefinitivo(id) {
  return apiDelete(`/vendas/${id}/definitivo`);
}

/**
 * Lista vendedoras conforme os filtros e parametros informados.
 */
export async function listarVendedoras() {
  return apiGet('/vendas/vendedoras');
}
