const test = require('node:test');
const assert = require('node:assert/strict');

const { _internals } = require('../src/services/notificacao.service');

const {
  isRetornoLeadAgendadoElegivel,
  deveRearmarPopupRetornoFuturo,
  popupRetornoFuturoDisponivel
} = _internals;

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
