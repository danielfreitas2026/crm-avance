/**
 * Cliente de API para mensagens internas, conversas e anexos.
 */
import { apiGet, apiPost, apiRequest, apiBlob, apiDelete } from './api';

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
 * Lista contatos conforme os filtros e parametros informados.
 */
export async function listarContatos() {
  return apiGet('/mensagens/contatos');
}

/**
 * Lista conversas conforme os filtros e parametros informados.
 */
export async function listarConversas() {
  return apiGet('/mensagens/conversas');
}

/**
 * Lista todas conversas conforme os filtros e parametros informados.
 */
export async function listarTodasConversas() {
  return apiGet('/mensagens/admin/conversas');
}

/**
 * Lista mensagens conforme os filtros e parametros informados.
 */
export async function listarMensagens(contatoId, filtros = {}) {
  return apiGet(`/mensagens/conversas/${contatoId}${montarQuery(filtros)}`);
}

/**
 * Lista mensagens conversa interna conforme os filtros e parametros informados.
 */
export async function listarMensagensConversaInterna(conversaKey, filtros = {}) {
  return apiGet(`/mensagens/admin/conversas/${conversaKey}${montarQuery(filtros)}`);
}

/**
 * Envia mensagem para processamento.
 */
export async function enviarMensagem(destinatarioId, conteudo, anexo = null) {
  const corpo = { destinatario_id: destinatarioId, conteudo };
  if (anexo?.arquivo_id) {
    corpo.arquivo_id = anexo.arquivo_id;
    corpo.nome_arquivo = anexo.nome_original;
  }
  return apiPost('/mensagens', corpo);
}

/**
 * Envia copias independentes da mesma mensagem para varios destinatarios.
 */
export async function enviarMensagensEmLote(destinatarioIds, conteudo, anexo = null) {
  const corpo = { destinatario_ids: destinatarioIds, conteudo };
  if (anexo?.arquivo_id) {
    corpo.arquivo_id = anexo.arquivo_id;
    corpo.nome_arquivo = anexo.nome_original;
  }
  return apiPost('/mensagens/lote', corpo);
}

/**
 * Processa upload anexo mensagem conforme as regras do dominio.
 */
export async function uploadAnexoMensagem(file) {
  const formData = new FormData();
  formData.append('arquivo', file, file.name);
  return apiRequest('/mensagens/anexos', { method: 'POST', body: formData });
}

/**
 * Baixa anexo mensagem para o usuario.
 */
export async function baixarAnexoMensagem(mensagemArquivoId) {
  return apiBlob(`/mensagens/anexos/${mensagemArquivoId}`);
}

/**
 * Baixa anexo mensagem interna para o usuario.
 */
export async function baixarAnexoMensagemInterna(mensagemArquivoId) {
  return apiBlob(`/mensagens/admin/anexos/${mensagemArquivoId}`);
}

/**
 * Exclui mensagem conforme a regra de negocio.
 */
export async function excluirMensagem(mensagemId) {
  return apiDelete(`/mensagens/${mensagemId}`);
}

/**
 * Conta mensagens nao lidas conforme os dados informados.
 */
export async function contarMensagensNaoLidas() {
  return apiGet('/mensagens/nao-lidas');
}

/**
 * Marca conversa lida conforme a acao solicitada.
 */
export async function marcarConversaLida(contatoId) {
  return apiRequest(`/mensagens/conversas/${contatoId}/lida`, {
    method: 'PATCH'
  });
}
