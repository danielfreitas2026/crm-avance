const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { _internals } = require('../src/services/telegram-cancelamento-retroativo.service');

const atribuicaoAtiva = {
  id: 15,
  lead_linha_id: 42,
  aceite_status: 'aguardando_aceite',
  telegram_chat_id: '-100123',
  telegram_message_id: '777',
  consultora_nome: 'Ana Consultora'
};

test('seleciona somente atribuicoes ativas com mensagem do Telegram', () => {
  assert.equal(_internals.atribuicaoElegivel(atribuicaoAtiva), true);
  assert.equal(_internals.atribuicaoElegivel({ ...atribuicaoAtiva, aceite_status: 'aceito' }), true);
  assert.equal(_internals.atribuicaoElegivel({ ...atribuicaoAtiva, aceite_status: 'cancelado' }), false);
  assert.equal(_internals.atribuicaoElegivel({ ...atribuicaoAtiva, telegram_chat_id: '  ' }), false);
  assert.equal(_internals.atribuicaoElegivel({ ...atribuicaoAtiva, telegram_message_id: null }), false);
});

test('monta o botao retroativo com consultora e callback preservado', () => {
  assert.deepEqual(_internals.montarBotaoCancelarEnvio(42, 'Ana Consultora'), {
    text: 'Cancelar envio Ana Consultora',
    callback_data: 'fc:cancelar:42'
  });
  assert.equal(_internals.montarBotaoCancelarEnvio(42).text, 'Cancelar envio');
});

test('usa a mensagem da republicacao quando a atribuicao antiga nao guardou seus ids', () => {
  const resolvida = _internals.resolverMensagemTelegram({
    ...atribuicaoAtiva,
    telegram_chat_id: null,
    telegram_message_id: null,
    publicacao_telegram_chat_id: '-100999',
    publicacao_telegram_message_id: '888'
  });

  assert.equal(resolvida.telegram_chat_id, '-100999');
  assert.equal(resolvida.telegram_message_id, '888');
  assert.equal(_internals.atribuicaoElegivel(resolvida), true);
});

test('prioriza os ids da atribuicao quando ambos os registros existem', () => {
  const resolvida = _internals.resolverMensagemTelegram({
    ...atribuicaoAtiva,
    publicacao_telegram_chat_id: '-100999',
    publicacao_telegram_message_id: '888'
  });

  assert.equal(resolvida.telegram_chat_id, '-100123');
  assert.equal(resolvida.telegram_message_id, '777');
});

test('preview nao chama a API do Telegram', async () => {
  let chamadas = 0;
  const resumo = await _internals.atualizarBotoesCancelamento([atribuicaoAtiva], {
    preview: true,
    chamarApi: async () => { chamadas += 1; }
  });

  assert.equal(chamadas, 0);
  assert.deepEqual(resumo, { encontrados: 1, atualizados: 0, ignorados: 0, falhas: 0, erros: [] });
});

test('continua atualizando quando uma mensagem falha', async () => {
  const chamadas = [];
  const resumo = await _internals.atualizarBotoesCancelamento([
    atribuicaoAtiva,
    { ...atribuicaoAtiva, id: 16, lead_linha_id: 43, telegram_message_id: '778', consultora_nome: 'Bia Consultora' }
  ], {
    chamarApi: async (_metodo, dados) => {
      chamadas.push(dados);
      if (dados.message_id === '777') throw new Error('Mensagem não encontrada');
    }
  });

  assert.equal(chamadas.length, 2);
  assert.equal(resumo.atualizados, 1);
  assert.equal(resumo.falhas, 1);
  assert.deepEqual(resumo.erros, [{ atribuicao_id: 15, lead_linha_id: 42, mensagem: 'Mensagem não encontrada' }]);
  assert.equal(chamadas[1].reply_markup.inline_keyboard[0][0].text, 'Cancelar envio Bia Consultora');
});

test('trata como sucesso quando a mensagem antiga ja possui o mesmo botao', async () => {
  const resumo = await _internals.atualizarBotoesCancelamento([atribuicaoAtiva], {
    chamarApi: async () => { throw new Error('Bad Request: message is not modified'); }
  });

  assert.deepEqual(resumo, { encontrados: 1, atualizados: 1, ignorados: 0, falhas: 0, erros: [] });
});

test('agenda a correcao retroativa uma vez ao iniciar o backend', () => {
  const arquivo = path.join(__dirname, '../src/server.js');
  const conteudo = fs.readFileSync(arquivo, 'utf8');

  assert.match(conteudo, /telegramCancelamentoRetroativoService\.corrigirBotoesCancelamento\(\)/);
  assert.match(conteudo, /setTimeout\(corrigirBotoesCancelamentoAntigos, 15000\)/);
  assert.doesNotMatch(conteudo, /setInterval\(corrigirBotoesCancelamentoAntigos/);
  assert.match(conteudo, /tentativa < 3/);
  assert.match(conteudo, /resumo\.encontrados/);
  assert.match(conteudo, /resumo\.erros/);
});
