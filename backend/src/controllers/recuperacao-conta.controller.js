const service = require('../services/recuperacao-conta.service');
const auditoria = require('../services/audit-log.service');

function handler(executar) {
  return async (req, res) => {
    try {
      return res.json(await executar(req));
    } catch (error) {
      console.error('Falha em operação de recuperação de conta.');
      return res.status(error.recuperacaoSegura ? error.status : 500).json({
        message: error.recuperacaoSegura ? error.message : 'Não foi possível concluir a operação. Tente novamente mais tarde.'
      });
    }
  };
}

module.exports = {
  solicitar: handler(req => service.solicitar(req.body?.email, req)),
  redefinir: handler(req => service.redefinirSenha(req.body?.token, req.body?.senha, req)),
  confirmar: handler(req => service.confirmarEmail(req.body?.token, req)),
  reenviar: handler(async req => {
    await service.reenviarConfirmacao(req.usuario.id, req.body?.senha_atual);
    await auditoria.registrarSemBloquear(req, {
      acao: 'auth.confirmacao_email_reenviada', entidade: 'usuarios', entidade_id: req.usuario.id
    });
    return { message: 'E-mail de confirmação reenviado.' };
  })
};
