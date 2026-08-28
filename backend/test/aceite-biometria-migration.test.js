const test = require('node:test');
const assert = require('node:assert/strict');

const migration = require('../src/database/migrations/20260828120000_add_aceite_biometria_funil');

function criarKnex(colunasIniciais = {}) {
  const colunas = new Map(Object.entries(colunasIniciais).map(([tabela, nomes]) => [tabela, new Set(nomes)]));
  const defaults = new Map();

  return {
    colunas,
    defaults,
    schema: {
      async hasColumn(tabela, coluna) {
        return colunas.get(tabela)?.has(coluna) || false;
      },
      async alterTable(tabela, callback) {
        if (!colunas.has(tabela)) colunas.set(tabela, new Set());
        const table = {
          boolean(coluna) {
            colunas.get(tabela).add(coluna);
            const builder = {
              notNullable() { return builder; },
              defaultTo(valor) { defaults.set(`${tabela}.${coluna}`, valor); return builder; }
            };
            return builder;
          },
          dropColumn(coluna) {
            colunas.get(tabela).delete(coluna);
            defaults.delete(`${tabela}.${coluna}`);
          }
        };
        callback(table);
      }
    }
  };
}

test('migration expande o funil e as vendas com defaults pendentes e aceita repeticao', async () => {
  const knex = criarKnex({ funil_etapas: [], vendas: [] });

  await migration.up(knex);
  await migration.up(knex);

  assert.equal(knex.colunas.get('funil_etapas').has('aceite_biometria'), true);
  assert.equal(knex.colunas.get('vendas').has('aceite_concluido'), true);
  assert.equal(knex.colunas.get('vendas').has('biometria_concluida'), true);
  assert.equal(knex.defaults.get('funil_etapas.aceite_biometria'), false);
  assert.equal(knex.defaults.get('vendas.aceite_concluido'), false);
  assert.equal(knex.defaults.get('vendas.biometria_concluida'), false);
});

test('rollback remove somente as colunas de aceite e biometria e aceita repeticao', async () => {
  const knex = criarKnex({
    funil_etapas: ['id', 'aceite_biometria'],
    vendas: ['id', 'aceite_concluido', 'biometria_concluida']
  });

  await migration.down(knex);
  await migration.down(knex);

  assert.deepEqual([...knex.colunas.get('funil_etapas')], ['id']);
  assert.deepEqual([...knex.colunas.get('vendas')], ['id']);
});
