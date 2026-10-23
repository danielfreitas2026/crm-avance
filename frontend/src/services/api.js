import { clearNavigation } from '../utils/navigation-storage';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
let redirecionandoLogin = false;

export const SYSTEM_CLOSED_MESSAGE = 'O sistema está temporariamente fechado. Tente novamente no horário de funcionamento.';

function encerrarSessaoExpirada() {
  clearNavigation();
  localStorage.removeItem('token');
  localStorage.removeItem('usuario');

  if (!redirecionandoLogin && window.location.pathname !== '/login') {
    redirecionandoLogin = true;
    window.location.replace('/login');
  }
}

function encerrarSessaoPorFechamento(message) {
  clearNavigation();
  localStorage.removeItem('token');
  localStorage.removeItem('usuario');
  sessionStorage.setItem('system_closed_message', message || SYSTEM_CLOSED_MESSAGE);

  if (!redirecionandoLogin && window.location.pathname !== '/login') {
    redirecionandoLogin = true;
    window.location.replace('/login');
  }
}

function criarErroApi(response, data) {
  const error = new Error(data?.message || data?.error || 'Erro na requisição.');
  error.status = response.status;
  error.code = data?.code;
  return error;
}

export function tratarErroAutenticacao(response, data, token, endpoint) {
  if (response.status === 403 && data?.code === 'NETWORK_ACCESS_REQUIRED') {
    sessionStorage.setItem('acesso_rede_pendente', JSON.stringify({
      solicitacao_id: data.solicitacao_id, expira_em: data.expira_em, ...(data.modo ? { modo: data.modo } : {})
    }));
    if (endpoint !== '/auth/login' && window.location.pathname !== '/verificar-acesso' && !redirecionandoLogin) {
      redirecionandoLogin = true;
      window.location.replace('/verificar-acesso');
    }
    return;
  }
  if (response.status === 423 && data?.code === 'SYSTEM_CLOSED') {
    if (token && endpoint !== '/auth/login') encerrarSessaoPorFechamento(data.message);
    return;
  }

  if (response.status === 401) encerrarSessaoExpirada();
}

async function lerJson(response) {
  const contentType = response.headers.get('content-type');
  return contentType?.includes('application/json') ? response.json() : null;
}

function montarHeaders(options, token) {
  const isFormData = options.body instanceof FormData;
  const headers = { ...(options.headers || {}) };
  if (!isFormData) headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function apiRequest(endpoint, options = {}) {
  const token = localStorage.getItem('token');
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers: montarHeaders(options, token)
  });
  const data = await lerJson(response);

  if (!response.ok) {
    tratarErroAutenticacao(response, data, token, endpoint);
    throw criarErroApi(response, data);
  }

  return data;
}

export async function apiBlob(endpoint, options = {}) {
  const token = localStorage.getItem('token');
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers: montarHeaders(options, token)
  });

  if (!response.ok) {
    const data = await lerJson(response);
    tratarErroAutenticacao(response, data, token, endpoint);
    throw criarErroApi(response, data);
  }

  return response.blob();
}

export async function apiStreamNdjson(endpoint, options = {}, onEvent = () => {}) {
  const token = localStorage.getItem('token');
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers: montarHeaders(options, token)
  });

  if (!response.ok) {
    const data = await lerJson(response);
    tratarErroAutenticacao(response, data, token, endpoint);
    throw criarErroApi(response, data);
  }

  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const partes = buffer.split('\n');
    buffer = partes.pop() || '';
    partes.forEach(parte => {
      const texto = parte.trim();
      if (texto) onEvent(JSON.parse(texto));
    });
    if (done) break;
  }

  const resto = buffer.trim();
  if (resto) onEvent(JSON.parse(resto));
}

export function apiGet(endpoint) {
  return apiRequest(endpoint);
}

export function apiPost(endpoint, body) {
  return apiRequest(endpoint, { method: 'POST', body: JSON.stringify(body) });
}

export function apiPut(endpoint, body) {
  return apiRequest(endpoint, { method: 'PUT', body: JSON.stringify(body) });
}

export function apiDelete(endpoint, body) {
  return apiRequest(endpoint, {
    method: 'DELETE',
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}
