const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
let redirecionandoLogin = false;

/**
 * Processa encerrar sessao expirada conforme as regras do dominio.
 */
function encerrarSessaoExpirada() {
  localStorage.removeItem('token');
  localStorage.removeItem('usuario');

  if (!redirecionandoLogin && window.location.pathname !== '/login') {
    redirecionandoLogin = true;
    window.location.replace('/login');
  }
}

/**
 * Executa uma requisicao JSON autenticada contra a API configurada.
 *
 * @param {string} endpoint - Caminho relativo da API, incluindo query string quando houver.
 * @param {RequestInit} [options={}] - Opcoes repassadas ao fetch.
 * @returns {Promise<unknown>} Corpo JSON retornado pela API, ou null quando nao houver JSON.
 * @throws {Error} Quando a API retorna status de erro.
 */
export async function apiRequest(endpoint, options = {}) {
  const token = localStorage.getItem('token');
  const isFormData = options.body instanceof FormData;

  const headers = {
    ...(options.headers || {})
  };

  if (!isFormData) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers
  });

  const contentType = response.headers.get('content-type');

  const data = contentType?.includes('application/json')
    ? await response.json()
    : null;

  if (!response.ok) {
    if (response.status === 401) {
      encerrarSessaoExpirada();
    }

    throw new Error(data?.message || data?.error || 'Erro na requisição.');
  }

  return data;
}

/**
 * Executa uma requisicao autenticada que retorna arquivo/binario.
 *
 * @param {string} endpoint - Caminho relativo da API.
 * @param {RequestInit} [options={}] - Opcoes repassadas ao fetch.
 * @returns {Promise<Blob>} Blob retornado pela API.
 * @throws {Error} Quando a API retorna status de erro.
 */
export async function apiBlob(endpoint, options = {}) {
  const token = localStorage.getItem('token');
  const isFormData = options.body instanceof FormData;
  const headers = {
    ...(options.headers || {})
  };

  if (!isFormData) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers
  });

  if (!response.ok) {
    if (response.status === 401) {
      encerrarSessaoExpirada();
    }

    const contentType = response.headers.get('content-type');
    const data = contentType?.includes('application/json')
      ? await response.json()
      : null;
    throw new Error(data?.message || data?.error || 'Erro na requisição.');
  }

  return response.blob();
}

export async function apiStreamNdjson(endpoint, options = {}, onEvent = () => {}) {
  const token = localStorage.getItem('token');
  const isFormData = options.body instanceof FormData;
  const headers = {
    ...(options.headers || {})
  };

  if (!isFormData) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers
  });

  if (!response.ok) {
    if (response.status === 401) {
      encerrarSessaoExpirada();
    }

    const contentType = response.headers.get('content-type');
    const data = contentType?.includes('application/json')
      ? await response.json()
      : null;
    throw new Error(data?.message || data?.error || 'Erro na requisiÃ§Ã£o.');
  }

  if (!response.body) {
    return;
  }

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
      if (!texto) return;
      onEvent(JSON.parse(texto));
    });

    if (done) break;
  }

  const resto = buffer.trim();
  if (resto) {
    onEvent(JSON.parse(resto));
  }
}

/**
 * Atalho para requisicoes GET JSON.
 *
 * @param {string} endpoint - Caminho relativo da API.
 * @returns {Promise<unknown>} Resposta JSON da API.
 */
export function apiGet(endpoint) {
  return apiRequest(endpoint);
}

/**
 * Atalho para requisicoes POST JSON.
 *
 * @param {string} endpoint - Caminho relativo da API.
 * @param {unknown} body - Payload serializado como JSON.
 * @returns {Promise<unknown>} Resposta JSON da API.
 */
export function apiPost(endpoint, body) {
  return apiRequest(endpoint, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

/**
 * Atalho para requisicoes PUT JSON.
 *
 * @param {string} endpoint - Caminho relativo da API.
 * @param {unknown} body - Payload serializado como JSON.
 * @returns {Promise<unknown>} Resposta JSON da API.
 */
export function apiPut(endpoint, body) {
  return apiRequest(endpoint, {
    method: 'PUT',
    body: JSON.stringify(body)
  });
}

/**
 * Atalho para requisicoes DELETE JSON.
 *
 * @param {string} endpoint - Caminho relativo da API.
 * @param {unknown} [body] - Payload opcional serializado como JSON.
 * @returns {Promise<unknown>} Resposta JSON da API.
 */
export function apiDelete(endpoint, body) {
  return apiRequest(endpoint, {
    method: 'DELETE',
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

