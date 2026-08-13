/** Retorna o estado inicial dos campos que controlam a data da venda. */
export function criarEstadoDataVenda() {
  return { venda_antiga: false, data_venda: '' };
}

/** Normaliza o booleano retornado pela API ou persistido em rascunho. */
export function normalizarIndicadorVendaAntiga(valor) {
  return valor === true || Number(valor) === 1;
}

/** Aplica a classificação escolhida e descarta a data manual ao desmarcar. */
export function aplicarVendaAntigaAoFormulario(form, marcada) {
  return {
    ...form,
    venda_antiga: marcada,
    data_venda: marcada ? form.data_venda : ''
  };
}
