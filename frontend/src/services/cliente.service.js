import { apiBlob, apiDelete, apiGet, apiPost, apiPut, apiRequest } from './api';

/**
 * Monta query a partir dos dados informados.
 */
function montarQuery(filtros = {}) {
  const params = new URLSearchParams();

  Object.entries(filtros).forEach(([chave, valor]) => {
    if (valor !== undefined && valor !== null && valor !== '') {
      params.set(chave, valor);
    }
  });

  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Lista clientes ativos aplicando filtros e paginacao opcionais.
 *
 * @param {Record<string, unknown>} [filtros={}] - Filtros aceitos pela rota de clientes.
 * @returns {Promise<unknown>} Lista ou pagina de clientes retornada pela API.
 */
export async function listarClientes(filtros = {}) {
  return apiGet(`/clientes${montarQuery(filtros)}`);
}

export async function listarClientesSecretos(filtros = {}) {
  return apiGet(`/clientes-secretos${montarQuery(filtros)}`);
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
 * Baixa a planilha XLSX de clientes conforme os filtros informados.
 *
 * @param {Record<string, unknown>} [filtros={}] - Filtros aplicados na exportacao.
 * @returns {Promise<void>}
 */
export async function exportarClientesExcel(filtros = {}) {
  const blob = await apiBlob(`/clientes/exportar${montarQuery(filtros)}`);
  const data = new Date().toISOString().slice(0, 10);
  baixarBlob(blob, `clientes-${data}.xlsx`);
}

/**
 * Lista clientes em formato reduzido para campos de selecao.
 *
 * @param {Record<string, unknown>} [filtros={}] - Filtros de busca e limite.
 * @returns {Promise<unknown[]>} Opcoes de clientes retornadas pela API.
 */
export async function listarClientesSelect(filtros = {}) {
  return apiGet(`/clientes/select${montarQuery(filtros)}`);
}

/**
 * Lista clientes movidos para a lixeira.
 *
 * @param {Record<string, unknown>} [filtros={}] - Filtros da lixeira.
 * @returns {Promise<unknown[]>} Clientes excluidos logicamente.
 */
export async function listarClientesLixeira(filtros = {}) {
  return apiGet(`/clientes/lixeira${montarQuery(filtros)}`);
}

/**
 * Busca um cliente ativo pelo identificador.
 *
 * @param {number|string} id - Identificador do cliente.
 * @returns {Promise<unknown>} Dados completos do cliente.
 */
export async function buscarClientePorId(id) {
  return apiGet(`/clientes/${id}`);
}

export async function buscarClienteSecretoPorId(id) {
  return apiGet(`/clientes-secretos/${id}`);
}

/**
 * Verifica se um CPF/CNPJ ja esta cadastrado para outro cliente.
 *
 * @param {string} documento - CPF ou CNPJ informado pelo usuario.
 * @param {number|string|null} [ignorarId=null] - Cliente ignorado em edicoes.
 * @returns {Promise<unknown>} Resultado da verificacao de duplicidade.
 */
export async function verificarDocumentoCliente(documento, ignorarId = null) {
  const query = ignorarId ? montarQuery({ ignorar_id: ignorarId }) : '';
  return apiGet(`/clientes/documento/${encodeURIComponent(documento)}${query}`);
}

export async function verificarDocumentoClienteSecreto(documento, ignorarId = null) {
  const query = ignorarId ? montarQuery({ ignorar_id: ignorarId }) : '';
  return apiGet(`/clientes-secretos/documento/${encodeURIComponent(documento)}${query}`);
}

/**
 * Cria um cliente novo.
 *
 * @param {Record<string, unknown>} dados - Payload do formulario de cliente.
 * @returns {Promise<unknown>} Cliente criado.
 */
export async function criarCliente(dados) {
  return apiPost('/clientes', dados);
}

export async function atualizarConsultorasCliente(id, consultoraIds) {
  return apiPut(`/clientes/${id}/consultoras`, { consultora_ids: consultoraIds });
}

export async function criarClienteSecreto(dados) {
  return apiPost('/clientes-secretos', dados);
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
 * Le a planilha da base anterior e retorna colunas, sugestoes e amostras.
 *
 * @param {File} arquivo - Arquivo XLSX enviado pelo usuario.
 * @returns {Promise<unknown>} Preview de importacao.
 */
export async function previewImportacaoBaseAnterior(arquivo) {
  return apiRequest('/clientes/importar-base-anterior/preview', {
    method: 'POST',
    body: montarFormDataImportacao(arquivo)
  });
}

/**
 * Importa clientes da base anterior usando o mapeamento confirmado.
 *
 * @param {File} arquivo - Arquivo XLSX enviado pelo usuario.
 * @param {Record<string, string>} mapeamento - Relacao entre campos do sistema e colunas da planilha.
 * @returns {Promise<unknown>} Resumo da importacao.
 */
export async function importarBaseAnterior(arquivo, mapeamento) {
  return apiRequest('/clientes/importar-base-anterior', {
    method: 'POST',
    body: montarFormDataImportacao(arquivo, mapeamento)
  });
}

/**
 * Remove clientes marcados como base anterior, opcionalmente removendo vendas relacionadas.
 *
 * @param {Object} [opcoes={}] - Opcoes de limpeza.
 * @returns {Promise<unknown>} Resumo da limpeza.
 */
export async function limparClientesBaseAnterior(opcoes = {}) {
  const query = opcoes.excluirVendasRelacionadas ? '?excluir_vendas_relacionadas=1' : '';
  return apiDelete(`/clientes/base-anterior${query}`);
}

/**
 * Atualiza os dados de um cliente existente.
 *
 * @param {number|string} id - Identificador do cliente.
 * @param {Record<string, unknown>} dados - Campos atualizados.
 * @returns {Promise<unknown>} Cliente atualizado.
 */
export async function atualizarCliente(id, dados) {
  return apiPut(`/clientes/${id}`, dados);
}

export async function atualizarClienteSecreto(id, dados) {
  return apiPut(`/clientes-secretos/${id}`, dados);
}

/**
 * Move um cliente para a lixeira.
 *
 * @param {number|string} id - Identificador do cliente.
 * @returns {Promise<unknown>} Resposta da API.
 */
export async function excluirCliente(id) {
  return apiDelete(`/clientes/${id}`);
}

export async function excluirClienteSecreto(id) {
  return apiDelete(`/clientes-secretos/${id}`);
}

/**
 * Restaura um cliente da lixeira.
 *
 * @param {number|string} id - Identificador do cliente.
 * @returns {Promise<unknown>} Cliente restaurado.
 */
export async function restaurarCliente(id) {
  return apiPost(`/clientes/${id}/restaurar`, {});
}

/**
 * Exclui definitivamente um cliente que esta na lixeira.
 *
 * @param {number|string} id - Identificador do cliente.
 * @param {Object} [opcoes={}] - Define se vendas relacionadas tambem serao apagadas.
 * @returns {Promise<unknown>} Resposta da API.
 */
export async function excluirClienteDefinitivo(id, opcoes = {}) {
  const query = opcoes.excluirVendasRelacionadas ? '?excluir_vendas_relacionadas=1' : '';
  return apiDelete(`/clientes/${id}/definitivo${query}`);
}
