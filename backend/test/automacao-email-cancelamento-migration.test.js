const test = require('node:test');
const assert = require('node:assert/strict');
const migration = require('../src/database/migrations/20260902130000_add_cancelamento_automacao_emails');

test('migration expande o enum e rollback preserva registros como desconhecidos', async () => {
  const operacoes = [];
  const knex = tabela => ({
    where(campo, valor) { operacoes.push(['where', tabela, campo, valor]); return this; },
    async update(dados) { operacoes.push(['update', tabela, dados]); }
  });
  knex.raw = async sql => { operacoes.push(['raw', sql]); };

  await migration.up(knex);
  assert.match(operacoes[0][1], /'sem_acao', 'cancelamento'/);

  operacoes.length = 0;
  await migration.down(knex);
  assert.deepEqual(operacoes.slice(0, 2), [
    ['where', 'automacao_emails', 'classificacao', 'cancelamento'],
    ['update', 'automacao_emails', { classificacao: 'desconhecido' }]
  ]);
  assert.doesNotMatch(operacoes[2][1], /cancelamento/);
});
