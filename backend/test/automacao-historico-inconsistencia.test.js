const test = require('node:test');
const assert = require('node:assert/strict');

const automacao = require('../src/services/automacao-email.service');
const AutomacaoEmail = require('../src/models/AutomacaoEmail');
const FunilEtapa = require('../src/models/FunilEtapa');
const Venda = require('../src/models/Venda');
const VendaHistorico = require('../src/models/VendaHistorico');
const auditLogService = require('../src/services/audit-log.service');

test('auditoria identifica movimento e email anteriores ao cadastro sem apagar evidencia', () => {
  const historico = {
    id: 70,
    venda_id: 42,
    acao: 'venda.status_atualizado',
    status_anterior: 'aceite',
    status_novo: 'concluido',
    created_at: '2026-09-02 12:05:00',
    dados: JSON.stringify({ origem_movimentacao: 'automacao_gmail', automacao_email_id: 10 })
  };
  const venda = { id: 42, criado_em: '2026-09-08 12:00:00', status_funil: 'concluido', updated_at: '2026-09-08 13:00:00' };
  const email = { id: 10, recebido_em: '2026-09-02 12:00:00', dados_extraidos: '{}' };

  const resultado = automacao._internals.montarInconsistenciaHistorico(historico, venda, email);
  assert.deepEqual(resultado.motivos, [
    'Movimentação anterior à criação da venda.',
    'E-mail recebido antes da criação da venda.'
  ]);
  assert.equal(resultado.venda_updated_at, venda.updated_at);
  assert.equal(historico.invalidated_at, undefined);
});

test('correcao rejeita previa desatualizada antes de alterar venda ou historico', async () => {
  const queryEtapaOriginal = FunilEtapa.query;
  const transactionOriginal = Venda.transaction;
  const queryVendaOriginal = Venda.query;
  const queryHistoricoOriginal = VendaHistorico.query;
  const queryAutomacaoOriginal = AutomacaoEmail.query;
  let patches = 0;

  FunilEtapa.query = () => ({ findOne: async () => ({ codigo: 'aceite', ativo: true }) });
  Venda.transaction = async callback => callback({ id: 'trx' });
  Venda.query = () => ({
    findById() {
      return {
        forUpdate: async () => ({
          id: 42,
          status_funil: 'concluido',
          criado_em: '2026-09-08 12:00:00',
          updated_at: '2026-09-08 14:00:00'
        }),
        patch: async () => { patches += 1; }
      };
    }
  });
  VendaHistorico.query = () => ({
    findById() {
      return {
        forUpdate: async () => ({
          id: 70, venda_id: 42, invalidated_at: null,
          dados: JSON.stringify({ origem_movimentacao: 'automacao_gmail', automacao_email_id: 10 })
        }),
        patch: async () => { patches += 1; }
      };
    }
  });
  AutomacaoEmail.query = () => ({ findById: async () => ({ id: 10, recebido_em: '2026-09-02 12:00:00', dados_extraidos: '{}' }) });

  try {
    await assert.rejects(
      automacao.corrigirInconsistenciaHistorico(70, {
        motivo: 'Vínculo incorreto', status_destino: 'aceite', versao_venda: '2026-09-08 13:00:00'
      }, 7),
      error => error.statusCode === 409 && /mudou desde a prévia/.test(error.message)
    );
    assert.equal(patches, 0);
  } finally {
    FunilEtapa.query = queryEtapaOriginal;
    Venda.transaction = transactionOriginal;
    Venda.query = queryVendaOriginal;
    VendaHistorico.query = queryHistoricoOriginal;
    AutomacaoEmail.query = queryAutomacaoOriginal;
  }
});

test('correcao invalida o evento original e registra um novo evento auditado', async () => {
  const queryEtapaOriginal = FunilEtapa.query;
  const transactionOriginal = Venda.transaction;
  const queryVendaOriginal = Venda.query;
  const queryHistoricoOriginal = VendaHistorico.query;
  const queryAutomacaoOriginal = AutomacaoEmail.query;
  const registrarOriginal = auditLogService.registrar;
  const patchesVenda = [];
  const patchesHistorico = [];
  const inseridos = [];
  const auditorias = [];
  const historico = {
    id: 70, venda_id: 42, invalidated_at: null, status_anterior: 'aceite', status_novo: 'concluido', created_at: '2026-09-02 12:05:00',
    dados: JSON.stringify({ origem_movimentacao: 'automacao_gmail', automacao_email_id: 10 })
  };

  FunilEtapa.query = () => ({ findOne: async () => ({ codigo: 'aceite', ativo: true }) });
  Venda.transaction = async callback => callback({ id: 'trx' });
  Venda.query = () => ({
    findById() {
      return {
        forUpdate: async () => ({
          id: 42,
          status_funil: 'concluido',
          criado_em: '2026-09-08 12:00:00',
          updated_at: '2026-09-08 13:00:00'
        }),
        patch: async dados => { patchesVenda.push(dados); }
      };
    }
  });
  VendaHistorico.query = () => ({
    findById() {
      return {
        forUpdate: async () => historico,
        patch: async dados => { patchesHistorico.push(dados); }
      };
    },
    insert: async dados => { inseridos.push(dados); }
  });
  AutomacaoEmail.query = () => ({ findById: async () => ({ id: 10, recebido_em: '2026-09-02 12:00:00', dados_extraidos: '{}' }) });
  auditLogService.registrar = async (...args) => { auditorias.push(args); };

  try {
    const resultado = await automacao.corrigirInconsistenciaHistorico(70, {
      motivo: 'E-mail pertence a outra venda.', status_destino: 'aceite', versao_venda: '2026-09-08 13:00:00'
    }, 7);
    assert.equal(resultado.status, 'ok');
    assert.equal(patchesVenda[0].status_funil, 'aceite');
    assert.equal(patchesHistorico[0].invalidated_by_id, 7);
    assert.equal(inseridos[0].acao, 'venda.automacao_corrigida');
    assert.equal(inseridos[0].dados.historico_invalidado_id, 70);
    assert.equal(auditorias[0][1].acao, 'venda.automacao_historico_corrigido');
  } finally {
    FunilEtapa.query = queryEtapaOriginal;
    Venda.transaction = transactionOriginal;
    Venda.query = queryVendaOriginal;
    VendaHistorico.query = queryHistoricoOriginal;
    AutomacaoEmail.query = queryAutomacaoOriginal;
    auditLogService.registrar = registrarOriginal;
  }
});
