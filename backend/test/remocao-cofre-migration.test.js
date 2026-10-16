const test = require('node:test');
const assert = require('node:assert/strict');
const migration = require('../src/database/migrations/20261016120000_remove_senha_criptografada_from_usuarios');

test('migration remove somente a cópia reversível e preserva o hash de login', async () => {
  const colunas = new Map([['id', 1], ['senha', 'hash-bcrypt'], ['senha_criptografada', 'cópia-legada']]);
  const knex = { schema: { alterTable(nome, callback) {
    assert.equal(nome, 'usuarios');
    callback({
      dropColumn(campo) { colunas.delete(campo); },
      text(campo) { return { nullable() { colunas.set(campo, null); } }; }
    });
  } } };

  await migration.up(knex);
  assert.deepEqual([...colunas], [['id', 1], ['senha', 'hash-bcrypt']]);
  await migration.down(knex);
  assert.equal(colunas.get('senha_criptografada'), null);
  assert.equal(colunas.get('senha'), 'hash-bcrypt');
});
