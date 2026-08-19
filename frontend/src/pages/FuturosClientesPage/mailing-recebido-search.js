export function montarFiltrosLinhasMailingRecebido({ selecionados, pagina, busca, buscaGlobal, status, linhaId }) {
  const termoGlobal = String(buscaGlobal || '').trim();
  return {
    envio_ids: termoGlobal ? undefined : selecionados,
    page: pagina,
    page_size: 200,
    busca: busca || undefined,
    busca_global: termoGlobal || undefined,
    status: status || undefined,
    linha_id: linhaId || undefined
  };
}
