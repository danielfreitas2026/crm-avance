const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const db = require('../src/database/connection');
const telegram = require('../src/services/telegram.service');
const distribuicao = require('../src/services/lead-distribuicao.service');
const resumo = require('../src/services/resumo-vendas-telegram.service');

function configurar(t, valores) {
  for (const [nome, valor] of Object.entries(valores)) {
    const anterior = process.env[nome];
    if (valor === undefined) delete process.env[nome];
    else process.env[nome] = valor;
    t.after(() => {
      if (anterior === undefined) delete process.env[nome];
      else process.env[nome] = anterior;
    });
  }
}

function simularBanco(t, responder) {
  t.mock.method(db.client, 'acquireConnection', async () => ({}));
  t.mock.method(db.client, 'releaseConnection', async () => {});
  t.mock.method(db.client, '_query', async (_conexao, consulta) => ({
    ...consulta,
    response: [await responder(consulta), []]
  }));
}

const atribuicao = {
  id: 15,
  lead_linha_id: 42,
  usuario_id: 7,
  etapa: 'venda',
  aceite_status: 'aceito',
  telegram_chat_id: '-1001',
  telegram_message_id: '777',
  consultora_nome: 'Ana Consultora'
};
const venda = { id: 91, origem_lead_linha_id: 42, vendedora_id: 7, valor_total: 100 };

test('chaves opcionais ficam desligadas e aceitam somente true normalizado, de forma independente', t => {
  const chaves = {
    TELEGRAM_ACOMPANHAMENTO_ATIVO: telegram.acompanhamentoAtivo,
    TELEGRAM_VENDAS_ATIVO: telegram.vendasAtivo,
    TELEGRAM_RESUMO_VENDAS_ATIVO: telegram.resumoVendasAtivo
  };
  configurar(t, Object.fromEntries(Object.keys(chaves).map(nome => [nome, undefined])));
  for (const [nome, ler] of Object.entries(chaves)) {
    for (const valor of [undefined, '', 'false', ' TRUE ', 'true', '1', 'sim']) {
      if (valor === undefined) delete process.env[nome];
      else process.env[nome] = valor;
      assert.equal(ler(), [' TRUE ', 'true'].includes(valor), `${nome}: ${valor}`);
      for (const [outra, lerOutra] of Object.entries(chaves)) {
        if (outra !== nome) assert.equal(lerOutra(), false);
      }
    }
    delete process.env[nome];
  }
});

test('bloqueia vendas e resumos diretos mesmo com token e chats configurados', async t => {
  configurar(t, {
    TELEGRAM_BOT_TOKEN: 'token-de-teste',
    TELEGRAM_VENDAS_CHAT_ID: '-1001',
    TELEGRAM_RESUMO_VENDAS_CHAT_ID: '-1002'
  });
  const enviar = t.mock.method(axios, 'post', async () => {
    assert.fail('Nao deve chamar a API com o aviso desligado');
  });
  for (const valor of [undefined, 'false']) {
    configurar(t, { TELEGRAM_VENDAS_ATIVO: valor, TELEGRAM_RESUMO_VENDAS_ATIVO: valor });
    assert.deepEqual(await telegram.enviarVenda(venda), {
      enviado: false, motivo: 'telegram_vendas_desativado'
    });
    assert.deepEqual(await telegram.enviarResumoVendas('Resumo'), {
      enviado: false, motivo: 'telegram_resumo_vendas_desativado'
    });
  }
  assert.equal(enviar.mock.callCount(), 0);
});

