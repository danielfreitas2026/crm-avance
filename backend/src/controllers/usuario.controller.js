const usuarioService = require('../services/usuario.service');

/**
 * Lista usuarios conforme filtros de consulta.
 *
 * @param {Object} req - Requisicao com filtros em req.query.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Lista de usuarios.
 */
async function index(req, res) {
  try {
    const usuarios = await usuarioService.listarUsuarios();

    return res.json(usuarios);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: 'Erro ao listar usuários.'
    });
  }
}

/**
 * Busca um usuario pelo identificador.
 *
 * @param {Object} req - Requisicao com id em req.params.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Usuario encontrado ou erro 404.
 */
async function show(req, res) {
  try {
    const usuario = await usuarioService.buscarUsuarioPorId(req.params.id);

    if (!usuario) {
      return res.status(404).json({
        message: 'Usuário não encontrado.'
      });
    }

    return res.json(usuario);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: 'Erro ao buscar usuário.'
    });
  }
}

/**
 * Cria um novo usuario.
 *
 * @param {Object} req - Requisicao com dados do usuario em req.body.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Usuario criado.
 */
async function store(req, res) {
  try {
    const usuario = await usuarioService.criarUsuario(req.body);

    return res.status(201).json(usuario);
  } catch (error) {
    console.error(error);

    return res.status(error.code === 'PASSWORD_VAULT_UNAVAILABLE' ? 503 : 500).json({
      message: error.code === 'PASSWORD_VAULT_UNAVAILABLE' ? error.message : 'Erro ao criar usuário.'
    });
  }
}

/**
 * Atualiza um usuario existente.
 *
 * @param {Object} req - Requisicao com id na rota e campos em req.body.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Usuario atualizado ou erro 404.
 */
async function update(req, res) {
  try {
    const usuario = await usuarioService.atualizarUsuario(req.params.id, req.body, {
      registrarAuditoria: req.registrarAlteracaoAuditoria
    });

    if (!usuario) {
      return res.status(404).json({
        message: 'Usuário não encontrado.'
      });
    }

    return res.json(usuario);
  } catch (error) {
    console.error(error);

    return res.status(error.code === 'PASSWORD_VAULT_UNAVAILABLE' ? 503 : 500).json({
      message: error.code === 'PASSWORD_VAULT_UNAVAILABLE' ? error.message : 'Erro ao atualizar usuário.'
    });
  }
}

/**
 * Remove um usuario pelo identificador.
 *
 * @param {Object} req - Requisicao com id em req.params.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<(Object|void)>} Status 204 quando removido.
 */
async function destroy(req, res) {
  try {
    const totalExcluido = await usuarioService.excluirUsuario(req.params.id);

    if (!totalExcluido) {
      return res.status(404).json({
        message: 'Usuário não encontrado.'
      });
    }

    return res.status(204).send();
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: 'Erro ao excluir usuário.'
    });
  }
}

module.exports = {
  index,
  show,
  store,
  update,
  destroy
};
