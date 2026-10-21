const service = require('../services/acesso-rede.service');

function responder(operacao) {
  return async (req, res) => {
    try {
      return res.json(await operacao(req));
    } catch (error) {
      if (!error.acessoRedeSeguro) console.error('Falha no controle de acesso por rede.');
      return res.status(error.acessoRedeSeguro ? error.status : 500).json({
        message: error.acessoRedeSeguro ? error.message : 'Não foi possível concluir a operação de acesso por rede.',
        ...(error.code ? { code: error.code } : {})
      });
    }
  };
}

module.exports = {
  show: responder(req => service.buscarConfiguracao(req)),
  update: responder(req => service.atualizarConfiguracao(req.body, req)),
  validar: responder(req => service.validar(req.body, req)),
  logout: responder(req => service.logout(req))
};
