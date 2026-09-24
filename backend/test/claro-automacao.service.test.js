const test = require('node:test');
const assert = require('node:assert/strict');
const automacao = require('../src/services/automacao-email.service');
const claroImap = require('../src/services/claro-imap.service');
const AutomacaoEmail = require('../src/models/AutomacaoEmail');
const Venda = require('../src/models/Venda');
const FunilEtapa = require('../src/models/FunilEtapa');
const vendaFunilAutomacaoService = require('../src/services/venda-funil-automacao.service');

function instalarConsultas(vendas, etapas, onGraph) {
  const queryVendaOriginal = Venda.query;
  const queryEtapaOriginal = FunilEtapa.query;
  Venda.query = () => ({
    alias() { return this; }, join() { return this; }, leftJoin() { return this; }, select() { return this; },
    whereRaw() { return this; }, whereNull() { return this; }, whereNotNull() { return this; },
    withGraphFetched: async grafo => { onGraph?.(grafo); return vendas; }
  });
  FunilEtapa.query = () => {
    const consulta = {
      filtros: null,
      where(filtros) { this.filtros = filtros; return this; },
      orderBy() { return this; },
      findOne: async filtros => etapas.find(etapa => etapa.codigo === filtros.codigo) || null,
      then(resolve, reject) {
        const resultado = this.filtros?.etapa_final
          ? etapas.filter(etapa => etapa.etapa_final)
          : etapas.filter(etapa => etapa.ativo !== false && (!this.filtros?.aceite_biometria || etapa.aceite_biometria));
        return Promise.resolve(resultado).then(resolve, reject);
      }
    };
    return consulta;
  };
  return () => { Venda.query = queryVendaOriginal; FunilEtapa.query = queryEtapaOriginal; };
}

const etapas = [
  { codigo: 'analise', nome: 'Análise', ordem: 1, ativo: true },
  { codigo: 'aceite', nome: 'Aceite/Biometria', ordem: 2, ativo: true, aceite_biometria: true },
  { codigo: 'pedido', nome: 'Pedido na operadora', ordem: 3, ativo: true },
  { codigo: 'sms', nome: 'Confirmação SMS Portabilidade', ordem: 4, ativo: true },
  { codigo: 'final', nome: 'Final', ordem: 5, ativo: true, etapa_final: true }
];

function venda(id, extras = {}) {
  return {
    id, nome: 'Empresa Ágil', razao_social: 'Empresa Ágil Ltda', status_funil: 'analise',
    criado_em: '2026-09-01 10:00:00', enviada_pos_venda_em: '2026-09-01 11:00:00',
    excluido_em: null, cancelada_em: null, cliente: null, operadora: { nome: 'Claro' }, ...extras
  };
}

test('consulta de candidatas Claro retorna os detalhes reais e preserva os bloqueios', async () => {
  const queryAutomacaoOriginal = AutomacaoEmail.query;
  let grafoConsultado;
  const restaurar = instalarConsultas([
    venda(627, {
      data_venda: '2026-09-10', valor_total: 149.8, quantidade_linhas: 2,
      valores_unitarios_chips: JSON.stringify([{ quantidade: 2, tipo_linha: 'novo', valor_unitario: 74.9 }]),
      vendedora: { id: 3, nome: 'Consultora A' },
      vendedoras: [{ id: 3, nome: 'Consultora A' }, { id: 4, nome: 'Consultora B' }],
      criador: { id: 7, nome: 'Gerente' }
    }),
    venda(733, { valor_total: 0, tipoVenda: { nome: 'Portabilidade' }, cancelada_automacao_em: '2026-09-20' })
  ], etapas, grafo => { grafoConsultado = grafo; });
  AutomacaoEmail.query = () => ({ findById: async () => ({
    id: 268, origem: 'imap_claro', recebido_em: '2026-09-22 12:00:00',
    dados_extraidos: JSON.stringify({ empresa: 'Empresa Ágil Ltda' })
  }) });
  try {
    const resultado = await automacao.listarVendasCandidatas(268);
    assert.match(grafoConsultado, /vendedora, vendedoras, criador/);
    assert.equal(resultado.empresa, 'Empresa Ágil Ltda');
    assert.deepEqual(resultado.vendas.map(item => item.id), [627, 733]);
    assert.equal(resultado.vendas[0].data_venda, '2026-09-10');
    assert.equal(resultado.vendas[0].valor_total, 149.8);
    assert.equal(resultado.vendas[0].quantidade_linhas, 2);
    assert.deepEqual(resultado.vendas[0].vendedores, [
      { id: 3, nome: 'Consultora A' }, { id: 4, nome: 'Consultora B' }
    ]);
    assert.deepEqual(resultado.vendas[0].criador, { id: 7, nome: 'Gerente' });
    assert.equal(resultado.vendas[0].tipo_venda, 'Novo');
    assert.deepEqual(resultado.vendas[0].chips, [{ quantidade: 2, tipo_linha: 'novo', valor_unitario: 74.9 }]);
    assert.equal(resultado.vendas[0].elegivel, true);
    assert.equal(resultado.vendas[1].valor_total, 0);
    assert.equal(resultado.vendas[1].tipo_venda, 'Portabilidade');
    assert.deepEqual(resultado.vendas[1].chips, []);
    assert.equal(resultado.vendas[1].elegivel, false);
    assert.deepEqual(resultado.vendas[1].inelegibilidades, ['venda cancelada no Funil de Automações']);
  } finally {
    AutomacaoEmail.query = queryAutomacaoOriginal;
    restaurar();
  }
});

