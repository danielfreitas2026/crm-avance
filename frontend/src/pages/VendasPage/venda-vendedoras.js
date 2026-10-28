/**
 * Mantem apenas as vendedoras presentes nas opcoes exibidas no formulario.
 */
export function filtrarVendedorasVisiveis(ids = [], opcoes = []) {
  if (!Array.isArray(opcoes) || opcoes.length === 0) return ids;

  const visiveis = new Set(opcoes.map(opcao => Number(opcao.id)));
  return ids.filter(id => visiveis.has(Number(id)));
}
