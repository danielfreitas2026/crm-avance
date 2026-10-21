import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearNavigation, navigationKey } from './navigation-storage';
import { useNavigationState } from './useNavigationState';
import { useNavigationRecord } from './useNavigationRecord';

describe('navegação da sessão', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('usuario', JSON.stringify({ id: 7 }));
  });

  it('restaura filtros e página ao remontar e separa usuários e subvisões', () => {
    const first = renderHook(() => useNavigationState('clientes:pagina', 1));
    act(() => first.result.current[1](4));
    first.unmount();
    const second = renderHook(() => useNavigationState('clientes:pagina', 1));
    expect(second.result.current[0]).toBe(4);
    const other = renderHook(() => useNavigationState('recebidos:pagina', 1));
    expect(other.result.current[0]).toBe(1);
    localStorage.setItem('usuario', JSON.stringify({ id: 8 }));
    second.rerender();
    expect(second.result.current[0]).toBe(1);
    act(() => second.result.current[1](2));
    localStorage.setItem('usuario', JSON.stringify({ id: 7 }));
    second.rerender();
    expect(second.result.current[0]).toBe(4);
  });

  it('descarta JSON inválido, tipos incorretos e páginas inválidas', () => {
    for (const raw of ['{', 'null', '"4"', '-1', '0', '1.5']) {
      sessionStorage.setItem(navigationKey('pagina'), raw);
      const hook = renderHook(() => useNavigationState('pagina', 1));
      expect(hook.result.current[0]).toBe(1);
      hook.unmount();
    }
  });

  it('aplica parâmetros explícitos e invalida uma aba quando perde permissão', () => {
    sessionStorage.setItem(navigationKey('aba'), '"estatisticas"');
    const hook = renderHook(({ allowed, preferInitial }) => useNavigationState('aba', 'meus', { allowed, preferInitial }), {
      initialProps: { allowed: ['meus', 'estatisticas'], preferInitial: false }
    });
    expect(hook.result.current[0]).toBe('estatisticas');
    hook.rerender({ allowed: ['meus'], preferInitial: false });
    expect(hook.result.current[0]).toBe('meus');
    hook.unmount();
    const explicit = renderHook(() => useNavigationState('aba', 'recebidos', { preferInitial: true }));
    expect(explicit.result.current[0]).toBe('recebidos');
  });

  it('continua navegando se o armazenamento falhar e limpa apenas o próprio contexto', () => {
    const hook = renderHook(() => useNavigationState('busca', ''));
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado'); });
    act(() => hook.result.current[1]('Ana'));
    expect(hook.result.current[0]).toBe('Ana');
    spy.mockRestore();
    sessionStorage.setItem(navigationKey('pagina'), '3');
    sessionStorage.setItem('system_closed_message', 'fechado');
    clearNavigation();
    expect(sessionStorage.getItem(navigationKey('pagina'))).toBeNull();
    expect(sessionStorage.getItem('system_closed_message')).toBe('fechado');
  });

  it('persiste apenas ID e relê o detalhe; fechar impede reabertura', async () => {
    const load = vi.fn().mockResolvedValue({ id: 42, nome: 'Dados atuais' });
    const first = renderHook(() => useNavigationRecord('detalhe', { load }));
    act(() => first.result.current[1]({ id: 42, nome: 'Dados antigos', senha: 'nao persistir' }));
    expect(sessionStorage.getItem(navigationKey('detalhe'))).toBe('42');
    first.unmount();
    const onRestore = vi.fn();
    const second = renderHook(() => useNavigationRecord('detalhe', { load, onRestore }));
    await waitFor(() => expect(second.result.current[0]?.nome).toBe('Dados atuais'));
    expect(load).toHaveBeenCalledExactlyOnceWith(42);
    expect(onRestore).toHaveBeenCalledTimes(1);
    act(() => second.result.current[1](null));
    second.unmount();
    const third = renderHook(() => useNavigationRecord('detalhe', { load }));
    expect(third.result.current[0]).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('não restaura seleção antiga enquanto há um destino explícito ou dados pendentes', async () => {
    sessionStorage.setItem(navigationKey('detalhe'), '42');
    const load = vi.fn().mockResolvedValue({ id: 42 });
    const hook = renderHook(({ ready }) => useNavigationRecord('detalhe', { load, ready }), { initialProps: { ready: false } });
    expect(load).not.toHaveBeenCalled();
    act(() => hook.result.current[1]({ id: 99 }));
    hook.rerender({ ready: true });
    expect(hook.result.current[0]?.id).toBe(99);
    expect(load).not.toHaveBeenCalled();
  });

  it('remove seleção indisponível e relata o erro sem recuperar dados antigos', async () => {
    sessionStorage.setItem(navigationKey('detalhe'), '42');
    const onError = vi.fn();
    const load = vi.fn().mockRejectedValue(new Error('Sem acesso'));
    const hook = renderHook(() => useNavigationRecord('detalhe', { load, onError }));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(hook.result.current[0]).toBeNull();
    expect(sessionStorage.getItem(navigationKey('detalhe'))).toBeNull();
  });

  it('uma resposta atrasada não substitui uma seleção mais recente', async () => {
    sessionStorage.setItem(navigationKey('detalhe'), '42');
    let resolve;
    const load = () => new Promise(done => { resolve = done; });
    const hook = renderHook(() => useNavigationRecord('detalhe', { load }));
    act(() => hook.result.current[1]({ id: 99 }));
    await act(async () => resolve({ id: 42 }));
    expect(hook.result.current[0]?.id).toBe(99);
  });
});