test('vínculo Claro exige uma única venda ativa, anterior ao e-mail e com nome normalizado exato', async () => {
  let restaurar = instalarConsultas([venda(1)], etapas);
  try {
    const unica = await automacao._internals.resolverVendaClaro(
      { origem: 'imap_claro', recebido_em: '2026-09-22 12:00:00' },
      { empresa: ' EMPRESA AGIL ' }
    );
    assert.equal(unica.venda.id, 1);
  } finally { restaurar(); }

  restaurar = instalarConsultas([venda(1), venda(2)], etapas);
  try {
    const duplicada = await automacao._internals.resolverVendaClaro(
      { origem: 'imap_claro', recebido_em: '2026-09-22 12:00:00' },
      { empresa: 'Empresa Ágil' }
    );
    assert.equal(duplicada.venda, null);
    assert.match(duplicada.erro, /Mais de uma venda Claro elegível/);
    const manual = await automacao._internals.resolverVendaClaro(
      { origem: 'imap_claro', recebido_em: '2026-09-22 12:00:00', revisado_por_id: 7, venda_id: 2 },
      { empresa: 'Empresa Ágil' }
    );
    assert.equal(manual.venda.id, 2);
    assert.equal(manual.candidatas.find(item => item.id === 2).manual, true);
  } finally { restaurar(); }

  restaurar = instalarConsultas([venda(1, { criado_em: '2026-09-23 10:00:00' })], etapas);
  try {
    const anterior = await automacao._internals.resolverVendaClaro(
      { origem: 'imap_claro', recebido_em: '2026-09-22 12:00:00' },
      { empresa: 'Empresa Ágil' }
    );
    assert.equal(anterior.venda, null);
  } finally { restaurar(); }

  restaurar = instalarConsultas([venda(1), venda(2, { excluido_em: '2026-09-20' })], etapas);
  try {
    const unica = await automacao._internals.resolverVendaClaro(
      { recebido_em: '2026-09-22 12:00:00' }, { empresa: 'Empresa Ágil Ltda' }
    );
    assert.equal(unica.venda.id, 1);
    assert.deepEqual(unica.candidatas.find(item => item.id === 2).inelegibilidades, ['venda excluída']);
  } finally { restaurar(); }
});

