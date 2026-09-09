const service = require('../services/venda-funil-automacao.service');

async function index(req, res) {
  try {
    return res.json(await service.listar(req.query, req.usuario.id));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao listar o funil de automações.' });
  }
}

async function updateStatus(req, res) {
  try {
    const resultado = await service.movimentar(req.params.id, req.body, {
      origem: 'ajuste_manual',
      usuarioId: req.usuario.id
    });
    if (resultado.status === 'not_found') return res.status(404).json({ message: 'Venda não encontrada.' });
    if (resultado.status === 'invalid') return res.status(400).json({ message: resultado.message });
    const vendas = await service.listar({}, req.usuario.id);
    return res.json(vendas.find(venda => Number(venda.id) === Number(req.params.id)) || resultado.estado);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao movimentar o funil de automações.' });
  }
}

module.exports = { index, updateStatus };
