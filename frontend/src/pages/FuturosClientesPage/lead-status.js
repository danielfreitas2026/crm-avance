export function isFuturoClienteAtivo(linha) {
  return Boolean(linha?.futuro_cliente && !linha?.futuro_cliente_excluido_em);
}

export function getVendaClassificacaoTipo(linha) {
  if (linha?.venda_classificacao?.tipo) return linha.venda_classificacao.tipo;
  if (linha?.venda_id || linha?.status_operacional === 'vendido') return 'venda_futuro_cliente';
  return linha?.possui_venda_cliente ? 'venda_antiga_registrada' : null;
}

export function resolverAbaFuturosClientes(valor, podeVerEstatisticas = false) {
  const normalizada = ({ futuros: 'meus', leads: 'mailings' })[valor] || valor;
  const permitidas = ['meus', 'recebidos', 'mailings', ...(podeVerEstatisticas ? ['estatisticas'] : [])];
  return permitidas.includes(normalizada) ? normalizada : 'meus';
}

export function formatarDuracaoMinutos(valor) {
  if (valor === null || valor === undefined || valor === '') return '-';
  const total = Math.max(0, Math.round(Number(valor) || 0));
  if (total < 60) return `${total} min`;
  const dias = Math.floor(total / 1440);
  const horas = Math.floor((total % 1440) / 60);
  const minutos = total % 60;
  if (dias > 0) return [dias && `${dias}d`, horas && `${horas}h`, minutos && `${minutos}min`].filter(Boolean).join(' ');
  return [horas && `${horas}h`, minutos && `${minutos}min`].filter(Boolean).join(' ');
}

export function isVendaAntigaRegistrada(linha) {
  return getVendaClassificacaoTipo(linha) === 'venda_antiga_registrada';
}

export function isFuturoClienteVendido(linha) {
  return Boolean(isFuturoClienteAtivo(linha) && getVendaClassificacaoTipo(linha) === 'venda_futuro_cliente');
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
  if (isVendaAntigaRegistrada(linha)) return 'lead-row-venda-antiga';
  if (isVendaRecusada(linha)) return 'lead-row-recusado';
  if (isFuturoClienteAtivo(linha)) return 'lead-row-futuro';
  return '';
}
