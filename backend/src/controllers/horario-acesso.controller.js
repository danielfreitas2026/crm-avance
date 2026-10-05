const horarioAcessoService = require('../services/horario-acesso.service');

async function show(req, res) {
  try {
    return res.json(await horarioAcessoService.buscarConfiguracaoAdministrativa());
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao carregar o horário de acesso.' });
  }
}

async function update(req, res) {
  try {
    return res.json(await horarioAcessoService.atualizarConfiguracao(req.body, {
      registrarAuditoria: req.registrarAlteracaoAuditoria
    }));
  } catch (error) {
    console.error(error);
    return res.status(400).json({ message: error.message || 'Erro ao atualizar o horário de acesso.' });
  }
}

module.exports = { show, update };
