const notificacaoService = require('../services/notificacao.service');
const notificacaoEmailService = require('../services/notificacao-email.service');
const Usuario = require('../models/Usuario');

/**
 * Lista notificacoes do usuario autenticado.
 *
 * @param {Object} req - Requisicao autenticada com filtros em req.query.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Notificacoes paginadas ou filtradas.
 */
async function index(req, res) {
  try {
    const dados = await notificacaoService.listarNotificacoes(req.usuario.id, req.query);
    return res.json(dados);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao listar notificacoes.' });
  }
}

/**
 * Lista notificacoes urgentes para exibicao imediata.
 *
 * @param {Object} req - Requisicao autenticada.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Lista de notificacoes urgentes.
 */
async function urgentes(req, res) {
  try {
    const notificacoes = await notificacaoService.listarUrgentes(req.usuario.id);
    return res.json({ notificacoes });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao listar notificacoes urgentes.' });
  }
}

/**
 * Marca uma notificacao como lida para o usuario atual.
 *
 * @param {Object} req - Requisicao com id da notificacao em req.params.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<(Object|void)>} Status 204 quando atualizada.
 */
async function marcarLida(req, res) {
  try {
    await notificacaoService.marcarComoLida(req.params.id, req.usuario.id);
    return res.status(204).send();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao marcar notificacao como lida.' });
  }
}

/**
 * Marca o popup de uma notificacao como visualizado.
 *
 * @param {Object} req - Requisicao com id da notificacao em req.params.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<(Object|void)>} Status 204 quando atualizado.
 */
async function marcarPopupVisto(req, res) {
  try {
    await notificacaoService.marcarPopupVisto(req.params.id, req.usuario.id);
    return res.status(204).send();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao marcar popup como visto.' });
  }
}

/**
 * Marca todas as notificacoes do usuario como lidas.
 *
 * @param {Object} req - Requisicao autenticada.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<(Object|void)>} Status 204 quando concluido.
 */
async function marcarTodasLidas(req, res) {
  try {
    await notificacaoService.marcarTodasComoLidas(req.usuario.id, { escopo: req.query?.escopo });
    return res.status(204).send();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao marcar notificacoes como lidas.' });
  }
}

/**
 * Oculta uma notificacao somente para o usuario autenticado.
 *
 * @param {Object} req - Requisicao com id da notificacao em req.params.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<(Object|void)>} Status 204 quando concluido.
 */
async function excluir(req, res) {
  try {
    await notificacaoService.ocultarNotificacao(req.params.id, req.usuario.id);
    return res.status(204).send();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao excluir notificacao.' });
  }
}

/**
 * Envia um e-mail de teste de notificacao para o usuario logado.
 *
 * @param {Object} req - Requisicao autenticada.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Resultado do envio e status da configuracao.
 */
async function testarEmail(req, res) {
  try {
    const usuario = await Usuario.query().findById(req.usuario.id);
    const resultado = await notificacaoEmailService.enviarEmailTeste(usuario);
    return res.json({
      ...resultado,
      config: notificacaoEmailService.statusConfiguracao()
    });
  } catch (error) {
    console.error('Erro ao enviar email de teste:', error);
    return res.status(error.statusCode || 500).json({
      message: error.message || 'Erro ao enviar email de teste.',
      config: notificacaoEmailService.statusConfiguracao()
    });
  }
}

module.exports = {
  index,
  urgentes,
  marcarLida,
  marcarPopupVisto,
  marcarTodasLidas,
  excluir,
  testarEmail
};
