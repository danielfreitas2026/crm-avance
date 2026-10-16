const { isDeepStrictEqual } = require('node:util');

const CAMPOS_AUTOMATICOS = new Set(['id', 'created_at', 'updated_at', 'ultima_atividade_em']);
const CAMPO_SENSIVEL = /senha|password|token|authorization|jwt|(?:^|[._])secret(?:$|[._])|api_key/i;

function normalizar(valor) {
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === 'string' && /^[\[{]/.test(valor.trim())) {
    try { return JSON.parse(valor); } catch { /* Preserva texto que não é JSON. */ }
  }
  return valor;
}

function objeto(valor) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

/** Compara os estados efetivamente persistidos, sem gravar credenciais. */
function montarAlteracoesAuditoria(anterior = {}, novo = {}) {
  const alteracoes = [];
  function comparar(campo, antes, depois) {
    antes = normalizar(antes);
    depois = normalizar(depois);
    if (isDeepStrictEqual(antes, depois)) return;
    if (CAMPO_SENSIVEL.test(campo) || campo === 'foto_perfil') {
      alteracoes.push({ campo, anterior: '[removido]', novo: '[removido]', protegido: true });
    } else if (objeto(antes) && objeto(depois)) {
      for (const chave of new Set([...Object.keys(antes), ...Object.keys(depois)])) {
        comparar(`${campo}.${chave}`, antes[chave], depois[chave]);
      }
    } else if (Array.isArray(antes) && Array.isArray(depois)) {
      for (let i = 0; i < Math.max(antes.length, depois.length); i += 1) {
        comparar(`${campo}[${i}]`, antes[i], depois[i]);
      }
    } else {
      alteracoes.push({ campo, anterior: antes ?? null, novo: depois ?? null });
    }
  }
  for (const campo of new Set([...Object.keys(anterior), ...Object.keys(novo)])) {
    if (!CAMPOS_AUTOMATICOS.has(campo)) comparar(campo, anterior[campo], novo[campo]);
  }
  return alteracoes;
}

module.exports = { montarAlteracoesAuditoria, CAMPO_SENSIVEL };
