/** Retorna a chave estavel de uma notificacao da navbar. */
export function chaveNotificacaoNavbar(notificacao) {
  return String(notificacao?.id ?? '');
}

/** Remove do resultado do polling as exclusoes que ainda estao em andamento. */
export function filtrarExclusoesPendentesNavbar(notificacoes, idsPendentes) {
  return notificacoes.filter(notificacao => !idsPendentes.has(chaveNotificacaoNavbar(notificacao)));
}

/** Gera a assinatura usada para detectar mudancas reais na fila. */
export function assinaturaNotificacoesNavbar(notificacoes) {
  return notificacoes
    .map(notificacao => `${notificacao.destinatario_id || notificacao.id}:${notificacao.tipo}:${notificacao.ativa ? 1 : 0}`)
    .sort()
    .join('|');
}

/** Recoloca uma notificacao apos falha da exclusao, sem duplicar a fila. */
export function restaurarNotificacaoNavbar(notificacoes, notificacao) {
  const chave = chaveNotificacaoNavbar(notificacao);
  if (notificacoes.some(item => chaveNotificacaoNavbar(item) === chave)) return notificacoes;

  return [...notificacoes, notificacao].sort((a, b) => {
    const dataA = new Date(a.created_at || 0).getTime();
    const dataB = new Date(b.created_at || 0).getTime();
    return dataA - dataB || Number(a.id || 0) - Number(b.id || 0);
  });
}
