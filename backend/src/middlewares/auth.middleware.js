const jwt = require('jsonwebtoken');
const horarioAcessoService = require('../services/horario-acesso.service');
const acessoRede = require('../services/acesso-rede.service');

/**
 * Middleware Express que valida JWT Bearer e expõe o usuario decodificado em req.usuario.
 *
 * @param {Object} req - Requisicao HTTP.
 * @param {Object} res - Resposta HTTP.
 * @param {Function} next - Proximo middleware da cadeia.
 * @returns {void}
 */
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      message: 'Token não informado.'
    });
  }

  const [, token] = authHeader.split(' ');

  if (!token) {
    return res.status(401).json({
      message: 'Token inválido.'
    });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ message: 'Token inválido ou expirado.' });
  }

  try {
    const acesso = await horarioAcessoService.avaliarAcesso(decoded.id);

    if ((decoded.versao_sessao ?? 0) !== (acesso.versao_sessao ?? 0)) {
      return res.status(401).json({ message: 'Sessão encerrada. Faça login novamente.' });
    }

    if (!acesso.permitido && acesso.motivo === 'SYSTEM_CLOSED') {
      return res.status(423).json({
        code: 'SYSTEM_CLOSED',
        message: horarioAcessoService.SYSTEM_CLOSED_MESSAGE
      });
    }

    if (!acesso.permitido) {
      return res.status(401).json({ message: 'Usuário inativo.' });
    }

    await acessoRede.avaliarSessao(req, decoded, token);
    req.usuario = decoded;
    return next();
  } catch (error) {
    if (error.acessoRedeSeguro) {
      return res.status(error.status).json({ message: error.message, ...(error.code ? { code: error.code } : {}), ...error.detalhes });
    }
    console.error(error);
    return res.status(500).json({ message: 'Erro ao validar o horário de acesso.' });
  }
}

module.exports = authMiddleware;
