const clienteSecretoService = require('../services/cliente-secreto.service');

async function index(req, res) {
  try {
    const clientes = await clienteSecretoService.listarClientesSecretos(req.query, req.usuario.id);
    return res.json(clientes);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao listar clientes próprios.' });
  }
}

async function show(req, res) {
  try {
    const cliente = await clienteSecretoService.buscarClienteSecretoPorId(req.params.id, req.usuario.id);
    if (!cliente) return res.status(404).json({ message: 'Cliente próprio nao encontrado.' });
    return res.json(cliente);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao buscar cliente próprio.' });
  }
}

async function verificarDocumento(req, res) {
  try {
    const resultado = await clienteSecretoService.verificarDocumentoClienteSecreto(req.params.documento, req.usuario.id, {
      ignorarId: req.query.ignorar_id
    });
    return res.json(resultado);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({
      message: error.message || 'Erro ao verificar documento do cliente próprio.'
    });
  }
}

async function store(req, res) {
  try {
    const cliente = await clienteSecretoService.criarClienteSecreto(req.body, req.usuario.id);
    return res.status(201).json(cliente);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({
      message: error.message || 'Erro ao criar cliente próprio.'
    });
  }
}

async function update(req, res) {
  try {
    const cliente = await clienteSecretoService.atualizarClienteSecreto(req.params.id, req.body, req.usuario.id, {
      registrarAuditoria: req.registrarAlteracaoAuditoria
    });
    if (!cliente) return res.status(404).json({ message: 'Cliente próprio nao encontrado.' });
    return res.json(cliente);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({
      message: error.message || 'Erro ao atualizar cliente próprio.'
    });
  }
}

async function destroy(req, res) {
  try {
    const total = await clienteSecretoService.excluirClienteSecreto(req.params.id, req.usuario.id);
    if (!total) return res.status(404).json({ message: 'Cliente próprio nao encontrado.' });
    return res.status(204).send();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao excluir cliente próprio.' });
  }
}

module.exports = {
  index,
  show,
  verificarDocumento,
  store,
  update,
  destroy
};
