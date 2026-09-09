const test = require('node:test');
const assert = require('node:assert/strict');

const migration = require('../src/database/migrations/20260908120000_add_venda_historico_invalidation');

function knexFalso() {
  const colunas = new Set();
  const indices = new Set();
  const estrangeiras = new Set();
  const table = {
    dateTime(nome) { colunas.add(nome); return this; },
    integer(nome) { colunas.add(nome); return this; },
    text(nome) { colunas.add(nome); return this; },
    nullable() { return this; },
    unsigned() { return this; },
    foreign(nome) { this.colunaEstrangeira = nome; return this; },
    references() { return this; },
    inTable() { return this; },
    onDelete() { estrangeiras.add(this.colunaEstrangeira); return this; },
    index(_colunas, nome) { indices.add(nome); },
    dropForeign(nome) { estrangeiras.delete(nome); },
    dropIndex(_colunas, nome) { indices.delete(nome); },
    dropColumn(nome) { colunas.delete(nome); }
  };
  return {
    estado: { colunas, indices, estrangeiras },
    schema: {
      hasColumn: async (_tabela, coluna) => colunas.has(coluna),
      alterTable: async (_tabela, callback) => callback(table)
    },
    raw: async (sql, parametros) => {
      const nome = parametros[1];
      return [sql.includes('statistics')
        ? (indices.has(nome) ? [{ existe: 1 }] : [])
        : (estrangeiras.has(nome) ? [{ existe: 1 }] : [])];
    }
  };
}

test('migration de invalidacao aceita repeticao e rollback parcial', async () => {
  const knex = knexFalso();
  await migration.up(knex);
  await migration.up(knex);
  assert.deepEqual([...knex.estado.colunas].sort(), [
    'correction_automation_id', 'invalidated_at', 'invalidated_by_id', 'invalidation_reason'
  ]);
  assert.equal(knex.estado.estrangeiras.size, 2);
  assert.equal(knex.estado.indices.size, 2);

  await migration.down(knex);
  await migration.down(knex);
  assert.equal(knex.estado.colunas.size, 0);
  assert.equal(knex.estado.estrangeiras.size, 0);
  assert.equal(knex.estado.indices.size, 0);
});
