import { describe, expect, it } from 'vitest';
import { filtrarNotificacoes, intervaloNotificacoesInvalido, nomeTipoNotificacao } from './notificacao-filtros';

const avisos = [
  { id: 1, tipo: 'venda_cancelada', titulo: 'Aprovação da ÁVANCE', mensagem: 'Cliente São José', created_at: '2026-10-16T02:59:59.999Z' },
  { id: 2, tipo: 'venda_cancelada', titulo: 'Venda cancelada', mensagem: 'Cliente São José', created_at: '2026-10-16 03:00:00' },
  { id: 3, tipo: 'lead_retorno_due', titulo: 'Retorno', mensagem: 'Cliente São José', created_at: '2026-10-17T02:59:59.999Z' },
  { id: 4, tipo: 'lead_retorno_due', titulo: 'Retorno', mensagem: 'Outro cliente', created_at: '2026-10-17T03:00:00Z' },
  { id: 5, titulo: null, mensagem: null, created_at: 'invalida' }
];

describe('filtros de notificações', () => {
  it('busca no título e na mensagem sem diferenciar acentos ou caixa', () => {
    expect(filtrarNotificacoes(avisos, { busca: ' APROVACAO ' }).map(item => item.id)).toEqual([1]);
    expect(filtrarNotificacoes(avisos, { busca: 'sao JOSE' }).map(item => item.id)).toEqual([1, 2, 3]);
  });

  it('inclui os dois limites do dia de São Paulo, inclusive para datas UTC sem fuso', () => {
    expect(filtrarNotificacoes(avisos, { de: '2026-10-16', ate: '2026-10-16' }).map(item => item.id)).toEqual([2, 3]);
  });

  it('combina os critérios preservando a ordem e permite limites abertos', () => {
    expect(filtrarNotificacoes(avisos, { busca: 'jose', tipo: 'lead_retorno_due', de: '2026-10-16', ate: '2026-10-16' }).map(item => item.id)).toEqual([3]);
    expect(filtrarNotificacoes(avisos, { ate: '2026-10-15' }).map(item => item.id)).toEqual([1]);
    expect(filtrarNotificacoes(avisos, { de: '2026-10-17' }).map(item => item.id)).toEqual([4]);
    expect(filtrarNotificacoes(avisos, {})).toEqual(avisos);
  });

  it('valida intervalo invertido e trata resultados vazios e tipos desconhecidos', () => {
    const filtros = { de: '2026-10-17', ate: '2026-10-16' };
    expect(intervaloNotificacoesInvalido(filtros)).toBe(true);
    expect(filtrarNotificacoes(avisos, filtros)).toEqual([]);
    expect(filtrarNotificacoes(avisos, { busca: 'inexistente' })).toEqual([]);
    expect(nomeTipoNotificacao('novo_aviso')).toBe('novo aviso');
  });
});
