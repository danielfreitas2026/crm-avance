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