test('reativa vendas e resumos diretos individualmente, preservando chats e confirmacao de envio', async t => {
  configurar(t, {
    TELEGRAM_BOT_TOKEN: 'token-de-teste',
    TELEGRAM_VENDAS_CHAT_ID: '-1001',
    TELEGRAM_RESUMO_VENDAS_CHAT_ID: '-1002',
    TELEGRAM_ACOMPANHAMENTO_ATIVO: 'false',
    TELEGRAM_VENDAS_ATIVO: ' TRUE ',
    TELEGRAM_RESUMO_VENDAS_ATIVO: 'false'
  });
  const chamadas = [];
  t.mock.method(axios, 'post', async (_url, dados) => {
    chamadas.push(dados);
    return { data: { ok: true, result: { message_id: chamadas.length } } };
  });
  const resultado = await telegram.enviarVenda({ ...venda, observacoes: 'X'.repeat(8500) });
  assert.equal(resultado.enviado, true);
  assert.ok(resultado.message_ids.length > 1);
  assert.ok(chamadas.every(dados => dados.chat_id === '-1001' && dados.text.length <= 4096));
  assert.equal((await telegram.enviarResumoVendas('Resumo')).enviado, false);

  process.env.TELEGRAM_VENDAS_ATIVO = 'false';
  process.env.TELEGRAM_RESUMO_VENDAS_ATIVO = 'true';
  const quantidade = chamadas.length;
  assert.equal((await telegram.enviarVenda(venda)).enviado, false);
  assert.deepEqual(await telegram.enviarResumoVendas('Resumo'), { enviado: true, message_id: quantidade + 1 });
  assert.equal(chamadas.at(-1).chat_id, '-1002');
  assert.equal(chamadas.at(-1).text, 'Resumo');
});

test('acompanhamento desligado preserva os botoes de retorno e venda sem enviar avisos', async t => {
  const chamadas = [];
  const opcoes = { chamarApi: async (metodo, dados) => { chamadas.push({ metodo, dados }); return {}; } };
  for (const valor of [undefined, 'false']) {
    configurar(t, { TELEGRAM_ACOMPANHAMENTO_ATIVO: valor });
    const retorno = await distribuicao._internals.enviarNotificacaoRetornoAgendado(
      atribuicao, { id: 42 }, '2026-10-06 15:30:00', opcoes
    );
    const fechada = await distribuicao._internals.enviarNotificacaoVendaFechada(venda, atribuicao, opcoes);
    for (const resultado of [retorno, fechada]) {
      assert.equal(resultado.enviado, false);
      assert.equal(resultado.botao_atualizado, true);
      assert.equal(resultado.motivo, 'telegram_acompanhamento_desativado');
    }
  }
  assert.deepEqual(chamadas.map(item => item.metodo), Array(4).fill('editMessageReplyMarkup'));
  assert.equal(chamadas[0].dados.reply_markup.inline_keyboard[0][0].callback_data, 'fc:cancelar:42');
  assert.equal(chamadas[1].dados.reply_markup.inline_keyboard[0][0].callback_data, 'fc:info:42:venda');
});

test('reativa os avisos de retorno e venda sem habilitar os demais envios', async t => {
  configurar(t, {
    TELEGRAM_ACOMPANHAMENTO_ATIVO: 'true',
    TELEGRAM_VENDAS_ATIVO: 'false',
    TELEGRAM_RESUMO_VENDAS_ATIVO: 'false'
  });
  const chamadas = [];
  const opcoes = { chamarApi: async (metodo, dados) => {
    chamadas.push({ metodo, dados });
    return { message_id: 888 };
  } };
  assert.equal((await distribuicao._internals.enviarNotificacaoRetornoAgendado(
    atribuicao, { id: 42 }, '2026-10-06 15:30:00', opcoes
  )).enviado, true);
  assert.equal((await distribuicao._internals.enviarNotificacaoVendaFechada(venda, atribuicao, opcoes)).enviado, true);
  assert.deepEqual(chamadas.map(item => item.metodo), [
    'editMessageReplyMarkup', 'sendMessage', 'editMessageReplyMarkup', 'sendMessage'
  ]);
});

test('aceite desligado sincroniza apenas os botoes e nao carrega o texto da sondagem', async t => {
  configurar(t, { TELEGRAM_ACOMPANHAMENTO_ATIVO: 'false' });
  const consultas = [];
  simularBanco(t, consulta => {
    consultas.push(consulta.sql);
    if (consulta.sql.includes('`lead_atribuicoes`')) return [atribuicao];
    if (consulta.sql.includes('`vendas`')) return [];
    assert.fail(`Consulta inesperada: ${consulta.sql}`);
  });
  const chamadas = [];
  t.mock.method(telegram, 'chamarApi', async (metodo, dados) => { chamadas.push({ metodo, dados }); });
  assert.deepEqual(await distribuicao.reconciliarMensagemTelegram(15), { sincronizado: true });
  assert.equal(consultas.length, 2);
  assert.deepEqual(chamadas.map(item => item.metodo), ['editMessageReplyMarkup']);
  assert.equal(chamadas[0].dados.reply_markup.inline_keyboard[0][0].callback_data, 'fc:cancelar:42');
});

