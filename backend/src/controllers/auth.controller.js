const authService = require('../services/auth.service');
const auditLogService = require('../services/audit-log.service');

/**
 * Autentica usuario por e-mail e senha e registra auditoria do resultado.
 *
 * @param {Object} req - Requisicao com credenciais em req.body.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Dados de sessao ou erro de autenticacao.
 */
async function login(req, res) {
  const { email, senha } = req.body || {};

  try {
    if (!email || !senha) {
      return res.status(400).json({
        message: 'E-mail e senha são obrigatórios.'
      });
    }

    const resultado = await authService.login(email, senha);

    await auditLogService.registrarSemBloquear(req, {
      usuario_id: resultado.usuario.id,
      acao: 'auth.login',
      entidade: 'usuarios',
      entidade_id: resultado.usuario.id,
      dados: {
        email
      }
    });

    return res.json(resultado);
  } catch (error) {
    await auditLogService.registrarSemBloquear(req, {
      acao: 'auth.login_falha',
      entidade: 'usuarios',
      dados: {
        email,
        motivo: error.message
      }
    });

    return res.status(error.status || 401).json({
      message: error.message || 'Erro ao fazer login.',
      ...(error.code ? { code: error.code } : {})
    });
  }
}

/**
 * Retorna os dados do usuario autenticado.
 *
 * @param {Object} req - Requisicao autenticada com req.usuario.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Usuario logado ou erro 401.
 */
async function me(req, res) {
  try {
    const usuario = await authService.buscarUsuarioLogado(req.usuario.id);

    return res.json(usuario);
  } catch (error) {
    return res.status(401).json({
      message: error.message || 'Usuário não autenticado.'
    });
  }
}

/**
 * Atualiza o perfil do usuario autenticado e registra auditoria das alteracoes.
 *
 * @param {Object} req - Requisicao com campos de perfil em req.body.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Usuario atualizado.
 */
async function updateMe(req, res) {
  try {
    const usuario = await authService.atualizarPerfil(req.usuario.id, req.body, {
      registrarAuditoria: req.registrarAlteracaoAuditoria
    });

    return res.json(usuario);
  } catch (error) {
    console.error('Erro ao atualizar perfil.');

    const mensagensSeguras = [
      'Usuário não encontrado.', 'Foto de perfil invalida.',
      'A foto deve ser PNG, JPG ou WEBP.', 'A foto deve ter ate 4 MB.',
      'Chave de criptografia de senhas ausente ou inválida.', 'Senha inválida.'
    ];

    return res.status(error.recuperacaoSegura ? error.status : 500).json({
      message: error.recuperacaoSegura || mensagensSeguras.includes(error.message) ? error.message : 'Erro ao atualizar perfil.'
    });
  }
}

module.exports = {
  login,
  me,
  updateMe
};
