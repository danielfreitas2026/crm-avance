const vendaProblemaService = require('../services/venda-problema.service');
const vendaVisibilidadeService = require('../services/venda-visibilidade.service');

/**
 * Envia erro padronizado de operacoes de problemas de venda.
 *
 * @param {Object} res - Resposta HTTP.
 * @param {Object} error - Erro lancado pelo service.
 * @param {string} fallback - Mensagem padrao quando o erro nao possui mensagem.
 * @returns {Object} Resposta JSON de erro.
 */
function responderErro(res, error, fallback) {
  console.error(error);
  return res.status(error.statusCode || 500).json({
    message: error.message || fallback
  });
}

/**
 * Abre um problema em uma venda.
 *
 * @param {Object} req - Requisicao com vendaId na rota e dados em req.body.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Problema criado.
 */
async function store(req, res) {
  try {
    const problemaCompleto = await vendaProblemaService.abrirProblema(req.params.id, req.body, req.usuario.id);
    const problema = await vendaVisibilidadeService.sanitizarProblemaParaUsuario(problemaCompleto, req.usuario.id);
    return res.status(201).json(problema);
  } catch (error) {
    return responderErro(res, error, 'Erro ao marcar problema na venda.');
  }
}

/**
 * Lista destinatarios disponiveis para problemas de venda.
 *
 * @param {Object} req - Requisicao HTTP.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Destinatarios disponiveis.
 */
async function destinatarios(req, res) {
  try {
    const usuarios = await vendaProblemaService.listarDestinatariosDisponiveis();
    return res.json(usuarios);
  } catch (error) {
    return responderErro(res, error, 'Erro ao listar responsáveis.');
  }
}

/**
 * Busca o problema ativo de uma venda.
 *
 * @param {Object} req - Requisicao com vendaId em req.params.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Problema ativo ou null.
 */
async function ativo(req, res) {
  try {
    const problemaCompleto = await vendaProblemaService.obterAtivo(req.params.id, req.usuario.id);
    const problema = await vendaVisibilidadeService.sanitizarProblemaParaUsuario(problemaCompleto, req.usuario.id);
    return res.json(problema || null);
  } catch (error) {
    return responderErro(res, error, 'Erro ao buscar problema ativo da venda.');
  }
}

/**
 * Lista problemas ativos de uma venda.
 *
 * @param {Object} req - Requisicao com vendaId em req.params.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Lista de problemas ativos.
 */
async function index(req, res) {
  try {
    const problemasCompletos = await vendaProblemaService.listarAtivos(req.params.id, req.usuario.id);
    const problemas = await vendaVisibilidadeService.sanitizarProblemaParaUsuario(problemasCompletos, req.usuario.id);
    return res.json(problemas);
  } catch (error) {
    return responderErro(res, error, 'Erro ao listar problemas ativos da venda.');
  }
}

/**
 * Resolve um problema de venda.
 *
 * @param {Object} req - Requisicao com problemaId e dados de resolucao.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Problema resolvido.
 */
async function resolver(req, res) {
  try {
    const problemaCompleto = await vendaProblemaService.resolverProblema(req.params.problemaId, req.body, req.usuario.id);
    const problema = await vendaVisibilidadeService.sanitizarProblemaParaUsuario(problemaCompleto, req.usuario.id);
    return res.json(problema);
  } catch (error) {
    return responderErro(res, error, 'Erro ao resolver problema da venda.');
  }
}

/**
 * Solicita correcao de um problema de venda.
 *
 * @param {Object} req - Requisicao com problemaId e detalhes em req.body.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Problema atualizado com solicitacao.
 */
async function correcao(req, res) {
  try {
    const problemaCompleto = await vendaProblemaService.solicitarCorrecao(req.params.problemaId, req.body, req.usuario.id);
    const problema = await vendaVisibilidadeService.sanitizarProblemaParaUsuario(problemaCompleto, req.usuario.id);
    return res.json(problema);
  } catch (error) {
    return responderErro(res, error, 'Erro ao solicitar nova correção.');
  }
}

/**
 * Verifica um problema de venda pendente.
 *
 * @param {Object} req - Requisicao com problemaId em req.params.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Resultado da verificacao.
 */
async function verificar(req, res) {
  try {
    const problemaCompleto = await vendaProblemaService.verificarProblema(req.params.problemaId, req.usuario.id);
    const problema = await vendaVisibilidadeService.sanitizarProblemaParaUsuario(problemaCompleto, req.usuario.id);
    return res.json(problema);
  } catch (error) {
    return responderErro(res, error, 'Erro ao verificar problema da venda.');
  }
}

module.exports = {
  destinatarios,
  store,
  ativo,
  index,
  resolver,
  correcao,
  verificar
};
