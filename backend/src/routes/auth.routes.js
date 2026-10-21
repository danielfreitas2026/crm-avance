const express = require('express');
const router = express.Router();

const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const { auditar } = require('../middlewares/audit.middleware');
const { rateLimit } = require('express-rate-limit');
const recuperacao = require('../controllers/recuperacao-conta.controller');
const acessoRede = require('../controllers/acesso-rede.controller');
const limitarAcessoRede = rateLimit({
  windowMs: 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { message: 'Muitas tentativas de acesso. Tente novamente em um minuto.' }
});

const limitarRecuperacao = rateLimit({
  windowMs: 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { message: 'Muitas solicitações. Tente novamente em 1 minuto.' }
});

router.post('/forgot-password', limitarRecuperacao, recuperacao.solicitar);
router.post('/reset-password', limitarRecuperacao, recuperacao.redefinir);
router.post('/confirmar-email-recuperacao', limitarRecuperacao, recuperacao.confirmar);
router.post('/reenviar-confirmacao-email-recuperacao', limitarRecuperacao, authMiddleware, recuperacao.reenviar);


router.post('/login', limitarAcessoRede, authController.login);
router.post('/acesso-rede/validar', limitarAcessoRede, acessoRede.validar);
router.post('/logout', acessoRede.logout);
router.get('/me', authMiddleware, authController.me);
router.put('/me', (req, res, next) => req.body?.email_recuperacao !== undefined
  ? limitarRecuperacao(req, res, next) : next(), authMiddleware, auditar({
  acao: 'auth.perfil_atualizado', entidade: 'usuarios',
  entidade_id: req => req.usuario.id,
  dados: req => ({ alteracoes: req.body })
}), authController.updateMe);

module.exports = router;
