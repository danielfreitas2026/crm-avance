const test = require('node:test');
const assert = require('node:assert/strict');

const vendaService = require('../src/services/venda.service');

const {
  adicionarMesesDataISO,
  aplicarDadosClienteNaVenda,
  filtrarVendasRelatorioPorVendedora,
  montarDadosSincronizacaoClienteVenda,
  montarAtribuicoesVendedorasVenda,
  montarPayload,
  normalizarData,
  validarDataVendaNaoFutura,
  normalizarItensChips,
  vendaDeveNotificarTelegram,
  obterDataLimiteConcluidaAntiga,
  obterTipoLinhaPorNomeTipoVenda,
  obterQuantidadeChipsVenda,
  obterUltimaAtividadeFunil,
  parseValorMonetario,
  validarVendedorasNosChips,
  vendaDeveAparecerNoFunil
} = vendaService._internals;

test('normaliza datas validas e rejeita datas invalidas', () => {
  assert.equal(normalizarData('2026-05-18'), '2026-05-18');
  assert.equal(normalizarData('18/05/2026'), '2026-05-18');
  assert.equal(normalizarData('18/05/26'), '2026-05-18');
  assert.equal(normalizarData('2026-02-31'), null);
  assert.equal(normalizarData('1899-12-31'), null);
});

test('impede data de venda futura considerando o fuso de Sao Paulo', () => {
  const agora = new Date('2026-08-05T02:00:00.000Z');

  assert.doesNotThrow(() => validarDataVendaNaoFutura('2026-08-04', agora));
  assert.doesNotThrow(() => validarDataVendaNaoFutura('2026-08-03', agora));
  assert.throws(() => validarDataVendaNaoFutura('2026-08-05', agora), /não pode ser futura/i);
});

test('notifica Telegram apenas para vendas com no maximo dois dias de atraso', () => {
  const agora = new Date('2026-08-05T15:00:00.000Z');

  assert.equal(vendaDeveNotificarTelegram({ data_venda: '2026-08-05' }, agora), true);
  assert.equal(vendaDeveNotificarTelegram({ data_venda: '2026-08-03' }, agora), true);
  assert.equal(vendaDeveNotificarTelegram({ data_venda: '2026-08-02' }, agora), false);
  assert.equal(vendaDeveNotificarTelegram({ data_venda: '2026-08-10' }, agora), true);
  assert.equal(vendaDeveNotificarTelegram({}, agora), true);
});

test('converte valores monetarios brasileiros e numericos', () => {
  assert.equal(parseValorMonetario('R$ 1.234,56'), 1234.56);
  assert.equal(parseValorMonetario('99,90'), 99.9);
  assert.equal(parseValorMonetario(120.5), 120.5);
  assert.equal(parseValorMonetario(''), 0);
});

test('normaliza chips de array, JSON e texto legado', () => {
  assert.deepEqual(normalizarItensChips([
    { quantidade: '2', gb: '25GB', tipo_linha: 'Portabilidade', valor_unitario: '59,90', operadora_atual_id: '3', operadora_atual_nome: 'TIM', operadora_id: '5', operadora_nome: 'Claro', vendedora_id: '7' },
    { quantidade: 0, gb: '10', valor_unitario: 20 }
  ]), [
    { quantidade: 2, gb: '25', tipo_linha: 'portabilidade', valor_unitario: 59.9, operadora_atual_id: 3, operadora_atual_nome: 'TIM', operadora_id: 5, operadora_nome: 'Claro', vendedora_id: 7 }
  ]);

  assert.deepEqual(normalizarItensChips(JSON.stringify([
    { quantidade: 1, gb: '15', tipo: 'Novo', valor_unitario: 45 }
  ])), [
    { quantidade: 1, gb: '15', tipo_linha: 'novo', valor_unitario: 45 }
  ]);

  assert.deepEqual(normalizarItensChips('2x49,90\n1 x 39.90'), [
    { quantidade: 2, gb: '', tipo_linha: 'novo', valor_unitario: 49.9 },
    { quantidade: 1, gb: '', tipo_linha: 'novo', valor_unitario: 39.9 }
  ]);
});

test('mapeia tipo de venda para fallback dos chips exibidos na tabela', () => {
  assert.equal(obterTipoLinhaPorNomeTipoVenda('Novo'), 'novo');
  assert.equal(obterTipoLinhaPorNomeTipoVenda('Portabilidade'), 'portabilidade');
  assert.equal(obterTipoLinhaPorNomeTipoVenda('Venda especial'), '');
});

