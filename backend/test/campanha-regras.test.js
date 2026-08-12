const test = require('node:test');
const assert = require('node:assert/strict');

const campanhaController = require('../src/controllers/campanha.controller');
const Campanha = require('../src/models/Campanha');
const {
  campanhaVisivelParaUsuario,
  calcularContribuicoesCampanha,
  calcularValorCampanha,
  dataValidaISO,
  intervaloCampanha,
  itensElegiveisCampanha,
  montarRanking,
  montarVendasContabilizadas,
  unirVendasCampanha,
  validarCampanha
} = campanhaController.__testables;
const { intervaloCiclo } = require('../src/database/migrations/20260812130000_add_periodo_fixo_campanhas')._internals;
const { montarVinculos } = require('../src/database/migrations/20260812140000_materialize_campanha_participantes')._internals;
const { periodoFoiAlterado } = Campanha._internals;

const item = (quantidade, tipo_linha, operadora_id, valor_unitario = 50) => ({
  quantidade, tipo_linha, operadora_id, valor_unitario
});

test('combina regras de operadora, base e portabilidade com semantica OU', () => {
  const campanha = {
    categoria: 'venda',
    regras: [
      { operadora_id: 1, publico_base: 'base', tipo: 'categoria' },
      { operadora_id: 2, publico_base: 'nao_base', tipo: 'categoria' },
      { operadora_id: 2, publico_base: 'ambos', tipo: 'portabilidade' }
    ]
  };
  const vendas = [
    { cliente_da_base: true, valores_unitarios_chips: [item(1, 'novo', 1)] },
    { cliente_da_base: false, valores_unitarios_chips: [item(1, 'novo', 2)] },
    { cliente_da_base: true, valores_unitarios_chips: [item(1, 'portabilidade', 2)] },
    { cliente_da_base: true, valores_unitarios_chips: [item(1, 'novo', 2)] }
  ];

  assert.equal(calcularValorCampanha(campanha, vendas, []), 3);
});

test('uma venda atendida por mais de uma regra conta uma unica vez na campanha', () => {
  const campanha = {
    categoria: 'venda',
    regras: [
      { operadora_id: 1, publico_base: 'base', tipo: 'categoria' },
      { operadora_id: 2, publico_base: 'ambos', tipo: 'portabilidade' }
    ]
  };
  const venda = {
    cliente_da_base: true,
    valores_unitarios_chips: [item(1, 'novo', 1), item(2, 'portabilidade', 2)]
  };

  assert.equal(itensElegiveisCampanha(campanha, venda).length, 2);
  assert.equal(calcularValorCampanha(campanha, [venda], []), 1);
});

test('a mesma venda contribui independentemente para campanhas diferentes', () => {
  const venda = { cliente_da_base: false, valores_unitarios_chips: [item(1, 'novo', 2)] };
  const geral = { categoria: 'venda', regras: [{ operadora_id: null, publico_base: 'ambos', tipo: 'categoria' }] };
  const vivo = { categoria: 'venda', regras: [{ operadora_id: 2, publico_base: 'ambos', tipo: 'categoria' }] };

  assert.equal(calcularValorCampanha(geral, [venda], []), 1);
  assert.equal(calcularValorCampanha(vivo, [venda], []), 1);
});

test('soma somente linhas e valores dos itens elegiveis', () => {
  const venda = {
    cliente_da_base: false,
    valor_total: 250,
    valores_unitarios_chips: [item(2, 'portabilidade', 2, 40), item(3, 'portabilidade', 1, 30)]
  };
  const regraVivo = [{ operadora_id: 2, publico_base: 'ambos', tipo: 'categoria' }];

  assert.equal(calcularValorCampanha({ categoria: 'portabilidade', regras: regraVivo }, [venda], []), 2);
  assert.equal(calcularValorCampanha({ categoria: 'valor_monetario', regras: regraVivo }, [venda], []), 80);
});

test('usa campos legados quando a venda nao possui itens detalhados', () => {
  const campanha = {
    categoria: 'portabilidade',
    regras: [{ operadora_id: 2, publico_base: 'nao_base', tipo: 'categoria' }]
  };
  const venda = {
    operadora_id: 2,
    cliente_da_base: false,
    tipo_venda: 'Portabilidade',
    quantidade_linhas: 4,
    valores_unitarios_chips: null
  };

  assert.equal(calcularValorCampanha(campanha, [venda], []), 4);
});

test('registro de cliente ignora base e filtra operadora pelas regras', () => {
  const campanha = {
    categoria: 'registro_cliente',
    regras: [{ operadora_id: 1, publico_base: 'ambos', tipo: 'categoria' }]
  };

  assert.equal(calcularValorCampanha(campanha, [], [
    { operadora_atual_id: 1 },
    { operadora_atual_id: 2 }
  ]), 1);
});

