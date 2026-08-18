const express = require('express');
const router = express.Router();

const notificacaoController = require('../controllers/notificacao.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.use(authMiddleware);

router.get('/', notificacaoController.index);
router.get('/urgentes', notificacaoController.urgentes);
router.post('/email-teste', notificacaoController.testarEmail);
router.patch('/lidas', notificacaoController.marcarTodasLidas);
router.patch('/:id/popup-visto', notificacaoController.marcarPopupVisto);
router.patch('/:id/lida', notificacaoController.marcarLida);
router.delete('/:id', notificacaoController.excluir);

module.exports = router;
