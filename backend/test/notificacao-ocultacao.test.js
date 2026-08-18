const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../src/database/connection');
const { _internals } = require('../src/services/notificacao.service');

const {
  aplicarFiltroNavbar,
  aplicarFiltroTiposVisiveis,
  salvarOcultacaoDestinatario
} = _internals;

function compilarVisibilidade(podeReceberTodas) {
  const query = db('notificacoes as n')
    .leftJoin('notificacao_destinatarios as nd', 'nd.notificacao_id', 'n.id')
    .select('n.id');

  aplicarFiltroTiposVisiveis(query, {
    podeReceberTodas,
    podeVerTudo: true,
    podeVerAprovacoes: true,
    podeVerVendasParadas: true
  });

  return query.toSQL().sql;
}

test('ocultacao da navbar nao altera a visibilidade das tarefas', () => {
  const consultaDestinatario = compilarVisibilidade(false);
  const consultaGlobal = compilarVisibilidade(true);

  assert.doesNotMatch(consultaDestinatario, /`nd`.`ocultada_em` is null/);
  assert.match(consultaDestinatario, /`nd`.`id` is not null/);
  assert.doesNotMatch(consultaGlobal, /`nd`.`ocultada_em` is null/);
  assert.doesNotMatch(consultaGlobal, /`nd`.`id` is not null/);
});

test('ocultacao e aplicada somente a fila da navbar', () => {
  const query = db('notificacoes as n')
    .leftJoin('notificacao_destinatarios as nd', 'nd.notificacao_id', 'n.id')
    .select('n.id');

  aplicarFiltroNavbar(query);

  assert.match(query.toSQL().sql, /`nd`.`ocultada_em` is null/);
});

test('oculta somente o registro do destinatario existente', async () => {
  const chamadas = [];
  const ocultadaEm = new Date('2026-08-18T12:00:00Z');
  const DestinatarioModel = {
    query() {
      return {
        async patchAndFetchById(id, patch) {
          chamadas.push({ id, patch });
        }
      };
    }
  };

  await salvarOcultacaoDestinatario({
    notificacaoId: 10,
    usuarioId: 20,
    destinatarioId: 30,
    ocultadaEm
  }, {
    DestinatarioModel,
    knex: () => assert.fail('nao deve inserir outro destinatario')
  });

  assert.deepEqual(chamadas, [{ id: 30, patch: { ocultada_em: ocultadaEm } }]);
});

test('materializa a ocultacao para usuario que recebe notificacao global', async () => {
  const chamadas = {};
  const ocultadaEm = new Date('2026-08-18T12:00:00Z');
  const knex = tabela => {
    chamadas.tabela = tabela;
    return {
      insert(payload) {
        chamadas.payload = payload;
        return this;
      },
      onConflict(colunas) {
        chamadas.colunas = colunas;
        return this;
      },
      async merge(patch) {
        chamadas.merge = patch;
      }
    };
  };

  await salvarOcultacaoDestinatario({
    notificacaoId: 10,
    usuarioId: 20,
    destinatarioId: null,
    ocultadaEm
  }, { knex });

  assert.equal(chamadas.tabela, 'notificacao_destinatarios');
  assert.deepEqual(chamadas.payload, {
    notificacao_id: 10,
    usuario_id: 20,
    ocultada_em: ocultadaEm
  });
  assert.deepEqual(chamadas.colunas, ['notificacao_id', 'usuario_id']);
  assert.deepEqual(chamadas.merge, { ocultada_em: ocultadaEm });
});
