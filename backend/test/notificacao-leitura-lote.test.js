const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/database/connection');
const Usuario = require('../src/models/Usuario');
const Notificacao = require('../src/models/Notificacao');
const NotificacaoDestinatario = require('../src/models/NotificacaoDestinatario');
const service = require('../src/services/notificacao.service');
const controller = require('../src/controllers/notificacao.controller');

const permissoes = {
  podeReceberTodas: false, podeVerTudo: false,
  podeVerAprovacoes: false, podeVerVendasParadas: false
};

// Compila as consultas reais, mas intercepta sua execução: nenhum banco é acessado.
function bancoSimulado(notificacoes, falharLote = 0) {
  const consultas = [];
  let lotes = 0;
  let transacoes = 0;
  const knex = () => assert.fail('consulta fora da transacao');
  knex.transaction = async callback => {
    transacoes += 1;
    const trx = tabela => {
      const query = db(tabela);
      query.then = (resolve, reject) => Promise.resolve().then(() => {
        const consulta = query.toSQL();
        consultas.push(consulta);
        if (tabela === 'notificacoes as n') return notificacoes;
        lotes += 1;
        if (lotes === falharLote) throw new Error('falha de persistencia');
        return [1];
      }).then(resolve, reject);
      return query;
    };
    trx.raw = db.raw.bind(db);
    return callback(trx);
  };
  return { knex, consultas, get transacoes() { return transacoes; } };
}

test('leitura da navbar respeita as mesmas pendencias, permissoes e usuario da listagem', async () => {
  const banco = bancoSimulado([{ id: 11 }, { id: 12 }]);
  assert.equal(await service._internals.marcarPendenciasNavbarLidas(9, permissoes, banco.knex), 2);
  assert.equal(banco.transacoes, 1);
  const [selecao, escrita] = banco.consultas;
  assert.match(selecao.sql, /`nd`.`usuario_id` = \?/);
  assert.equal(selecao.bindings[0], 9);
  assert.match(selecao.sql, /`n`.`ativa` = \?/);
  assert.match(selecao.sql, /`nd`.`id` is not null/);
  assert.match(selecao.sql, /`n`.`tipo` in/);
  assert.ok(!selecao.bindings.includes('venda_aprovacao_pendente'));
  assert.ok(!selecao.bindings.includes('venda_parada_funil'));
  assert.match(selecao.sql, /`nd`.`popup_visto_em` is null/);
  assert.match(selecao.sql, /`nd`.`ocultada_em` is null/);
  assert.match(selecao.sql, /exists.*lead_linhas/i);
  // Avisos já lidos mas ainda presentes no painel também são confirmados.
  assert.doesNotMatch(selecao.sql, /`nd`.`lida_em` is null/);
  assert.match(escrita.sql, /insert into `notificacao_destinatarios`/);
  assert.match(escrita.sql, /on duplicate key update/);
  assert.match(escrita.sql, /`lida_em` = COALESCE\(`lida_em`, \?\)/);
  assert.match(escrita.sql, /`popup_visto_em` = COALESCE\(`popup_visto_em`, \?\)/);
  assert.doesNotMatch(escrita.sql, /ocultada_em|ativa|delete/i);
  // Cada linha inserida contém somente o usuário autenticado.
  assert.deepEqual(escrita.bindings.filter(valor => typeof valor === 'number'), [11, 9, 12, 9]);
});

test('materializa destinatarios globais e inclui os tipos autorizados', async () => {
  const banco = bancoSimulado([{ id: 11 }]);
  await service._internals.marcarPendenciasNavbarLidas(9, {
    podeReceberTodas: true, podeVerTudo: true, podeVerAprovacoes: true, podeVerVendasParadas: true
  }, banco.knex);
  assert.doesNotMatch(banco.consultas[0].sql, /`nd`.`id` is not null|`n`.`tipo` in/);
  assert.match(banco.consultas[1].sql, /insert into/);
});

test('servico seleciona a leitura da navbar com as permissoes do usuario autenticado', async t => {
  t.mock.method(Usuario, 'query', () => ({ findById(id) {
    assert.equal(id, 9);
    return this;
  }, async withGraphFetched() { return { id: 9, permissoes: [] }; } }));
  const banco = bancoSimulado([{ id: 11 }]);
  t.mock.method(db, 'transaction', banco.knex.transaction);
  assert.equal(await service.marcarTodasComoLidas(9, { escopo: 'navbar' }), 1);
  assert.equal(banco.transacoes, 1);
  assert.match(banco.consultas[0].sql, /`nd`.`id` is not null/);
});

test('repeticao sem pendencias nao escreve e falha de lote rejeita a transacao inteira', async () => {
  const vazio = bancoSimulado([]);
  assert.equal(await service._internals.marcarPendenciasNavbarLidas(9, permissoes, vazio.knex), 0);
  assert.equal(vazio.consultas.length, 1);
  const banco = bancoSimulado(Array.from({ length: 251 }, (_, i) => ({ id: i + 1 })), 2);
  await assert.rejects(service._internals.marcarPendenciasNavbarLidas(9, permissoes, banco.knex), /falha de persistencia/);
  assert.equal(banco.transacoes, 1);
  assert.equal(banco.consultas.length, 3);
});

test('controller encaminha o escopo autenticado e preserva resposta 204', async t => {
  const chamadas = [];
  t.mock.method(service, 'marcarTodasComoLidas', async (...args) => chamadas.push(args));
  for (const query of [{ escopo: 'navbar' }, {}]) {
    const res = { status(code) { this.code = code; return this; }, send() {} };
    await controller.marcarTodasLidas({ usuario: { id: 9 }, query }, res);
    assert.equal(res.code, 204);
  }
  assert.deepEqual(chamadas, [[9, { escopo: 'navbar' }], [9, { escopo: undefined }]]);
});

test('leitura sem escopo conserva a atualizacao exclusiva de lida_em', async t => {
  t.mock.method(Usuario, 'query', () => ({ findById() { return this; }, async withGraphFetched() { return { id: 9 }; } }));
  const query = db('notificacoes');
  query.alias = alias => query.from({ [alias]: 'notificacoes' });
  let selecao;
  query.then = resolve => {
    selecao = query.toSQL();
    return Promise.resolve([{ id: 11, destinatario_id: 22 }]).then(resolve);
  };
  t.mock.method(Notificacao, 'query', () => query);
  let patch;
  t.mock.method(NotificacaoDestinatario, 'query', () => ({
    whereIn(chave, ids) { assert.equal(chave, 'id'); assert.deepEqual(ids, [22]); return this; },
    async patch(dados) { patch = dados; }
  }));
  assert.equal(await service.marcarTodasComoLidas(9), 1);
  assert.match(selecao.sql, /`nd`.`lida_em` is null/);
  assert.doesNotMatch(selecao.sql, /popup_visto_em|ocultada_em/);
  assert.deepEqual(Object.keys(patch), ['lida_em']);
});
