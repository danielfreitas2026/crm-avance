const test = require('node:test');
const assert = require('node:assert/strict');

const vendaService = require('../src/services/venda.service');
const vendaEtapaService = require('../src/services/venda-etapa.service');
const Venda = require('../src/models/Venda');
const VendaArquivo = require('../src/models/VendaArquivo');
const VendaHistorico = require('../src/models/VendaHistorico');
const FunilEtapa = require('../src/models/FunilEtapa');
const auditLogService = require('../src/services/audit-log.service');
const vendaNotificacaoParadaService = require('../src/services/venda-notificacao-parada.service');

const {
  obterEtapasAtravessadas,
  montarConclusaoRequisitosGmail
} = vendaService._internals;

test('seleciona a etapa atual e as intermediarias, excluindo o destino', () => {
  const etapas = [
    { id: 'analise', ordem: 1 },
    { id: 'aceite', ordem: 2 },
    { id: 'entrega', ordem: 3 }
  ];

  assert.deepEqual(
    obterEtapasAtravessadas(etapas, 'analise', 'entrega'),
    etapas.slice(0, 2)
  );
  assert.deepEqual(obterEtapasAtravessadas(etapas, 'entrega', 'analise'), []);
  assert.deepEqual(obterEtapasAtravessadas(etapas, 'analise', 'analise'), []);
});

test('Gmail conclui requisitos atravessados e preserva conclusoes manuais', () => {
  const agora = '2026-08-31 12:00:00';
  const venda = {
    operadora: { nome: 'Vivo' },
    aceite_concluido: true,
    biometria_concluida: false,
    etapa_0800_concluida: true,
    etapa_0800_concluida_em: '2026-08-30 10:00:00',
    etapa_0800_concluida_por_id: 9,
    etapa_0800_resultado: 'base_vivo',
    etapa_abr_concluida: false,
    etapa_vivo_concluida: false
  };
  const atravessadas = [
    { id: 'analise', bloqueia_avanco: true, aceite_biometria: false },
    { id: 'aceite', bloqueia_avanco: false, aceite_biometria: true }
  ];

  const resultado = montarConclusaoRequisitosGmail(venda, atravessadas, agora);

  assert.deepEqual(resultado.concluidos, ['biometria', 'abr', 'vivo']);
  assert.equal(resultado.patch.biometria_concluida, true);
  assert.equal(resultado.patch.etapa_abr_concluida, true);
  assert.equal(resultado.patch.etapa_abr_concluida_em, agora);
  assert.equal(resultado.patch.etapa_abr_concluida_por_id, null);
  assert.equal(resultado.patch.etapa_vivo_concluida, true);
  assert.equal(Object.hasOwn(resultado.patch, 'aceite_concluido'), false);
  assert.equal(Object.hasOwn(resultado.patch, 'etapa_0800_concluida'), false);
  assert.equal(venda.etapa_0800_concluida_por_id, 9);
  assert.equal(venda.etapa_0800_resultado, 'base_vivo');
});

test('Gmail nao conclui a conferencia VIVO para outra operadora', () => {
  const resultado = montarConclusaoRequisitosGmail({
    operadora: { nome: 'Claro' },
    etapa_0800_concluida: false,
    etapa_abr_concluida: false,
    etapa_vivo_concluida: false
  }, [{ id: 'analise', bloqueia_avanco: true }], '2026-08-31 12:00:00');

  assert.deepEqual(resultado.concluidos, ['0800', 'abr']);
  assert.equal(Object.hasOwn(resultado.patch, 'etapa_vivo_concluida'), false);
  assert.equal(Object.hasOwn(resultado.patch, 'etapa_0800_resultado'), false);
});

test('sincronizacao de arquivos preserva conclusao sem autor feita pelo Gmail', async () => {
  const queryVendaOriginal = Venda.query;
  const queryArquivoOriginal = VendaArquivo.query;
  let alterouVenda = false;

  VendaArquivo.query = () => ({
    where() { return this; },
    whereNull() { return this; },
    resultSize: async () => 0
  });
  Venda.query = () => ({
    findById: async () => ({
      etapa_abr_concluida: true,
      etapa_abr_concluida_por_id: null
    }),
    patch() {
      alterouVenda = true;
      return this;
    }
  });

  try {
    const resultado = await vendaEtapaService.sincronizarEtapaPorArquivos(12, 'etapa_abr', 7);
    assert.deepEqual(resultado, { chave: 'abr', concluida: true });
    assert.equal(alterouVenda, false);
  } finally {
    Venda.query = queryVendaOriginal;
    VendaArquivo.query = queryArquivoOriginal;
  }
});

function criarQueryEtapas(etapas) {
  const query = {
    where() { return this; },
    orderBy() { return this; },
    first: async () => ({ codigo: 'final' }),
    then(resolve) { resolve(etapas); }
  };
  return query;
}

