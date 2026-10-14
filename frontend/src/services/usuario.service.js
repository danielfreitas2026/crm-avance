/**
 * Cliente de API para usuarios, permissoes e manutencao de cadastro.
 */
import { apiGet, apiPost, apiPut, apiDelete } from './api';

/**
 * Lista usuarios conforme os filtros e parametros informados.
 */
export async function listarUsuarios() {
  return apiGet('/usuarios');
}

/**
 * Busca usuario por id conforme os parametros informados.
 */
export async function buscarUsuarioPorId(id) {
  return apiGet(`/usuarios/${id}`);
}

export async function visualizarSenhaUsuario(id) {
  return apiPost(`/usuarios/${id}/visualizar-senha`, {});
}

/**
 * Lista permissoes conforme os filtros e parametros informados.
 */
export async function listarPermissoes() {
  return apiGet('/permissoes');
}

/**
 * Cria usuario com os dados informados.
 */
export async function criarUsuario({ nome, email, senha, role_id, permissoes }) {
  return apiPost('/usuarios', {
    nome,
    email,
    senha,
    role_id,
    permissoes
  });
}

/**
 * Atualiza usuario com os dados informados.
 */
export async function atualizarUsuario(id, dados) {
  return apiPut(`/usuarios/${id}`, dados);
}

/**
 * Remove usuario conforme a regra de negocio.
 */
export async function deletarUsuario(id) {
  return apiDelete(`/usuarios/${id}`);
}