test('monta payload calculando totais, gb, datas e prioridade', () => {
  const payload = montarPayload({
    nome: '  Cliente Teste  ',
    quantidade_linhas: '3',
    prioridade_funil: 'urgente',
    data_venda: '18/05/2026',
    data_ativacao: '',
    numeros_ativados: '11999990000',
    valores_unitarios_chips: [
      { quantidade: 2, gb: '25GB', tipo_linha: 'Novo', valor_unitario: '59,90', operadora_atual_id: 2, operadora_id: 5, operadora_nome: 'Claro' },
      { quantidade: 1, gb: '50', tipo_linha: 'Portabilidade', valor_unitario: '79,90', operadora_atual_id: 3, operadora_id: 6, operadora_nome: 'TIM' }
    ],
    cliente_solicitou_servicos: ['bloqueio'],
    cliente_solicitou_bloqueio_qtd: '1',
    cliente_solicitou_numeros: { bloqueio: ['11999990000'], cancelamento: ['11888880000'] },
    cliente_solicitou_resolvido: 'sim',
    cliente_solicitou_resolvido_em: '18/05/2026',
    cliente_solicitou_protocolo_atendimento: '  ABC123  '
  });

  assert.equal(payload.nome, 'Cliente Teste');
  assert.equal(payload.quantidade_linhas, 3);
  assert.equal(payload.prioridade_funil, 'media');
  assert.equal(payload.data_venda, '2026-05-18');
  assert.equal(payload.data_ativacao, null);
  assert.equal(payload.numeros_ativados, null);
  assert.equal(payload.valor_total, 199.7);
  assert.equal(payload.gb, '25, 50');
  assert.deepEqual(
    JSON.parse(payload.valores_unitarios_chips).map(item => item.operadora_atual_id),
    [2, 3]
  );
  assert.deepEqual(
    JSON.parse(payload.valores_unitarios_chips).map(item => item.operadora_id),
    [5, 6]
  );
  assert.equal(payload.cliente_solicitou_bloqueio_qtd, 1);
  assert.deepEqual(JSON.parse(payload.cliente_solicitou_numeros), {
    bloqueio: ['11999990000'],
    cancelamento: []
  });
  assert.equal(payload.cliente_solicitou_resolvido_em, '2026-05-18');
  assert.equal(payload.cliente_solicitou_protocolo_atendimento, 'ABC123');
});

test('montarPayload impede mais chips do que linhas fechadas', () => {
  assert.throws(() => montarPayload({
    quantidade_linhas: 1,
    valores_unitarios_chips: [{ quantidade: 2, valor_unitario: 50 }]
  }), /quantidade de chips/i);
});

test('valida vendedoras atribuidas nos chips em venda compartilhada', () => {
  assert.doesNotThrow(() => validarVendedorasNosChips({
    valores_unitarios_chips: [
      { quantidade: 1, valor_unitario: 50, vendedora_id: 10 },
      { quantidade: 1, valor_unitario: 50, vendedora_id: 11 }
    ]
  }, [10, 11]));

  assert.throws(() => validarVendedorasNosChips({
    valores_unitarios_chips: [{ quantidade: 1, valor_unitario: 50, vendedora_id: 12 }]
  }, [10, 11]), /vendedoras selecionadas/i);

  assert.throws(() => validarVendedorasNosChips({
    valores_unitarios_chips: [{ quantidade: 1, valor_unitario: 50, vendedora_id: 10 }]
  }, [10, 11]), /pelo menos um chip/i);
});

test('aplica dados do cliente sem sobrescrever campos ja preenchidos', () => {
  const payload = aplicarDadosClienteNaVenda({ nome: 'Venda Manual' }, {
    nome: 'Cliente Base',
    razao_social: 'Razao Base',
    cnpj: '11222333000181',
    email: 'cliente@test.local',
    whatsapp_ddd: '11',
    whatsapp_numero: '999990000',
    responsavel_tipo: 'rl',
    responsavel_nome: 'Responsavel Legal'
  });

  assert.equal(payload.nome, 'Venda Manual');
  assert.equal(payload.razao_social, 'Razao Base');
  assert.equal(payload.telefone, '11999990000');
  assert.equal(payload.nome_representante_legal, 'Responsavel Legal');
  assert.equal(payload.email_representante_legal, 'cliente@test.local');
});

test('aplica operadora atual do cliente casando com operadora da venda', () => {
  const payload = aplicarDadosClienteNaVenda({ operadora_id: 7 }, {
    nome: 'Cliente Multi',
    responsavel_tipo: 'adm',
    operadoras_atuais: [
      { operadora_id: 5 },
      { operadora_id: 7 }
    ]
  });

  assert.equal(payload.operadora_atual_id, 7);

  const manual = aplicarDadosClienteNaVenda({ operadora_id: 7, operadora_atual_id: 9 }, {
    nome: 'Cliente Multi',
    responsavel_tipo: 'adm',
    operadoras_atuais: [{ operadora_id: 7 }]
  });

  assert.equal(manual.operadora_atual_id, 9);
});

test('obtem quantidade de chips com fallback para quantidade de linhas ou 1', () => {
  assert.equal(obterQuantidadeChipsVenda({
    valores_unitarios_chips: JSON.stringify([{ quantidade: 2 }, { quantidade: 3 }]),
    quantidade_linhas: 10
  }), 5);
  assert.equal(obterQuantidadeChipsVenda({ valores_unitarios_chips: '', quantidade_linhas: 4 }), 4);
  assert.equal(obterQuantidadeChipsVenda({}), 1);
});

