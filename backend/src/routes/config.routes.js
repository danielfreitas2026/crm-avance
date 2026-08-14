const express = require('express');
const router = express.Router();

const configController = require('../controllers/config.controller');
const horarioAcessoController = require('../controllers/horario-acesso.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const { exigirPermissao } = require('../middlewares/permissao.middleware');
const { auditar } = require('../middlewares/audit.middleware');

router.use(authMiddleware);

router.get('/operadoras', configController.operadoras);
router.get('/links-externos', configController.linksExternos);
router.get('/tipos-produto', configController.tiposProduto);
router.get('/tipos-venda', configController.tiposVenda);
router.get('/servicos', configController.servicos);
router.get('/funil-etapas', configController.funilEtapas);
router.get('/regras-comissao', configController.regrasComissao);
router.get('/notificacao-aparencias', configController.aparenciasNotificacao);

router.get('/admin/operadoras', exigirPermissao('crud_operadoras'), configController.adminOperadoras);
router.post('/admin/operadoras', exigirPermissao('crud_operadoras'), configController.criarOperadora);
router.put('/admin/operadoras/:id', exigirPermissao('crud_operadoras'), configController.atualizarOperadora);
router.delete('/admin/operadoras/:id', exigirPermissao('crud_operadoras'), configController.excluirOperadora);

router.get('/admin/tipos-produto', exigirPermissao('crud_tipos_produto'), configController.adminTiposProduto);
router.post('/admin/tipos-produto', exigirPermissao('crud_tipos_produto'), configController.criarTipoProduto);
router.put('/admin/tipos-produto/:id', exigirPermissao('crud_tipos_produto'), configController.atualizarTipoProduto);
router.delete('/admin/tipos-produto/:id', exigirPermissao('crud_tipos_produto'), configController.excluirTipoProduto);

router.get('/admin/tipos-venda', exigirPermissao('crud_tipos_venda'), configController.adminTiposVenda);
router.post('/admin/tipos-venda', exigirPermissao('crud_tipos_venda'), configController.criarTipoVenda);
router.put('/admin/tipos-venda/:id', exigirPermissao('crud_tipos_venda'), configController.atualizarTipoVenda);
router.delete('/admin/tipos-venda/:id', exigirPermissao('crud_tipos_venda'), configController.excluirTipoVenda);

router.get('/admin/servicos', exigirPermissao('crud_servicos'), configController.adminServicos);
router.post('/admin/servicos', exigirPermissao('crud_servicos'), configController.criarServico);
router.put('/admin/servicos/:id', exigirPermissao('crud_servicos'), configController.atualizarServico);
router.delete('/admin/servicos/:id', exigirPermissao('crud_servicos'), configController.excluirServico);

router.get('/admin/funil-etapas', exigirPermissao('crud_funil_etapas'), configController.adminFunilEtapas);
router.post('/admin/funil-etapas', exigirPermissao('crud_funil_etapas'), configController.criarFunilEtapa);
router.put('/admin/funil-etapas/reorder', exigirPermissao('crud_funil_etapas'), configController.reordenarFunilEtapas);
router.put('/admin/funil-etapas/:id', exigirPermissao('crud_funil_etapas'), configController.atualizarFunilEtapa);
router.delete('/admin/funil-etapas/:id', exigirPermissao('crud_funil_etapas'), configController.excluirFunilEtapa);

router.get('/admin/regras-comissao', exigirPermissao('crud_regras_comissao'), configController.adminRegrasComissao);
router.post('/admin/regras-comissao', exigirPermissao('crud_regras_comissao'), configController.criarRegraComissao);
router.put('/admin/regras-comissao/:id', exigirPermissao('crud_regras_comissao'), configController.atualizarRegraComissao);
router.delete('/admin/regras-comissao/:id', exigirPermissao('crud_regras_comissao'), configController.excluirRegraComissao);

router.get('/admin/links-externos', exigirPermissao('crud_links'), configController.adminLinksExternos);
router.post('/admin/links-externos', exigirPermissao('crud_links'), configController.criarLinkExterno);
router.put('/admin/links-externos/:id', exigirPermissao('crud_links'), configController.atualizarLinkExterno);
router.delete('/admin/links-externos/:id', exigirPermissao('crud_links'), configController.excluirLinkExterno);

router.get('/admin/notificacao-aparencias', exigirPermissao('configurar_notificacoes'), configController.aparenciasNotificacao);
router.put('/admin/notificacao-aparencias/:id', exigirPermissao('configurar_notificacoes'), configController.atualizarAparenciaNotificacao);

router.get('/admin/horario-acesso', exigirPermissao('configurar_horario_acesso'), horarioAcessoController.show);
router.put(
  '/admin/horario-acesso',
  exigirPermissao('configurar_horario_acesso'),
  auditar({
    acao: 'config.horario_acesso_atualizado',
    entidade: 'configuracoes_horario_acesso',
    entidade_id: 1,
    dados: req => ({ ativo: req.body?.ativo, dias: req.body?.dias, usuario_ids: req.body?.usuario_ids })
  }),
  horarioAcessoController.update
);

module.exports = router;
