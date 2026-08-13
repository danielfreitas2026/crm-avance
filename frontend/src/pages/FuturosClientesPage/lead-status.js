export function isFuturoClienteAtivo(linha) {
  return Boolean(linha?.futuro_cliente && !linha?.futuro_cliente_excluido_em);
}

export function isFuturoClienteVendido(linha) {
  return Boolean(isFuturoClienteAtivo(linha) && (linha?.venda_id || linha?.status_operacional === 'vendido'));
}

/** Identifica venda recusada mesmo depois que o estado de futuro cliente foi revertido. */
export function isVendaRecusada(linha) {
  return Boolean(
    linha?.venda_recusada_em
    || linha?.venda_recusada_motivo
    || (linha?.status_operacional === 'perdido' && !linha?.cliente_recusou)
  );
}

export function getClasseLinhaLead(linha) {
  if (isFuturoClienteVendido(linha)) return 'lead-row-vendido';
  if (isVendaRecusada(linha)) return 'lead-row-recusado';
  if (isFuturoClienteAtivo(linha)) return 'lead-row-futuro';
  return '';
}
