/**
 * Cliente de API para notificacoes, leitura e popups.
 */
import { apiDelete, apiGet, apiRequest } from './api';

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
 * Lista notificacoes conforme os filtros e parametros informados.
 */
export async function listarNotificacoes(filtros = {}) {
  return apiGet(`/notificacoes${montarQuery(filtros)}`);
}

/**
 * Lista notificacoes urgentes conforme os filtros e parametros informados.
 */
export async function listarNotificacoesUrgentes() {
  return apiGet('/notificacoes/urgentes');
}

/**
 * Marca notificacao lida conforme a acao solicitada.
 */
export async function marcarNotificacaoLida(id) {
  return apiRequest(`/notificacoes/${id}/lida`, {
    method: 'PATCH'
  });
}

/**
 * Marca popup notificacao visto conforme a acao solicitada.
 */
export async function marcarPopupNotificacaoVisto(id) {
  return apiRequest(`/notificacoes/${id}/popup-visto`, {
    method: 'PATCH'
  });
}

/**
 * Marca todas notificacoes lidas conforme a acao solicitada.
 */
export async function marcarTodasNotificacoesLidas(filtros = {}) {
  return apiRequest(`/notificacoes/lidas${montarQuery(filtros)}`, {
    method: 'PATCH'
  });
}

/**
 * Exclui uma notificacao somente para o usuario atual.
 */
export async function excluirNotificacao(id) {
  return apiDelete(`/notificacoes/${id}`);
}