test('migra ciclos atuais para intervalos inclusivos', () => {
  assert.deepEqual(intervaloCiclo('diaria', '2026-08-09'), { data_inicio: '2026-08-09', data_fim: '2026-08-09' });
  assert.deepEqual(intervaloCiclo('semanal', '2026-08-09'), { data_inicio: '2026-08-03', data_fim: '2026-08-09' });
  assert.deepEqual(intervaloCiclo('mensal', '2026-02-15'), { data_inicio: '2026-02-01', data_fim: '2026-02-28' });
});

test('materializa todos os usuarios ativos nas campanhas sem participantes', () => {
  assert.deepEqual(montarVinculos([5, 8], [10, 20]), [
    { campanha_id: 5, usuario_id: 10 },
    { campanha_id: 5, usuario_id: 20 },
    { campanha_id: 8, usuario_id: 10 },
    { campanha_id: 8, usuario_id: 20 }
  ]);
});

test('valida datas reais e ordem do periodo fixo', () => {
  const base = {
    periodo: 'personalizado', categoria: 'venda', target: 1, desc: 'Campanha',
    data_inicio: '2026-08-01', data_fim: '2026-08-31', regras: []
  };
  assert.equal(validarCampanha(base), null);
  assert.equal(dataValidaISO('2026-02-29'), false);
  assert.match(validarCampanha({ ...base, data_fim: '2026-02-29' }), /datas inicial e final válidas/i);
  assert.match(validarCampanha({ ...base, data_inicio: '2026-09-01' }), /anterior ou igual/i);
});

test('resolve estados e transforma fim inclusivo em limite exclusivo', () => {
  const campanha = { data_inicio: '2026-08-10', data_fim: '2026-08-20' };
  assert.equal(intervaloCampanha(campanha, '2026-08-09').estado, 'futura');
  assert.deepEqual(intervaloCampanha(campanha, '2026-08-20'), {
    periodo: 'personalizado', inicioStr: '2026-08-10', fimInclusivoStr: '2026-08-20',
    fimStr: '2026-08-21', estado: 'ativa'
  });
  assert.equal(intervaloCampanha(campanha, '2026-08-21').estado, 'encerrada');
});

test('mantem campanhas encerradas e resgatadas visiveis como historico', () => {
  const campanha = { data_inicio: '2026-08-01', data_fim: '2026-08-10', target: 5 };
  assert.equal(campanhaVisivelParaUsuario(campanha, 4, false, '2026-08-11'), true);
  assert.equal(campanhaVisivelParaUsuario(campanha, 5, false, '2026-08-11'), true);
  assert.equal(campanhaVisivelParaUsuario(campanha, 5, true, '2026-08-11'), true);
  assert.equal(campanhaVisivelParaUsuario({ ...campanha, data_inicio: '2026-08-12' }, 0, false, '2026-08-11'), true);
});

test('distribui itens compartilhados por vendedora e fecha com o total coletivo', () => {
  const campanha = {
    categoria: 'valor_monetario',
    regras: [{ operadora_id: null, publico_base: 'ambos', tipo: 'categoria' }]
  };
  const vendas = [{
    id: 1,
    vendedora_id: 10,
    cliente_da_base: false,
    valores_unitarios_chips: [
      { ...item(2, 'novo', 1, 50), vendedora_id: 10 },
      { ...item(1, 'portabilidade', 2, 80), vendedora_id: 20 }
    ]
  }];
  const participantes = [{ id: 10, nome: 'Ana' }, { id: 20, nome: 'Bia' }];
  const contribuicoes = calcularContribuicoesCampanha(campanha, vendas, [], participantes);
  const ranking = montarRanking(participantes, contribuicoes);

  assert.deepEqual(contribuicoes, { 10: 100, 20: 80 });
  assert.equal(ranking.reduce((soma, pessoa) => soma + pessoa.contribuicao, 0), 180);
  assert.deepEqual(ranking.map(pessoa => pessoa.id), [10, 20]);
});

test('atribui venda geral somente a vendedora principal', () => {
  const campanha = { categoria: 'venda', regras: [{ operadora_id: null, publico_base: 'ambos', tipo: 'categoria' }] };
  const venda = {
    vendedora_id: 10,
    valores_unitarios_chips: [{ ...item(1, 'novo', 1), vendedora_id: 20 }]
  };
  assert.deepEqual(calcularContribuicoesCampanha(campanha, [venda], [], [{ id: 10 }, { id: 20 }]), {
    10: 1,
    20: 0
  });
});

test('atribui registros ao criador e compartilha a mesma posicao em empate', () => {
  const campanha = { categoria: 'registro_cliente', regras: [{ operadora_id: null, publico_base: 'ambos', tipo: 'categoria' }] };
  const participantes = [{ id: 10, nome: 'Ana' }, { id: 20, nome: 'Bia' }, { id: 30, nome: 'Caio' }];
  const contribuicoes = calcularContribuicoesCampanha(campanha, [], [
    { criado_por_id: 10 }, { criado_por_id: 20 }
  ], participantes);
  const ranking = montarRanking(participantes, contribuicoes);

  assert.deepEqual(ranking.map(itemRanking => [itemRanking.id, itemRanking.contribuicao, itemRanking.posicao]), [
    [10, 1, 1], [20, 1, 1], [30, 0, 3]
  ]);
});

