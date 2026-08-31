/** Converte os dados estruturados de um evento de historico. */
function parseDadosHistorico(dados) {
  if (!dados) return {};
  if (typeof dados === 'object') return dados;

  try {
    return JSON.parse(dados);
  } catch {
    return {};
  }
}

/** Identifica o autor humano ou a automacao responsavel pelo evento. */
export function getAutorHistorico(evento) {
  if (parseDadosHistorico(evento?.dados).origem_movimentacao === 'automacao_gmail') {
    return 'Automação Gmail';
  }

  return evento?.usuario?.nome
    || (evento?.usuario_id ? `Usuário #${evento.usuario_id}` : 'Sistema');
}
