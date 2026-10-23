const service = require('../services/acesso-rede.service');
const dispositivos = require('../services/dispositivos-acesso.service');

function responder(operacao) {
  return async (req, res) => {
    try {
      return res.json(await operacao(req, res));
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
  logout: responder(req => service.logout(req)),
  dispositivos: responder(req => dispositivos.listar(req)),
  autorizarDispositivo: responder(async (req, res) => {
    const { dispositivo, credencial } = await dispositivos.autorizar(req.body, req);
    dispositivos.definirCookie(req, res, credencial);
    return { dispositivo };
  }),
  revogarDispositivo: responder(async (req, res) => {
    const { atual } = await dispositivos.revogar(req.params.id, req);
    if (atual) dispositivos.limparCookie(req, res);
    return { message: 'Autorização do navegador revogada.' };
  })
};
