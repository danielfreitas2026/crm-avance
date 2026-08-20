const test = require('node:test');
const assert = require('node:assert/strict');
const { _internals } = require('../src/services/lead-planilha.service');

const {
  aplicarEscopoCarteiraFuturosClientes,
  deveNotificarNovoFuturoCliente,
  deduplicarIndicacoesEnvio,
  obterErroEnvioFuturoClienteDistribuicao,
  resolverDestinoNovoFuturoCliente
} = _internals;
const db = require('../src/database/connection');
const Usuario = require('../src/models/Usuario');
const leadPlanilhaRoutes = require('../src/routes/lead-planilha.routes');

test('notifica o Telegram somente ao qualificar um futuro cliente pela primeira vez', () => {
  assert.equal(deveNotificarNovoFuturoCliente({
    futuro_cliente: false,
    futuro_cliente_marcado_em: null
  }), true);

  for (const futuroCliente of [true, 1, '1']) {
    assert.equal(deveNotificarNovoFuturoCliente({
      futuro_cliente: futuroCliente,
      futuro_cliente_marcado_em: '2026-07-20 12:30:00'
    }), false);
  }
});

test('nao renotifica registro ja qualificado mesmo com booleano legado inconsistente', () => {
  assert.equal(deveNotificarNovoFuturoCliente({
    futuro_cliente: false,
    futuro_cliente_marcado_em: '2026-07-20 12:30:00'
  }), false);
});

test('resolve o destino apenas no primeiro cadastro e preserva compatibilidade', () => {
  assert.equal(resolverDestinoNovoFuturoCliente({ futuro_cliente: false }, { destino: 'carteira' }), 'carteira');
  assert.equal(resolverDestinoNovoFuturoCliente({ futuro_cliente: false }, { destino: 'distribuicao' }), 'distribuicao');
  assert.equal(resolverDestinoNovoFuturoCliente({ futuro_cliente: false }, {}), 'distribuicao');
  assert.equal(resolverDestinoNovoFuturoCliente({ futuro_cliente: true, futuro_cliente_destino: 'carteira' }, { destino: 'distribuicao' }), 'carteira');
  assert.equal(resolverDestinoNovoFuturoCliente({ futuro_cliente: true, futuro_cliente_destino: null }, {}), null);
  assert.throws(() => resolverDestinoNovoFuturoCliente({ futuro_cliente: false }, { destino: 'invalido' }), /Destino do futuro cliente invalido/);
});

test('carteira propria preserva legados e exclui somente destino distribuicao', () => {
  const query = db('lead_linhas').select('*');
  aplicarEscopoCarteiraFuturosClientes(query, 17);
  const consulta = query.toSQL();

  assert.match(consulta.sql, /futuro_cliente_marcado_por_id/);
  assert.match(consulta.sql, /futuro_cliente_destino.*is null.*not.*futuro_cliente_destino/);
  assert.deepEqual(consulta.bindings, [17, 'distribuicao']);
});

test('envio posterior preserva o primeiro envio do dono e exige acesso total para republicar', () => {
  const disponivel = {
    futuro_cliente: true,
    futuro_cliente_excluido_em: null,
    futuro_cliente_marcado_por_id: 17,
    futuro_cliente_destino: 'carteira',
    status_operacional: 'qualificado',
    etapa_atual: 'sondagem',
    venda_id: null
  };
  assert.equal(obterErroEnvioFuturoClienteDistribuicao(disponivel, 17), null);
  assert.equal(obterErroEnvioFuturoClienteDistribuicao({
    ...disponivel,
    futuro_cliente_destino: 'distribuicao'
  }, 17)?.statusCode, 403);
  assert.equal(obterErroEnvioFuturoClienteDistribuicao({
    ...disponivel,
    futuro_cliente_destino: 'distribuicao'
  }, 17, { podeReencaminharTodos: true }), null);
  assert.equal(obterErroEnvioFuturoClienteDistribuicao({ ...disponivel, futuro_cliente_destino: null }, 17)?.statusCode, 409);
  assert.equal(obterErroEnvioFuturoClienteDistribuicao(disponivel, 18)?.statusCode, 403);
  assert.equal(obterErroEnvioFuturoClienteDistribuicao(disponivel, 18, { podeReencaminharTodos: true }), null);
  assert.equal(obterErroEnvioFuturoClienteDistribuicao({ ...disponivel, status_operacional: 'vendido' }, 17)?.statusCode, 409);
  assert.equal(obterErroEnvioFuturoClienteDistribuicao({ ...disponivel, futuro_cliente_excluido_em: new Date() }, 17)?.statusCode, 404);
});

test('republicacao bloqueia recusas, vendas e atribuicoes ativas', () => {
  const disponivel = {
    futuro_cliente: true,
    futuro_cliente_excluido_em: null,
    futuro_cliente_marcado_por_id: 17,
    futuro_cliente_destino: 'distribuicao',
    status_operacional: 'qualificado',
    etapa_atual: 'sondagem',
    venda_id: null
  };
  const acessoTotal = { podeReencaminharTodos: true };

  assert.equal(obterErroEnvioFuturoClienteDistribuicao({ ...disponivel, venda_id: 91 }, 18, acessoTotal)?.statusCode, 409);
  assert.equal(obterErroEnvioFuturoClienteDistribuicao({ ...disponivel, venda_recusada_em: new Date() }, 18, acessoTotal)?.statusCode, 409);
  assert.equal(obterErroEnvioFuturoClienteDistribuicao({ ...disponivel, cliente_recusou: true }, 18, acessoTotal)?.statusCode, 409);
  assert.equal(obterErroEnvioFuturoClienteDistribuicao(disponivel, 18, {
    ...acessoTotal,
    possuiAtribuicaoAtiva: true
  })?.statusCode, 409);
});

test('rota de distribuicao aceita usuario com ver todos mesmo sem permissao de registrar', async () => {
  const camada = leadPlanilhaRoutes.stack.find(item => item.route?.path === '/me/futuros-clientes/:id/distribuir');
  const middlewarePermissao = camada.route.stack[0].handle;
  const originalQuery = Usuario.query;
  Usuario.query = () => ({
    findById() { return this; },
    withGraphFetched: async () => ({
      id: 22,
      ativo: true,
      permissoes: { futuros_clientes_registrar: false, futuros_clientes_ver_todos: true },
      role: { nome: 'usuario', permissoes: {} }
    })
  });
  let avancou = false;
  const resposta = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json() { return this; }
  };
  try {
    await middlewarePermissao({ usuario: { id: 22 } }, resposta, () => { avancou = true; });
  } finally {
    Usuario.query = originalQuery;
  }
  assert.equal(avancou, true);
  assert.equal(resposta.statusCode, 200);
});

test('exibe somente o encaminhamento mais recente de uma indicacao duplicada', () => {
  const envios = deduplicarIndicacoesEnvio([
    { id: 9, nome: 'Indicacao #16576' },
    { id: 8, nome: 'Indicacao #16576' },
    { id: 7, nome: 'Mailing comercial' }
  ]);

  assert.deepEqual(envios.map(envio => envio.id), [9, 7]);
});
