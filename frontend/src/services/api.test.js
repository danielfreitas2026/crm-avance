import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiBlob, apiDelete, apiGet, apiPost, apiPut, apiRequest } from './api';

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('api service', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('envia Content-Type e Authorization quando ha token', async () => {
    localStorage.setItem('token', 'abc123');
    fetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await expect(apiPost('/clientes', { nome: 'Cliente' })).resolves.toEqual({ ok: true });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/clientes', {
      method: 'POST',
      body: JSON.stringify({ nome: 'Cliente' }),
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer abc123',
      },
    });
  });

  it('nao define Content-Type manualmente para FormData', async () => {
    const formData = new FormData();
    formData.append('arquivo', new File(['conteudo'], 'teste.txt'));
    fetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await apiRequest('/upload', { method: 'POST', body: formData });

    expect(fetch.mock.calls[0][1].headers).toEqual({});
  });

  it('lanca mensagem de erro retornada pela API', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ message: 'Falha validada' }, { status: 400 }));

    await expect(apiGet('/clientes')).rejects.toThrow('Falha validada');
  });

  it('atalhos usam os metodos HTTP esperados', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({ get: true }))
      .mockResolvedValueOnce(jsonResponse({ put: true }))
      .mockResolvedValueOnce(jsonResponse({ delete: true }));

    await expect(apiGet('/x')).resolves.toEqual({ get: true });
    await expect(apiPut('/x/1', { nome: 'Novo' })).resolves.toEqual({ put: true });
    await expect(apiDelete('/x/1')).resolves.toEqual({ delete: true });

    expect(fetch.mock.calls[0][1].headers['Content-Type']).toBe('application/json');
    expect(fetch.mock.calls[1][1].method).toBe('PUT');
    expect(fetch.mock.calls[2][1].method).toBe('DELETE');
  });

  it('encerra sessão e preserva aviso quando o sistema está fechado', async () => {
    window.history.replaceState({}, '', '/login');
    localStorage.setItem('token', 'abc123');
    localStorage.setItem('usuario', '{}');
    fetch.mockResolvedValueOnce(jsonResponse({ code: 'SYSTEM_CLOSED', message: 'Sistema fechado' }, { status: 423 }));

    await expect(apiGet('/auth/me')).rejects.toMatchObject({ code: 'SYSTEM_CLOSED', status: 423 });
    expect(localStorage.getItem('token')).toBeNull();
    expect(sessionStorage.getItem('system_closed_message')).toBe('Sistema fechado');
  });

  it('permite enviar corpo JSON em requisicoes DELETE', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await apiDelete('/x/1', { motivo: 'Duplicado' });

    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: 'DELETE',
      body: JSON.stringify({ motivo: 'Duplicado' })
    });
  });

  it.each([
    { status: 401, body: { message: 'Sessão expirada' } },
    { status: 423, body: { code: 'SYSTEM_CLOSED', message: 'Sistema fechado' } }
  ])('avisa encerramento da sessão: $status', async ({ status, body }) => {
    window.history.replaceState({}, '', '/login');
    localStorage.setItem('token', 'abc123');
    localStorage.setItem('usuario', '{}');
    const listener = vi.fn();
    window.addEventListener('auth:sessao-encerrada', listener);
    try {
      fetch.mockResolvedValueOnce(jsonResponse(body, { status }));
      await expect(apiGet('/auth/me')).rejects.toMatchObject({ status });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('usuario')).toBeNull();
    } finally {
      window.removeEventListener('auth:sessao-encerrada', listener);
    }
  });

  it('retorna blob em respostas de arquivo', async () => {
    const blob = new Blob(['arquivo']);
    fetch.mockResolvedValueOnce(new Response(blob, { status: 200 }));

    await expect(apiBlob('/arquivo')).resolves.toBeInstanceOf(Blob);
  });
});
