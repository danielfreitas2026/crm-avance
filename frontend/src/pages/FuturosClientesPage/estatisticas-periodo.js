import { formatUtcDateTime } from '../../utils/datetime';

export function formatarDataHoraEstatisticas(valor) {
  return formatUtcDateTime(valor, {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit'
  }, '-');
}

const FORMATADOR = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
});

/** Atalhos seguem o mesmo calendário do relatório no servidor. */
export function obterPeriodoEstatisticas(preset, inicio, fim, referencia = new Date()) {
  const partes = Object.fromEntries(FORMATADOR.formatToParts(referencia)
    .filter(item => item.type !== 'literal').map(item => [item.type, item.value]));
  const hoje = `${partes.year}-${partes.month}-${partes.day}`;
  if (preset === 'hoje') return { data_inicio: hoje, data_fim: hoje };
  if (preset === 'ontem') {
    const data = new Date(`${hoje}T12:00:00Z`);
    data.setUTCDate(data.getUTCDate() - 1);
    const ontem = data.toISOString().slice(0, 10);
    return { data_inicio: ontem, data_fim: ontem };
  }
  if (preset === 'mes') return { data_inicio: `${hoje.slice(0, 7)}-01`, data_fim: hoje };
  if (preset === 'personalizado') return { data_inicio: inicio || undefined, data_fim: fim || undefined };
  return {};
}