test('atribui receita do ranking por vendedora de cada chip', () => {
  const usuarios = new Map([
    [1, { id: 1, nome: 'Ana', email: 'ana@test.local' }],
    [2, { id: 2, nome: 'Bia', email: 'bia@test.local' }]
  ]);

  const atribuicoes = montarAtribuicoesVendedorasVenda({
    vendedora_id: 1,
    vendedora_nome: 'Ana antiga',
    valor_total: 329.98,
    quantidade_linhas: 2,
    valores_unitarios_chips: JSON.stringify([
      { quantidade: 1, valor_unitario: 299.99, vendedora_id: 1 },
      { quantidade: 1, valor_unitario: 29.99, vendedora_id: 2 }
    ])
  }, usuarios);

  assert.deepEqual(atribuicoes, [
    { id: 1, nome: 'Ana', email: 'ana@test.local', valor: 299.99, chips: 1 },
    { id: 2, nome: 'Bia', email: 'bia@test.local', valor: 29.99, chips: 1 }
  ]);
});

test('filtra relatorio por vendedora usando apenas a receita dos chips dela', () => {
  const vendas = filtrarVendasRelatorioPorVendedora([{
    id: 18,
    vendedora_id: 1,
    vendedora_nome: 'Ana',
    valor_total: 329.98,
    quantidade_linhas: 2,
    valores_unitarios_chips: [
      { quantidade: 1, valor_unitario: 299.99, vendedora_id: 1 },
      { quantidade: 1, valor_unitario: 29.99, vendedora_id: 2 }
    ]
  }], 2, new Map([[2, { id: 2, nome: 'Bia', email: 'bia@test.local' }]]));

  assert.equal(vendas.length, 1);
  assert.equal(vendas[0].valor_total, 29.99);
  assert.equal(vendas[0].quantidade_linhas, 1);
  assert.equal(obterQuantidadeChipsVenda(vendas[0]), 1);
  assert.equal(vendas[0].vendedora_id, 2);
});

test('calcula fidelidade 24 meses apos a conclusao preservando fim de mes', () => {
  assert.equal(adicionarMesesDataISO('2026-05-19', 24), '2028-05-19');
  assert.equal(adicionarMesesDataISO('2026-02-28', 24), '2028-02-28');
  assert.equal(adicionarMesesDataISO('2026-01-31', 1), '2026-02-28');
});

test('monta sincronizacao substituindo dados da operadora vendida', () => {
  const dados = montarDadosSincronizacaoClienteVenda({
    cliente_id: 10,
    operadora_id: 5,
    operadora_atual_id: 5,
    data_ativacao: '2026-05-19',
    valor_total: '119.80',
    quantidade_linhas: 8,
    valores_unitarios_chips: JSON.stringify([
      { quantidade: 2, valor_unitario: 59.9 }
    ])
  }, '2026-05-20');

  assert.deepEqual(dados, {
    clienteId: 10,
    operadoraVendidaId: 5,
    quantidadeChips: 2,
    valorPago: 119.8,
    fidelidadeFim: '2028-05-19',
    dataBase: '2026-05-19'
  });
});

test('monta sincronizacao para adicionar operadora diferente sem remover antigas', () => {
  const dados = montarDadosSincronizacaoClienteVenda({
    cliente_id: 10,
    operadora_id: 7,
    operadora_atual_id: 5,
    valor_total: 89.9,
    quantidade_linhas: 1
  }, '2026-05-20 14:30:00');

  assert.equal(dados.operadoraVendidaId, 7);
  assert.equal(dados.quantidadeChips, 1);
  assert.equal(dados.valorPago, 89.9);
  assert.equal(dados.fidelidadeFim, '2028-05-20');
});

test('nao monta sincronizacao sem cliente ou sem operadora vendida', () => {
  assert.equal(montarDadosSincronizacaoClienteVenda({ cliente_id: 10 }), null);
  assert.equal(montarDadosSincronizacaoClienteVenda({ operadora_id: 5 }), null);
});

test('oculta venda concluida parada por duas semanas no funil', () => {
  const referencia = new Date('2026-05-18T12:00:00Z');

  assert.equal(
    obterDataLimiteConcluidaAntiga(referencia).toISOString(),
    '2026-05-04T12:00:00.000Z'
  );
  assert.equal(
    obterUltimaAtividadeFunil({
      ultima_atividade_em: null,
      updated_at: '2026-05-04 12:00:01',
      created_at: '2026-05-01 12:00:00'
    }).toISOString(),
    '2026-05-04T12:00:01.000Z'
  );

  assert.equal(vendaDeveAparecerNoFunil({
    status_funil: 'concluido',
    ultima_atividade_em: '2026-05-04 12:00:01'
  }, 'concluido', referencia), true);

  assert.equal(vendaDeveAparecerNoFunil({
    status_funil: 'concluido',
    ultima_atividade_em: '2026-05-04 12:00:00'
  }, 'concluido', referencia), false);

  assert.equal(vendaDeveAparecerNoFunil({
    status_funil: 'concluido',
    ultima_atividade_em: '2026-05-04 11:59:59'
  }, 'concluido', referencia), false);

  assert.equal(vendaDeveAparecerNoFunil({
    status_funil: 'ativacao',
    ultima_atividade_em: '2026-04-01 12:00:00'
  }, 'concluido', referencia), true);
});
