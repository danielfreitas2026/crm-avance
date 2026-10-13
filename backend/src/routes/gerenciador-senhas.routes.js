const router = require('express').Router();
const authMiddleware = require('../middlewares/auth.middleware');
const Usuario = require('../models/Usuario');
const controller = require('../controllers/gerenciador-senhas.controller');

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
router.use(authMiddleware);
router.use(async (req, res, next) => {
  try {
    const usuario = await Usuario.query().findById(req.usuario.id).withGraphFetched('role');
    if (!usuario?.estaAtivo() || usuario.role?.nome !== 'admin') {
      return res.status(403).json({ message: 'Apenas administradores ativos podem acessar o gerenciador de senhas.' });
    }
    return next();
  } catch {
    return res.status(503).json({ message: 'Gerenciador de senhas temporariamente indisponível.' });
  }
});
router.get('/', controller.index);
router.post('/:id/revelar', controller.revelar);

module.exports = router;
