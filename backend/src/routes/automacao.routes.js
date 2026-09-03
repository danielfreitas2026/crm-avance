const express = require('express');
const controller = require('../controllers/automacao.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const { exigirPermissao } = require('../middlewares/permissao.middleware');

const router = express.Router();
router.use(authMiddleware, exigirPermissao('automacoes_gerenciar'));
router.get('/resumo', controller.resumo);
router.get('/', controller.index);
router.post('/coletar-historico', controller.coletarHistorico);
router.post('/repetir-revisoes', controller.repetirRevisoes);
router.get('/:id/vendas-candidatas', controller.vendasCandidatas);
router.post('/:id/revisar', controller.revisar);
router.post('/:id/repetir', controller.repetir);
router.post('/:id/descartar', controller.descartar);
module.exports = router;
