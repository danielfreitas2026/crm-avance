import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listarCredenciais, revelarSenha } from './gerenciador-senhas.service';

describe('API do gerenciador de senhas', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('token', 'token-teste');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ senha: 'senha-teste' }), { headers: { 'content-type': 'application/json' } })));
  });
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
  it('lista metadados com autenticação, cancelamento e cache desativado', async () => {
    const controller = new AbortController();
    await listarCredenciais(controller.signal);
    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/admin/senhas', expect.objectContaining({ signal: controller.signal, cache: 'no-store', headers: expect.objectContaining({ Authorization: 'Bearer token-teste' }) }));
  });
  it('revela por POST individual e mantém a resposta fora do armazenamento persistente', async () => {
    const controller = new AbortController();
    expect(await revelarSenha(7, controller.signal)).toEqual({ senha: 'senha-teste' });
    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/admin/senhas/7/revelar', expect.objectContaining({ method: 'POST', signal: controller.signal, cache: 'no-store' }));
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem('token')).toBe('token-teste');
  });
});
