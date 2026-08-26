const test = require('node:test');
const assert = require('node:assert/strict');
const leadPlanilhaRouter = require('../src/routes/lead-planilha.routes');
const leadPlanilhaController = require('../src/controllers/lead-planilha.controller');
const leadPlanilhaService = require('../src/services/lead-planilha.service');
const Usuario = require('../src/models/Usuario');
const { _internals } = require('../src/services/lead-planilha.service');

const {
  montarQueryFuturosClientesComConsultoras,
  formatarFuturoClienteComConsultora
} = _internals;

test('consulta somente a ultima atribuicao ativa e exclui todos os desfechos finais', () => {
  const consulta = montarQueryFuturosClientesComConsultoras({ busca: '12.345' })
    .orderByRaw('COALESCE(la.prazo_acao_em, DATE_ADD(la.atribuido_em, INTERVAL ? MINUTE)) ASC', [30])
    .toSQL();

  assert.match(consulta.sql, /aceite_status.*in \(\?, \?\)/i);
  assert.ok(consulta.bindings.includes('aguardando_aceite'));
  assert.ok(consulta.bindings.includes('aceito'));
  assert.match(consulta.sql, /not exists.*la_nova\.id > la\.id/is);
  assert.match(consulta.sql, /venda_id.*is null/i);
  assert.match(consulta.sql, /venda_recusada_em.*is null/i);
  assert.match(consulta.sql, /status_operacional.*not in/is);
  assert.match(consulta.sql, /cliente_recusou/is);
  assert.match(consulta.sql, /acao_registrada_em.*is null.*acao_registrada_tipo/is);
  assert.ok(consulta.bindings.includes('retorno_agendado'));
  assert.match(consulta.sql, /razao_social.*cnpj.*u\.nome/is);
  assert.match(consulta.sql, /DATE_ADD\(la\.atribuido_em, INTERVAL \? MINUTE\).*ASC/i);
  assert.ok(consulta.bindings.includes('%12345%'));
});

