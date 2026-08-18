import { marcarPopupNotificacaoVisto } from './notificacao.service';

const aberturasPendentes = new Set();

export function iniciarAberturaNotificacao(id) {
  if (id) aberturasPendentes.add(String(id));
}

export function finalizarAberturaNotificacao(id) {
  if (id) aberturasPendentes.delete(String(id));
}

export function falharAberturaNotificacao(id) {
  finalizarAberturaNotificacao(id);
  window.dispatchEvent(new CustomEvent('pos-venda:navbar-notificacoes-atualizar'));
}

export function aberturaNotificacaoPendente(id) {
  return aberturasPendentes.has(String(id));
}

export function getNotificacaoIdParam(searchParams) {
  const id = Number(searchParams?.get('notificacao_id') || 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function confirmarAberturaNotificacao(id) {
  if (!id) return false;
  try {
    await marcarPopupNotificacaoVisto(id);
    return true;
  } finally {
    finalizarAberturaNotificacao(id);
    window.dispatchEvent(new CustomEvent('pos-venda:navbar-notificacoes-atualizar'));
  }
}
