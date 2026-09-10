const test = require('node:test');
const assert = require('node:assert/strict');

const fechamentoService = require('../src/services/fechamento.service');

const {
  agregarPorOperadora,
  categoriaServico,
  classificarSecao,
  encontrarRegraComissao,
  gigasUnitarios,
  montarColunasXlsxVendasPeriodo,
  montarLinhasExportacaoVenda,
  montarLinhasChips,
  montarRespostaLinhasChips,
  parseChips,
  parseNumerosLinha,
  quantidadeChipsPorTipo,
  quantidadeChipsVenda,
  tipoVendaNormalizado
} = fechamentoService._internals;

test('normaliza categorias de servico e tipo de venda', () => {
  assert.equal(categoriaServico('Telefonia Móvel'), 'movel');
  assert.equal(categoriaServico('Internet'), 'internet');
  assert.equal(categoriaServico('Servico desconhecido'), null);
  assert.equal(tipoVendaNormalizado('Portabilidade'), 'portabilidade');
  assert.equal(tipoVendaNormalizado('Novo'), 'novo');
});

test('parseia chips e numeros em formatos aceitos', () => {
  assert.deepEqual(parseChips(JSON.stringify([
    { quantidade: '2', gb: '25', tipo_linha: 'Portabilidade', valor_unitario: '59.90', vendedora_id: '4' }
  ])), [
    { quantidade: 2, gb: '25', tipo_linha: 'portabilidade', valor_unitario: 59.9, vendedora_id: 4 }
  ]);

  assert.deepEqual(parseNumerosLinha('11999990000, 11888880000\n11777770000'), [
    '11999990000',
    '11888880000',
    '11777770000'
  ]);
});

test('distribui gigas por chip com total, lista e fallback', () => {
  assert.deepEqual(gigasUnitarios('25', 2), ['25GB', '25GB']);
  assert.deepEqual(gigasUnitarios('10 + 20', 2), ['10GB', '20GB']);
  assert.deepEqual(gigasUnitarios('10 + 20', 3), ['10GB', '10GB', '10GB']);
  assert.deepEqual(gigasUnitarios('', 2, '15'), ['15GB', '15GB']);
});

test('seleciona regra de comissao especifica por operadora antes da generica', () => {
  const regras = [
    { id: 1, valor_min: 0, valor_max: 100, valor_comissao: 10, operadora_id: null },
    { id: 2, valor_min: 0, valor_max: 100, valor_comissao: 20, operadora_id: 5 }
  ];

  assert.equal(encontrarRegraComissao(regras, 59.9, 5).id, 2);
  assert.equal(encontrarRegraComissao(regras, 59.9, 6).id, 1);
  assert.equal(encontrarRegraComissao(regras, 150, 5), null);
});

test('calcula quantidade de chips total e por tipo', () => {
  const venda = {
    quantidade_linhas: 10,
    tipo_venda_nome: 'Novo',
    valores_unitarios_chips: JSON.stringify([
      { quantidade: 2, tipo_linha: 'novo', valor_unitario: 50 },
      { quantidade: 1, tipo_linha: 'portabilidade', valor_unitario: 60 }
    ])
  };

  assert.equal(quantidadeChipsVenda(venda), 3);
  assert.equal(quantidadeChipsPorTipo(venda, 'novo'), 2);
  assert.equal(quantidadeChipsPorTipo(venda, 'portabilidade'), 1);
  assert.equal(quantidadeChipsVenda({ quantidade_linhas: 4 }), 4);
});

test('posiciona classificacao do cliente depois do CNPJ na planilha do fechamento', () => {
  const colunas = montarColunasXlsxVendasPeriodo();
  const indiceCnpj = colunas.findIndex(coluna => coluna.key === 'cnpj');

  assert.equal(colunas[indiceCnpj + 1].key, 'classificacao_cliente');
  assert.equal(colunas[indiceCnpj + 1].header, 'CLASSIFICAÇÃO DO CLIENTE');
  assert.equal(colunas[indiceCnpj + 2].key, 'cidade');
});

test('repete classificacao do cliente nas linhas desdobradas do fechamento', () => {
  const venda = {
    id: 10,
    cliente_da_base: false,
    valores_unitarios_chips: JSON.stringify([
      { quantidade: 1, tipo_linha: 'novo', valor_unitario: 50, vendedora_id: 1 },
      { quantidade: 1, tipo_linha: 'portabilidade', valor_unitario: 60, vendedora_id: 2 }
    ]),
    vendedoras: [{ id: 1, nome: 'Ana' }, { id: 2, nome: 'Bia' }]
  };

  const linhas = montarLinhasExportacaoVenda(venda);

  assert.equal(linhas.length, 2);
  assert.deepEqual(linhas.map(linha => linha.classificacao_cliente), [
    'Cliente fora da base',
    'Cliente fora da base'
  ]);
  assert.equal(montarLinhasExportacaoVenda({ ...venda, cliente_da_base: true })[0].classificacao_cliente, 'Cliente base');
  assert.equal(montarLinhasExportacaoVenda({ ...venda, cliente_da_base: null })[0].classificacao_cliente, '');
});