test('venda de outra operadora ou encerrada não bloqueia a única Claro elegível, mas duas elegíveis exigem revisão', async () => {
  const registro = { recebido_em: '2026-09-22 12:00:00' };
  const campos = { empresa: 'SIMPLICIUS COLETA E REMOCAO DE RESIDUOS LTDA' };
  const base = (id, extras = {}) => venda(id, { razao_social: campos.empresa, ...extras });
  let restaurar = instalarConsultas([
    base(658, { operadora: { nome: 'Vivo' }, status_funil: 'final' }), base(723)
  ], etapas);
  try {
    const resultado = await automacao._internals.resolverVendaClaro(registro, campos);
    assert.equal(resultado.venda.id, 723);
    assert.equal(resultado.erro, null);
    assert.deepEqual(resultado.candidatas.find(item => item.id === 658).inelegibilidades,
      ['operadora diferente de Claro', 'venda concluída no Funil de Automações']);
  } finally { restaurar(); }

  restaurar = instalarConsultas([
    base(658, { operadora: { nome: 'Vivo' } }), base(723), base(724), base(725)
  ], etapas);
  try {
    const resultado = await automacao._internals.resolverVendaClaro(registro, campos);
    assert.equal(resultado.venda, null);
    assert.match(resultado.erro, /Mais de uma venda Claro elegível/);
    assert.equal(resultado.candidatas.filter(item => item.elegivel).length, 3);
  } finally { restaurar(); }

  restaurar = instalarConsultas([
    base(356, { cancelada_automacao_em: '2026-09-20' }), base(627), base(73)
  ], etapas);
  try {
    const resultado = await automacao._internals.resolverVendaClaro(registro, campos);
    assert.equal(resultado.venda, null);
    assert.equal(resultado.candidatas.filter(item => item.elegivel).length, 2);
    assert.deepEqual(resultado.candidatas.find(item => item.id === 356).inelegibilidades,
      ['venda cancelada no Funil de Automações']);
  } finally { restaurar(); }
});

test('razão social higienizada do email identifica somente a venda Claro correspondente', async () => {
  const restaurar = instalarConsultas([
    venda(11, { nome: 'Nome fantasia', razao_social: 'Camisária-Barreto, Ltda.' }),
    venda(12, { nome: 'Outra empresa', razao_social: 'Camisaria Barreto Serviços Ltda' })
  ], etapas);
  try {
    const encontrada = await automacao._internals.resolverVendaClaro(
      { recebido_em: '2026-09-22 12:00:00' },
      { empresa: 'CAMISARIA BARRETO LTDA' }
    );
    assert.equal(encontrada.venda.id, 11);
    const ausente = await automacao._internals.resolverVendaClaro(
      { recebido_em: '2026-09-22 12:00:00' },
      { empresa: 'CAMISARIA BARRETO S/A' }
    );
    assert.equal(ausente.venda, null);
    assert.match(ausente.erro, /Não foi encontrada/);
  } finally { restaurar(); }
});

test('Claro aceita razão social contida em outra razão completa após higienização', async () => {
  const registro = { recebido_em: '2026-09-22 12:00:00' };
  const consultar = async (vendas, empresa) => {
    const restaurar = instalarConsultas(vendas, etapas);
    try { return await automacao._internals.resolverVendaClaro(registro, { empresa }); }
    finally { restaurar(); }
  };

  const curta = 'ALFHA AMBIENTAL SOLUCOES E SERVICOS LTDA';
  const longa = 'GRUPO ALFHA AMBIENTAL SOLUÇÕES E SERVIÇOS LTDA';
  assert.equal((await consultar([venda(1, { razao_social: longa })], curta)).venda.id, 1);
  assert.equal((await consultar([venda(2, { razao_social: curta })], longa)).venda.id, 2);

  const duplicada = await consultar([
    venda(3, { razao_social: longa }),
    venda(4, { razao_social: `${curta} FILIAL` })
  ], curta);
  assert.equal(duplicada.venda, null);
  assert.equal(duplicada.candidatas.filter(item => item.elegivel).length, 2);
  assert.match(duplicada.erro, /Mais de uma venda Claro elegível/);

  const exata = await consultar([
    venda(5, { razao_social: curta }),
    venda(6, { razao_social: longa })
  ], curta);
  assert.equal(exata.venda.id, 5);
  assert.deepEqual(exata.candidatas.map(item => item.id), [5]);
});

