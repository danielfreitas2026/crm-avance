const express = require('express');
const router = express.Router();

const usuarioController = require('../controllers/usuario.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const { auditar } = require('../middlewares/audit.middleware');
const {
  exigirUmaPermissao,
  exigirAdminParaAlterarAdmin,
  impedirAutoExclusao,
  exigirGerenciamentoPermissoesSeNecessario
} = require('../middlewares/permissao.middleware');

router.use(authMiddleware);

router.post(
  '/:id/visualizar-senha',
  exigirUmaPermissao(['usuarios_editar']),
  exigirAdminParaAlterarAdmin,
  usuarioController.visualizarSenha
);

router.get(
  '/',
  exigirUmaPermissao(['crud_usuarios', 'usuarios_listar', 'usuarios_criar', 'usuarios_editar', 'usuarios_excluir', 'gerenciar_permissoes']),
  usuarioController.index
);
router.get(
  '/:id',
  exigirUmaPermissao(['crud_usuarios', 'usuarios_listar', 'usuarios_editar', 'gerenciar_permissoes']),
  usuarioController.show
);
router.post(
  '/',
  exigirUmaPermissao(['usuarios_criar']),
  exigirAdminParaAlterarAdmin,
  exigirGerenciamentoPermissoesSeNecessario,
  auditar({
    acao: 'usuario.criado',
    entidade: 'usuarios',
    entidade_id: (req, usuario) => usuario?.id,
    dados: (req, usuario) => ({
      usuario,
      payload: req.body
    })
  }),
  usuarioController.store
);
router.put(
  '/:id',
  exigirUmaPermissao(['usuarios_editar']),
  exigirAdminParaAlterarAdmin,
  exigirGerenciamentoPermissoesSeNecessario,
  auditar({
    acao: 'usuario.atualizado',
    entidade: 'usuarios',
    entidade_id: req => req.params.id,
    dados: (req, usuario) => ({
      usuario,
      alteracoes: req.body
    })
  }),
  usuarioController.update
);
router.delete(
  '/:id',
  exigirUmaPermissao(['usuarios_excluir']),
  impedirAutoExclusao,
  exigirAdminParaAlterarAdmin,
  auditar({
    acao: 'usuario.excluido',
    entidade: 'usuarios',
    entidade_id: req => req.params.id,
    dados: req => ({
      id: req.params.id
    })
  }),
  usuarioController.destroy
);

module.exports = router;
