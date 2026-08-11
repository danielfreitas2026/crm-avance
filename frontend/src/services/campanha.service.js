/**
 * Cliente de API para campanhas, progresso e resgates.
 */
import { apiDelete, apiGet, apiPost, apiPut } from './api';

/**
 * Retorna campanhas a partir dos dados informados.
 */
export const getCampanhas = async () => {
  const data = await apiGet('/campanhas');
  return data;
};

/** Lista usuários ativos elegíveis para participar de campanhas. */
export const getParticipantesCampanha = async () => apiGet('/campanhas/participantes');

/**
 * Atualiza campanhas com o estado mais recente.
 */
export const updateCampanhas = async (campanhas) => {
  const data = await apiPut('/campanhas', { campanhas });
  return data;
};

/**
 * Cria campanha com os dados informados.
 */
export const createCampanha = async (campanha) => {
  const data = await apiPost('/campanhas', campanha);
  return data;
};

/**
 * Remove campanha conforme a regra de negocio.
 */
export const deleteCampanha = async (id) => {
  await apiDelete(`/campanhas/${id}`);
};

/**
 * Retorna progresso a partir dos dados informados.
 */
export const getProgresso = async () => {
  const data = await apiGet('/campanhas/progresso');
  return data;
};

/**
 * Retorna progresso usuarios a partir dos dados informados.
 */
export const getProgressoUsuarios = async () => {
  const data = await apiGet('/campanhas/progresso/usuarios');
  return data;
};

/**
 * Processa resgatar campanha conforme as regras do dominio.
 */
export const resgatarCampanha = async (id) => {
  const data = await apiPost(`/campanhas/${id}/resgatar`, {});
  return data;
};
