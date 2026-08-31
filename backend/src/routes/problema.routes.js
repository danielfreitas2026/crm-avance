const express = require('express');
const controller = require('../controllers/automacao.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const { exigirPermissao } = require('../middlewares/permissao.middleware');

const router = express.Router();
router.use(authMiddleware, exigirPermissao('problemas_pos_venda_responsavel'));
router.get('/', controller.problemas);
router.post('/:id/resolver', controller.resolverProblema);
module.exports = router;
