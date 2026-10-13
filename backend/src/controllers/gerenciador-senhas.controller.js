const service = require('../services/gerenciador-senhas.service');

function responderErro(res, error) {
  const status = [404, 409].includes(error.status) ? error.status : 503;
  return res.status(status).json({
    message: status === 503 ? 'Gerenciador de senhas temporariamente indisponível.' : error.message
  });
}

async function index(req, res) {
  try {
    return res.json(await service.listar());
  } catch (error) {
    return responderErro(res, error);
  }
}

async function revelar(req, res) {
  if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id))) {
    return res.status(400).json({ message: 'Usuário inválido.' });
  }
  try {
    return res.json(await service.revelar(Number(req.params.id), req));
  } catch (error) {
    return responderErro(res, error);
  }
}

module.exports = { index, revelar };