test('Claro não vincula por fragmento de palavra ou nome genérico e audita candidata contida inelegível', async () => {
  const registro = { recebido_em: '2026-09-22 12:00:00' };
  const consultar = async (vendas, empresa) => {
    const restaurar = instalarConsultas(vendas, etapas);
    try { return await automacao._internals.resolverVendaClaro(registro, { empresa }); }
    finally { restaurar(); }
  };

  assert.equal((await consultar([venda(1, { razao_social: 'ALFHA AMBIENTALISTA LTDA' })], 'ALFHA AMBIENTAL')).venda, null);
  assert.equal((await consultar([venda(2, { razao_social: 'GRUPO XYZ LTDA' })], 'XYZ LTDA')).venda, null);

  const inelegivel = await consultar([
    venda(3, { razao_social: 'GRUPO ALFHA AMBIENTAL LTDA', operadora: { nome: 'Vivo' } })
  ], 'ALFHA AMBIENTAL LTDA');
  assert.equal(inelegivel.venda, null);
  assert.match(inelegivel.candidatas[0].inelegibilidades.join(' '), /operadora diferente de Claro/);
});

test('nome fantasia igual à razão do email não cria vínculo automático', async () => {
  const restaurar = instalarConsultas([venda(1, { nome: 'ALFHA AMBIENTAL SOLUCOES E SERVICOS LTDA', razao_social: 'OUTRA EMPRESA LTDA' })], etapas);
  try {
    const resultado = await automacao._internals.resolverVendaClaro(
      { recebido_em: '2026-09-22 12:00:00' }, { empresa: 'ALFHA AMBIENTAL SOLUCOES E SERVICOS LTDA' }
    );
    assert.equal(resultado.venda, null);
  } finally { restaurar(); }
});

test('diagnóstico distingue vendas exatas excluídas por cada regra e data da venda válida', async () => {
  const recebido = { recebido_em: '2026-09-22 12:00:00' };
  const casos = [
    [venda(1, { operadora: { nome: 'Vivo' } }), 'operadora diferente de Claro'],
    [venda(2, { excluido_em: '2026-09-20' }), 'venda excluída'],
    [venda(3, { enviada_pos_venda_em: null }), 'venda não enviada ao pós-venda'],
    [venda(4, { criado_em: '2026-09-23', data_venda: '2026-09-24' }), 'venda cadastrada após o email'],
    [venda(5, { cancelada_automacao_em: '2026-09-20' }), 'venda cancelada'],
    [venda(6, { status_funil: 'final' }), 'venda concluída']
  ];
  for (const [item, motivo] of casos) {
    const restaurar = instalarConsultas([item], etapas);
    try {
      const resultado = await automacao._internals.resolverVendaClaro(recebido, { empresa: 'Empresa Ágil Ltda' });
      assert.equal(resultado.venda, null);
      assert.match(resultado.candidatas[0].inelegibilidades.join(' '), new RegExp(motivo));
    } finally { restaurar(); }
  }
  const restaurar = instalarConsultas([venda(7, { criado_em: '2026-09-23', data_venda: '2026-09-21' })], etapas);
  try {
    const resultado = await automacao._internals.resolverVendaClaro(recebido, { empresa: 'Empresa Ágil Ltda' });
    assert.equal(resultado.venda.id, 7);
  } finally { restaurar(); }
});

test('fuzzy só aceita nome completo com alta confiança e sem candidata concorrente', async () => {
  const registro = { recebido_em: '2026-09-22 12:00:00' };
  const alvo = 'ALFHA AMBIENTAL SOLUCOES E SERVICOS LTDA';
  let restaurar = instalarConsultas([venda(1, { razao_social: 'ALPHA AMBIENTAL SOLUCOES E SERVICOS LTDA' })], etapas);
  try {
    assert.equal((await automacao._internals.resolverVendaClaro(registro, { empresa: alvo })).venda.id, 1);
  } finally { restaurar(); }
  restaurar = instalarConsultas([venda(1, { razao_social: 'XYZ PECAS LTDA' })], etapas);
  try {
    assert.equal((await automacao._internals.resolverVendaClaro(registro, { empresa: 'XYZ PECAS & ACESSORIOS LTDA' })).venda, null);
  } finally { restaurar(); }
  restaurar = instalarConsultas([
    venda(1, { razao_social: 'ALPHA AMBIENTAL SOLUCOES E SERVICOS LTDA' }),
    venda(2, { razao_social: 'ALFHA AMBIENTAL SOLUCOES E SERVICOS LTDA' })
  ], etapas);
  try {
    assert.equal((await automacao._internals.resolverVendaClaro(registro, { empresa: alvo })).venda.id, 2);
  } finally { restaurar(); }
  restaurar = instalarConsultas([
    venda(1, { razao_social: 'ALPHA AMBIENTAL SOLUCOES E SERVICOS LTDA' }),
    venda(2, { razao_social: 'ALFAA AMBIENTAL SOLUCOES E SERVICOS LTDA' })
  ], etapas);
  try {
    assert.equal((await automacao._internals.resolverVendaClaro(registro, { empresa: alvo })).venda, null);
  } finally { restaurar(); }
});

