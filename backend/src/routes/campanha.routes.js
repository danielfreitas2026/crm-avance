const express = require('express');
const router = express.Router();
const campanhaController = require('../controllers/campanha.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const { exigirUmaPermissao } = require('../middlewares/permissao.middleware');

router.use(authMiddleware);

router.get('/progresso/usuarios', exigirUmaPermissao(['campanhas_ver_usuarios']), campanhaController.progressoUsuarios);
router.get('/participantes', exigirUmaPermissao(['gerenciar_campanhas']), campanhaController.participantes);
router.get('/progresso', exigirUmaPermissao(['campanhas_visualizar', 'gerenciar_campanhas']), campanhaController.progresso);
router.get('/', exigirUmaPermissao(['campanhas_visualizar', 'gerenciar_campanhas']), campanhaController.index);

router.post('/', exigirUmaPermissao(['gerenciar_campanhas']), campanhaController.store);
router.post('/:id/resgatar', exigirUmaPermissao(['campanhas_visualizar', 'gerenciar_campanhas']), campanhaController.resgatar);

router.put('/', exigirUmaPermissao(['gerenciar_campanhas']), campanhaController.updateBulk); 

router.delete('/:id', exigirUmaPermissao(['gerenciar_campanhas']), campanhaController.destroy);

module.exports = router;
