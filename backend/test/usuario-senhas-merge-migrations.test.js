const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const diretorio = path.join(__dirname, '../src/database/migrations');
const criacaoLocal = '20261013120000_add_senha_criptografada_to_usuarios.js';
const criacaoRecebida = '20261014120000_add_senha_criptografada_usuarios.js';
const remocaoLocal = '20261016120000_remove_senha_criptografada_from_usuarios.js';
const coluna = 'senha_criptografada';
const reserva = 'senha_criptografada_merge';
const arquivos = fs.readdirSync(diretorio).filter(nome =>
  [criacaoLocal, criacaoRecebida, remocaoLocal].includes(nome) || /_conciliar_senha_usuarios_/.test(nome)
).sort();

function banco(existe = false, valor = null, aplicadas = []) {
  const historico = new Set(aplicadas);
  const colunas = new Set(['id', 'senha', ...(existe ? [coluna] : [])]);
  const registros = [{ id: 1, senha: 'hash-preservado', ...(existe ? { [coluna]: valor } : {}) }];
  const knex = tabela => {
    if (tabela === 'knex_migrations') {
      return { where(campo, nome) {
        assert.equal(campo, 'name');
        return { async first() { return historico.has(nome) ? { name: nome } : undefined; } };
      } };
    }
    assert.equal(tabela, 'usuarios');
    return { async update(dados) {
      for (const registro of registros) {
        for (const [campo, expressao] of Object.entries(dados)) {
          assert.ok(colunas.has(campo));
          assert.equal(expressao.sql, 'COALESCE(??, ??)');
          expressao.bindings.forEach(nome => assert.ok(colunas.has(nome)));
          registro[campo] = registro[expressao.bindings[0]] ?? registro[expressao.bindings[1]];
        }
      }
    } };
  };
  knex.raw = (sql, bindings) => ({ sql, bindings });
  knex.schema = {
    async hasColumn(tabela, campo) { assert.equal(tabela, 'usuarios'); return colunas.has(campo); },
    async alterTable(tabela, callback) {
      assert.equal(tabela, 'usuarios');
      callback({
        text(campo) {
          assert.ok(!colunas.has(campo), `coluna duplicada: ${campo}`);
          colunas.add(campo);
          registros.forEach(registro => { registro[campo] = null; });
          return { nullable() {} };
        },
        dropColumn(campo) {
          assert.ok(colunas.has(campo), `coluna ausente: ${campo}`);
          colunas.delete(campo);
          registros.forEach(registro => { delete registro[campo]; });
        },
        renameColumn(anterior, novo) {
          assert.ok(colunas.has(anterior));
          assert.ok(!colunas.has(novo));
          colunas.delete(anterior);
          colunas.add(novo);
          registros.forEach(registro => { registro[novo] = registro[anterior]; delete registro[anterior]; });
        }
      });
    }
  };
  return { knex, colunas, registros, historico };
}

for (const cenario of [
  { nome: 'instalação nova', aplicadas: [], existe: false },
  { nome: 'migrations locais já aplicadas', aplicadas: [criacaoLocal, remocaoLocal], existe: false },
  { nome: 'somente criação local aplicada', aplicadas: [criacaoLocal], existe: true, valor: 'copia-local' },
  { nome: 'versão recebida já instalada', aplicadas: [criacaoRecebida], existe: true, valor: 'copia-recebida' },
  { nome: 'ambas as criações aplicadas', aplicadas: [criacaoLocal, criacaoRecebida], existe: true, valor: 'copia-atual' },
  { nome: 'todas as migrations antigas aplicadas', aplicadas: [criacaoLocal, criacaoRecebida, remocaoLocal], existe: false }
]) {
  test(`merge de senhas: ${cenario.nome} termina com coluna disponível e preserva o hash`, async () => {
    const { knex, colunas, registros, historico } = banco(cenario.existe, cenario.valor, cenario.aplicadas);
    for (const nome of arquivos.filter(nome => !cenario.aplicadas.includes(nome))) {
      await require(path.join(diretorio, nome)).up(knex);
      historico.add(nome);
    }
    assert.ok(colunas.has(coluna));
    assert.ok(!colunas.has(reserva));
    assert.equal(registros[0].senha, 'hash-preservado');
    assert.equal(registros[0][coluna], cenario.valor ?? null);
  });
}

test('reserva e restauracao retomam apos falha de DDL sem perder valores', async () => {
  const { reservar, restaurar } = require('../src/database/migration-utils/conciliar-senha-usuarios');
  const { knex, colunas, registros } = banco(true, 'copia-preservada');
  await reservar(knex);
  await reservar(knex);
  // Simula a criacao da outra branch, ainda sem dados novos.
  await knex.schema.alterTable('usuarios', table => table.text(coluna).nullable());
  const alterar = knex.schema.alterTable;
  knex.schema.alterTable = async () => { throw new Error('falha DDL'); };
  await assert.rejects(reservar(knex), /falha DDL/);
  assert.equal(registros[0][reserva], 'copia-preservada');
  knex.schema.alterTable = alterar;
  await reservar(knex);
  await knex.schema.alterTable('usuarios', table => table.text(coluna).nullable());
  // A copia ja foi restaurada quando a remocao da reserva falha.
  knex.schema.alterTable = async () => { throw new Error('falha DDL'); };
  await assert.rejects(restaurar(knex), /falha DDL/);
  assert.equal(registros[0][coluna], 'copia-preservada');
  knex.schema.alterTable = alterar;
  await restaurar(knex);
  await restaurar(knex);
  assert.ok(!colunas.has(reserva));
  assert.equal(registros[0][coluna], 'copia-preservada');
  assert.equal(registros[0].senha, 'hash-preservado');
});

test('restauracao preserva uma senha atual mais recente que a reserva', async () => {
  const { reservar, restaurar } = require('../src/database/migration-utils/conciliar-senha-usuarios');
  const { knex, registros } = banco(true, 'copia-anterior');
  await reservar(knex);
  await knex.schema.alterTable('usuarios', table => table.text(coluna).nullable());
  registros[0][coluna] = 'copia-mais-recente';
  await restaurar(knex);
  assert.equal(registros[0][coluna], 'copia-mais-recente');
});

test('rollback da conciliacao interrompe antes dos DDLs historicos destrutivos', async () => {
  const { knex, registros, colunas } = banco(true, 'copia-atual');
  for (const nome of arquivos.filter(nome => /_conciliar_senha_usuarios_/.test(nome))) {
    await assert.rejects(require(path.join(diretorio, nome)).down(knex), /nao admite rollback automatico/);
  }
  assert.ok(colunas.has(coluna));
  assert.equal(registros[0][coluna], 'copia-atual');
  assert.equal(registros[0].senha, 'hash-preservado');
});
