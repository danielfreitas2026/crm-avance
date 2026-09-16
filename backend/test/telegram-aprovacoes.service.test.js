const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const service = require('../src/services/telegram-aprovacoes.service');
const { _internals } = service;

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
    venda: {
      razao_social: 'Empresa Teste Ltda.',
      cnpj: '12.345.678/0001-90',
      quantidade_linhas: 8,
      valor_total: 399.2,
      vendedora: { nome: 'Ana Consultora' },
      cliente: { nome: 'Empresa Teste' }
    }
  });

  assert.match(texto, /VENDA AGUARDANDO APROVAÇÃO/);
  assert.match(texto, /Razão social: Empresa Teste Ltda\./);
  assert.match(texto, /CNPJ: 12\.345\.678\/0001-90/);
  assert.match(texto, /Quantidade de chips: 8/);
  assert.match(texto, /Receita: R\$ 399,20/);
  assert.match(texto, /Consultor\(a\): Ana Consultora/);
  assert.doesNotMatch(texto, /ID da venda:/);
  assert.match(texto, /Solicitada por: Bruno Vendas\n\nMotivos:/);
  assert.match(texto, /Cliente com venda em andamento/);
  assert.match(texto, /Venda compartilhada/);
  assert.match(texto, /Cliente possui contrato ativo/);
});

test('monta mensagem de decisão para refletir o resultado no Telegram', () => {
  const texto = _internals.montarMensagemDecisao({
    status: 'aprovada',
    decisor: { nome: 'Gestora ADM' },
    venda: { razao_social: 'Empresa Teste' }
  });

  assert.match(texto, /^✅ APROVADA por Gestora ADM/);
  assert.match(texto, /Razão social: Empresa Teste/);
});

test('identifica o membro do grupo sem exigir vínculo com usuário do CRM', () => {
  const identidade = _internals.identidadeTelegram({ id: 123, first_name: 'Ana', last_name: 'Silva', username: 'ana' });
  const chatAnterior = process.env.TELEGRAM_APROVACOES_CHAT_ID;

  assert.deepEqual(identidade, { nome: 'Ana Silva', username: '@ana', id: '123' });
  assert.equal(_internals.nomeExibicaoTelegram(identidade), 'Ana Silva @ana');
  process.env.TELEGRAM_APROVACOES_CHAT_ID = '-100123';
  try {
    assert.equal(_internals.grupoAutorizado('-100123'), true);
    assert.equal(_internals.grupoAutorizado('-100000'), false);
  } finally {
    if (chatAnterior === undefined) delete process.env.TELEGRAM_APROVACOES_CHAT_ID;
    else process.env.TELEGRAM_APROVACOES_CHAT_ID = chatAnterior;
  }
});

test('retentativa de aprovacao cresce de 30 segundos ate 30 minutos', () => {
  assert.equal(_internals.calcularAtrasoRetentativa(1), 30 * 1000);
  assert.equal(_internals.calcularAtrasoRetentativa(2), 60 * 1000);
  assert.equal(_internals.calcularAtrasoRetentativa(7), 30 * 60 * 1000);
  assert.equal(_internals.calcularAtrasoRetentativa(50), 30 * 60 * 1000);
});

test('falha ao publicar aprovacao fica registrada para nova tentativa', async () => {
  const falhas = [];
  const erroAnterior = console.error;
  console.error = () => {};
  try {
    const resultado = await _internals.processarPublicacao({ id: 42, telegram_tentativas: 1 }, {
      buscarSolicitacao: async id => ({ id, status: 'pendente', venda: {} }),
      enviar: async () => { throw new Error('Telegram indisponível'); },
      registrarFalha: async (item, error) => falhas.push({ item, error }),
      registrarSucesso: async () => assert.fail('não deveria registrar sucesso')
    });

    assert.equal(resultado.falhou, true);
    assert.equal(falhas.length, 1);
    assert.match(falhas[0].error.message, /indisponível/);
  } finally {
    console.error = erroAnterior;
  }
});

