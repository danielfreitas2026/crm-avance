const test = require('node:test');
const assert = require('node:assert/strict');

const { _internals } = require('../src/services/notificacao.service');
const db = require('../src/database/connection');

const {
  isLinhaLeadFinalizada,
  aplicarCondicaoLinhaLeadNaoFinalizada,
  aplicarFiltroRetornosLeadPendentes,
  isRetornoLeadAgendadoElegivel,
  deveRearmarPopupRetornoFuturo,
  popupRetornoFuturoDisponivel,
  resolverResponsavelAtualFuturoCliente,
  DIAS_RETENCAO_RETORNO_LIGACAO,
  retornoLigacaoExpirou,
  aplicarJanelaRetencaoRetorno,
  selecionarIdsRetornosExpirados
} = _internals;

test('expira notificacao sete dias completos depois da ligacao marcada', () => {
  const retorno = '2026-08-01T12:00:00.000Z';

  assert.equal(DIAS_RETENCAO_RETORNO_LIGACAO, 7);
  assert.equal(retornoLigacaoExpirou(retorno, new Date('2026-08-08T11:59:59.999Z')), false);
  assert.equal(retornoLigacaoExpirou(retorno, new Date('2026-08-08T12:00:00.000Z')), true);
  assert.equal(retornoLigacaoExpirou(null, new Date('2026-08-08T12:00:00.000Z')), false);
});

test('produtores ignoram ligacoes que ja atingiram o prazo de exclusao', () => {
  const consulta = aplicarJanelaRetencaoRetorno(
    db('lead_linhas').select('id'),
    'retorno_agendado_em',
    new Date('2026-08-08T12:00:00.000Z')
  ).toSQL();

  assert.match(consulta.sql, /retorno_agendado_em.*>/i);
  assert.equal(new Date(consulta.bindings.at(-1)).toISOString(), '2026-08-01T12:00:00.000Z');
});

test('seleciona para exclusao somente notificacoes de ligacao vencidas ha sete dias', () => {
  const agora = new Date('2026-08-08T12:00:00.000Z');
  const notificacoes = [
    { id: 1, dados: JSON.stringify({ retorno_agendado_para: '2026-08-01T12:00:00.000Z' }) },
    { id: 2, dados: { retorno_agendado_para: '2026-08-01T12:00:00.001Z' } },
    { id: 3, dados: '{}' }
  ];

  assert.deepEqual(selecionarIdsRetornosExpirados(notificacoes, agora), [1]);
});

test('considera estados finais inelegiveis para retorno pendente', () => {
  const ativa = {
    venda_id: null,
    venda_recusada_em: null,
    cliente_recusou: false,
    status_operacional: 'distribuido_venda'
  };

  assert.equal(isLinhaLeadFinalizada(ativa), false);
  assert.equal(isLinhaLeadFinalizada({ ...ativa, venda_id: 31 }), true);
  assert.equal(isLinhaLeadFinalizada({ ...ativa, venda_recusada_em: '2026-08-27 10:00:00' }), true);
  assert.equal(isLinhaLeadFinalizada({ ...ativa, status_operacional: 'vendido' }), true);
  assert.equal(isLinhaLeadFinalizada({ ...ativa, status_operacional: 'perdido' }), true);
  assert.equal(isLinhaLeadFinalizada({ ...ativa, cliente_recusou: true }), true);
});

test('aplica estados finais nos produtores e no leitor de notificacoes urgentes', () => {
  const produtora = aplicarCondicaoLinhaLeadNaoFinalizada(
    db('lead_linhas as ll').select('ll.id'),
    'll'
  ).toSQL();
  const leitora = aplicarFiltroRetornosLeadPendentes(
    db('notificacoes as n').select('n.id')
  ).toSQL();

  for (const consulta of [produtora, leitora]) {
    assert.match(consulta.sql, /venda_id.*is null/i);
    assert.match(consulta.sql, /venda_recusada_em.*is null/i);
    assert.match(consulta.sql, /cliente_recusou/i);
    assert.match(consulta.sql, /status_operacional.*not in/i);
    assert.deepEqual(consulta.bindings.slice(-2), ['vendido', 'perdido']);
  }
  assert.match(leitora.sql, /exists/i);
});

test('mantem retorno de mailing elegivel antes da qualificacao', () => {
  assert.equal(isRetornoLeadAgendadoElegivel({
    retorno_agendado_em: '2026-07-29 14:00:00',
    cliente_recusou: false,
    futuro_cliente: false,
    status_operacional: 'pendente'
  }), true);
});

test('permite retorno de futuro cliente encaminhado pelo Telegram', () => {
  assert.equal(isRetornoLeadAgendadoElegivel({
    retorno_agendado_em: '2026-07-29 14:00:00',
    cliente_recusou: false,
    futuro_cliente: true,
    status_operacional: 'distribuido_venda'
  }), true);
});

test('nao cria retorno de mailing para futuro cliente fora do encaminhamento', () => {
  assert.equal(isRetornoLeadAgendadoElegivel({
    retorno_agendado_em: '2026-07-29 14:00:00',
    cliente_recusou: false,
    futuro_cliente: true,
    status_operacional: 'qualificado'
  }), false);
});

