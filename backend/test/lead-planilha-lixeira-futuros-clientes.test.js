const test = require('node:test');
const assert = require('node:assert/strict');
const { _internals } = require('../src/services/lead-planilha.service');
const leadPlanilhaRouter = require('../src/routes/lead-planilha.routes');
const Usuario = require('../src/models/Usuario');

const {
  calcularVencimentoLixeiraFuturoCliente,
  montarPatchExclusaoFuturoCliente,
  obterResponsavelEscopoLixeira
} = _internals;

test('mantem o futuro cliente na lixeira por exatamente 30 dias', () => {
  const inicio = new Date('2026-08-20T14:35:10.000Z');
  const vencimento = calcularVencimentoLixeiraFuturoCliente(inicio);

  assert.equal(vencimento.toISOString(), '2026-09-19T14:35:10.000Z');
  assert.equal(vencimento.getTime() - inicio.getTime(), 30 * 24 * 60 * 60 * 1000);
});

test('preserva a linha do mailing e remove somente os metadados de futuro cliente', () => {
  const patch = montarPatchExclusaoFuturoCliente(new Date('2026-09-19T14:35:10.000Z'));

  assert.equal(patch.futuro_cliente, false);
  assert.equal(patch.futuro_cliente_notas, null);
  assert.equal(patch.futuro_cliente_retorno, null);
  assert.equal(patch.futuro_cliente_retorno_realizado_em, null);
  assert.equal(patch.futuro_cliente_marcado_por_id, null);
  assert.equal(patch.futuro_cliente_destino, null);
  assert.equal(patch.futuro_cliente_excluido_em, null);
  assert.equal(Object.hasOwn(patch, 'id'), false);
  assert.equal(Object.hasOwn(patch, 'dados_json'), false);
  assert.equal(Object.hasOwn(patch, 'planilha_id'), false);
});

test('limita a lixeira propria ao responsavel e remove o filtro somente no escopo Todos', () => {
  assert.equal(obterResponsavelEscopoLixeira(17), 17);
  assert.equal(obterResponsavelEscopoLixeira('17'), 17);
  assert.equal(obterResponsavelEscopoLixeira(17, { todos: true }), null);
});

function resposta() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function encontrarRota(caminho, metodo) {
  return leadPlanilhaRouter.stack.find(layer => layer.route?.path === caminho && layer.route.methods[metodo]).route;
}

async function executarMiddlewaresPermissao(rota, quantidade, permissoes) {
  const req = { usuario: { id: 9 } };
  const res = resposta();
  for (const layer of rota.stack.slice(0, quantidade)) {
    let avancou = false;
    await layer.handle(req, res, () => { avancou = true; });
    if (!avancou) break;
  }
  return res;
}

test('rota propria exige somente a permissao da acao solicitada', async () => {
  const originalQuery = Usuario.query;
  Usuario.query = () => ({
    findById() { return this; },
    withGraphFetched: async () => ({
      id: 9,
      ativo: true,
      role: { nome: 'usuario', permissoes: {} },
      permissoes: { futuros_clientes_enviar_lixeira: true }
    })
  });

  try {
    const rota = encontrarRota('/me/futuros-clientes/:id', 'delete');
    assert.equal((await executarMiddlewaresPermissao(rota, 1)).statusCode, 200);
  } finally {
    Usuario.query = originalQuery;
  }
});

test('rota Todos exige visualizacao, gerenciamento global e permissao da acao', async () => {
  const originalQuery = Usuario.query;
  let permissoesAtuais = {};
  Usuario.query = () => ({
    findById() { return this; },
    withGraphFetched: async () => ({
      id: 9,
      ativo: true,
      role: { nome: 'usuario', permissoes: {} },
      permissoes: permissoesAtuais
    })
  });

  try {
    const rota = encontrarRota('/futuros-clientes/:id', 'delete');

    permissoesAtuais = {
      futuros_clientes_ver_todos: true,
      futuros_clientes_enviar_lixeira: true
    };
    assert.equal((await executarMiddlewaresPermissao(rota, 3, permissoesAtuais)).statusCode, 403);

    permissoesAtuais = {
      futuros_clientes_ver_todos: true,
      futuros_clientes_gerenciar_todos: true
    };
    assert.equal((await executarMiddlewaresPermissao(rota, 3, permissoesAtuais)).statusCode, 403);

    permissoesAtuais.futuros_clientes_enviar_lixeira = true;
    assert.equal((await executarMiddlewaresPermissao(rota, 3, permissoesAtuais)).statusCode, 200);

    const rotaDefinitiva = encontrarRota('/futuros-clientes/:id/definitivo', 'delete');
    assert.equal((await executarMiddlewaresPermissao(rotaDefinitiva, 3, permissoesAtuais)).statusCode, 403);

    permissoesAtuais.futuros_clientes_excluir_definitivamente = true;
    assert.equal((await executarMiddlewaresPermissao(rotaDefinitiva, 3, permissoesAtuais)).statusCode, 200);
  } finally {
    Usuario.query = originalQuery;
  }
});
