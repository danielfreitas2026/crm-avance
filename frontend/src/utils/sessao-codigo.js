export const SESSION_EXPIRED_MESSAGE = 'Sua sessão expirou. Entre novamente e solicite um novo código ao administrador, se necessário.';

// Apenas orienta a interface. A API sempre valida assinatura e expiração do JWT.
export function expiracaoSessaoCodigo(token) {
  try {
    const partes = token.split('.');
    if (partes.length !== 3) return null;
    const base64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    return claims.acesso_por_codigo === true && Number.isSafeInteger(claims.exp) && claims.exp > 0
      ? claims.exp * 1000 : null;
  } catch { return null; }
}