test('movimentacao, requisitos e historicos do Gmail usam a mesma transacao', async () => {
  const queryVendaOriginal = Venda.query;
  const transactionOriginal = Venda.transaction;
  const queryHistoricoOriginal = VendaHistorico.query;
  const queryEtapaOriginal = FunilEtapa.query;
  const registrarAuditOriginal = auditLogService.registrar;
  const desativarOriginal = vendaNotificacaoParadaService.desativarNotificacaoVendaParada;
  const registrarEntradaOriginal = vendaNotificacaoParadaService.registrarEntradaEstagio;

  const trx = { id: 'trx-gmail' };
  const etapas = [
    { codigo: 'analise', nome: 'Análise', ordem: 1, bloqueia_avanco: true, aceite_biometria: false },
    { codigo: 'aceite', nome: 'Aceite', ordem: 2, bloqueia_avanco: false, aceite_biometria: true },
    { codigo: 'entrega', nome: 'Entrega', ordem: 3, bloqueia_avanco: false, aceite_biometria: false },
    { codigo: 'final', nome: 'Final', ordem: 4, etapa_final: true, bloqueia_avanco: false, aceite_biometria: false }
  ];
  const venda = {
    id: 71,
    status_funil: 'analise',
    prioridade_funil: 'media',
    enviada_pos_venda_em: '2026-08-30 10:00:00',
    excluido_em: null,
    cancelada_em: null,
    operadora: { nome: 'Claro' },
    aceite_concluido: false,
    biometria_concluida: false,
    etapa_0800_concluida: false,
    etapa_abr_concluida: false,
    etapa_vivo_concluida: false
  };
  let patchPendente = null;
  let patchConfirmado = null;
  let historicoTrx = null;
  let auditoriaTrx = null;

  FunilEtapa.query = () => criarQueryEtapas(etapas);
  Venda.query = transacao => {
    if (transacao === trx) {
      return {
        patchAndFetchById: async (_id, patch) => {
          patchPendente = patch;
          return { ...venda, ...patch };
        }
      };
    }
    return {
      findById() {
        return {
          withGraphFetched: async () => venda,
          then(resolve) { resolve(venda); }
        };
      }
    };
  };
  VendaHistorico.query = transacao => ({
    insert: async () => { historicoTrx = transacao; }
  });
  Venda.transaction = async callback => {
    try {
      const resultado = await callback(trx);
      patchConfirmado = patchPendente;
      return resultado;
    } catch (error) {
      patchPendente = null;
      throw error;
    }
  };
  auditLogService.registrar = async (_req, _dados, transacao) => {
    auditoriaTrx = transacao;
  };
  vendaNotificacaoParadaService.desativarNotificacaoVendaParada = async () => {};
  vendaNotificacaoParadaService.registrarEntradaEstagio = async () => {};

  try {
    const resultado = await vendaService.atualizarStatusVenda(
      71,
      { status_funil: 'entrega', observacao: 'Atualização automática pelo Gmail' },
      null,
      { sistema: true, origemMovimentacao: 'automacao_gmail', automacaoEmailId: 88 }
    );

    assert.equal(resultado.status, 'ok');
    assert.equal(patchConfirmado.status_funil, 'entrega');
    assert.equal(patchConfirmado.aceite_concluido, true);
    assert.equal(patchConfirmado.biometria_concluida, true);
    assert.equal(patchConfirmado.etapa_0800_concluida, true);
    assert.equal(patchConfirmado.etapa_abr_concluida, true);
    assert.equal(Object.hasOwn(patchConfirmado, 'etapa_vivo_concluida'), false);
    assert.equal(historicoTrx, trx);
    assert.equal(auditoriaTrx, trx);

    patchConfirmado = null;
    const semOrigemGmail = await vendaService.atualizarStatusVenda(
      71,
      { status_funil: 'entrega' },
      null,
      { sistema: true }
    );
    assert.equal(semOrigemGmail.status, 'invalid');
    assert.match(semOrigemGmail.message, /etapas de conferência/);
    assert.equal(patchConfirmado, null);

    auditLogService.registrar = async () => { throw new Error('falha de auditoria'); };
    await assert.rejects(
      vendaService.atualizarStatusVenda(
        71,
        { status_funil: 'entrega', observacao: 'Atualização automática pelo Gmail' },
        null,
        { sistema: true, origemMovimentacao: 'automacao_gmail', automacaoEmailId: 89 }
      ),
      /falha de auditoria/
    );
    assert.equal(patchConfirmado, null);
    assert.equal(patchPendente, null);
  } finally {
    Venda.query = queryVendaOriginal;
    Venda.transaction = transactionOriginal;
    VendaHistorico.query = queryHistoricoOriginal;
    FunilEtapa.query = queryEtapaOriginal;
    auditLogService.registrar = registrarAuditOriginal;
    vendaNotificacaoParadaService.desativarNotificacaoVendaParada = desativarOriginal;
    vendaNotificacaoParadaService.registrarEntradaEstagio = registrarEntradaOriginal;
  }
});
