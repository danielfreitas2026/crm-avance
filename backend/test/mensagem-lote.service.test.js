const test = require('node:test');
const assert = require('node:assert/strict');

const mensagemService = require('../src/services/mensagem.service');

test('normaliza e remove destinatarios duplicados', () => {
  assert.deepEqual(
    mensagemService._internals.normalizarDestinatarios([2, '2', 3, 'invalido', 'invalido']),
    [2, 3, 'invalido']
  );
});

test('rejeita lote vazio antes de consultar o banco', async () => {
  await assert.rejects(
    mensagemService.enviarMensagensEmLote(1, [], 'Olá'),
    erro => erro.statusCode === 400 && /ao menos um destinatário/i.test(erro.message)
  );
});

test('rejeita mensagem vazia e anexo malformado como erros gerais', async () => {
  await assert.rejects(
    mensagemService.enviarMensagensEmLote(1, [2], '   '),
    erro => erro.statusCode === 400 && /não pode estar vazia/i.test(erro.message)
  );
  await assert.rejects(
    mensagemService.enviarMensagensEmLote(1, [2], 'Olá', 'arquivo-invalido'),
    erro => erro.statusCode === 400 && /anexo inválido/i.test(erro.message)
  );
});

test('relata autoenvio e destinatario invalido sem abortar o lote', async () => {
  const resultado = await mensagemService.enviarMensagensEmLote(1, [1, 'x'], 'Olá');

  assert.equal(resultado.resumo.solicitadas, 2);
  assert.equal(resultado.resumo.enviadas, 0);
  assert.equal(resultado.resumo.falhas, 2);
  assert.match(resultado.falhas[0].motivo, /si mesmo/i);
  assert.match(resultado.falhas[1].motivo, /inválido/i);
});
