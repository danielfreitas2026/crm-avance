const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const arquivo = '20261015110000_reparar_schema_sincronizacao_aprovacoes.js';
const migration = require(`../src/database/migrations/${arquivo}`);

const esperadas = {
  telegram_status_sincronizado: ['string', 16],
  telegram_sincronizado_em: ['timestamp', undefined],
  telegram_decisor_nome: ['string', 255],
  status_anterior_obsoleta: ['string', 16]
};

function preparar(existentes = []) {
  const colunas = new Set(existentes);
  const criadas = [];
  const contexto = { falharEm: null };
  const knex = {
    schema: {
      async hasColumn(tabela, coluna) {
        assert.equal(tabela, 'venda_aprovacao_solicitacoes');
        return colunas.has(coluna);
      },
      async alterTable(tabela, callback) {
        assert.equal(tabela, 'venda_aprovacao_solicitacoes');
        function adicionar(tipo, nome, tamanho) {
          if (contexto.falharEm === nome) throw new Error('Falha de DDL');
          assert.equal(colunas.has(nome), false, 'nao pode recriar coluna existente');
          assert.deepEqual([tipo, tamanho], esperadas[nome]);
          return {
            nullable() { colunas.add(nome); criadas.push(nome); }
          };
        }
        callback({
          string: (nome, tamanho) => adicionar('string', nome, tamanho),
          timestamp: nome => adicionar('timestamp', nome)
        });
      }
    }
  };
  return { knex, colunas, criadas, contexto };
}

test('reparo cria as quatro colunas ausentes antes da migration que falhou no servidor', async () => {
  const { knex, colunas } = preparar();
  await migration.up(knex);
  assert.deepEqual([...colunas], Object.keys(esperadas));
  const arquivos = fs.readdirSync(path.join(__dirname, '../src/database/migrations')).sort();
  assert.ok(arquivos.indexOf(arquivo) < arquivos.indexOf('20261015120000_obsoletar_aprovacoes_vendas_na_lixeira.js'));
});

test('reparo preserva estrutura existente e adiciona somente a coluna do erro', async () => {
  const existentes = Object.keys(esperadas).filter(nome => nome !== 'status_anterior_obsoleta');
  const { knex, criadas } = preparar(existentes);
  await migration.up(knex);
  assert.deepEqual(criadas, ['status_anterior_obsoleta']);
});

test('schema completo e repeticao nao executam DDL nem alteram dados', async () => {
  const { knex, criadas } = preparar(Object.keys(esperadas));
  await migration.up(knex);
  await migration.up(knex);
  assert.deepEqual(criadas, []);
});

test('reparo pode retomar apos falha parcial de DDL sem duplicar colunas', async () => {
  const { knex, colunas, criadas, contexto } = preparar();
  contexto.falharEm = 'telegram_decisor_nome';
  await assert.rejects(migration.up(knex), /Falha de DDL/);
  assert.equal(colunas.size, 2);
  contexto.falharEm = null;
  await migration.up(knex);
  assert.deepEqual(criadas, Object.keys(esperadas));
});

test('rollback do reparo preserva colunas exigidas pela API e pela migration original', async () => {
  const { knex, colunas } = preparar();
  await migration.up(knex);
  await migration.down(knex);
  assert.deepEqual([...colunas], Object.keys(esperadas));
});
