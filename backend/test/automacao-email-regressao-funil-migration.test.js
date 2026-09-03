const test = require('node:test');
const assert = require('node:assert/strict');

let migration = null;
try {
  migration = require('../src/database/migrations/20260903150000_add_regressao_funil_automacao_emails');
} catch {}

test('migration adiciona regressao de funil e reclassifica somente a revisao correspondente', async () => {
  assert.ok(migration, 'migration de regressao do funil deve existir');
  const operacoes = [];
  const knex = tabela => ({
    where(filtros) { operacoes.push(['where', tabela, filtros]); return this; },
    async update(dados) { operacoes.push(['update', tabela, dados]); }
  });
  knex.raw = async sql => { operacoes.push(['raw', sql]); };

  await migration.up(knex);

  assert.match(operacoes[0][1], /'revisao', 'regressao_funil', 'erro'/);
  assert.deepEqual(operacoes.slice(1), [
    ['where', 'automacao_emails', {
      status: 'revisao',
      erro: 'O e-mail tentaria regredir o funil.'
    }],
    ['update', 'automacao_emails', { status: 'regressao_funil' }]
  ]);
});

test('rollback devolve todas as regressoes para revisao antes de restaurar o enum', async () => {
  assert.ok(migration, 'migration de regressao do funil deve existir');
  const operacoes = [];
  const knex = tabela => ({
    where(filtros) { operacoes.push(['where', tabela, filtros]); return this; },
    async update(dados) { operacoes.push(['update', tabela, dados]); }
  });
  knex.raw = async sql => { operacoes.push(['raw', sql]); };

  await migration.down(knex);

  assert.deepEqual(operacoes.slice(0, 2), [
    ['where', 'automacao_emails', { status: 'regressao_funil' }],
    ['update', 'automacao_emails', { status: 'revisao' }]
  ]);
  assert.doesNotMatch(operacoes[2][1], /regressao_funil/);
});
