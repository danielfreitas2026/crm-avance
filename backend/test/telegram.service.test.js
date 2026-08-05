const test = require('node:test');
const assert = require('node:assert/strict');
const { enviarVenda, _internals } = require('../src/services/telegram.service');

test('monta notificacao de futuro cliente com dados da sondagem e responsavel pelo cadastro', () => {
  const texto = _internals.montarMensagemFuturoCliente({
    futuro_cliente_marcado_em: '2026-07-15T12:00:00.000Z',
    futuro_cliente_retorno: '2026-07-20T15:30:00.000Z',
    sondagem: {
      razao_social: 'Empresa Teste LTDA', cnpj: '12.345.678/0001-90', contato_nome: 'Maria', contato_tipo: 'adm',
      melhor_numero_contato: '11999998888', whatsapp_ddd: '11', whatsapp_numero: '999998888', telefone_fixo: '1133334444', terminal: '11988887777', operadoraAtual: { nome: 'Claro' }, operadoraInteresse: { nome: 'Vivo' },
      chips_itens: [{ quantidade: 2, preco_por_chip: 49.9 }], valor_mensal_estimado: 99.8,
      usuario: { nome: 'Consultor Teste' }, observacoes: 'Retornar na proxima semana'
    }
  });

  assert.match(texto, /Empresa: Empresa Teste LTDA/);
  assert.match(texto, /WhatsApp: \(11\) 99999-8888/);
  assert.match(texto, /Fixo: \(11\) 3333-4444/);
  assert.match(texto, /Terminal: \(11\) 98888-7777/);
  assert.match(texto, /Melhor número para contato: \(11\) 99999-8888/);
  assert.match(texto, /Operadora atual: Claro/);
  assert.match(texto, /Operadora de interesse: Vivo/);
  assert.match(texto, /Valor mensal estimado: R\$\s?99,80/);
  assert.match(texto, /Data do contato: 15\/07\/2026/);
  assert.match(texto, /Cadastro feito por: Consultor Teste/);
});

test('monta notificacao de venda destacando origem na sondagem da primeira ligacao', () => {
  const texto = _internals.montarMensagemVenda({
    id: 42,
    nome: 'Empresa Teste',
    razao_social: 'Empresa Teste LTDA',
    cnpj: '12.345.678/0001-90',
    telefone: '11999998888',
    email: 'contato@empresa.test',
    origem_lead_linha_id: 15,
    origemSondador: { nome: 'Ana Sondadora' },
    vendedoras: [{ nome: 'Beatriz Vendedora' }],
    criador: { nome: 'Carlos Operador' },
    operadora: { nome: 'Claro' },
    tipoProduto: { nome: 'Móvel' },
    tipoVenda: { nome: 'Portabilidade' },
    servico: { nome: 'Plano empresarial' },
    quantidade_linhas: 2,
    cliente_da_base: true,
    possui_doc_na_casa: false,
    endereco: 'Rua de Teste',
    login: 'portal-teste',
    senha: 'senha-teste',
    valores_unitarios_chips: JSON.stringify([
      { quantidade: 2, gb: '30', tipo_linha: 'portabilidade', valor_unitario: 59.9 }
    ]),
    valor_total: 119.8,
    data_venda: '2026-07-29',
    protocolo: 'ABC123',
    observacoes: 'Venda confirmada'
  });

  assert.match(texto, /Origem: Sondagem da primeira ligação/);
  assert.match(texto, /Primeira ligação realizada por: Ana Sondadora/);
  assert.match(texto, /Vendedora\(s\): Beatriz Vendedora/);
  assert.match(texto, /Quantidade: 2/);
  assert.match(texto, /Franquia: 30 GB/);
  assert.match(texto, /Valor total: R\$\s?119,80/);
  assert.match(texto, /Classificação do cliente: Cliente da base/);
  assert.match(texto, /Possui documentação na casa: Não/);
  assert.match(texto, /Endereço: Rua de Teste/);
  assert.match(texto, /Login do portal: portal-teste/);
  assert.match(texto, /Senha do portal: senha-teste/);
});

test('usa chats distintos para resumo e novas vendas', () => {
  const resumoAnterior = process.env.TELEGRAM_RESUMO_VENDAS_CHAT_ID;
  const vendasAnterior = process.env.TELEGRAM_VENDAS_CHAT_ID;
  process.env.TELEGRAM_RESUMO_VENDAS_CHAT_ID = '-1001';
  process.env.TELEGRAM_VENDAS_CHAT_ID = '-1002';

  try {
    assert.equal(_internals.obterChatId('TELEGRAM_RESUMO_VENDAS_CHAT_ID'), '-1001');
    assert.equal(_internals.obterChatId('TELEGRAM_VENDAS_CHAT_ID'), '-1002');
  } finally {
    if (resumoAnterior === undefined) delete process.env.TELEGRAM_RESUMO_VENDAS_CHAT_ID;
    else process.env.TELEGRAM_RESUMO_VENDAS_CHAT_ID = resumoAnterior;
    if (vendasAnterior === undefined) delete process.env.TELEGRAM_VENDAS_CHAT_ID;
    else process.env.TELEGRAM_VENDAS_CHAT_ID = vendasAnterior;
  }
});

test('nao considera uma venda enviada quando o bot ou o grupo nao estao configurados', async () => {
  const tokenAnterior = process.env.TELEGRAM_BOT_TOKEN;
  const vendasAnterior = process.env.TELEGRAM_VENDAS_CHAT_ID;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_VENDAS_CHAT_ID;

  try {
    assert.deepEqual(await enviarVenda({ id: 1 }), {
      enviado: false,
      motivo: 'telegram_nao_configurado'
    });
  } finally {
    if (tokenAnterior === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = tokenAnterior;
    if (vendasAnterior === undefined) delete process.env.TELEGRAM_VENDAS_CHAT_ID;
    else process.env.TELEGRAM_VENDAS_CHAT_ID = vendasAnterior;
  }
});

test('identifica claramente uma mensagem de teste de venda', () => {
  const texto = _internals.montarMensagemVenda({
    mensagem_teste: true,
    nome: 'Empresa fictícia'
  });

  assert.match(texto, /^🧪 TESTE — VENDA LOCAL/);
});

test('divide venda completa em mensagens dentro do limite do Telegram sem perder dados', () => {
  const mensagens = _internals.montarMensagensVenda({
    id: 55,
    nome: 'Empresa extensa',
    observacoes: 'X'.repeat(8500)
  });

  assert.ok(mensagens.length >= 3);
  assert.ok(mensagens.every(mensagem => mensagem.length <= 4096));
  assert.equal(mensagens.join('').match(/X/g).length, 8500);
});
