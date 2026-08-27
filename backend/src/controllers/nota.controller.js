const notaService = require('../services/nota.service');

/**
 * Lista notas vinculadas a uma entidade permitida.
 *
 * @param {Object} req - Requisicao com tipo e id da entidade em req.params.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Lista de notas ou erro 404.
 */
async function index(req, res) {
  try {
    const notas = await notaService.listarNotas(req.params.tipo, req.params.id, req.usuario.id);

    if (!notas) {
      return res.status(404).json({ message: 'Entidade não encontrada.' });
    }

    return res.json(notas);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao listar notas.' });
  }
}

/**
 * Cria uma nota para uma entidade do sistema.
 *
 * @param {Object} req - Requisicao com entidade na rota e dados da nota em req.body.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Nota criada ou erro de validacao.
 */
async function store(req, res) {
  try {
    const nota = await notaService.criarNota(req.params.tipo, req.params.id, req.usuario.id, req.body);

    if (!nota) {
      return res.status(404).json({ message: 'Entidade não encontrada.' });
    }

    return res.status(201).json(nota);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao criar nota.' });
  }
}

/**
 * Atualiza uma nota existente.
 *
 * @param {Object} req - Requisicao com notaId em req.params.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Nota atualizada ou erro 404.
 */
async function update(req, res) {
  try {
    const nota = await notaService.atualizarNota(req.params.notaId, req.usuario.id, req.body);

    if (!nota) {
      return res.status(404).json({ message: 'Nota não encontrada.' });
    }

    return res.json(nota);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao atualizar nota.' });
  }
}

async function realizarRetorno(req, res) {
  try {
    const nota = await notaService.realizarRetornoNota(req.params.notaId, req.usuario.id);
    if (!nota) return res.status(404).json({ message: 'Nota não encontrada.' });
    return res.json(nota);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao concluir retorno.' });
  }
}

/**
 * Remove uma nota do sistema.
 *
 * @param {Object} req - Requisicao com notaId em req.params.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<(Object|void)>} Status 204 quando removida.
 */
async function destroy(req, res) {
  try {
    const total = await notaService.excluirNota(req.params.notaId, req.usuario.id);

    if (!total) {
      return res.status(404).json({ message: 'Nota não encontrada.' });
    }

    return res.status(204).send();
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Erro ao excluir nota.' });
  }
}

module.exports = {
  index,
  store,
  update,
  realizarRetorno,
  destroy
};