test('aceite reativado atualiza o texto e mantem o botao de cancelamento', async t => {
  configurar(t, { TELEGRAM_ACOMPANHAMENTO_ATIVO: 'true' });
  simularBanco(t, consulta => {
    if (consulta.sql.includes('`lead_atribuicoes`')) return [atribuicao];
    if (consulta.sql.includes('`lead_linhas`')) return [{ id: 42 }];
    if (consulta.sql.includes('`lead_sondagens`') || consulta.sql.includes('`vendas`')) return [];
    assert.fail(`Consulta inesperada: ${consulta.sql}`);
  });
  const chamadas = [];
  t.mock.method(telegram, 'chamarApi', async (metodo, dados) => { chamadas.push({ metodo, dados }); });
  assert.deepEqual(await distribuicao.reconciliarMensagemTelegram(15), { sincronizado: true });
  assert.deepEqual(chamadas.map(item => item.metodo), ['editMessageText']);
  assert.match(chamadas[0].dados.text, /Ana Consultora/);
  assert.equal(chamadas[0].dados.reply_markup.inline_keyboard[0][0].callback_data, 'fc:cancelar:42');
});

test('resumos desligados nao consultam o banco nem iniciam timers, inclusive com agendamento permitido', async t => {
  configurar(t, { TELEGRAM_RESUMO_VENDAS_AGENDAMENTO_ATIVO: 'true' });
  const consultar = t.mock.method(db.client, 'acquireConnection', async () => assert.fail('Nao deve consultar o banco'));
  const agendar = t.mock.method(global, 'setTimeout', () => assert.fail('Nao deve agendar resumo'));
  for (const valor of [undefined, 'false']) {
    configurar(t, { TELEGRAM_RESUMO_VENDAS_ATIVO: valor });
    assert.deepEqual(await resumo.enviarResumoDoDia('2026-10-05', { agendada: true }), {
      data: '2026-10-05', mensagens: 0, ignorado: 'telegram_resumo_vendas_desativado'
    });
    assert.equal(resumo.iniciarAgendamentoResumoVendas(), false);
  }
  assert.equal(consultar.mock.callCount(), 0);
  assert.equal(agendar.mock.callCount(), 0);
});

test('resumos reativados geram o resultado diario e o fechamento da sexta-feira', async t => {
  configurar(t, { TELEGRAM_RESUMO_VENDAS_ATIVO: 'true' });
  simularBanco(t, () => [{
    id: 91, consultor: 'Ana Consultora', status_funil: 'ativacao', quantidade_linhas: 2, valor_total: 100
  }]);
  const mensagens = [];
  t.mock.method(telegram, 'enviarResumoVendas', async texto => {
    mensagens.push(texto);
    return { enviado: true, message_id: mensagens.length };
  });
  const resultado = await resumo.enviarResumoDoDia('2026-10-09');
  assert.equal(resultado.mensagens, mensagens.length);
  assert.match(mensagens.join('\n'), /Fechamento da semana/);
  assert.match(mensagens.join('\n'), /Resultado diário de vendas/);
  assert.match(mensagens.join('\n'), /Ana Consultora/);
});

test('agendamento exige as duas permissoes e inicia apenas uma vez', t => {
  configurar(t, { TELEGRAM_RESUMO_VENDAS_ATIVO: 'true', TELEGRAM_RESUMO_VENDAS_AGENDAMENTO_ATIVO: 'false' });
  const agendar = t.mock.method(global, 'setTimeout', () => ({}));
  assert.equal(resumo.iniciarAgendamentoResumoVendas(), false);
  assert.equal(agendar.mock.callCount(), 0);
  process.env.TELEGRAM_RESUMO_VENDAS_AGENDAMENTO_ATIVO = 'true';
  assert.equal(resumo.iniciarAgendamentoResumoVendas(), true);
  assert.equal(resumo.iniciarAgendamentoResumoVendas(), false);
  assert.equal(agendar.mock.callCount(), 1);
});
