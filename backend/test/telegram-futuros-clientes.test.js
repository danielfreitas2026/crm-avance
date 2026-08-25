const test = require('node:test');
const assert = require('node:assert/strict');
const telegramService = require('../src/services/telegram.service');
const {
  processarCallback,
  _internals: telegramInternals
} = require('../src/services/telegram-webhook.service');
const { _internals: distribuicaoInternals } = require('../src/services/lead-distribuicao.service');

test('inclui Josilaine entre os destinos ativos de encaminhamento', () => {
  const botoes = telegramInternals.botoesVendedoras([
    { id: 4, nome: 'Ana' },
    { id: 9, nome: 'Josilaine' }
  ], 123);

  assert.deepEqual(botoes[1], [{ text: 'Josilaine', callback_data: 'fc:atribuir:123:9' }]);
});

test('inclui Fechar ao final dos destinos de encaminhamento', () => {
  const botoes = telegramInternals.botoesVendedoras([
    { id: 4, nome: 'Ana' },
    { id: 9, nome: 'Josilaine' }
  ], 123);

  assert.deepEqual(botoes.at(-1), [{ text: 'Fechar', callback_data: 'fc:fechar:123' }]);
});

test('fecha a selecao de vendedoras e disponibiliza Encaminhar novamente', async t => {
  const chatIdAnterior = process.env.TELEGRAM_FUTUROS_CLIENTES_CHAT_ID;
  process.env.TELEGRAM_FUTUROS_CLIENTES_CHAT_ID = '-1001';
  t.after(() => {
    if (chatIdAnterior === undefined) delete process.env.TELEGRAM_FUTUROS_CLIENTES_CHAT_ID;
    else process.env.TELEGRAM_FUTUROS_CLIENTES_CHAT_ID = chatIdAnterior;
  });

  const chamadas = [];
  t.mock.method(telegramService, 'chamarApi', async (metodo, dados) => {
    chamadas.push({ metodo, dados });
    return { ok: true };
  });

  await processarCallback({
    id: 'callback-1',
    data: 'fc:fechar:123',
    from: { id: 77 },
    message: { chat: { id: -1001 }, message_id: 88 }
  });

  assert.deepEqual(chamadas, [
    {
      metodo: 'editMessageReplyMarkup',
      dados: {
        chat_id: -1001,
        message_id: 88,
        reply_markup: {
          inline_keyboard: [[{ text: 'Encaminhar', callback_data: 'fc:selecionar:123' }]]
        }
      }
    },
    {
      metodo: 'answerCallbackQuery',
      dados: { callback_query_id: 'callback-1', text: 'Selecao fechada.' }
    }
  ]);
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

test('garante o cancelamento com a nova consultora ao reencaminhar mensagem de retorno', async () => {
  const chamadas = [];
  const atualizado = await telegramInternals.garantirBotaoCancelarEnvio(
    123,
    'Beatriz Consultora',
    { chatId: -1001, messageId: 99 },
    { chamarApi: async (metodo, dados) => chamadas.push({ metodo, dados }) }
  );

  assert.equal(atualizado, true);
  assert.deepEqual(chamadas, [{
    metodo: 'editMessageReplyMarkup',
    dados: {
      chat_id: -1001,
      message_id: 99,
      reply_markup: {
        inline_keyboard: [[{
          text: 'Cancelar envio Beatriz Consultora',
          callback_data: 'fc:cancelar:123'
        }]]
      }
    }
  }]);
});

test('considera garantido quando a fila ja colocou o mesmo botao', async () => {
  const atualizado = await telegramInternals.garantirBotaoCancelarEnvio(
    123,
    'Beatriz Consultora',
    { chatId: -1001, messageId: 99 },
    { chamarApi: async () => { throw new Error('Bad Request: message is not modified'); } }
  );

  assert.equal(atualizado, true);
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
