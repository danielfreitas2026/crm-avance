import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiBlob, apiDelete, apiGet, apiPost, apiPut, apiRequest, apiStreamNdjson, tratarErroAutenticacao } from './api';

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('api service', () => {
  it.each(['json', 'blob', 'stream', 'upload'])('preserva solicitação e bloqueia a operação %s sem repeti-la', async tipo => {
    window.history.replaceState({}, '', '/verificar-acesso');
    localStorage.setItem('token', 'sessao-existente');
    const data = { code: 'NETWORK_ACCESS_REQUIRED', message: 'Rede externa', solicitacao_id: 'id-teste', expira_em: '2026-10-21T15:00:00Z' };
    fetch.mockResolvedValueOnce(jsonResponse(data, { status: 403 }));
    if (tipo === 'upload') tratarErroAutenticacao({ status: 403 }, data, 'sessao-existente', '/upload');
    else {
      const executar = tipo === 'blob' ? apiBlob : tipo === 'stream' ? apiStreamNdjson : apiGet;
      await expect(executar('/protegido')).rejects.toMatchObject({ code: 'NETWORK_ACCESS_REQUIRED' });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
    expect(JSON.parse(sessionStorage.getItem('acesso_rede_pendente'))).toEqual({ solicitacao_id: data.solicitacao_id, expira_em: data.expira_em });
    expect(localStorage.getItem('token')).toBe('sessao-existente');
  });
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

  it('retorna blob em respostas de arquivo', async () => {
    const blob = new Blob(['arquivo']);
    fetch.mockResolvedValueOnce(new Response(blob, { status: 200 }));

    await expect(apiBlob('/arquivo')).resolves.toBeInstanceOf(Blob);
  });
});
