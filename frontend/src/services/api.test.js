import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiBlob, apiDelete, apiGet, apiPost, apiPut, apiRequest, apiStreamNdjson, tratarErroAutenticacao } from './api';
import { SESSION_EXPIRED_MESSAGE } from '../utils/sessao-codigo';

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
      credentials: 'include',
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

  it.each(['json', 'blob', 'stream'])('envia cookie de navegador em chamadas %s preservando Bearer', async tipo => {
    localStorage.setItem('token', 'jwt-atual');
    fetch.mockResolvedValueOnce(tipo === 'json' ? jsonResponse({}) : new Response(''));
    const executar = tipo === 'json' ? apiGet : tipo === 'blob' ? apiBlob : apiStreamNdjson;
    await executar('/protegido');
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'include', headers: { Authorization: 'Bearer jwt-atual' } });
  });

  it('preserva o modo por dispositivo para a tela de verificação sem repetir a operação', async () => {
    window.history.replaceState({}, '', '/verificar-acesso');
    fetch.mockResolvedValueOnce(jsonResponse({ code: 'NETWORK_ACCESS_REQUIRED', modo: 'dispositivo', solicitacao_id: 'id-dispositivo', expira_em: '2026-10-23T15:00:00Z' }, { status: 403 }));
    await expect(apiGet('/protegido')).rejects.toMatchObject({ code: 'NETWORK_ACCESS_REQUIRED' });
    expect(JSON.parse(sessionStorage.getItem('acesso_rede_pendente')).modo).toBe('dispositivo');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('401 de sessão por código expirada limpa sessão e navegação, preservando cookie e aviso no login', async () => {
    window.history.replaceState({}, '', '/login');
    const token = `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 1, acesso_por_codigo: true }))}.assinatura`;
    localStorage.setItem('token', token);
    localStorage.setItem('usuario', '{"id":1}');
    sessionStorage.setItem('acesso_rede_pendente', '{"solicitacao_id":"antiga"}');
    sessionStorage.setItem('crm:navegacao:v1:1:vendas', '{"pagina":2}');
    document.cookie = 'crm_dispositivo=credencial-teste; path=/';
    fetch.mockResolvedValueOnce(jsonResponse({ message: 'Token expirado.' }, { status: 401 }));
    await expect(apiGet('/protegido')).rejects.toMatchObject({ status: 401 });
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('usuario')).toBeNull();
    expect(sessionStorage.getItem('acesso_rede_pendente')).toBeNull();
    expect(sessionStorage.getItem('crm:navegacao:v1:1:vendas')).toBeNull();
    expect(sessionStorage.getItem('logout_message')).toBe(SESSION_EXPIRED_MESSAGE);
    expect(document.cookie).toContain('crm_dispositivo=credencial-teste');
    document.cookie = 'crm_dispositivo=; path=/; max-age=0';
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('401 atrasado de um token antigo não encerra um novo login', async () => {
    window.history.replaceState({}, '', '/login');
    localStorage.setItem('token', 'token-antigo');
    fetch.mockResolvedValueOnce(jsonResponse({ message: 'Token expirado.' }, { status: 401 }));
    const requisicao = apiGet('/protegido');
    localStorage.setItem('token', 'novo-login');
    localStorage.setItem('usuario', '{"id":2}');
    await expect(requisicao).rejects.toMatchObject({ status: 401 });
    expect(localStorage.getItem('token')).toBe('novo-login');
    expect(localStorage.getItem('usuario')).toBe('{"id":2}');
  });
});
