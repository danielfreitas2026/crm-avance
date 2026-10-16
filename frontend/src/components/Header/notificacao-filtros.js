import { parseUtcDateTime } from '../../utils/datetime';

const nomesTipos = {
  venda_parada_funil: 'Venda parada no funil',
  venda_cancelada: 'Venda cancelada',
  venda_aprovacao_pendente: 'Aprovação pendente',
  venda_retorno_registrado: 'Retorno de venda',
  venda_problema_aberto: 'Problema aberto',
  venda_problema_resolvido: 'Problema resolvido',
  venda_problema_correcao: 'Correção de problema',
  venda_problema_automatico: 'Problema automático',
  cliente_fidelidade: 'Fidelidade de cliente',
  nota_retorno_pre: 'Retorno de nota em breve',
  nota_retorno_due: 'Retorno de nota vencido',
  lead_retorno_pre: 'Retorno de lead em breve',
  lead_retorno_due: 'Retorno de lead vencido',
  futuro_cliente_retorno_pre: 'Retorno de futuro cliente em breve',
  futuro_cliente_retorno_due: 'Retorno de futuro cliente vencido',
  futuro_cliente_distribuido: 'Futuro cliente encaminhado'
};

export function nomeTipoNotificacao(tipo) {
  return nomesTipos[tipo] || String(tipo || 'Outros').replaceAll('_', ' ');
}

function normalizarTexto(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const formatoDia = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
});

export function intervaloNotificacoesInvalido({ de, ate }) {
  return Boolean(de && ate && de > ate);
}

/** Filtra a fila sem alterar sua ordem nem depender do fuso do navegador. */
export function filtrarNotificacoes(notificacoes, filtros) {
  if (intervaloNotificacoesInvalido(filtros)) return [];
  const busca = normalizarTexto(filtros.busca).trim();
  return notificacoes.filter(item => {
    if (filtros.tipo && item.tipo !== filtros.tipo) return false;
    if (busca && !normalizarTexto(`${item.titulo || ''} ${item.mensagem || ''}`).includes(busca)) return false;
    if (filtros.de || filtros.ate) {
      const data = parseUtcDateTime(item.created_at);
      if (!data) return false;
      const dia = formatoDia.format(data);
      if ((filtros.de && dia < filtros.de) || (filtros.ate && dia > filtros.ate)) return false;
    }
    return true;
  });
}
