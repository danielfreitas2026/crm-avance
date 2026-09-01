const test = require('node:test');
const assert = require('node:assert/strict');
const migration = require('../src/database/migrations/20260901120000_add_resolucao_auditoria_venda_problemas');

function criarKnex() {
  const colunas = new Set();
  const indices = new Set();
  const atualizacoes = [];
  function knex(tabela) {
    const query = {
      tabela,
      where() { return query; },
      whereNotNull() { return query; },
      leftJoin() { return query; },
      orderBy() { return query; },
      select() { return tabela === 'venda_problemas' ? Promise.resolve([{ id: 7 }]) : query; },
      first() { return Promise.resolve({ usuario_id: 4, nome: 'Maria Silva' }); },
      update(dados) { atualizacoes.push(dados); return Promise.resolve(1); }
    };
    return query;
  }
  knex.colunas = colunas;
  knex.indices = indices;
  knex.atualizacoes = atualizacoes;
  knex.schema = {
    async alterTable(tabela, callback) {
      const encadeavel = { unsigned() { return encadeavel; }, nullable() { return encadeavel; }, references() { return encadeavel; }, inTable() { return encadeavel; }, onDelete() { return encadeavel; } };
      callback({
        integer(nome) { colunas.add(nome); return encadeavel; },
        string(nome) { colunas.add(nome); return encadeavel; },
        foreign() { return encadeavel; },
        index(campos, nome) { indices.add(nome || campos.join('_')); },
        dropIndex(campos, nome) { indices.delete(nome || campos.join('_')); },
        dropForeign() {},
        dropColumn(nome) { colunas.delete(nome); }
      });
    }
  };
  return knex;
}

test('migration adiciona auditoria, índices e preenche o resolvedor histórico', async () => {
  const knex = criarKnex();
  await migration.up(knex);

  assert.equal(knex.colunas.has('resolvido_por_id'), true);
  assert.equal(knex.colunas.has('resolvido_por_nome'), true);
  assert.equal(knex.indices.has('idx_venda_problemas_status_aberto'), true);
  assert.equal(knex.indices.has('idx_venda_problemas_status_resolvido'), true);
  assert.deepEqual(knex.atualizacoes, [{ resolvido_por_id: 4, resolvido_por_nome: 'Maria Silva' }]);
});

test('rollback remove somente a auditoria e os índices novos', async () => {
  const knex = criarKnex();
  knex.colunas.add('resolvido_por_id');
  knex.colunas.add('resolvido_por_nome');
  knex.indices.add('idx_venda_problemas_status_aberto');
  knex.indices.add('idx_venda_problemas_status_resolvido');

  await migration.down(knex);

  assert.equal(knex.colunas.has('resolvido_por_id'), false);
  assert.equal(knex.colunas.has('resolvido_por_nome'), false);
  assert.equal(knex.indices.size, 0);
});