test('consulta individual restringe a atribuicao ativa ao usuario informado', () => {
  const consulta = montarQueryFuturosClientesComConsultoras({}, 27).toSQL();

  assert.match(consulta.sql, /la`?\.`?usuario_id`? = \?/i);
  assert.ok(consulta.bindings.includes(27));
});

test('formata razao e CNPJ priorizando sondagem e calcula prazo legado', () => {
  const direto = formatarFuturoClienteComConsultora({
    id: 8,
    razao_social: 'Empresa da Sondagem',
    cnpj: '00123456000199',
    dados_json: JSON.stringify({ 'Razao Social': 'Empresa do Mailing', CNPJ: '999' }),
    consultora_id: 4,
    consultora_nome: 'Ana',
    aceite_status: 'aceito',
    atribuido_em: '2026-08-21T12:00:00.000Z',
    prazo_acao_em: '2026-08-21T14:00:00.000Z',
    acao_registrada_tipo: 'retorno_agendado'
  });
  assert.equal(direto.razao_social, 'Empresa da Sondagem');
  assert.equal(direto.cnpj, '00123456000199');
  assert.equal(direto.situacao, 'retorno_marcado');
  assert.equal(direto.retorno_previsto_em, '2026-08-21T14:00:00.000Z');

  const legado = formatarFuturoClienteComConsultora({
    id: 9,
    dados_json: { 'Razao Social': 'Empresa Legada', CNPJ: '123' },
    consultora_id: 5,
    consultora_nome: 'Bia',
    aceite_status: 'aguardando_aceite',
    atribuido_em: '2026-08-21T12:00:00.000Z'
  });
  assert.equal(legado.razao_social, 'Empresa Legada');
  assert.equal(legado.cnpj, '123');
  assert.equal(legado.situacao, 'aguardando_aceite');
  assert.equal(new Date(legado.retorno_previsto_em).toISOString(), '2026-08-21T12:30:00.000Z');
});

test('rota de acompanhamento exige futuros_clientes_ver_todos', async () => {
  const rota = leadPlanilhaRouter.stack.find(layer => (
    layer.route?.path === '/futuros-clientes/em-acompanhamento' && layer.route.methods.get
  )).route;
  const originalQuery = Usuario.query;
  let permissoes = {};
  Usuario.query = () => ({
    findById() { return this; },
    withGraphFetched: async () => ({
      id: 9,
      ativo: true,
      role: { nome: 'usuario', permissoes: {} },
      permissoes
    })
  });
  const executar = async () => {
    const req = { usuario: { id: 9 } };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json() { return this; }
    };
    let avancou = false;
    await rota.stack[0].handle(req, res, () => { avancou = true; });
    return { avancou, statusCode: res.statusCode };
  };

  try {
    assert.deepEqual(await executar(), { avancou: false, statusCode: 403 });
    permissoes = { futuros_clientes_ver_todos: true };
    assert.deepEqual(await executar(), { avancou: true, statusCode: 200 });
  } finally {
    Usuario.query = originalQuery;
  }
});

test('rota individual de acompanhamento aceita permissoes normais de futuros clientes', async () => {
  const rota = leadPlanilhaRouter.stack.find(layer => (
    layer.route?.path === '/me/futuros-clientes/em-acompanhamento' && layer.route.methods.get
  )).route;
  const originalQuery = Usuario.query;
  let permissoes = {};
  Usuario.query = () => ({
    findById() { return this; },
    withGraphFetched: async () => ({
      id: 9,
      ativo: true,
      role: { nome: 'usuario', permissoes: {} },
      permissoes
    })
  });
  const executar = async () => {
    const req = { usuario: { id: 9 } };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json() { return this; }
    };
    let avancou = false;
    await rota.stack[0].handle(req, res, () => { avancou = true; });
    return { avancou, statusCode: res.statusCode };
  };

  try {
    assert.deepEqual(await executar(), { avancou: false, statusCode: 403 });
    permissoes = { futuros_clientes_ver: true };
    assert.deepEqual(await executar(), { avancou: true, statusCode: 200 });
    permissoes = { vendas_criar: true };
    assert.deepEqual(await executar(), { avancou: true, statusCode: 200 });
  } finally {
    Usuario.query = originalQuery;
  }
});

test('controller individual repassa filtros e usuario autenticado ao servico', async () => {
  const originalListar = leadPlanilhaService.listarFuturosClientesComConsultoras;
  const chamadas = [];
  leadPlanilhaService.listarFuturosClientesComConsultoras = async (...args) => {
    chamadas.push(args);
    return { data: [], total: 0, page: 2, page_size: 15 };
  };
  const req = { query: { page: '2', page_size: '15', busca: 'Empresa' }, usuario: { id: 31 } };
  let resposta;
  const res = { json(payload) { resposta = payload; return this; } };

  try {
    await leadPlanilhaController.listarMeusFuturosClientesEmAcompanhamento(req, res);
    assert.deepEqual(chamadas, [[req.query, 31]]);
    assert.deepEqual(resposta, { data: [], total: 0, page: 2, page_size: 15 });
  } finally {
    leadPlanilhaService.listarFuturosClientesComConsultoras = originalListar;
  }
});

test('controllers de detalhe preservam os escopos individual e global', async () => {
  const originalBuscar = leadPlanilhaService.buscarFuturoClienteEmAcompanhamento;
  const chamadas = [];
  leadPlanilhaService.buscarFuturoClienteEmAcompanhamento = async (...args) => {
    chamadas.push(args);
    return { linha: { id: Number(args[0]) } };
  };
  const respostas = [];
  const res = { json(payload) { respostas.push(payload); return this; } };

  try {
    await leadPlanilhaController.obterMeuFuturoClienteEmAcompanhamento(
      { params: { id: '41' }, usuario: { id: 9 } },
      res
    );
    await leadPlanilhaController.obterFuturoClienteEmAcompanhamento(
      { params: { id: '42' }, usuario: { id: 9 } },
      res
    );

    assert.deepEqual(chamadas, [['41', 9], ['42']]);
    assert.deepEqual(respostas, [{ linha: { id: 41 } }, { linha: { id: 42 } }]);
  } finally {
    leadPlanilhaService.buscarFuturoClienteEmAcompanhamento = originalBuscar;
  }
});

test('rotas de detalhe exigem as permissoes dos respectivos escopos', async () => {
  const rotaIndividual = leadPlanilhaRouter.stack.find(layer => (
    layer.route?.path === '/me/futuros-clientes/em-acompanhamento/:id' && layer.route.methods.get
  )).route;
  const rotaGlobal = leadPlanilhaRouter.stack.find(layer => (
    layer.route?.path === '/futuros-clientes/em-acompanhamento/:id' && layer.route.methods.get
  )).route;
  const originalQuery = Usuario.query;
  let permissoes = {};
  Usuario.query = () => ({
    findById() { return this; },
    withGraphFetched: async () => ({
      id: 9,
      ativo: true,
      role: { nome: 'usuario', permissoes: {} },
      permissoes
    })
  });
  const executar = async rota => {
    const req = { usuario: { id: 9 } };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json() { return this; }
    };
    let avancou = false;
    await rota.stack[0].handle(req, res, () => { avancou = true; });
    return { avancou, statusCode: res.statusCode };
  };

  try {
    assert.deepEqual(await executar(rotaIndividual), { avancou: false, statusCode: 403 });
    permissoes = { futuros_clientes_ver: true };
    assert.deepEqual(await executar(rotaIndividual), { avancou: true, statusCode: 200 });
    assert.deepEqual(await executar(rotaGlobal), { avancou: false, statusCode: 403 });
    permissoes = { futuros_clientes_ver_todos: true };
    assert.deepEqual(await executar(rotaGlobal), { avancou: true, statusCode: 200 });
  } finally {
    Usuario.query = originalQuery;
  }
});
