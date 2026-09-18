/** Retorna o estado inicial dos campos que controlam a data da venda. */
export function criarEstadoDataVenda() {
  return { venda_antiga: false, data_venda: '' };
}

/** Normaliza o booleano retornado pela API ou persistido em rascunho. */
export function normalizarIndicadorVendaAntiga(valor) {
  return valor === true || Number(valor) === 1;
}

/** Aplica a classificação escolhida e opcionalmente preserva a data na edição. */
export function aplicarVendaAntigaAoFormulario(form, marcada, preservarData = false) {
  return {
    ...form,
    venda_antiga: marcada,
    data_venda: marcada || preservarData ? form.data_venda : ''
  };
}

/** Define a data enviada conforme o fluxo de cadastro ou edição. */
export function obterDataVendaPayload({ editando, vendaAntiga, dataVenda }) {
  if (editando) return dataVenda;
  return vendaAntiga ? dataVenda : null;
}
