import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encerrarSessaoExpirada } from '../services/api';
import { expiracaoSessaoCodigo, SESSION_EXPIRED_MESSAGE } from './sessao-codigo';
import { useExpiracaoSessaoCodigo } from './useExpiracaoSessaoCodigo';

vi.mock('../services/api', () => ({ encerrarSessaoExpirada: vi.fn() }));
const INICIO = Date.parse('2026-10-23T12:00:00Z');
const token = (exp, extras = {}) => `header.${btoa(JSON.stringify({ exp, acesso_por_codigo: true, ...extras })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.assinatura`;

function montar(valor) {
  localStorage.setItem('token', valor);
  const resultado = renderHook(() => useExpiracaoSessaoCodigo(valor));
  // O jsdom agenda a notificação de storage, mesmo sem outra janela aberta.
  act(() => vi.advanceTimersByTime(0));
  return resultado;
}

describe('expiração de sessões liberadas por código', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(INICIO);
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => { vi.useRealTimers(); localStorage.clear(); sessionStorage.clear(); });

  it('encerra em duas horas, sem renovar por atividade e limpa o temporizador ao desmontar', () => {
    const valor = token(INICIO / 1000 + 7200);
    const { unmount } = montar(valor);
    act(() => vi.advanceTimersByTime(3600000));
    act(() => window.dispatchEvent(new Event('focus')));
    act(() => vi.advanceTimersByTime(3599999));
    expect(encerrarSessaoExpirada).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(encerrarSessaoExpirada).toHaveBeenCalledExactlyOnceWith(valor);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['focus', 'visibilitychange'])('confere a expiração ao retomar por %s', evento => {
    const valor = token(INICIO / 1000 + 7200);
    montar(valor);
    vi.setSystemTime(INICIO + 7200000);
    act(() => (evento === 'focus' ? window : document).dispatchEvent(new Event(evento)));
    expect(encerrarSessaoExpirada).toHaveBeenCalledWith(valor);
  });

  it('encerra uma sessão já expirada ao abrir a rota protegida', () => {
    const valor = token(INICIO / 1000 - 1);
    montar(valor);
    expect(encerrarSessaoExpirada).toHaveBeenCalledExactlyOnceWith(valor);
  });

  it('desmontar a rota cancela prazo e eventos de retomada', () => {
    const valor = token(INICIO / 1000 + 7200);
    const { unmount } = montar(valor);
    unmount();
    act(() => vi.advanceTimersByTime(7200000));
    act(() => window.dispatchEvent(new Event('focus')));
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(encerrarSessaoExpirada).not.toHaveBeenCalled();
  });

  it('uma troca de token sem evento não permite que o temporizador antigo encerre a sessão nova', () => {
    const antigo = token(INICIO / 1000 + 10);
    const novo = token(INICIO / 1000 + 7200);
    montar(antigo);
    localStorage.setItem('token', novo);
    act(() => vi.advanceTimersByTime(10000));
    expect(encerrarSessaoExpirada).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(7190000));
    expect(encerrarSessaoExpirada).toHaveBeenCalledExactlyOnceWith(novo);
  });

  it('sincroniza um novo token recebido por outra aba e remove o temporizador quando ele não exige código', () => {
    const antigo = token(INICIO / 1000 + 10);
    montar(antigo);
    const novo = token(INICIO / 1000 + 86400, { acesso_por_codigo: false });
    localStorage.setItem('token', novo);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'token', oldValue: antigo, newValue: novo, storageArea: localStorage })));
    act(() => vi.advanceTimersByTime(0));
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(20000));
    expect(encerrarSessaoExpirada).not.toHaveBeenCalled();
  });

  it('replica encerramento em outra aba e preserva o aviso de expiração', () => {
    const antigo = token(INICIO / 1000 + 10);
    montar(antigo);
    vi.setSystemTime(INICIO + 10000);
    localStorage.removeItem('token');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'token', oldValue: antigo, newValue: null, storageArea: localStorage })));
    act(() => vi.advanceTimersByTime(0));
    expect(encerrarSessaoExpirada).toHaveBeenCalledWith(null);
    expect(sessionStorage.getItem('logout_message')).toBe(SESSION_EXPIRED_MESSAGE);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('não agenda expiração especial para sessões anteriores, não identificadas ou malformadas', () => {
    for (const valor of ['jwt-legado', token(INICIO / 1000 + 86400, { acesso_por_codigo: false }), token('invalido')]) {
      const { unmount } = montar(valor);
      expect(vi.getTimerCount()).toBe(0);
      unmount();
    }
    expect(encerrarSessaoExpirada).not.toHaveBeenCalled();
    expect(expiracaoSessaoCodigo(null)).toBeNull();
  });
});
