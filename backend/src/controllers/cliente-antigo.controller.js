const clienteAntigoService = require('../services/cliente-antigo.service');

/**
 * Busca vendas antigas por CNPJ, CPF ou razao social e registra o historico.
 */
async function buscar(req, res) {
  try {
    const resultado = await clienteAntigoService.buscar(req.query.termo, req.usuario, {
      page: req.query.page,
      per_page: req.query.per_page
    });
    return res.json(resultado);
  } catch (error) {
    if (!error.statusCode) console.error(error);
    return res.status(error.statusCode || 500).json({
      message: error.message || 'Erro ao buscar cliente antigo.'
    });
  }
}

/**
 * Lista paginada do historico de buscas de clientes antigos.
 */
async function historico(req, res) {
  try {
    const resultado = await clienteAntigoService.listarHistorico(req.query);
    return res.json(resultado);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({
      message: error.message || 'Erro ao listar historico de buscas.'
    });
  }
}

/**
 * Atualiza uma venda antiga cadastrada na base isolada.
 */
async function atualizar(req, res) {
  try {
    const resultado = await clienteAntigoService.atualizar(req.params.id, req.body, {
      registrarAuditoria: req.registrarAlteracaoAuditoria
    });
    return res.json(resultado);
  } catch (error) {
    if (!error.statusCode) console.error(error);
    return res.status(error.statusCode || 500).json({
      message: error.message || 'Erro ao atualizar cliente antigo.'
    });
  }
}
/**
 * Exclui uma venda antiga cadastrada na base isolada.
 */
async function excluir(req, res) {
  try {
    const resultado = await clienteAntigoService.excluir(req.params.id);
    return res.json(resultado);
  } catch (error) {
    if (!error.statusCode) console.error(error);
    return res.status(error.statusCode || 500).json({
      message: error.message || 'Erro ao excluir cliente antigo.'
    });
  }
}
/**
 * Preview do upload da planilha de vendas antigas.
 */
async function planilhaPreview(req, res) {
  try {
    const preview = await clienteAntigoService.previewPlanilha(req);
    return res.json(preview);
  } catch (error) {
    if (!error.statusCode) console.error(error);
    return res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Erro ao ler planilha.'
    });
  }
}

/**
 * Importa a planilha de vendas antigas para a base isolada.
 */
async function planilhaImportar(req, res) {
  try {
    const resultado = await clienteAntigoService.importarPlanilha(req, req.usuario?.id);
    return res.json(resultado);
  } catch (error) {
    if (!error.statusCode) console.error(error);
    return res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Erro ao importar planilha.'
    });
  }
}

module.exports = {
  buscar,
  historico,
  atualizar,
  excluir,
  planilhaPreview,
  planilhaImportar
};