test('worker recupera aprovacoes pendentes que ficaram sem mensagem', async () => {
  const tokenAnterior = process.env.TELEGRAM_APROVACOES_BOT_TOKEN;
  const chatAnterior = process.env.TELEGRAM_APROVACOES_CHAT_ID;
  process.env.TELEGRAM_APROVACOES_BOT_TOKEN = 'token-teste';
  process.env.TELEGRAM_APROVACOES_CHAT_ID = '-100123';

  const fila = [
    { id: 41, telegram_tentativas: 1 },
    { id: 42, telegram_tentativas: 2 }
  ];
  const enviadas = [];
  try {
    const resultado = await service.processarPublicacoesPendentes({
      reivindicar: async () => fila.shift() || null,
      buscarSolicitacao: async id => ({ id, status: 'pendente', venda: {} }),
      enviar: async solicitacao => ({ message_id: solicitacao.id + 100 }),
      registrarSucesso: async (item, publicacao) => enviadas.push({ item, publicacao }),
      registrarFalha: async () => assert.fail('não deveria registrar falha')
    });

    assert.deepEqual(resultado, { processadas: 2, enviadas: 2, falhas: 0, ignoradas: 0 });
    assert.deepEqual(enviadas.map(item => item.item.id), [41, 42]);
  } finally {
    if (tokenAnterior === undefined) delete process.env.TELEGRAM_APROVACOES_BOT_TOKEN;
    else process.env.TELEGRAM_APROVACOES_BOT_TOKEN = tokenAnterior;
    if (chatAnterior === undefined) delete process.env.TELEGRAM_APROVACOES_CHAT_ID;
    else process.env.TELEGRAM_APROVACOES_CHAT_ID = chatAnterior;
  }
});

test('claim compartilhado impede publicar a mesma aprovacao duas vezes', async () => {
  const tokenAnterior = process.env.TELEGRAM_APROVACOES_BOT_TOKEN;
  const chatAnterior = process.env.TELEGRAM_APROVACOES_CHAT_ID;
  process.env.TELEGRAM_APROVACOES_BOT_TOKEN = 'token-teste';
  process.env.TELEGRAM_APROVACOES_CHAT_ID = '-100123';

  let disponivel = true;
  let envios = 0;
  const opcoes = {
    reivindicar: async () => {
      if (!disponivel) return null;
      disponivel = false;
      return { id: 42, telegram_tentativas: 1 };
    },
    buscarSolicitacao: async id => ({ id, status: 'pendente', venda: {} }),
    enviar: async () => { envios += 1; return { message_id: 142 }; },
    registrarSucesso: async () => {}
  };
  try {
    const resultados = await Promise.all([
      service.notificarSolicitacaoPendente(42, opcoes),
      service.notificarSolicitacaoPendente(42, opcoes)
    ]);

    assert.equal(envios, 1);
    assert.equal(resultados.filter(item => item.enviado).length, 1);
  } finally {
    if (tokenAnterior === undefined) delete process.env.TELEGRAM_APROVACOES_BOT_TOKEN;
    else process.env.TELEGRAM_APROVACOES_BOT_TOKEN = tokenAnterior;
    if (chatAnterior === undefined) delete process.env.TELEGRAM_APROVACOES_CHAT_ID;
    else process.env.TELEGRAM_APROVACOES_CHAT_ID = chatAnterior;
  }
});

test('migration adiciona metadados duraveis para reconciliar aprovacoes', () => {
  const arquivo = path.join(
    __dirname,
    '../src/database/migrations/20260915120000_add_telegram_retry_to_venda_aprovacoes.js'
  );
  const conteudo = fs.readFileSync(arquivo, 'utf8');

  assert.match(conteudo, /telegram_tentativas/);
  assert.match(conteudo, /telegram_proxima_tentativa_em/);
  assert.match(conteudo, /telegram_ultimo_erro/);
  assert.match(conteudo, /idx_venda_aprovacao_telegram_fila/);
});

test('servidor agenda reconciliacao periodica das aprovacoes no Telegram', () => {
  const conteudo = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
  assert.match(conteudo, /telegramAprovacoesService\.processarPublicacoesPendentes\(\)/);
  assert.match(conteudo, /setInterval\(processarAprovacoesTelegram, 30 \* 1000\)/);
});