test('prévia Claro apresenta motivos e seleciona apenas registros interpretáveis sem revisão manual', async () => {
  const itens = [
    { id: 1, origem: 'imap_claro', status: 'revisao', assunto: 'Atualização de pedido', corpo_texto: 'O cliente EMPRESA TESTE ASSINOU o contrato.', erro: 'Venda não encontrada', autenticacao_valida: false },
    { id: 2, origem: 'imap_claro', status: 'revisao', assunto: 'Outro assunto', corpo_texto: 'Texto', erro: 'Formato inválido', revisado_por_id: 5 }
  ];
  const resultado = await automacao.diagnosticoClaro({ consultar: async () => itens, carregarVendas: async () => [], etapasFinais: async () => [], resolver: async () => ({ candidatas: [{ id: 9, inelegibilidades: ['venda excluída'] }], erro: 'Venda inelegível' }) });
  assert.equal(resultado.total, 2);
  assert.equal(resultado.contagens['Venda não encontrada'], 1);
  assert.equal(resultado.registros[0].empresa, 'EMPRESA TESTE');
  assert.equal(resultado.registros[0].elegivel_reprocessamento, true);
  assert.deepEqual(resultado.registros[0].candidatas[0].inelegibilidades, ['venda excluída']);
  assert.equal(resultado.registros[1].elegivel_reprocessamento, false);
});

test('prévia recalcula vínculo único sem esconder a venda de outra operadora', async () => {
  const empresa = 'SIMPLICIUS COLETA E REMOCAO DE RESIDUOS LTDA';
  const registro = { id: 238, origem: 'imap_claro', status: 'revisao', assunto: 'Atualização de pedido',
    corpo_texto: `O cliente ${empresa} ASSINOU o contrato.`, recebido_em: '2026-09-22 12:00:00',
    erro: 'Mais de uma venda distinta possui a mesma razão social; revisão manual obrigatória.' };
  const resultado = await automacao.diagnosticoClaro({
    consultar: async () => [registro],
    carregarVendas: async () => [
      venda(658, { razao_social: empresa, operadora: { nome: 'Vivo' }, status_funil: 'final' }),
      venda(723, { razao_social: empresa })
    ],
    etapasFinais: async () => ['final']
  });
  assert.equal(resultado.registros[0].motivo_vinculo, null);
  assert.equal(resultado.registros[0].venda_sugerida_id, 723);
  assert.deepEqual(resultado.registros[0].candidatas.map(item => [item.id, item.elegivel]), [[658, false], [723, true]]);
});

test('reprocessamento seletivo da Claro preserva revisões não relacionadas', async () => {
  const corpo = 'Prezado BASARI TELECOM &#x20;\nO aceite do cliente CAMISARIA BARRETO LTDA foi ENVIADO.';
  const base = { origem: 'imap_claro', status: 'revisao', autenticacao_valida: true, assunto: 'Atualização de pedido', corpo_texto: corpo, erro: 'Formato do e-mail Claro não reconhecido.', revisado_por_id: null, venda_id: null };
  const itens = [
    { ...base, id: 1 },
    { ...base, id: 2, erro: 'Não foi encontrada uma venda Claro ativa com nome/razão social exatamente correspondente.' },
    { ...base, id: 3, erro: 'Mais de uma venda Claro ativa possui o mesmo nome/razão social.' },
    { ...base, id: 4, autenticacao_valida: false },
    { ...base, id: 5, revisado_por_id: 7 },
    { ...base, id: 6, corpo_texto: null },
    { ...base, id: 7, origem: 'gmail_vivo' },
    { ...base, id: 8, corpo_texto: 'Mensagem sem status da Claro' }
  ];
  const reivindicados = [];
  const processados = [];
  const resultado = await automacao.repetirInvalidosClaro({
    consultar: async () => itens,
    reivindicar: async item => { reivindicados.push(item.id); return 1; },
    verificar: async () => ({ valida: true, motivo: 'DKIM válido', dominio: 'example.com' }),
    atualizar: async () => {},
    obter: async id => ({ id, status: 'revisao', erro: 'Venda ainda inelegível' }),
    processar: async item => { processados.push(item.id); return true; }
  });
  assert.equal(resultado.selecionados, 4);
  assert.equal(resultado.repetidos, 4);
  assert.equal(resultado.falhas, 0);
  assert.deepEqual(reivindicados, [1, 2, 3, 4]);
  assert.deepEqual(processados, [1, 2, 3, 4]);
});

