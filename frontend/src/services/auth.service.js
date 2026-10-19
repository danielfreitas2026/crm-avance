/**
 * Cliente de API para autenticacao, perfil local e permissoes do usuario.
 */
import { apiGet, apiPost, apiPut } from './api';
import {
  PERMISSOES_ADMIN_EXPLICITAS,
  permissaoObrigatoriaAdminVendas
} from '../utils/permissoes-admin';

/**
 * Processa login conforme as regras do dominio.
 */
export async function login(email, senha) {
  const data = await apiPost('/auth/login', {
    email,
    senha
  });

  localStorage.setItem('token', data.token);
  localStorage.setItem('usuario', JSON.stringify(data.usuario));

  return data;
}

/**
 * Busca perfil conforme os parametros informados.
 */
export async function buscarPerfil() {
  return apiGet('/auth/me');
}

export const solicitarRecuperacao = email => apiPost('/auth/forgot-password', { email });
export const confirmarEmailRecuperacao = token => apiPost('/auth/confirmar-email-recuperacao', { token });
export const redefinirSenha = (token, senha) => apiPost('/auth/reset-password', { token, senha });
export const reenviarConfirmacaoEmailRecuperacao = senha_atual =>
  apiPost('/auth/reenviar-confirmacao-email-recuperacao', { senha_atual });

/**
 * Retorna usuario local a partir dos dados informados.
 */
export function getUsuarioLocal() {
  const usuario = localStorage.getItem('usuario');

  if (!usuario) {
    return null;
  }

  return JSON.parse(usuario);
}

/**
 * Normaliza permissoes para uso interno consistente.
 */
function normalizarPermissoes(permissoes) {
  if (!permissoes) {
    return {};
  }

  if (typeof permissoes === 'string') {
    try {
      return normalizarPermissoes(JSON.parse(permissoes));
    } catch {
      return {};
    }
  }

  if (Array.isArray(permissoes)) {
    return permissoes.reduce((acc, permissao) => {
      acc[permissao] = true;
      return acc;
    }, {});
  }

  return permissoes;
}

/**
 * Verifica se permissao esta presente nos dados informados.
 */
export function temPermissao(usuario, permissao) {
  if (!permissao) {
    return true;
  }

  if (Array.isArray(permissao)) {
    return permissao.some(item => temPermissao(usuario, item));
  }

  if (usuario?.role?.nome === 'admin') {
    const permissaoObrigatoria = permissaoObrigatoriaAdminVendas(permissao);
    if (permissaoObrigatoria !== null) return permissaoObrigatoria;

    const permissoesUsuario = normalizarPermissoes(usuario?.permissoes);
    if (PERMISSOES_ADMIN_EXPLICITAS.has(permissao)) {
      return permissoesUsuario?.[permissao] === true;
    }

    return permissoesUsuario?.[permissao] !== false;
  }

  const permissoesUsuario = normalizarPermissoes(usuario?.permissoes);
  const permissoesRole = normalizarPermissoes(usuario?.role?.permissoes);

  return permissoesUsuario?.[permissao] === true || permissoesRole?.[permissao] === true;
}

/**
 * Atualiza perfil com os dados informados.
 */
export async function atualizarPerfil(dados) {
  const usuario = await apiPut('/auth/me', dados);

  localStorage.setItem('usuario', JSON.stringify(usuario));

  return usuario;
}

/**
 * Processa logout conforme as regras do dominio.
 */
export function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('usuario');
}
