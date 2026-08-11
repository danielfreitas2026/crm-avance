const test = require('node:test');
const assert = require('node:assert/strict');

const { _internals } = require('../src/services/telegram-aprovacoes.service');

test('monta botoes de aprovar e recusar com callback compacto', () => {
  assert.deepEqual(_internals.botoesDecisao(123), [[
    { text: '✅ Aprovar', callback_data: 'va:aprovar:123' },
    { text: '❌ Recusar', callback_data: 'va:recusar:123' }
  ]]);
});

test('monta mensagem de solicitacao com os motivos de aprovacao', () => {
  const texto = _internals.montarMensagemSolicitacao({
    id: 4,
    venda_id: 72,
    motivos: JSON.stringify(['cliente_venda_em_andamento', 'venda_compartilhada']),
    motivo_descricao: 'Cliente possui contrato ativo.',
    solicitante: { nome: 'Bruno Vendas' },
    venda: { cliente: { nome: 'Empresa Teste' } }
  });

  assert.match(texto, /VENDA AGUARDANDO APROVAÇÃO/);
  assert.match(texto, /Venda: Empresa Teste/);
  assert.match(texto, /ID da venda: 72/);
  assert.match(texto, /Cliente com venda em andamento/);
  assert.match(texto, /Venda compartilhada/);
  assert.match(texto, /Cliente possui contrato ativo/);
});

test('aceita apenas mapa de aprovadores Telegram para e-mail', () => {
  const anterior = process.env.TELEGRAM_APROVACOES_APROVADORES;
  process.env.TELEGRAM_APROVACOES_APROVADORES = '{"123":"gestor@empresa.com"}';

  try {
    assert.deepEqual(_internals.mapaAprovadores(), { 123: 'gestor@empresa.com' });
  } finally {
    if (anterior === undefined) delete process.env.TELEGRAM_APROVACOES_APROVADORES;
    else process.env.TELEGRAM_APROVACOES_APROVADORES = anterior;
  }
});
