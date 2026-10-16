const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99
]);

function normalizarDdd(valor) {
  const ddd = String(valor ?? '').trim();
  if (ddd && (!/^\d{2}$/.test(ddd) || !DDDS_VALIDOS.has(Number(ddd)))) {
    const error = new Error('Informe um DDD brasileiro válido.');
    error.statusCode = 400;
    throw error;
  }
  return ddd;
}

module.exports = { normalizarDdd };
