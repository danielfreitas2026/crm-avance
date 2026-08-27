export const VISIBILIDADE_TODAS = 'todas';
export const VISIBILIDADE_OCULTAR = 'ocultar';
export const VISIBILIDADE_SOMENTE = 'somente';

/**
 * Verifica se a venda nao possui documento fisico nem arquivo anexado.
 */
export function vendaSemDocumento(venda = {}) {
  const raw = venda.raw || venda;
  const possuiDocumentoNaCasa = raw.possui_doc_na_casa === true
    || Number(raw.possui_doc_na_casa) === 1;
  const possuiArquivoAnexado = Number(raw.total_arquivos) > 0;

  return !possuiDocumentoNaCasa && !possuiArquivoAnexado;
}

/**
 * Aplica os atalhos de visibilidade de cancelamento e documentacao.
 */
export function vendaCorrespondeAtalhos(sale, filtros = {}) {
  const cancelada = Boolean(sale.canceladaEm || sale.cancelada_em);
  const semDocumento = sale.semDocumento ?? vendaSemDocumento(sale);
  const visibilidadeCanceladas = filtros.canceladas || VISIBILIDADE_TODAS;
  const visibilidadeSemDocumento = filtros.semDocumento || VISIBILIDADE_TODAS;

  if (visibilidadeCanceladas === VISIBILIDADE_OCULTAR && cancelada) return false;
  if (visibilidadeCanceladas === VISIBILIDADE_SOMENTE && !cancelada) return false;
  if (visibilidadeSemDocumento === VISIBILIDADE_OCULTAR && semDocumento) return false;
  if (visibilidadeSemDocumento === VISIBILIDADE_SOMENTE && !semDocumento) return false;

  return true;
}
