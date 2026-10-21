const PREFIX = 'crm:navegacao:v1:';

/** Navegação é local à aba e à sessão autenticada; nunca contém dados de registros. */
export function navigationKey(scope) {
  if (!scope) return null;
  try {
    const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
    return usuario?.id ? `${PREFIX}${usuario.id}:${scope}` : null;
  } catch {
    return null;
  }
}

export function readNavigation(key, fallback, validate) {
  if (!key) return fallback;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return fallback;
    const value = JSON.parse(raw);
    return validate(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writeNavigation(key, value) {
  if (!key) return;
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch { /* A navegação continua funcionando sem armazenamento. */ }
}

export function clearNavigation() {
  try {
    Object.keys(sessionStorage).filter(key => key.startsWith(PREFIX))
      .forEach(key => sessionStorage.removeItem(key));
  } catch { /* Armazenamento indisponível. */ }
}

export function sameNavigationType(value, fallback) {
  if (fallback === null) return value === null;
  if (typeof fallback === 'number') return typeof value === 'number' && Number.isFinite(value)
    && (fallback < 1 || (Number.isSafeInteger(value) && value >= 1));
  if (Array.isArray(fallback)) return Array.isArray(value) && value.length <= 1000
    && value.every(item => typeof item === 'string' || (typeof item === 'number' && Number.isFinite(item)));
  if (typeof fallback === 'object') return value !== null && !Array.isArray(value)
    && typeof value === 'object' && Object.keys(fallback).every(key => sameNavigationType(value[key], fallback[key]));
  return typeof value === typeof fallback;
}
