import { getUtcDateTimeTimestamp } from '../../utils/datetime';

/** Ordena os popups liberados pelo horario de retorno mais proximo. */
export function ordenarPopupsRetornoFuturo(notificacoes = []) {
  return notificacoes
    .filter(notificacao => notificacao?.popup_retorno_futuro_disponivel === true)
    .sort((a, b) => (
      getUtcDateTimeTimestamp(a?.dados?.retorno_agendado_para, Number.MAX_SAFE_INTEGER)
      - getUtcDateTimeTimestamp(b?.dados?.retorno_agendado_para, Number.MAX_SAFE_INTEGER)
    ));
}

/**
 * Mantem um popup ja exibido mesmo quando a consulta periodica oscila.
 * Quando o mesmo item continua presente, apenas atualiza seus dados visuais.
 */
export function reconciliarPopupRetornoFuturo(atual, notificacoes = []) {
  if (!atual) return ordenarPopupsRetornoFuturo(notificacoes)[0] || null;

  const atualizado = notificacoes.find(notificacao => Number(notificacao?.id) === Number(atual.id));
  if (!atualizado) return atual;

  return {
    ...atual,
    ...atualizado,
    dados: { ...(atual.dados || {}), ...(atualizado.dados || {}) }
  };
}
