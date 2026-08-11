const test = require('node:test');
const assert = require('node:assert/strict');

const { _internals } = require('../src/services/venda-aprovacao.service');

const ETAPA_FINAL = 'concluido';
const AGORA = new Date('2026-08-11T12:00:00.000Z');

function vendaAtual(overrides = {}) {
  return {
    id: 100,
    cliente_id: 10,
    vendedora_id: 1,
    vendedoras: [{ id: 1 }],
    ...overrides
  };
}

function vendaAnterior(overrides = {}) {
  return {
    id: 99,
    cliente_id: 10,
    status_funil: 'ativacao',
    enviada_pos_venda_em: '2026-08-01 10:00:00',
    cancelada_em: null,
    excluido_em: null,
    entrada_etapa_final_em: null,
    ...overrides
  };
}

test('exige liberacao para cliente com venda enviada em andamento', () => {
  const motivos = _internals.avaliarMotivosVenda(
    vendaAtual(),
    [vendaAnterior()],
    ETAPA_FINAL,
    AGORA
  );

  assert.deepEqual(motivos, ['cliente_venda_em_andamento']);
});

test('ignora venda anterior nao enviada, excluida, cancelada ou a propria venda para regra de andamento', () => {
  const naoEnviada = vendaAnterior({ enviada_pos_venda_em: null });
  const cancelada = vendaAnterior({ cancelada_em: '2026-08-02 10:00:00' });
  const excluida = vendaAnterior({ excluido_em: '2026-08-02 10:00:00' });
  const propriaVenda = vendaAtual({
    enviada_pos_venda_em: '2026-08-01 10:00:00',
    status_funil: 'ativacao'
  });

  assert.equal(_internals.vendaEmAndamento(naoEnviada, ETAPA_FINAL), false);
  assert.equal(_internals.vendaEmAndamento(cancelada, ETAPA_FINAL), false);
  assert.equal(_internals.vendaEmAndamento(excluida, ETAPA_FINAL), false);
  assert.deepEqual(
    _internals.avaliarMotivosVenda(propriaVenda, [naoEnviada, cancelada, excluida, propriaVenda], ETAPA_FINAL, AGORA),
    []
  );
});

test('exige liberacao para cliente com venda concluida ha menos de 24 meses', () => {
  const concluidaRecente = vendaAnterior({
    status_funil: ETAPA_FINAL,
    entrada_etapa_final_em: '2024-08-12 12:00:00'
  });

  assert.equal(_internals.vendaConcluidaRecentemente(concluidaRecente, ETAPA_FINAL, AGORA), true);
  assert.deepEqual(
    _internals.avaliarMotivosVenda(vendaAtual(), [concluidaRecente], ETAPA_FINAL, AGORA),
    ['cliente_venda_concluida_recente']
  );
});

test('nao exige liberacao para venda concluida exatamente ha 24 meses ou cancelada', () => {
  const noLimite = vendaAnterior({
    status_funil: ETAPA_FINAL,
    entrada_etapa_final_em: '2024-08-11 12:00:00'
  });
  const cancelada = vendaAnterior({
    status_funil: ETAPA_FINAL,
    entrada_etapa_final_em: '2026-08-10 12:00:00',
    cancelada_em: '2026-08-11 10:00:00'
  });

  assert.equal(_internals.vendaConcluidaRecentemente(noLimite, ETAPA_FINAL, AGORA), false);
  assert.equal(_internals.vendaConcluidaRecentemente(cancelada, ETAPA_FINAL, AGORA), false);
});

test('exige liberacao para venda compartilhada sem limite de tempo de registro', () => {
  const motivos = _internals.avaliarMotivosVenda(
    vendaAtual({ vendedoras: [{ id: 1 }, { id: 2 }] }),
    [],
    ETAPA_FINAL,
    AGORA
  );

  assert.deepEqual(motivos, ['venda_compartilhada']);
});

test('combina os tres motivos e gera descricao automatica adequada', () => {
  const venda = vendaAtual({ vendedoras: [{ id: 1 }, { id: 2 }] });
  const motivos = _internals.avaliarMotivosVenda(venda, [
    vendaAnterior(),
    vendaAnterior({
      id: 98,
      status_funil: ETAPA_FINAL,
      entrada_etapa_final_em: '2026-07-11 12:00:00'
    })
  ], ETAPA_FINAL, AGORA);

  assert.deepEqual(motivos, [
    'cliente_venda_concluida_recente',
    'cliente_venda_em_andamento',
    'venda_compartilhada'
  ]);
  assert.match(_internals.normalizarMotivoDescricao('', venda, motivos), /cliente com venda em andamento/i);
  assert.doesNotMatch(_internals.normalizarMotivoDescricao('', venda, motivos), /^Venda compartilhada\.$/);
});
