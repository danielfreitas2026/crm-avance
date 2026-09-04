const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FORMATO_MOEDA_BR,
  FORMATO_DECIMAL_BR,
  FORMATO_INTEIRO_BR,
  FORMATO_PERCENTUAL_BR,
  FORMATO_DATA_BR,
  numeroPlanilha
} = require('../src/utils/formato-planilha');

test('converte decimal vindo do banco como string para numero real', () => {
  assert.equal(numeroPlanilha('49.90'), 49.9);
  assert.equal(numeroPlanilha('1234.56'), 1234.56);
  assert.equal(numeroPlanilha(1234.56), 1234.56);
  assert.equal(numeroPlanilha(0), 0);
});

test('trata ausencia de valor como celula vazia na planilha', () => {
  assert.equal(numeroPlanilha(null), null);
  assert.equal(numeroPlanilha(undefined), null);
  assert.equal(numeroPlanilha(''), null);
});

test('descarta valor nao numerico em vez de gravar texto na coluna monetaria', () => {
  assert.equal(numeroPlanilha('nao informado'), null);
  assert.equal(numeroPlanilha('R$ 49,90'), null);
  assert.equal(numeroPlanilha(NaN), null);
  assert.equal(numeroPlanilha(Infinity), null);
});

test('fixa o locale brasileiro nos formatos numericos das exportacoes', () => {
  [FORMATO_MOEDA_BR, FORMATO_DECIMAL_BR, FORMATO_INTEIRO_BR, FORMATO_PERCENTUAL_BR].forEach(formato => {
    assert.match(formato, /^\[\$[^\]]*-416\]/, `formato sem locale pt-BR: ${formato}`);
  });

  assert.equal(FORMATO_DATA_BR, 'dd/mm/yyyy');
});
