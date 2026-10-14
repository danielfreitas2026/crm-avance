const usuarioService = require('../services/usuario.service');
const auditLogService = require('../services/audit-log.service');
const { recuperarSenha } = require('../utils/senha-usuario');

async function visualizarSenha(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    const usuario = await usuarioService.buscarUsuarioPorId(req.params.id);
    if (!usuario) return res.status(404).json({ message: 'Usuário não encontrado.' });
    if (!usuario.senha_criptografada) {
      return res.status(409).json({
        code: 'SENHA_NAO_DISPONIVEL',
        message: 'A senha atual não está disponível para visualização. Ela ficará disponível após uma nova troca de senha.'
      });
    }
    const senha = recuperarSenha(usuario.senha_criptografada);
    await auditLogService.registrar(req, {
      acao: 'usuario.senha_visualizada',
      entidade: 'usuarios',
      entidade_id: usuario.id,
      dados: { usuario_consultado_id: usuario.id }
    });
    return res.json({ senha });
  } catch {
    // Não imprimir erros que possam carregar dados da consulta ou da auditoria.
    return res.status(500).json({ message: 'Não foi possível visualizar a senha.' });
  }
}

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
    console.error('Erro ao criar usuário.');

    return res.status(500).json({
      message: 'Erro ao criar usuário.'
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
    console.error('Erro ao atualizar usuário.');

    return res.status(500).json({
      message: 'Erro ao atualizar usuário.'
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
  visualizarSenha,
  index,
  show,
  store,
  update,
  destroy
};
