const test = require('node:test');
const assert = require('node:assert/strict');

const campanhaController = require('../src/controllers/campanha.controller');
const Campanha = require('../src/models/Campanha');
const {
  campanhaPodeSerResgatada,
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
const { normalizarRegras, periodoFoiAlterado } = Campanha._internals;

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

test('filtra chips novos, portabilidades ou ambos dentro da mesma venda', () => {
  const venda = {
    cliente_da_base: false,
    valor_total: 180,
    valores_unitarios_chips: [item(2, 'novo', 1, 50), item(1, 'portabilidade', 1, 80)]
  };
  const regra = tipo_chip => [{ operadora_id: 1, publico_base: 'ambos', tipo: 'categoria', tipo_chip }];

  assert.equal(calcularValorCampanha({ categoria: 'valor_monetario', regras: regra('novo') }, [venda], []), 100);
  assert.equal(calcularValorCampanha({ categoria: 'valor_monetario', regras: regra('portabilidade') }, [venda], []), 80);
  assert.equal(calcularValorCampanha({ categoria: 'valor_monetario', regras: regra('ambos') }, [venda], []), 180);
  assert.equal(calcularValorCampanha({ categoria: 'venda', regras: regra('portabilidade') }, [venda], []), 1);
  assert.equal(calcularValorCampanha({
    categoria: 'valor_monetario',
    regras: [{ operadora_id: 1, publico_base: 'ambos', tipo: 'novo_portabilidade', tipo_chip: 'ambos' }]
  }, [venda], []), 180);
});

test('quantidade de chip soma os itens conforme as regras de elegibilidade', () => {
  const vendas = [{
    cliente_da_base: false,
    valores_unitarios_chips: [
      item(2, 'novo', 1),
      item(3, 'portabilidade', 1),
      item(4, 'novo', 2)
    ]
  }];
  const campanha = tipo_chip => ({
    categoria: 'quantidade_chip',
    regras: [{ operadora_id: 1, publico_base: 'nao_base', tipo: 'categoria', tipo_chip }]
  });

  assert.equal(calcularValorCampanha(campanha('novo'), vendas, []), 2);
  assert.equal(calcularValorCampanha(campanha('portabilidade'), vendas, []), 3);
  assert.equal(calcularValorCampanha(campanha('ambos'), vendas, []), 5);
  assert.equal(calcularValorCampanha({
    categoria: 'quantidade_chip',
    regras: [{ operadora_id: 1, publico_base: 'nao_base', tipo: 'chip_novo', tipo_chip: 'novo' }]
  }, vendas, []), 2);
});

test('mantem ambos como padrao e nao duplica itens atendidos por regras diferentes', () => {
  const venda = {
    cliente_da_base: false,
    valores_unitarios_chips: [item(2, 'novo', 1), item(3, 'portabilidade', 1)]
  };
  const campanha = {
    categoria: 'valor_monetario',
    regras: [
      { operadora_id: 1, publico_base: 'ambos', tipo: 'categoria' },
      { operadora_id: 1, publico_base: 'ambos', tipo: 'categoria', tipo_chip: 'novo' }
    ]
  };

  assert.equal(itensElegiveisCampanha(campanha, venda).length, 2);
  assert.equal(calcularValorCampanha(campanha, [venda], []), 250);
});

test('normaliza tipo de chip e sincroniza tipos considerados restritivos', () => {
  assert.deepEqual(normalizarRegras({ regras: [
    { operadora_id: null, publico_base: 'ambos', tipo: 'categoria' },
    { operadora_id: 1, publico_base: 'base', tipo: 'chip_novo', tipo_chip: 'portabilidade' },
    { operadora_id: 2, publico_base: 'nao_base', tipo: 'portabilidade', tipo_chip: 'novo' },
    { operadora_id: 3, publico_base: 'ambos', tipo: 'novo_portabilidade', tipo_chip: 'novo' }
  ] }, 'venda', [], 'ambos'), [
    { operadora_id: null, publico_base: 'ambos', tipo: 'categoria', tipo_chip: 'ambos' },
    { operadora_id: 1, publico_base: 'base', tipo: 'chip_novo', tipo_chip: 'novo' },
    { operadora_id: 2, publico_base: 'nao_base', tipo: 'portabilidade', tipo_chip: 'portabilidade' },
    { operadora_id: 3, publico_base: 'ambos', tipo: 'novo_portabilidade', tipo_chip: 'ambos' }
  ]);
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
  assert.equal(validarCampanha({ ...base, regras: [{ operadora_id: null, publico_base: 'ambos', tipo: 'categoria', tipo_chip: 'novo' }] }), null);
  assert.match(validarCampanha({ ...base, regras: [{ operadora_id: null, publico_base: 'ambos', tipo: 'categoria', tipo_chip: 'invalido' }] }), /regra de elegibilidade inválida/i);
  assert.equal(validarCampanha({ ...base, categoria: 'quantidade_chip' }), null);
  assert.match(validarCampanha({ ...base, categoria: 'outros', categoria_personalizada: '' }), /categoria personalizada/i);
  assert.equal(validarCampanha({ ...base, categoria: 'outros', categoria_personalizada: 'Seguro' }), null);
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

test('permite resgate posterior de campanha encerrada que atingiu a meta', () => {
  const campanha = { data_inicio: '2026-08-01', data_fim: '2026-08-10', target: 5 };
  assert.equal(campanhaPodeSerResgatada(campanha, 5, false, '2026-08-11'), true);
  assert.equal(campanhaPodeSerResgatada(campanha, 4, false, '2026-08-11'), false);
  assert.equal(campanhaPodeSerResgatada(campanha, 5, true, '2026-08-11'), false);
});

test('rejeita exclusao de campanha encerrada com conflito', async () => {
  const deleteOriginal = Campanha.deleteById;
  let statusCode;
  let resposta;
  let hojeRecebido;
  Campanha.deleteById = async (_id, hoje) => {
    hojeRecebido = hoje;
    const erro = new Error('Campanhas encerradas são mantidas no histórico e não podem ser excluídas.');
    erro.code = 'CAMPANHA_ENCERRADA';
    throw erro;
  };

  const res = {
    status(code) { statusCode = code; return this; },
    json(payload) { resposta = payload; return this; }
  };

  try {
    await campanhaController.destroy({ params: { id: '12' } }, res);
  } finally {
    Campanha.deleteById = deleteOriginal;
  }

  assert.ok(hojeRecebido instanceof Date);
  assert.equal(statusCode, 409);
  assert.match(resposta.error, /histórico/i);
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

test('distribui a quantidade de chips elegiveis entre as vendedoras', () => {
  const campanha = {
    categoria: 'quantidade_chip',
    regras: [{ operadora_id: 1, publico_base: 'ambos', tipo: 'categoria', tipo_chip: 'ambos' }]
  };
  const vendas = [{
    vendedora_id: 10,
    valores_unitarios_chips: [
      { ...item(2, 'novo', 1), vendedora_id: 10 },
      { ...item(3, 'portabilidade', 1), vendedora_id: 20 },
      { ...item(4, 'novo', 2), vendedora_id: 20 }
    ]
  }];

  assert.deepEqual(calcularContribuicoesCampanha(campanha, vendas, [], [{ id: 10 }, { id: 20 }]), {
    10: 2,
    20: 3
  });
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
  assert.equal(calcularValorCampanha({ ...base, categoria: 'quantidade_chip' }, [venda], []), 5);
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

test('excecao de quantidade de chip credita todos os itens aos respectivos vendedores', () => {
  const campanha = { categoria: 'quantidade_chip', regras: [{ operadora_id: 99, publico_base: 'base', tipo: 'internet' }] };
  const venda = {
    __excecao: true,
    vendedora_id: 10,
    valores_unitarios_chips: [
      { ...item(2, 'novo', 1), vendedora_id: 10 },
      { ...item(3, 'portabilidade', 2), vendedora_id: 30 }
    ]
  };

  assert.deepEqual(calcularContribuicoesCampanha(campanha, [venda], [], [{ id: 10 }]), {
    10: 2,
    30: 3
  });
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


test('futuros clientes contam por operadora e autor, sem vendas de exceção', () => {
  const campanha = { categoria: 'registro_futuro_cliente', regras: [{ operadora_id: 2 }] };
  const clientes = [
    { id: 1, operadora_atual_id: 2, criado_por_id: 10 },
    { id: 2, operadora_atual_id: 2, criado_por_id: 20 },
    { id: 3, operadora_atual_id: 1, criado_por_id: 10 }
  ];
  const vendas = [{ id: 9, __excecao: true, vendedora_id: 10 }];
  assert.equal(calcularValorCampanha(campanha, vendas, clientes), 2);
  assert.deepEqual(calcularContribuicoesCampanha(campanha, vendas, clientes, [10, 20]), { 10: 1, 20: 1 });
  assert.deepEqual(montarVendasContabilizadas(campanha, vendas), []);
  assert.deepEqual(normalizarRegras({ regras: [{ operadora_id: 2, publico_base: 'base', tipo: 'chip_novo' }] },
    'registro_futuro_cliente', [], 'base'), [{ operadora_id: 2, publico_base: 'ambos', tipo: 'categoria', tipo_chip: 'ambos' }]);
});

test('valida horários completos, intervalo crescente e proíbe exceções em futuros clientes', () => {
  const campanha = { desc: 'Registrar', target: 2, periodo: 'personalizado', categoria: 'registro_futuro_cliente',
    data_inicio: '2026-10-06', data_fim: '2026-10-06' };
  assert.equal(validarCampanha(campanha), null);
  assert.equal(validarCampanha({ ...campanha, hora_inicio: '14:00', hora_fim: '18:00' }), null);
  for (const horas of [{ hora_inicio: '14:00' }, { hora_fim: '18:00' },
    { hora_inicio: '24:00', hora_fim: '18:00' }, { hora_inicio: '14:60', hora_fim: '18:00' },
    { hora_inicio: '14:00', hora_fim: '14:00' }, { hora_inicio: '18:00', hora_fim: '14:00' }]) {
    assert.ok(validarCampanha({ ...campanha, ...horas }));
  }
  assert.ok(validarCampanha({ ...campanha, venda_excecao_ids: [1] }));
  assert.equal(validarCampanha({ ...campanha, data_fim: '2026-10-07', hora_inicio: '22:00', hora_fim: '02:00' }), null);
});

test('horários usam São Paulo, início inclusivo e fim exclusivo', () => {
  const campanha = { data_inicio: '2026-10-06', data_fim: '2026-10-06', hora_inicio: '14:00', hora_fim: '18:00' };
  assert.equal(intervaloCampanha(campanha, new Date('2026-10-06T16:59:59Z')).estado, 'futura');
  assert.equal(intervaloCampanha(campanha, new Date('2026-10-06T17:00:00Z')).estado, 'ativa');
  assert.equal(intervaloCampanha(campanha, new Date('2026-10-06T20:59:59Z')).estado, 'ativa');
  const encerrada = intervaloCampanha(campanha, new Date('2026-10-06T21:00:00Z'));
  assert.equal(encerrada.estado, 'encerrada');
  assert.equal(encerrada.inicioUTC, '2026-10-06 17:00:00');
  assert.equal(encerrada.fimUTC, '2026-10-06 21:00:00');
  assert.equal(campanhaPodeSerResgatada(campanha, 5, false, new Date('2026-10-06T16:59:59Z')), false);
  const noturna = { ...campanha, data_fim: '2026-10-07', hora_inicio: '22:00', hora_fim: '02:00' };
  assert.equal(intervaloCampanha(noturna, new Date('2026-10-07T03:00:00Z')).estado, 'ativa');
  assert.equal(intervaloCampanha(noturna, new Date('2026-10-07T05:00:00Z')).estado, 'encerrada');
  assert.equal(periodoFoiAlterado(campanha, { ...campanha, hora_fim: '19:00' }), true);
  assert.equal(periodoFoiAlterado(campanha, { ...campanha, target: 5 }), false);
});

test('consultas usam primeiro registro e timestamps UTC; campanhas legadas mantêm datas de venda', async () => {
  const db = require('../src/database/connection');
  const { listarFuturosClientesDaCampanha, listarVendasDaCampanha, listarClientesDaCampanha } = campanhaController.__testables;
  const original = db.client.runner;
  const consultas = [];
  db.client.runner = builder => ({ run: async () => { consultas.push(builder.toSQL()); return []; } });
  try {
    const campanha = { data_inicio: '2026-10-06', data_fim: '2026-10-06', hora_inicio: '14:00', hora_fim: '18:00' };
    const ciclo = intervaloCampanha(campanha, new Date('2026-10-06T22:00:00Z'));
    await listarFuturosClientesDaCampanha([10], ciclo);
    assert.match(consultas[0].sql, /`ll`\.`futuro_cliente` = .*`ll`\.`futuro_cliente_excluido_em` is null/);
    assert.match(consultas[0].sql, /`ll`\.`futuro_cliente_primeiro_registro_por_id` in/);
    assert.match(consultas[0].sql, /`futuro_cliente_primeiro_registro_em` >= .*`futuro_cliente_primeiro_registro_em` </);
    assert.ok(consultas[0].bindings.includes('2026-10-06 17:00:00'));
    assert.ok(consultas[0].bindings.includes('2026-10-06 21:00:00'));
    await listarVendasDaCampanha([10], ciclo);
    assert.match(consultas[1].sql, /v.created_at >= .*v.created_at </);
    assert.doesNotMatch(consultas[1].sql, /COALESCE.*data_venda/);
    await listarClientesDaCampanha([10], ciclo);
    assert.match(consultas[2].sql, /created_at >= .*created_at </);
    await listarVendasDaCampanha([10], intervaloCampanha({ ...campanha, hora_inicio: null, hora_fim: null }, '2026-10-06'));
    assert.match(consultas[3].sql, /COALESCE.*data_venda/);
    assert.ok(consultas[3].bindings.includes('2026-10-07'));
  } finally { db.client.runner = original; }
});


test('persiste horários na criação e atualização e bloqueia alteração após resgate', async () => {
  const db = require('../src/database/connection');
  const originais = { runner: db.client.runner, transaction: Object.getOwnPropertyDescriptor(db, 'transaction'), findAll: Campanha.findAll,
    syncFiltros: Campanha.syncFiltros, syncParticipantes: Campanha.syncParticipantes, syncVendasExcecao: Campanha.syncVendasExcecao };
  let gravada;
  let temResgate = false;
  Object.defineProperty(db, 'transaction', { configurable: true, value: async executar => executar(db) });
  db.client.runner = builder => ({ run: async () => {
    const tabela = builder._single.table;
    if (builder._method === 'insert') { gravada = { ...builder._single.insert, id: 99 }; return [99]; }
    if (builder._method === 'update') { gravada = { ...gravada, ...builder._single.update }; return 1; }
    if (tabela === 'campanhas') return gravada;
    if (tabela === 'campanha_resgates') return temResgate ? { id: 1 } : undefined;
    return [];
  } });
  Campanha.findAll = async () => [gravada];
  Campanha.syncFiltros = Campanha.syncParticipantes = Campanha.syncVendasExcecao = async () => {};
  try {
    const campanha = { desc: 'Registrar', target: 2, categoria: 'registro_futuro_cliente',
      data_inicio: '2026-10-06', data_fim: '2026-10-06', hora_inicio: '14:00', hora_fim: '18:00' };
    const criada = await Campanha.create(campanha);
    assert.equal(criada.categoria, 'registro_futuro_cliente');
    assert.equal(criada.hora_inicio, '14:00');
    assert.equal(criada.hora_fim, '18:00');
    await Campanha.updateAll([{ ...campanha, id: 99, hora_fim: '19:00' }]);
    assert.equal(gravada.hora_fim, '19:00');
    temResgate = true;
    await assert.rejects(Campanha.updateAll([{ ...campanha, id: 99 }]), { code: 'CAMPANHA_PERIODO_BLOQUEADO' });
    assert.equal(gravada.hora_fim, '19:00');
    await assert.rejects(Campanha.deleteById(99, new Date('2026-10-06T22:00:00Z')), { code: 'CAMPANHA_ENCERRADA' });
  } finally {
    db.client.runner = originais.runner;
    Object.defineProperty(db, 'transaction', originais.transaction);
    for (const chave of ['findAll', 'syncFiltros', 'syncParticipantes', 'syncVendasExcecao']) Campanha[chave] = originais[chave];
  }
});

test('prévia conserva os horários editados e calcula o ranking de futuros clientes', async () => {
  const db = require('../src/database/connection');
  const original = db.client.runner;
  db.client.runner = builder => ({ run: async () => {
    if (builder._single.table === 'usuarios') return [{ id: 10, nome: 'Ana' }, { id: 20, nome: 'Bia' }];
    if (builder._single.table === 'lead_linhas as ll') return [
      { id: 1, operadora_atual_id: 2, criado_por_id: 10 }, { id: 2, operadora_atual_id: 2, criado_por_id: 10 },
      { id: 3, operadora_atual_id: 2, criado_por_id: 20 }
    ];
    return [];
  } });
  try {
    const previa = await campanhaController.__testables.montarPreviaCampanha({
      desc: 'Futuros', target: 3, periodo: 'personalizado', categoria: 'registro_futuro_cliente',
      data_inicio: '2026-10-06', data_fim: '2026-10-06', participante_ids: [10, 20], regras: [{ operadora_id: null, publico_base: 'ambos', tipo: 'categoria' }]
    }, { hora_inicio: '14:00', hora_fim: '18:00' });
    assert.equal(previa.hora_inicio, '14:00');
    const calculo = await campanhaController.__testables.calcularCampanhaColetiva(previa, new Date('2026-10-06T22:00:00Z'));
    assert.equal(calculo.current, 3);
    assert.equal(calculo.achieved, true);
    assert.deepEqual(calculo.contribuicoes, { 10: 2, 20: 1 });
    assert.equal(calculo.ranking[0].id, 10);
  } finally { db.client.runner = original; }
});
