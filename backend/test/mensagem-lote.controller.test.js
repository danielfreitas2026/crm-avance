const test = require('node:test');
const assert = require('node:assert/strict');

const mensagemService = require('../src/services/mensagem.service');
const mensagemController = require('../src/controllers/mensagem.controller');

function criarResposta() {
  return {
    statusCode: null,
    body: null,
    status(codigo) { this.statusCode = codigo; return this; },
    json(corpo) { this.body = corpo; return this; }
  };
}

test('controller retorna 201 para sucesso total e 207 para falha parcial', async () => {
  const original = mensagemService.enviarMensagensEmLote;
  const req = { usuario: { id: 1 }, body: { destinatario_ids: [2, 3], conteudo: 'Olá' } };

  try {
    mensagemService.enviarMensagensEmLote = async () => ({
      enviadas: [{ destinatario_id: 2 }, { destinatario_id: 3 }],
      falhas: [],
      resumo: { solicitadas: 2, enviadas: 2, falhas: 0 }
    });
    const sucesso = criarResposta();
    await mensagemController.enviarLote(req, sucesso);
    assert.equal(sucesso.statusCode, 201);

    mensagemService.enviarMensagensEmLote = async () => ({
      enviadas: [{ destinatario_id: 2 }],
      falhas: [{ destinatario_id: 3, motivo: 'Indisponível' }],
      resumo: { solicitadas: 2, enviadas: 1, falhas: 1 }
    });
    const parcial = criarResposta();
    await mensagemController.enviarLote(req, parcial);
    assert.equal(parcial.statusCode, 207);
    assert.equal(parcial.body.falhas.length, 1);
  } finally {
    mensagemService.enviarMensagensEmLote = original;
  }
});
