const express = require('express');
const router = express.Router();

const clienteController = require('../controllers/cliente.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const { auditar } = require('../middlewares/audit.middleware');
const { exigirPermissao, exigirUmaPermissao } = require('../middlewares/permissao.middleware');

router.use(authMiddleware);

router.get('/lixeira', exigirUmaPermissao(['clientes_ver_proprios', 'clientes_ver_todos']), clienteController.lixeira);
router.get('/select', exigirUmaPermissao(['clientes_ver_proprios', 'clientes_ver_todos']), clienteController.select);
router.get('/documento/:documento', exigirUmaPermissao(['clientes_criar', 'clientes_editar', 'clientes_ver_proprios', 'clientes_ver_todos']), clienteController.verificarDocumento);
router.get('/exportar', exigirUmaPermissao(['clientes_ver_proprios', 'clientes_ver_todos']), clienteController.exportar);
router.get('/', exigirUmaPermissao(['clientes_ver_proprios', 'clientes_ver_todos']), clienteController.index);
router.post(
  '/importar-base-anterior/preview',
  exigirUmaPermissao(['clientes_importar_planilhas']),
  clienteController.previewImportacaoBaseAnterior
);
router.post(
  '/importar-base-anterior',
  exigirUmaPermissao(['clientes_importar_planilhas']),
  auditar({
    acao: 'clientes.base_anterior_importada',
    entidade: 'clientes',
    entidade_id: null,
    dados: (req, resultado) => resultado
  }),
  clienteController.importarBaseAnterior
);
router.delete(
  '/base-anterior',
  exigirUmaPermissao(['clientes_excluir']),
  auditar({
    acao: 'clientes.base_anterior_limpa',
    entidade: 'clientes',
    entidade_id: null,
    dados: (req, resultado) => resultado
  }),
  clienteController.limparBaseAnterior
);
router.get('/:id', exigirUmaPermissao(['clientes_ver_proprios', 'clientes_ver_todos']), clienteController.show);
router.post(
  '/',
  exigirUmaPermissao(['clientes_criar']),
  auditar({
    acao: req => ({ criado: 'cliente.criado', vinculado: 'cliente.consultora_vinculada', restaurado: 'cliente.restaurado' })[req.clienteCadastroAcao],
    entidade: 'clientes',
    entidade_id: (req, cliente) => cliente?.id,
    dados: (req, cliente) => req.clienteCadastroAcao === 'criado'
      ? { cliente, payload: req.body }
      : { cliente_id: cliente?.id, usuario_id: req.usuario.id, restaurado: req.clienteCadastroAcao === 'restaurado' }
  }),
  clienteController.store
);
router.put(
  '/:id/consultoras',
  exigirPermissao('clientes_atribuir_vendedora'),
  auditar({
    acao: 'cliente.consultoras_atualizadas',
    entidade: 'clientes',
    entidade_id: req => req.params.id,
    dados: req => ({ consultora_ids: req.body?.consultora_ids || [] })
  }),
  clienteController.atualizarConsultoras
);
router.put(
  '/:id',
  exigirUmaPermissao(['clientes_editar']),
  auditar({
    acao: 'cliente.atualizado',
    entidade: 'clientes',
    entidade_id: req => req.params.id,
    dados: req => ({
      id: req.params.id,
      alteracoes: req.body
    })
  }),
  clienteController.update
);
router.delete(
  '/:id/definitivo',
  exigirUmaPermissao(['clientes_excluir']),
  auditar({
    acao: 'cliente.excluido_definitivamente',
    entidade: 'clientes',
    entidade_id: req => req.params.id,
    dados: req => ({
      id: req.params.id
    })
  }),
  clienteController.destroyDefinitivo
);
router.post(
  '/:id/restaurar',
  exigirUmaPermissao(['clientes_excluir']),
  auditar({
    acao: 'cliente.restaurado',
    entidade: 'clientes',
    entidade_id: req => req.params.id,
    dados: req => ({
      id: req.params.id
    })
  }),
  clienteController.restore
);
router.delete(
  '/:id',
  exigirUmaPermissao(['clientes_excluir']),
  auditar({
    acao: 'cliente.enviado_lixeira',
    entidade: 'clientes',
    entidade_id: req => req.params.id,
    dados: req => ({
      id: req.params.id
    })
  }),
  clienteController.destroy
);

module.exports = router;
