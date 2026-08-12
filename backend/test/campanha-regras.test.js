const test = require('node:test');
const assert = require('node:assert/strict');

const campanhaController = require('../src/controllers/campanha.controller');
const Campanha = require('../src/models/Campanha');
const {
  campanhaVisivelParaUsuario,
  calcularValorCampanha,
  dataValidaISO,
  intervaloCampanha,
  itensElegiveisCampanha,
  validarCampanha
} = campanhaController.__testables;
const { intervaloCiclo } = require('../src/database/migrations/20260812130000_add_periodo_fixo_campanhas')._internals;
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

test('mantem encerrada apenas quando atingida e ainda nao resgatada', () => {
  const campanha = { data_inicio: '2026-08-01', data_fim: '2026-08-10', target: 5 };
  assert.equal(campanhaVisivelParaUsuario(campanha, 4, false, '2026-08-11'), false);
  assert.equal(campanhaVisivelParaUsuario(campanha, 5, false, '2026-08-11'), true);
  assert.equal(campanhaVisivelParaUsuario(campanha, 5, true, '2026-08-11'), false);
  assert.equal(campanhaVisivelParaUsuario({ ...campanha, data_inicio: '2026-08-12' }, 0, false, '2026-08-11'), true);
});

test('detecta somente alteracoes nas datas bloqueadas por resgate', () => {
  const atual = { data_inicio: '2026-08-01', data_fim: '2026-08-31' };
  assert.equal(periodoFoiAlterado(atual, { ...atual, target: 20 }), false);
  assert.equal(periodoFoiAlterado(atual, { ...atual, data_fim: '2026-09-01' }), true);
});
