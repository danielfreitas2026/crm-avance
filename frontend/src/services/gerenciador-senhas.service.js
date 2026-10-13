import { apiRequest } from './api';

export function listarCredenciais(signal) {
  return apiRequest('/admin/senhas', { signal, cache: 'no-store' });
}

export function revelarSenha(id, signal) {
  return apiRequest(`/admin/senhas/${id}/revelar`, { method: 'POST', signal, cache: 'no-store' });
}