test('monta linhas de chips com regras, bases e vendedoras', () => {
  const vendas = [{
    id: 10,
    nome: 'Cliente A',
    razao_social: 'Cliente A LTDA',
    status_funil: 'concluido',
    data_venda: '2026-05-10',
    data_ativacao: '2026-05-12',
    valor_total: 119.8,
    valores_unitarios_chips: JSON.stringify([
      { quantidade: 1, gb: '25', tipo_linha: 'novo', valor_unitario: 59.9, operadora_atual_id: 6, operadora_atual_nome: 'Vivo', vendedora_id: 1 },
      { quantidade: 1, gb: '25', tipo_linha: 'portabilidade', valor_unitario: 59.9, operadora_atual_id: 5, operadora_atual_nome: 'Claro', operadora_id: 6, operadora_nome: 'Vivo', vendedora_id: 2 }
    ]),
    numeros_ativados: '11999990000\n11888880000',
    numeros_portados: '11777770000',
    operadora_id: 5,
    operadora_nome: 'Claro',
    cliente_id: 20,
    cliente_nome: 'Cliente A',
    cliente_base_anterior_sistema: true,
    cliente_operadora_atual_id: 6,
    cliente_operadora_atual_nome: 'Vivo',
    cliente_operadoras_ids: '6,5',
    vendedoras: [
      { id: 1, nome: 'Ana', email: 'ana@test.local' },
      { id: 2, nome: 'Bia', email: 'bia@test.local' }
    ]
  }];
  const regras = [{
    id: 7,
    operadora_id: 5,
    operadora_nome: 'Claro',
    valor_min: 0,
    valor_max: 100,
    valor_comissao: 30,
    valor_comissao_base: 20,
    valor_comissao_base_propria: 15,
    prioridade_base_dupla: 'base_operadora'
  }, {
    id: 8,
    operadora_id: 6,
    operadora_nome: 'Vivo',
    valor_min: 0,
    valor_max: 100,
    valor_comissao: 40,
    valor_comissao_base: 25,
    valor_comissao_base_propria: 18,
    prioridade_base_dupla: 'base_operadora'
  }];

  const linhas = montarLinhasChips(vendas, regras);

  assert.equal(linhas.length, 2);
  assert.equal(linhas[0].comissao, 20);
  assert.equal(linhas[0].tipo_comissao, 'base_operadora');
  assert.equal(linhas[0].tipo_repasse, 'base_propria_operadora');
  assert.equal(linhas[0].cliente.operadora_atual.id, 6);
  assert.equal(linhas[0].cliente.operadora_atual.nome, 'Vivo');
  assert.equal(linhas[0].vendedora.nome, 'Ana');
  assert.equal(linhas[1].cliente.operadora_atual.id, 5);
  assert.equal(linhas[1].operadora.id, 6);
  assert.equal(linhas[1].operadora.nome, 'Vivo');
  assert.equal(linhas[1].comissao, 25);
  assert.equal(linhas[1].vendedora.nome, 'Bia');
  assert.equal(linhas[1].numero_ativado, '11888880000');
});

test('divide totais da mesma venda entre operadoras de destino', () => {
  const venda = {
    status_funil: 'concluido',
    servico_nome: 'Telefonia Movel',
    operadora_id: 5,
    operadora_nome: 'Claro',
    valores_unitarios_chips: JSON.stringify([
      { quantidade: 1, tipo_linha: 'novo', valor_unitario: 59.9 },
      { quantidade: 1, tipo_linha: 'portabilidade', valor_unitario: 59.9, operadora_id: 6, operadora_nome: 'Vivo' }
    ])
  };
  const resumo = agregarPorOperadora([venda]);

  assert.equal(resumo.total.length, 2);
  assert.deepEqual(
    resumo.total.map(item => ({ id: item.operadora_id, chips: item.novo + item.portabilidade, receita: item.receita })),
    [
      { id: 5, chips: 1, receita: 59.9 },
      { id: 6, chips: 1, receita: 59.9 }
    ]
  );
});

test('monta totais de chips por vendedora e total geral', () => {
  const resposta = montarRespostaLinhasChips([
    { valor_unitario: 50, comissao: 20, sem_regra: false, vendedora: { id: 1, nome: 'Ana' } },
    {
      valor_unitario: 80,
      comissao: 40,
      sem_regra: false,
      vendedoras: [{ id: 1, nome: 'Ana' }, { id: 2, nome: 'Bia' }]
    },
    { valor_unitario: 30, comissao: null, sem_regra: true, vendedora: { id: 3, nome: 'Carla' } }
  ]);

  assert.equal(resposta.total_geral.chips, 3);
  assert.equal(resposta.total_geral.valor, 160);
  assert.equal(resposta.total_geral.comissao, 60);
  assert.equal(resposta.total_geral.ugrs_sem_regra, 1);
  assert.deepEqual(resposta.totais_por_vendedora, [
    { vendedora_id: 1, vendedora_nome: 'Ana', total_ugrs: 1.5, total_comissao: 40 },
    { vendedora_id: 2, vendedora_nome: 'Bia', total_ugrs: 0.5, total_comissao: 20 }
  ]);
});

test('classifica secoes do fechamento', () => {
  assert.equal(classificarSecao('concluido', 'concluido'), 'ativas');
  assert.equal(classificarSecao('ativacao', 'concluido'), 'tratando');
  assert.equal(classificarSecao('retorno', 'concluido'), null);
});
