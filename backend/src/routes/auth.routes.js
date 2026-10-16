const express = require('express');
const router = express.Router();

const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const { auditar } = require('../middlewares/audit.middleware');


router.post('/login', authController.login);
router.get('/me', authMiddleware, authController.me);
router.put('/me', authMiddleware, auditar({
  acao: 'auth.perfil_atualizado', entidade: 'usuarios',
  entidade_id: req => req.usuario.id,
  dados: req => ({ alteracoes: req.body })
}), authController.updateMe);

module.exports = router;