test('excecao ignora regras e usa a metrica integral de cada categoria', () => {
  const venda = {
    id: 90,
    __excecao: true,
    vendedora_id: 30,
    cliente_da_base: false,
    valor_total: 250,
    valores_unitarios_chips: [item(2, 'novo', 1, 50), item(3, 'portabilidade', 2, 50)]
  };
  const base = { regras: [{ operadora_id: 99, publico_base: 'base', tipo: 'internet' }] };

  assert.equal(calcularValorCampanha({ ...base, categoria: 'registro_cliente' }, [venda], []), 1);
  assert.equal(calcularValorCampanha({ ...base, categoria: 'venda' }, [venda], []), 1);
  assert.equal(calcularValorCampanha({ ...base, categoria: 'outros', categoria_personalizada: 'Seguro' }, [venda], []), 1);
  assert.equal(calcularValorCampanha({ ...base, categoria: 'chip_novo' }, [venda], []), 5);
  assert.equal(calcularValorCampanha({ ...base, categoria: 'portabilidade' }, [venda], []), 5);
  assert.equal(calcularValorCampanha({ ...base, categoria: 'internet' }, [venda], []), 5);
  assert.equal(calcularValorCampanha({ ...base, categoria: 'valor_monetario' }, [venda], []), 250);
});

test('excecao substitui a venda regular sem duplicar e credita vendedor externo', () => {
  const regular = { id: 7, vendedora_id: 10, valores_unitarios_chips: [item(1, 'novo', 1)] };
  const excecao = {
    id: 7,
    vendedora_id: 30,
    valor_total: 200,
    valores_unitarios_chips: [{ ...item(2, 'portabilidade', 2, 100), vendedora_id: 30 }]
  };
  const vendas = unirVendasCampanha([regular], [excecao]);
  const campanha = { categoria: 'venda', regras: [{ operadora_id: 1, publico_base: 'ambos', tipo: 'categoria' }] };
  const contribuicoes = calcularContribuicoesCampanha(campanha, vendas, [], [{ id: 10 }]);
  const ranking = montarRanking([{ id: 10, nome: 'Ana' }, { id: 30, nome: 'Externo' }], contribuicoes);

  assert.equal(vendas.length, 1);
  assert.equal(vendas[0].__excecao, true);
  assert.deepEqual(contribuicoes, { 10: 0, 30: 1 });
  assert.equal(ranking[0].id, 30);
});

test('lista somente vendas que efetivamente contabilizam na campanha', () => {
  const campanha = { categoria: 'valor_monetario', regras: [{ operadora_id: 2, publico_base: 'ambos', tipo: 'categoria' }] };
  const vendas = [
    {
      id: 10, cliente_nome: 'Cliente elegível', vendedora_nome: 'Ana', operadora_nome: 'Vivo',
      data_contabilizada: '2026-08-12', valor_total: 150, cliente_da_base: false,
      valores_unitarios_chips: [item(2, 'novo', 2, 50), item(1, 'novo', 1, 50)]
    },
    {
      id: 11, cliente_nome: 'Cliente fora da regra', cliente_da_base: false,
      valores_unitarios_chips: [item(1, 'novo', 1, 90)]
    }
  ];

  assert.deepEqual(montarVendasContabilizadas(campanha, vendas), [{
    id: 10,
    cliente_nome: 'Cliente elegível',
    vendedora_nome: 'Ana',
    operadora_nome: 'Vivo',
    data_venda: '2026-08-12',
    valor_total: 150,
    contribuicao: 100,
    excecao: false
  }]);
});

test('venda comum nao contribui para campanha de registro de clientes', () => {
  const campanha = {
    categoria: 'registro_cliente',
    regras: [{ operadora_id: null, publico_base: 'ambos', tipo: 'categoria' }]
  };
  const vendaRegular = { id: 20, vendedora_id: 10, valores_unitarios_chips: [item(1, 'novo', 1)] };
  const vendaExcecao = { ...vendaRegular, id: 21, __excecao: true };

  assert.deepEqual(montarVendasContabilizadas(campanha, [vendaRegular]), []);
  assert.equal(montarVendasContabilizadas(campanha, [vendaExcecao])[0].id, 21);
});

test('detecta somente alteracoes nas datas bloqueadas por resgate', () => {
  const atual = { data_inicio: '2026-08-01', data_fim: '2026-08-31' };
  assert.equal(periodoFoiAlterado(atual, { ...atual, target: 20 }), false);
  assert.equal(periodoFoiAlterado(atual, { ...atual, data_fim: '2026-09-01' }), true);
});
