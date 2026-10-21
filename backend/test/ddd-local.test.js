const test = require('node:test');
const assert = require('node:assert/strict');
const { extrairDddTelefone, localizarTelefones, LOCAIS_DDD, normalizarDdd } = require('../src/utils/ddd');

test('extrai DDD de telefone fixo, celular, país e prefixos nacionais', () => {
  const casos = [
    ['(19) 3234-5678', '19'], ['21 99999-8888', '21'], ['+55 (19) 3234-5678', '19'],
    ['5519999998888', '19'], ['01932345678', '19'], ['019999998888', '19'],
    ['0211932345678', '19'], ['02119999998888', '19'], [1932345678, '19']
  ];
  casos.forEach(([telefone, esperado]) => assert.equal(extrairDddTelefone(telefone), esperado, String(telefone)));
});

test('distingue DDD 55 do código brasileiro sem truncar o assinante', () => {
  ['5532345678', '55999998888', '+55 55 99999-8888', '555532345678', '5555999998888']
    .forEach(telefone => assert.equal(extrairDddTelefone(telefone), '55', telefone));
});

test('rejeita valores incompletos, estrangeiros, texto, serviços e DDD inexistente', () => {
  [null, '', '19', '999998888', '20999998888', '+1 212 555 1234', '+54 11 99999 8888',
    '005519999998888', '08001234567', '1932345678 ramal 5', 'abc1932345678', '1111111111', '193234567890']
    .forEach(telefone => assert.equal(extrairDddTelefone(telefone), null, String(telefone)));
});

test('consolida somente os campos selecionados, prioriza atualizados e ordena sem repetir', () => {
  const dados = {
    Terminal: '2132345678', Fixo: '1132345678', 'Fixo (atualizado)': '1932345678',
    Celular: '19999998888; 21999998888', Outro: '3132345678', Local: 'Importado'
  };
  const copia = structuredClone(dados);
  const resultado = localizarTelefones(dados, ['Terminal', 'Fixo', 'Celular']);
  assert.deepEqual(resultado.ddds, ['19', '21']);
  assert.equal(resultado.local, 'Campinas e região/SP — DDD 19; Rio de Janeiro e região/RJ — DDD 21');
  assert.deepEqual(dados, copia);
  assert.deepEqual(localizarTelefones({ Fixo: '32345678' }, ['Fixo']), { ddds: [], local: 'Não identificado' });
});

test('catálogo mantém todos os DDDs válidos e explicita DF/GO', () => {
  assert.equal(LOCAIS_DDD.length, 67);
  assert.equal(new Set(LOCAIS_DDD.map(local => local.ddd)).size, 67);
  LOCAIS_DDD.forEach(local => assert.equal(normalizarDdd(local.ddd), local.ddd));
  assert.equal(LOCAIS_DDD.find(local => local.ddd === '61').uf, 'DF/GO');
  assert.throws(() => normalizarDdd('20'), { statusCode: 400 });
});
