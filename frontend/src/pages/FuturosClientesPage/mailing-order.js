/** Retorna os mailings do envio mais recente para o mais antigo. */
export function ordenarMailingsMaisRecentes(mailings) {
  return [...mailings].sort((a, b) => Number(b.envio_id || 0) - Number(a.envio_id || 0));
}