test('reprocessamento informa resultado por ID e mantém origem não comprovada em revisão', async () => {
  const corpo = 'O cliente EMPRESA TESTE ASSINOU o contrato.';
  const itens = [1, 2, 3].map(id => ({ id, origem: 'imap_claro', status: 'revisao', assunto: 'Atualização de pedido', corpo_texto: corpo, erro: 'Origem não comprovada' }));
  const estados = new Map([[1, { status: 'revisao', erro: 'Origem não comprovada' }], [2, { status: 'revisao', erro: 'Venda duplicada' }], [3, { status: 'concluido', erro: null }]]);
  const reivindicados = [];
  const resultado = await automacao.repetirInvalidosClaro({
    consultar: async () => itens,
    verificar: async item => item.id === 1 ? { valida: false, motivo: 'Original indisponível' } : { valida: true, dominio: 'example.com' },
    reivindicar: async item => { reivindicados.push(item.id); return 1; },
    atualizar: async () => {},
    processar: async () => true,
    obter: async id => estados.get(id)
  });
  assert.deepEqual(reivindicados, [2, 3]);
  assert.deepEqual(resultado.registros, [
    { id: 1, status: 'revisao', motivo: 'Original indisponível' },
    { id: 2, status: 'revisao', motivo: 'Venda duplicada' },
    { id: 3, status: 'concluido', motivo: null }
  ]);
});

test('revisão manual Claro valida a venda pelo nome sem exigir CNPJ', async () => {
  const escolhida = venda(9);
  const resultado = await automacao._internals.validarVendaSelecionada(
    { origem: 'imap_claro', dados_extraidos: JSON.stringify({ empresa: 'Empresa Ágil' }), recebido_em: '2026-09-22 12:00:00' },
    { venda_id: 9 },
    { buscarClaro: async () => [escolhida], etapasFinais: async () => ['final'] }
  );
  assert.equal(resultado.venda.id, 9);
  assert.equal(resultado.cnpj, null);
});

test('Claro autenticada fica em revisão enquanto ações estão bloqueadas', async () => {
  const restaurar = instalarConsultas([venda(1)], etapas);
  const flagAnterior = process.env.CLARO_IMAP_AUTO_ACTIONS_ENABLED;
  process.env.CLARO_IMAP_AUTO_ACTIONS_ENABLED = 'false';
  try {
    const resultado = await automacao._internals.processarRegistro({
      id: 50, origem: 'imap_claro', assunto: 'STATUS DE PEDIDO', autenticacao_valida: true,
      dados_extraidos: JSON.stringify({ autenticacao_email: { metodo: 'dkim_original' } }),
      corpo_texto: 'O cliente Empresa Ágil ASSINOU o contrato.', recebido_em: '2026-09-22 12:00:00'
    });
    assert.equal(resultado.status, 'revisao');
    assert.equal(resultado.venda_id, 1);
    assert.match(resultado.erro, /aguardam homologação/);
  } finally {
    restaurar();
    if (flagAnterior === undefined) delete process.env.CLARO_IMAP_AUTO_ACTIONS_ENABLED;
    else process.env.CLARO_IMAP_AUTO_ACTIONS_ENABLED = flagAnterior;
  }
});

