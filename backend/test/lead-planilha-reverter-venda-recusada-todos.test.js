const test = require('node:test');
const assert = require('node:assert/strict');
const { _internals } = require('../src/services/lead-planilha.service');
const leadPlanilhaRouter = require('../src/routes/lead-planilha.routes');
const Usuario = require('../src/models/Usuario');

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

async function executarPermissoes(rota) {
  const req = { usuario: { id: 9 } };
  const res = resposta();
  for (const layer of rota.stack.slice(0, 2)) {
    let avancou = false;
    await layer.handle(req, res, () => { avancou = true; });
    if (!avancou) break;
  }
  return res;
}

test('rota de reversao exige visualizar e gerenciar todos os futuros clientes', async () => {
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

  try {
    const rota = encontrarRota('/futuros-clientes/:id/venda-recusada/reverter', 'post');

    permissoes = { futuros_clientes_gerenciar_todos: true };
    assert.equal((await executarPermissoes(rota)).statusCode, 403);

    permissoes = { futuros_clientes_ver_todos: true };
    assert.equal((await executarPermissoes(rota)).statusCode, 403);

    permissoes.futuros_clientes_gerenciar_todos = true;
    assert.equal((await executarPermissoes(rota)).statusCode, 200);
  } finally {
    Usuario.query = originalQuery;
  }
});

test('patch da reversao limpa somente a recusa e requalifica o futuro cliente ativo', () => {
  const patch = _internals.montarPatchReversaoVendaRecusada({
    futuro_cliente: true,
    futuro_cliente_excluido_em: null,
    atribuido_para_id: 27,
    venda_recusada_em: '2026-08-20 11:39:00',
    venda_recusada_motivo: 'Cliente ja atendido.'
  });

  assert.deepEqual(patch, {
    venda_recusada_motivo: null,
    venda_recusada_em: null,
    venda_recusada_por_id: null,
    status_operacional: 'qualificado'
  });
  assert.equal(Object.hasOwn(patch, 'atribuido_para_id'), false);
  assert.equal(Object.hasOwn(patch, 'futuro_cliente'), false);
});
