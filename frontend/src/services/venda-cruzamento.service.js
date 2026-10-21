import { apiBlob, apiRequest } from './api';


/**
 * Monta o FormData com as planilhas do cruzamento. A primeira e a principal.
 *
 * @param {File[]} arquivos - Arquivos selecionados, em ordem.
 * @param {Object} [extra] - Campos de texto adicionais (ex.: config).
 * @returns {FormData}
 */
function montarFormData(arquivos, extra = {}) {
  const formData = new FormData();
  arquivos.forEach(arquivo => formData.append('planilhas', arquivo));
  Object.entries(extra).forEach(([chave, valor]) => formData.append(chave, valor));
  return formData;
}

/**
 * Baixa um blob para o usuario disparando o download no navegador.
 *
 * @param {Blob} blob - Conteudo binario.
 * @param {string} nomeArquivo - Nome sugerido para o arquivo.
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
 * Gera a pre-visualizacao das planilhas para configuracao do mapeamento.
 *
 * @param {File[]} arquivos - Arquivos selecionados, em ordem.
 * @returns {Promise<Object>} Preview por planilha (colunas, amostras, valoresDistintos) + sugestoes.
 */
export function previewCruzamento(arquivos) {
  return apiRequest('/vendas/cruzamento/preview', {
    method: 'POST',
    body: montarFormData(arquivos)
  });
}

/**
 * Processa o cruzamento e dispara o download do cruzamento.xlsx.
 *
 * O cliente compartilhado preserva o boundary multipart e trata os bloqueios de acesso.
 *
 * @param {{ arquivos: File[], config: Object }} dados - Arquivos + config.
 * @returns {Promise<void>}
 */
export async function processarCruzamento({ arquivos, config }) {
  const blob = await apiBlob('/vendas/cruzamento/processar', {
    method: 'POST', body: montarFormData(arquivos, { config: JSON.stringify(config) })
  });
  const dataArquivo = new Date().toISOString().slice(0, 10);
  baixarBlob(blob, `cruzamento-${dataArquivo}.xlsx`);
}