test('crédito aprovado avança somente o funil comparativo e conclui marcadores automáticos', async () => {
  const restaurar = instalarConsultas([venda(1, { status_funil: 'aceite' })], etapas);
  const moverOriginal = vendaFunilAutomacaoService.movimentar;
  const flagAnterior = process.env.CLARO_IMAP_AUTO_ACTIONS_ENABLED;
  const movimentos = [];
  process.env.CLARO_IMAP_AUTO_ACTIONS_ENABLED = 'true';
  vendaFunilAutomacaoService.movimentar = async (...args) => { movimentos.push(args); return { status: 'ok' }; };
  try {
    const resultado = await automacao._internals.processarRegistro({
      id: 51, origem: 'imap_claro', assunto: 'STATUS DE PEDIDO', autenticacao_valida: true,
      dados_extraidos: JSON.stringify({ autenticacao_email: { metodo: 'dkim_original' } }),
      corpo_texto: 'O pedido do cliente Empresa Ágil foi APROVADO CREDITO.', recebido_em: '2026-09-22 12:00:00'
    });
    assert.equal(resultado.status, 'concluido');
    assert.equal(resultado.etapa_destino, 'pedido');
    assert.equal(movimentos.length, 1);
    assert.equal(movimentos[0][0], 1);
    assert.deepEqual(movimentos[0][2].marcadores, { aceite: true, biometria: true });
    assert.equal(movimentos[0][2].origem, 'automacao_imap_claro');
  } finally {
    restaurar();
    vendaFunilAutomacaoService.movimentar = moverOriginal;
    if (flagAnterior === undefined) delete process.env.CLARO_IMAP_AUTO_ACTIONS_ENABLED;
    else process.env.CLARO_IMAP_AUTO_ACTIONS_ENABLED = flagAnterior;
  }
});

test('falha de DKIM/DMARC nunca executa ação automática', async () => {
  const restaurar = instalarConsultas([venda(1)], etapas);
  const moverOriginal = vendaFunilAutomacaoService.movimentar;
  let moveu = false;
  vendaFunilAutomacaoService.movimentar = async () => { moveu = true; return { status: 'ok' }; };
  try {
    const resultado = await automacao._internals.processarRegistro({
      id: 52, origem: 'imap_claro', assunto: 'STATUS DE PEDIDO', autenticacao_valida: false,
      corpo_texto: 'O pedido do cliente Empresa Ágil foi FATURADO.', recebido_em: '2026-09-22 12:00:00'
    });
    assert.equal(resultado.status, 'revisao');
    assert.match(resultado.erro, /DKIM/);
    assert.equal(moveu, false);
  } finally { restaurar(); vendaFunilAutomacaoService.movimentar = moverOriginal; }
});

test('flags Claro são independentes entre coleta e ações', () => {
  const coleta = process.env.CLARO_IMAP_AUTOMATION_ENABLED;
  const acoes = process.env.CLARO_IMAP_AUTO_ACTIONS_ENABLED;
  process.env.CLARO_IMAP_AUTOMATION_ENABLED = 'true';
  process.env.CLARO_IMAP_AUTO_ACTIONS_ENABLED = 'false';
  try {
    assert.equal(claroImap.habilitado(), true);
    assert.equal(claroImap.acoesAutomaticasHabilitadas(), false);
  } finally {
    if (coleta === undefined) delete process.env.CLARO_IMAP_AUTOMATION_ENABLED; else process.env.CLARO_IMAP_AUTOMATION_ENABLED = coleta;
    if (acoes === undefined) delete process.env.CLARO_IMAP_AUTO_ACTIONS_ENABLED; else process.env.CLARO_IMAP_AUTO_ACTIONS_ENABLED = acoes;
  }
});

test('repetição Claro reutiliza o corpo persistido sem consultar Gmail', async () => {
  let consultouGmail = false;
  const atualizacao = await automacao._internals.prepararRepeticao(
    { origem: 'imap_claro', gmail_message_id: 'imap:dedup', corpo_texto: 'O cliente Empresa Ágil ASSINOU o contrato.' },
    async () => { consultouGmail = true; return ''; }
  );
  assert.deepEqual(atualizacao, { status: 'pendente', erro: null });
  assert.equal(consultouGmail, false);
});
