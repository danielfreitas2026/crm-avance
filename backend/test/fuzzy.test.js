const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizar,
  tokensSignificativos,
  levenshtein,
  levenshteinRatio,
  jaro,
  jaroWinkler,
  scoreTokens,
  similaridadeNome,
  confiancaEmpresa
} = require('../src/utils/fuzzy');

test('normalizar remove acento, pontuacao e caixa', () => {
  assert.equal(normalizar('João da Silva & Cia.'), 'joao da silva cia');
  assert.equal(normalizar('  AUTO-PEÇAS  '), 'auto pecas');
  assert.equal(normalizar(null), '');
  assert.equal(normalizar(undefined), '');
});

test('tokensSignificativos descarta termos genericos e curtos', () => {
  assert.deepEqual(
    tokensSignificativos(normalizar('Padaria Sao Joao ME LTDA')),
    ['padaria', 'sao', 'joao']
  );
});

test('levenshtein conta edicoes basicas', () => {
  assert.equal(levenshtein('gato', 'gato'), 0);
  assert.equal(levenshtein('gato', 'rato'), 1);
  assert.equal(levenshtein('comercial', 'comercal'), 1);
  assert.equal(levenshtein('', 'abc'), 3);
});

test('levenshteinRatio devolve 0-1 e 1 para identicas', () => {
  assert.equal(levenshteinRatio('', ''), 1);
  assert.equal(levenshteinRatio('11999998888', '11999998888'), 1);
  assert.ok(levenshteinRatio('11999998888', '1199999888') > 0.9);
});

test('jaro e jaroWinkler ficam entre 0 e 1', () => {
  assert.equal(jaro('', ''), 1);
  assert.equal(jaro('abc', ''), 0);
  const jw = jaroWinkler('martha', 'marhta');
  assert.ok(jw > 0.9 && jw <= 1);
});

test('jaroWinkler premia prefixo comum', () => {
  // Mesmo Jaro base, o prefixo igual "dwa" deve elevar o Winkler.
  assert.ok(jaroWinkler('dwayne', 'duane') > jaro('dwayne', 'duane'));
});

test('similaridadeNome tolera acento, espaco e sufixo', () => {
  assert.equal(similaridadeNome('Padaria São João', 'Padaria Sao Joao'), 1);
  assert.ok(similaridadeNome('Auto Peças Silva', 'Autopeças Silva') > 0.8);
  assert.ok(similaridadeNome('Padaria Sao Joao', 'Padaria Sao Joao ME LTDA') > 0.9);
  assert.ok(similaridadeNome('Comercial Uniao', 'Comercal Uniao') > 0.85);
});

test('similaridadeNome separa empresas diferentes do limiar de confianca', () => {
  // Nao precisa ser ~0: basta ficar claramente abaixo do limiar de decisao
  // (0.72), bem distante dos matches reais (> 0.9).
  assert.ok(similaridadeNome('Padaria Sao Joao', 'Auto Center Estrela') < 0.65);
  assert.ok(similaridadeNome('Padaria Sao Joao', 'Bar do Ze') < 0.65);
  assert.equal(similaridadeNome('', 'Empresa X'), 0);
});

test('scoreTokens reconhece nome contido (subconjunto)', () => {
  const a = tokensSignificativos(normalizar('padaria sao joao'));
  const b = tokensSignificativos(normalizar('padaria sao joao comercio de paes ltda'));
  assert.ok(scoreTokens(a, b) > 0.95);
});

test('confiancaEmpresa usa so o nome quando nao ha municipio/uf', () => {
  const c = confiancaEmpresa('Padaria Sao Joao', {}, { nome: 'Padaria Sao Joao', endereco: '' });
  assert.equal(c, 1);
  const baixa = confiancaEmpresa('Padaria Sao Joao', {}, { nome: 'Bar do Ze', endereco: '' });
  assert.ok(baixa < 0.65);
});

test('confiancaEmpresa soma municipio e uf como confirmacao', () => {
  const dados = { municipio: 'Sao Paulo', uf: 'SP' };
  const candidato = { nome: 'Padaria Sao Joao', endereco: 'Rua X, 10 - Sao Paulo, SP' };
  const comLocal = confiancaEmpresa('Padaria Sao Joao', dados, candidato);
  assert.equal(comLocal, 1);

  // Nome perfeito mas em outra cidade/UF reduz a confianca.
  const outroLocal = confiancaEmpresa('Padaria Sao Joao', dados, {
    nome: 'Padaria Sao Joao',
    endereco: 'Av Y, 5 - Curitiba, PR'
  });
  assert.ok(outroLocal < comLocal);
  assert.ok(outroLocal >= 0.5 && outroLocal < 0.7);
});
