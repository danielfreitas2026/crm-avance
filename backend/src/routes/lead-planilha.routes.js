const express = require('express');
const router = express.Router();

const leadPlanilhaController = require('../controllers/lead-planilha.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const { auditar } = require('../middlewares/audit.middleware');
const { exigirUmaPermissao } = require('../middlewares/permissao.middleware');

router.use(authMiddleware);

router.get('/me/envios', leadPlanilhaController.meusEnvios);
router.get('/me/mailings', leadPlanilhaController.meusMailings);
router.get('/me/linhas', leadPlanilhaController.minhasLinhas);
router.get('/me/futuros-clientes', exigirUmaPermissao(['futuros_clientes_ver', 'vendas_criar']), leadPlanilhaController.listarFuturosClientes);
router.get('/me/futuros-clientes/recebidos', exigirUmaPermissao(['futuros_clientes_ver', 'vendas_criar']), leadPlanilhaController.listarFuturosClientesRecebidos);
router.post(
  '/me/futuros-clientes/:id/aceitar',
  exigirUmaPermissao(['futuros_clientes_ver', 'vendas_criar']),
  auditar({
    acao: 'lead_atribuicao.aceita',
    entidade: 'lead_linhas',
    entidade_id: req => req.params.id,
    dados: req => ({ linha_id: req.params.id, usuario_id: req.usuario?.id })
  }),
  leadPlanilhaController.aceitarFuturoCliente
);
router.post(
  '/me/futuros-clientes/:id/recusar',
  exigirUmaPermissao(['futuros_clientes_ver', 'vendas_criar']),
  auditar({
    acao: 'lead_atribuicao.recusada',
    entidade: 'lead_linhas',
    entidade_id: req => req.params.id,
    dados: req => ({ linha_id: req.params.id, motivo: req.body?.motivo, usuario_id: req.usuario?.id })
  }),
  leadPlanilhaController.recusarFuturoCliente
);
router.get('/me/futuros-clientes/lixeira', exigirUmaPermissao(['futuros_clientes_ver', 'vendas_criar']), leadPlanilhaController.listarFuturosClientesLixeira);
router.post(
  '/me/futuros-clientes/:id/distribuir',
  exigirUmaPermissao(['futuros_clientes_registrar', 'futuros_clientes_ver_todos']),
  auditar({
    acao: 'lead_linha.futuro_cliente_enviado_distribuicao',
    entidade: 'lead_linhas',
    entidade_id: req => req.params.id,
    dados: req => ({ linha_id: req.params.id, destino: 'distribuicao', usuario_id: req.usuario?.id })
  }),
  leadPlanilhaController.distribuirFuturoCliente
);
router.delete(
  '/me/futuros-clientes/:id',
  exigirUmaPermissao(['futuros_clientes_registrar']),
  auditar({
    acao: 'lead_linha.futuro_cliente_enviado_lixeira',
    entidade: 'lead_linhas',
    entidade_id: req => req.params.id,
    dados: req => ({ linha_id: req.params.id, usuario_id: req.usuario?.id })
  }),
  leadPlanilhaController.excluirFuturoCliente
);
router.post(
  '/me/futuros-clientes/:id/restaurar',
  exigirUmaPermissao(['futuros_clientes_registrar']),
  auditar({
    acao: 'lead_linha.futuro_cliente_restaurado',
    entidade: 'lead_linhas',
    entidade_id: req => req.params.id,
    dados: req => ({ linha_id: req.params.id, usuario_id: req.usuario?.id })
  }),
  leadPlanilhaController.restaurarFuturoCliente
);
router.delete(
  '/me/futuros-clientes/:id/definitivo',
  exigirUmaPermissao(['futuros_clientes_registrar']),
  auditar({
    acao: 'lead_linha.futuro_cliente_excluido_definitivamente',
    entidade: 'lead_linhas',
    entidade_id: req => req.params.id,
    dados: req => ({ linha_id: req.params.id, usuario_id: req.usuario?.id })
  }),
  leadPlanilhaController.excluirFuturoClienteDefinitivo
);
router.post('/me/exportar', leadPlanilhaController.exportarMinhas);
router.post(
  '/me/linhas/:id/futuro-cliente',
  exigirUmaPermissao(['futuros_clientes_registrar']),
  auditar({
    acao: 'lead_linha.futuro_cliente_marcado',
    entidade: 'lead_linhas',
    entidade_id: (req, resultado) => resultado?.linha?.id || req.params.id,
    dados: (req, resultado) => ({
      linha_id: req.params.id,
      notas: req.body?.notas,
      retorno: req.body?.retorno,
      destino: req.body?.destino,
      usuario_id: req.usuario?.id
    })
  }),
  leadPlanilhaController.marcarFuturoCliente
);
router.post(
  '/me/linhas/:id/avaliacao-primeira-ligacao',
  exigirUmaPermissao(['futuros_clientes_ver', 'vendas_criar']),
  auditar({
    acao: 'lead_linha.primeira_ligacao_avaliada',
    entidade: 'lead_linhas',
    entidade_id: (req, resultado) => resultado?.linha?.id || req.params.id,
    dados: req => ({
      linha_id: req.params.id,
      avaliacao: req.body?.avaliacao,
      usuario_id: req.usuario?.id
    })
  }),
  leadPlanilhaController.avaliarPrimeiraLigacao
);
router.put(
  '/me/linhas/:id/campo-atualizado',
  auditar({
    acao: 'lead_linha.campo_atualizado',
    entidade: 'lead_linhas',
    entidade_id: (req, resultado) => resultado?.linha?.id || req.params.id,
    dados: (req, resultado) => ({
      coluna: resultado?.coluna || req.body?.coluna,
      coluna_atualizada: resultado?.coluna_atualizada,
      usuario_id: req.usuario?.id
    })
  }),
  leadPlanilhaController.atualizarMeuCampo
);
router.post(
  '/me/linhas/:id/venda-recusada',
  exigirUmaPermissao(['futuros_clientes_registrar']),
  auditar({
    acao: 'lead_linha.venda_recusada',
    entidade: 'lead_linhas',
    entidade_id: (req, resultado) => resultado?.linha?.id || req.params.id,
    dados: req => ({ linha_id: req.params.id, motivo: req.body?.motivo, usuario_id: req.usuario?.id })
  }),
  leadPlanilhaController.marcarVendaRecusada
);
router.post(
  '/me/linhas/:id/cliente-recusou',
  exigirUmaPermissao(['futuros_clientes_registrar']),
  auditar({
    acao: 'lead_linha.cliente_recusou',
    entidade: 'lead_linhas',
    entidade_id: (req, resultado) => resultado?.linha?.id || req.params.id,
    dados: req => ({ linha_id: req.params.id, motivo: req.body?.motivo, usuario_id: req.usuario?.id })
  }),
  leadPlanilhaController.marcarClienteRecusou
);
router.post(
  '/me/linhas/:id/cliente-recusou/reverter',
  exigirUmaPermissao(['futuros_clientes_registrar']),
  auditar({
    acao: 'lead_linha.cliente_recusou_revertido',
    entidade: 'lead_linhas',
    entidade_id: (req, resultado) => resultado?.linha?.id || req.params.id,
    dados: req => ({ linha_id: req.params.id, usuario_id: req.usuario?.id })
  }),
  leadPlanilhaController.reverterClienteRecusou
);
router.post(
  '/me/linhas/:id/chamada-nao-atendida',
  exigirUmaPermissao(['futuros_clientes_registrar']),
  auditar({
    acao: 'lead_linha.chamada_nao_atendida',
    entidade: 'lead_linhas',
    entidade_id: (req, resultado) => resultado?.linha?.id || req.params.id,
    dados: req => ({ linha_id: req.params.id, motivo: req.body?.motivo, usuario_id: req.usuario?.id })
  }),
  leadPlanilhaController.marcarChamadaNaoAtendida
);
router.post(
  '/me/linhas/:id/chamada-nao-atendida/reverter',
  exigirUmaPermissao(['futuros_clientes_registrar']),
  auditar({
    acao: 'lead_linha.chamada_nao_atendida_revertida',
    entidade: 'lead_linhas',
    entidade_id: (req, resultado) => resultado?.linha?.id || req.params.id,
    dados: req => ({ linha_id: req.params.id, usuario_id: req.usuario?.id })
  }),
  leadPlanilhaController.reverterChamadaNaoAtendida
);
router.post(
  '/me/linhas/:id/retorno',
  exigirUmaPermissao(['futuros_clientes_registrar']),
  auditar({
    acao: 'lead_linha.retorno_marcado',
    entidade: 'lead_linhas',
    entidade_id: (req, resultado) => resultado?.linha?.id || req.params.id,
    dados: req => ({ linha_id: req.params.id, retorno: req.body?.retorno, observacao: req.body?.observacao, usuario_id: req.usuario?.id })
  }),
  leadPlanilhaController.marcarRetorno
);

router.get('/', exigirUmaPermissao(['gerenciar_leads']), leadPlanilhaController.index);
router.post('/uploads', exigirUmaPermissao(['gerenciar_leads']), leadPlanilhaController.upload);
router.post('/importar-excel', exigirUmaPermissao(['gerenciar_leads']), leadPlanilhaController.importarExcel);
router.post('/importar-base-antiga', exigirUmaPermissao(['gerenciar_leads']), leadPlanilhaController.importarBaseAntiga);
router.post(
  '/',
  exigirUmaPermissao(['gerenciar_leads']),
  auditar({
    acao: 'lead_planilha.criada',
    entidade: 'lead_planilhas',
    entidade_id: (req, planilha) => planilha?.id,
    dados: (req, planilha) => ({ planilha, payload: req.body })
  }),
  leadPlanilhaController.store
);
router.post('/:id/linhas', exigirUmaPermissao(['gerenciar_leads']), leadPlanilhaController.storeLinhas);
router.post('/:id/finalizar', exigirUmaPermissao(['gerenciar_leads']), leadPlanilhaController.finalizar);
router.post('/:id/erro', exigirUmaPermissao(['gerenciar_leads']), leadPlanilhaController.erro);
router.put('/:id/schema', exigirUmaPermissao(['gerenciar_leads']), leadPlanilhaController.updateSchema);
router.get('/:id/status', exigirUmaPermissao(['gerenciar_leads']), leadPlanilhaController.status);
router.delete(
  '/:id',
  exigirUmaPermissao(['gerenciar_leads']),
  auditar({
    acao: 'lead_planilha.excluida',
    entidade: 'lead_planilhas',
    entidade_id: req => req.params.id,
    dados: req => ({ planilha_id: req.params.id })
  }),
  leadPlanilhaController.destroy
);
router.get('/linhas', exigirUmaPermissao(['gerenciar_leads']), leadPlanilhaController.linhas);

// Ações administrativas por linha (Planilha de Mailing) — gate gerenciar_leads.
router.put(
  '/linhas/:id/campo',
  exigirUmaPermissao(['gerenciar_leads']),
  auditar({
    acao: 'lead_linha.campo_atualizado_admin',
    entidade: 'lead_linhas',
    entidade_id: (req, resultado) => resultado?.linha?.id || req.params.id,
    dados: (req, resultado) => ({ coluna: resultado?.coluna || req.body?.coluna, usuario_id: req.usuario?.id })
  }),
  leadPlanilhaController.adminAtualizarCampoLead
);
router.post(
  '/linhas/:id/futuro-cliente',
  exigirUmaPermissao(['gerenciar_leads']),
  auditar({
    acao: 'lead_linha.futuro_cliente_marcado_admin',
    entidade: 'lead_linhas',
    entidade_id: (req, resultado) => resultado?.linha?.id || req.params.id,
    dados: req => ({ linha_id: req.params.id, usuario_id: req.usuario?.id })
  }),
  leadPlanilhaController.adminMarcarFuturoCliente
);
router.post(
  '/linhas/:id/futuro-cliente/reverter',
  exigirUmaPermissao(['gerenciar_leads']),
  auditar({
    acao: 'lead_linha.futuro_cliente_revertido_admin',
    entidade: 'lead_linhas',
    entidade_id: (req, resultado) => resultado?.linha?.id || req.params.id,
    dados: req => ({ linha_id: req.params.id, usuario_id: req.usuario?.id })
  }),
  leadPlanilhaController.adminReverterFuturoCliente
);
router.post(
  '/linhas/:id/venda-recusada',
  exigirUmaPermissao(['gerenciar_leads']),
  auditar({
    acao: 'lead_linha.venda_recusada_admin',
    entidade: 'lead_linhas',
    entidade_id: (req, resultado) => resultado?.linha?.id || req.params.id,
    dados: req => ({ linha_id: req.params.id, motivo: req.body?.motivo, usuario_id: req.usuario?.id })
  }),
  leadPlanilhaController.adminMarcarVendaRecusada
);
router.post(
  '/linhas/:id/venda-recusada/reverter',
  exigirUmaPermissao(['gerenciar_leads']),
  auditar({
    acao: 'lead_linha.venda_recusada_revertida_admin',
    entidade: 'lead_linhas',
    entidade_id: (req, resultado) => resultado?.linha?.id || req.params.id,
    dados: req => ({ linha_id: req.params.id, usuario_id: req.usuario?.id })
  }),
  leadPlanilhaController.adminReverterVendaRecusada
);
router.post(
  '/linhas/:id/cliente-recusou',
  exigirUmaPermissao(['gerenciar_leads']),
  auditar({
    acao: 'lead_linha.cliente_recusou_admin',
    entidade: 'lead_linhas',
    entidade_id: (req, resultado) => resultado?.linha?.id || req.params.id,
    dados: req => ({ linha_id: req.params.id, motivo: req.body?.motivo, usuario_id: req.usuario?.id })
  }),
  leadPlanilhaController.adminMarcarClienteRecusou
);
router.post(
  '/linhas/:id/cliente-recusou/reverter',
  exigirUmaPermissao(['gerenciar_leads']),
  auditar({
    acao: 'lead_linha.cliente_recusou_revertido_admin',
    entidade: 'lead_linhas',
    entidade_id: (req, resultado) => resultado?.linha?.id || req.params.id,
    dados: req => ({ linha_id: req.params.id, usuario_id: req.usuario?.id })
  }),
  leadPlanilhaController.adminReverterClienteRecusou
);
router.post(
  '/linhas/:id/chamada-nao-atendida',
  exigirUmaPermissao(['gerenciar_leads']),
  auditar({
    acao: 'lead_linha.chamada_nao_atendida_admin',
    entidade: 'lead_linhas',
    entidade_id: (req, resultado) => resultado?.linha?.id || req.params.id,
    dados: req => ({ linha_id: req.params.id, motivo: req.body?.motivo, usuario_id: req.usuario?.id })
  }),
  leadPlanilhaController.adminMarcarChamadaNaoAtendida
);
router.post(
  '/linhas/:id/chamada-nao-atendida/reverter',
  exigirUmaPermissao(['gerenciar_leads']),
  auditar({
    acao: 'lead_linha.chamada_nao_atendida_revertida_admin',
    entidade: 'lead_linhas',
    entidade_id: (req, resultado) => resultado?.linha?.id || req.params.id,
    dados: req => ({ linha_id: req.params.id, usuario_id: req.usuario?.id })
  }),
  leadPlanilhaController.adminReverterChamadaNaoAtendida
);
router.post(
  '/linhas/:id/retorno',
  exigirUmaPermissao(['gerenciar_leads']),
  auditar({
    acao: 'lead_linha.retorno_marcado_admin',
    entidade: 'lead_linhas',
    entidade_id: (req, resultado) => resultado?.linha?.id || req.params.id,
    dados: req => ({ linha_id: req.params.id, retorno: req.body?.retorno, observacao: req.body?.observacao, usuario_id: req.usuario?.id })
  }),
  leadPlanilhaController.adminMarcarRetorno
);
router.get(
  '/linhas/:id/vendas-candidatas',
  exigirUmaPermissao(['gerenciar_leads']),
  leadPlanilhaController.listarVendasCandidatas
);
router.post(
  '/linhas/:id/venda',
  exigirUmaPermissao(['gerenciar_leads']),
  auditar({
    acao: 'lead_linha.venda_vinculada_manual',
    entidade: 'lead_linhas',
    entidade_id: (req, resultado) => resultado?.linha_id || req.params.id,
    dados: (req, resultado) => ({
      linha_id: req.params.id,
      venda_id: resultado?.venda_id || req.body?.venda_id,
      cnpj_pesquisado: resultado?.cnpj_pesquisado || req.body?.cnpj || null,
      primeira_ligacao_usuario_id: resultado?.origem_sondador_id || null,
      vendedor_preservado_id: resultado?.vendedor_id || null,
      gerente_id: req.usuario?.id
    })
  }),
  leadPlanilhaController.adminVincularVenda
);
router.delete(
  '/linhas/:id/venda',
  exigirUmaPermissao(['gerenciar_leads']),
  auditar({
    acao: 'lead_linha.venda_desvinculada_manual',
    entidade: 'lead_linhas',
    entidade_id: (req, resultado) => resultado?.linha_id || req.params.id,
    dados: (req, resultado) => ({
      linha_id: req.params.id,
      venda_id: resultado?.venda_id || null,
      primeira_ligacao_usuario_id: resultado?.origem_sondador_id || null,
      vendedor_preservado_id: resultado?.vendedor_id || null,
      gerente_id: req.usuario?.id
    })
  }),
  leadPlanilhaController.adminDesvincularVenda
);
router.get('/:id/destinatarios-envios', exigirUmaPermissao(['gerenciar_leads']), leadPlanilhaController.destinatariosEnviosPlanilha);
router.post('/:id/cancelar-envios', exigirUmaPermissao(['gerenciar_leads']), auditar({ acao: 'lead_envio.cancelado', entidade: 'lead_planilhas', entidade_id: req => req.params.id, dados: req => ({ planilha_id: req.params.id, usuario_destino_id: req.body?.usuario_id || null, cancelado_por_id: req.usuario?.id }) }), leadPlanilhaController.cancelarEnviosPlanilha);

router.get('/envios', exigirUmaPermissao(['gerenciar_leads']), leadPlanilhaController.envios);
router.put(
  '/envios/:id',
  exigirUmaPermissao(['gerenciar_leads']),
  auditar({
    acao: 'lead_envio.nome_atualizado',
    entidade: 'lead_envios',
    entidade_id: (req, envio) => envio?.id || req.params.id,
    dados: req => ({ envio_id: req.params.id, nome: req.body?.nome })
  }),
  leadPlanilhaController.atualizarNomeEnvio
);
router.post('/exportar', exigirUmaPermissao(['gerenciar_leads']), leadPlanilhaController.exportar);
router.post('/exportar-xlsx/:id', exigirUmaPermissao(['gerenciar_leads']), leadPlanilhaController.exportarPlanilhaXlsx);
router.get('/futuros-clientes', exigirUmaPermissao(['futuros_clientes_ver_todos']), leadPlanilhaController.listarTodosFuturosClientes);
router.get('/futuros-clientes/:id/historico', exigirUmaPermissao(['futuros_clientes_ver_todos']), leadPlanilhaController.historicoFuturoCliente);
router.post(
  '/futuros-clientes/republicar-pendentes-telegram',
  exigirUmaPermissao(['gerenciar_leads']),
  auditar({
    acao: 'lead_futuro_cliente.pendentes_republicados_telegram',
    entidade: 'lead_linhas',
    dados: (req, resultado) => ({ ...resultado, usuario_id: req.usuario?.id })
  }),
  leadPlanilhaController.republicarPendentesAntigosTelegram
);
router.get('/futuros-clientes/metricas', exigirUmaPermissao(['gerenciar_leads']), leadPlanilhaController.metricasFuturosClientes);
router.get('/futuros-clientes/metricas/exportar', exigirUmaPermissao(['gerenciar_leads']), leadPlanilhaController.exportarMetricasFuturosClientes);
router.get('/futuros-clientes/estatisticas/resumo', exigirUmaPermissao(['gerenciar_leads']), leadPlanilhaController.estatisticasResumo);
router.get('/futuros-clientes/estatisticas/usuarios/:usuarioId/mailings', exigirUmaPermissao(['gerenciar_leads']), leadPlanilhaController.estatisticasMailings);
router.get('/futuros-clientes/estatisticas/usuarios/:usuarioId/mailings/:envioId/linhas', exigirUmaPermissao(['gerenciar_leads']), leadPlanilhaController.estatisticasLinhas);
router.post(
  '/dividir',
  exigirUmaPermissao(['gerenciar_leads']),
  auditar({
    acao: 'lead_envio.criado',
    entidade: 'lead_envios',
    entidade_id: (req, resultado) => resultado?.envio?.id,
    dados: req => ({ payload: req.body })
  }),
  leadPlanilhaController.dividir
);

module.exports = router;
