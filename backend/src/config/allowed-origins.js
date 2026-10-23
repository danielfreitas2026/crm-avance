function allowedOrigins() {
  return [
    'http://localhost:5173', 'http://127.0.0.1:5173',
    'http://localhost:5175', 'http://127.0.0.1:5175',
    'https://pos-venda.avancevip.net.br', process.env.FRONTEND_URL,
    ...(process.env.CORS_ALLOWED_ORIGINS || '').split(',')
  ].filter(Boolean).map(origin => origin.trim()).filter(Boolean);
}

function exigirOrigemPermitida(req, res, next) {
  if (!allowedOrigins().includes(req.headers.origin)) {
    return res.status(403).json({ message: 'Origem não autorizada para esta operação.' });
  }
  return next();
}

module.exports = { allowedOrigins, exigirOrigemPermitida };
