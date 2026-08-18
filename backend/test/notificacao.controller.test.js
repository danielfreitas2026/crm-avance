const test = require('node:test');
const assert = require('node:assert/strict');

const notificacaoController = require('../src/controllers/notificacao.controller');
const notificacaoService = require('../src/services/notificacao.service');

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; }
  };
}

test('exclui notificacao somente para o usuario autenticado', async () => {
  const original = notificacaoService.ocultarNotificacao;
  const chamadas = [];
  notificacaoService.ocultarNotificacao = async (notificacaoId, usuarioId) => {
    chamadas.push({ notificacaoId, usuarioId });
    return true;
  };

  try {
    const res = response();
    await notificacaoController.excluir({ params: { id: '17' }, usuario: { id: 9 } }, res);

    assert.equal(res.statusCode, 204);
    assert.equal(res.body, undefined);
    assert.deepEqual(chamadas, [{ notificacaoId: '17', usuarioId: 9 }]);
  } finally {
    notificacaoService.ocultarNotificacao = original;
  }
});