test('nao cria retorno sem data ou depois de recusa do cliente', () => {
  assert.equal(isRetornoLeadAgendadoElegivel({
    retorno_agendado_em: null,
    cliente_recusou: false,
    futuro_cliente: false
  }), false);
  assert.equal(isRetornoLeadAgendadoElegivel({
    retorno_agendado_em: '2026-07-29 14:00:00',
    cliente_recusou: true,
    futuro_cliente: false
  }), false);
});

test('nao cria retorno para venda fechada, perdida ou recusada', () => {
  const retornoAtivo = {
    retorno_agendado_em: '2026-07-29 14:00:00',
    retorno_agendado_realizado_em: null,
    cliente_recusou: false,
    futuro_cliente: true,
    status_operacional: 'distribuido_venda',
    venda_id: null,
    venda_recusada_em: null
  };

  assert.equal(isRetornoLeadAgendadoElegivel({ ...retornoAtivo, venda_id: 15 }), false);
  assert.equal(isRetornoLeadAgendadoElegivel({
    ...retornoAtivo,
    venda_recusada_em: '2026-08-27 10:00:00'
  }), false);
  assert.equal(isRetornoLeadAgendadoElegivel({ ...retornoAtivo, status_operacional: 'vendido' }), false);
  assert.equal(isRetornoLeadAgendadoElegivel({ ...retornoAtivo, status_operacional: 'perdido' }), false);
});

function notificacaoRetorno(overrides = {}) {
  return {
    tipo: 'futuro_cliente_retorno_pre',
    ativa: true,
    dados: {
      retorno_agendado_para: '2026-08-26T15:15:00.000Z',
      responsavel_usuario_id: 9,
      futuro_cliente: true
    },
    ...overrides
  };
}

test('libera popup de futuro cliente somente a partir de quinze minutos do retorno', () => {
  const notificacao = notificacaoRetorno();

  assert.equal(popupRetornoFuturoDisponivel(notificacao, 9, new Date('2026-08-26T14:59:59.999Z')), false);
  assert.equal(popupRetornoFuturoDisponivel(notificacao, 9, new Date('2026-08-26T15:00:00.000Z')), true);
  assert.equal(popupRetornoFuturoDisponivel(notificacao, 9, new Date('2026-08-26T15:20:00.000Z')), true);
});

test('restringe popup ao responsavel e ignora retorno de mailing comum', () => {
  const agora = new Date('2026-08-26T15:05:00.000Z');

  assert.equal(popupRetornoFuturoDisponivel(notificacaoRetorno(), 7, agora), false);
  assert.equal(popupRetornoFuturoDisponivel(notificacaoRetorno({
    tipo: 'lead_retorno_pre',
    dados: {
      retorno_agendado_para: '2026-08-26T15:15:00.000Z',
      responsavel_usuario_id: 9,
      futuro_cliente: false
    }
  }), 9, agora), false);
  assert.equal(popupRetornoFuturoDisponivel(notificacaoRetorno({ tipo: 'lead_retorno_pre' }), 9, agora), true);
});

test('nao rearma popup no vencimento, mas rearma depois de reagendamento', () => {
  const anterior = notificacaoRetorno({
    dados: JSON.stringify(notificacaoRetorno().dados)
  });
  const vencida = notificacaoRetorno({
    tipo: 'futuro_cliente_retorno_due',
    dados: JSON.stringify({ ...notificacaoRetorno().dados, retorno_etapa: 'due' })
  });
  const reagendada = notificacaoRetorno({
    dados: JSON.stringify({
      ...notificacaoRetorno().dados,
      retorno_agendado_para: '2026-08-27T15:15:00.000Z'
    })
  });

  assert.equal(deveRearmarPopupRetornoFuturo(anterior, vencida), false);
  assert.equal(deveRearmarPopupRetornoFuturo(anterior, reagendada), true);
  assert.equal(deveRearmarPopupRetornoFuturo({ ...anterior, ativa: false }, anterior), true);
});

test('resolve a consultora atual sem usar quem registrou a sondagem', () => {
  const carteira = {
    usuario_id: 3,
    atribuido_para_id: 7,
    futuro_cliente_marcado_por_id: 5,
    futuro_cliente_destino: 'carteira'
  };

  assert.equal(resolverResponsavelAtualFuturoCliente(carteira), 7);
  assert.equal(resolverResponsavelAtualFuturoCliente({ ...carteira, atribuido_para_id: null }), 5);
  assert.equal(resolverResponsavelAtualFuturoCliente({
    ...carteira,
    distribuicao_usuario_id: 11,
    distribuicao_aceite_status: 'aceito'
  }), 11);
  assert.equal(resolverResponsavelAtualFuturoCliente({
    ...carteira,
    distribuicao_usuario_id: 12,
    distribuicao_aceite_status: 'aguardando_aceite'
  }), 12);
});

test('nao atribui carteira de distribuicao sem consultora ativa', () => {
  assert.equal(resolverResponsavelAtualFuturoCliente({
    atribuido_para_id: 7,
    futuro_cliente_marcado_por_id: 5,
    futuro_cliente_destino: 'distribuicao',
    distribuicao_usuario_id: 11,
    distribuicao_aceite_status: 'cancelado'
  }), null);
});
