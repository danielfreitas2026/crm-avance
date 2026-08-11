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
