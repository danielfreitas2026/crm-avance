const vendaAprovacaoService = require('../services/venda-aprovacao.service');
const telegramAprovacoesService = require('../services/telegram-aprovacoes.service');

async function sincronizarDecisaoNoTelegram(solicitacao) {
  try {
    await telegramAprovacoesService.reconciliarSolicitacao(solicitacao.id);
  } catch (error) {
    // A decisão no CRM já foi concluída e não deve ser revertida por uma falha externa.
    console.error('Erro ao refletir decisão de aprovação no Telegram:', error.message);
  }
}

/**
 * Lista solicitacoes de aprovacao de vendas.
 *
 * @param {Object} req - Requisicao com filtros em req.query.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Solicitacoes encontradas.
 */
async function index(req, res) {
  try {
    const solicitacoes = await vendaAprovacaoService.listarSolicitacoes(req.query);
    return res.json(solicitacoes);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao listar solicitações de aprovação.' });
  }
}

/**
 * Aprova uma solicitacao de venda.
 *
 * @param {Object} req - Requisicao com id em req.params e decisao em req.body.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Solicitacao aprovada.
 */
async function aprovar(req, res) {
  try {
    const solicitacao = await vendaAprovacaoService.aprovarSolicitacao(req.params.id, req.body, req.usuario.id);
    await sincronizarDecisaoNoTelegram(solicitacao);
    return res.json(solicitacao);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({
      message: error.message || 'Erro ao aprovar solicitação.'
    });
  }
}

/**
 * Recusa uma solicitacao de venda.
 *
 * @param {Object} req - Requisicao com id em req.params e motivo em req.body.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Solicitacao recusada.
 */
async function recusar(req, res) {
  try {
    const solicitacao = await vendaAprovacaoService.recusarSolicitacao(req.params.id, req.body, req.usuario.id);
    await sincronizarDecisaoNoTelegram(solicitacao);
    return res.json(solicitacao);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({
      message: error.message || 'Erro ao recusar solicitação.'
    });
  }
}

module.exports = {
  index,
  aprovar,
  recusar
};
