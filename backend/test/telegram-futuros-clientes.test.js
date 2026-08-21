const test = require('node:test');
const assert = require('node:assert/strict');
const { _internals: telegramInternals } = require('../src/services/telegram-webhook.service');
const { _internals: distribuicaoInternals } = require('../src/services/lead-distribuicao.service');

test('inclui Josilaine entre os destinos ativos de encaminhamento', () => {
  const botoes = telegramInternals.botoesVendedoras([
    { id: 4, nome: 'Ana' },
    { id: 9, nome: 'Josilaine' }
  ], 123);

  assert.deepEqual(botoes[1], [{ text: 'Josilaine', callback_data: 'fc:atribuir:123:9' }]);
});

test('inicia o primeiro prazo no momento do encaminhamento', () => {
  const enviadoEm = new Date('2026-07-30T15:00:00.000Z');
  const atribuicao = telegramInternals.montarAtribuicaoDistribuicao({
    linhaId: 123,
    envioId: 456,
    vendedoraId: 9,
    gerenteTelegramId: 77,
    telegramContexto: { chatId: -1001, messageId: 88, mensagemTexto: 'Indicacao' }
  }, enviadoEm);

  assert.equal(atribuicao.aceite_status, 'aguardando_aceite');
  assert.equal(atribuicao.atribuido_em, enviadoEm);
  assert.equal(atribuicao.prazo_acao_em.toISOString(), '2026-07-30T15:30:00.000Z');
});

test('callback repetido so e idempotente para a mesma consultora e mensagem', () => {
  const atribuicao = {
    usuario_id: 9,
    telegram_chat_id: '-1001',
    telegram_message_id: '88'
  };
  assert.equal(telegramInternals.atribuicaoRepetidaValida(
    atribuicao,
    9,
    { chatId: -1001, messageId: 88 }
  ), true);
  assert.equal(telegramInternals.atribuicaoRepetidaValida(
    atribuicao,
    10,
    { chatId: -1001, messageId: 88 }
  ), false);
  assert.equal(telegramInternals.atribuicaoRepetidaValida(
    atribuicao,
    9,
    { chatId: -1001, messageId: 99 }
  ), false);
});

test('republica somente futuro cliente antigo qualificado e nunca encaminhado', () => {
  const linhaPendente = { futuro_cliente: true, status_operacional: 'qualificado', futuro_cliente_excluido_em: null };
  assert.equal(distribuicaoInternals.deveRepublicarPendenteAntiga(linhaPendente, false), true);
  assert.equal(distribuicaoInternals.deveRepublicarPendenteAntiga(linhaPendente, true), false);
  assert.equal(distribuicaoInternals.deveRepublicarPendenteAntiga({ ...linhaPendente, status_operacional: 'distribuido_venda' }, false), false);
  assert.equal(distribuicaoInternals.deveRepublicarPendenteAntiga({ ...linhaPendente, futuro_cliente_excluido_em: new Date() }, false), false);
  assert.equal(distribuicaoInternals.deveRepublicarPendenteAntiga({ ...linhaPendente, futuro_cliente_destino: 'carteira' }, false), false);
  assert.equal(distribuicaoInternals.deveRepublicarPendenteAntiga({ ...linhaPendente, futuro_cliente_destino: 'distribuicao' }, false), true);
});
