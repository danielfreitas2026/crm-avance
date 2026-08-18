const express = require('express');
const router = express.Router();

const notaController = require('../controllers/nota.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.use(authMiddleware);

router.get('/:tipo/:id', notaController.index);
router.post('/:tipo/:id', notaController.store);
router.put('/:notaId', notaController.update);
router.patch('/:notaId/retorno-realizado', notaController.realizarRetorno);
router.delete('/:notaId', notaController.destroy);

module.exports = router;
