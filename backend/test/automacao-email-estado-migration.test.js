const test = require('node:test');
const assert = require('node:assert/strict');
const migration = require('../src/database/migrations/20260915120000_create_automacao_email_estado');

function criarKnex() {
  const tabelas = new Set();
  const dados = {};
  const coluna = () => ({ unsigned() { return this; }, primary() { return this; }, nullable() { return this; }, notNullable() { return this; }, defaultTo() { return this; } });
  const tabela = new Proxy({}, { get: () => () => coluna() });
  function knex(nome) {
    let filtro = {};
    return {
      where(valor) { filtro = valor; return this; },
      first: async () => (dados[nome] || []).find(item => Object.entries(filtro).every(([chave, valor]) => item[chave] === valor)),
      async insert(valor) { (dados[nome] ||= []).push(valor); }
    };
  }
  knex.schema = {
    hasTable: async nome => tabelas.has(nome),
    createTable: async (nome, callback) => { tabelas.add(nome); dados[nome] ||= []; callback(tabela); },
    dropTableIfExists: async nome => { tabelas.delete(nome); delete dados[nome]; }
  };
  return { knex, tabelas, dados };
}

test('migration cria um unico estado inicial e aceita repeticao', async () => {
  const contexto = criarKnex();
  await migration.up(contexto.knex);
  await migration.up(contexto.knex);
  assert.equal(contexto.tabelas.has('automacao_email_estado'), true);
  assert.deepEqual(contexto.dados.automacao_email_estado, [{ id: 1, estado: 'aguardando' }]);
});

test('rollback remove o estado da integracao', async () => {
  const contexto = criarKnex();
  await migration.up(contexto.knex);
  await migration.down(contexto.knex);
  assert.equal(contexto.tabelas.has('automacao_email_estado'), false);
});
