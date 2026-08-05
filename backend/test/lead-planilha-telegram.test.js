const test = require('node:test');
const assert = require('node:assert/strict');
const { _internals } = require('../src/services/lead-planilha.service');

const { deveNotificarNovoFuturoCliente, deduplicarIndicacoesEnvio } = _internals;

test('notifica o Telegram somente ao qualificar um futuro cliente pela primeira vez', () => {
  assert.equal(deveNotificarNovoFuturoCliente({
    futuro_cliente: false,
    futuro_cliente_marcado_em: null
  }), true);

  for (const futuroCliente of [true, 1, '1']) {
    assert.equal(deveNotificarNovoFuturoCliente({
      futuro_cliente: futuroCliente,
      futuro_cliente_marcado_em: '2026-07-20 12:30:00'
    }), false);
  }
});

test('nao renotifica registro ja qualificado mesmo com booleano legado inconsistente', () => {
  assert.equal(deveNotificarNovoFuturoCliente({
    futuro_cliente: false,
    futuro_cliente_marcado_em: '2026-07-20 12:30:00'
  }), false);
});

test('exibe somente o encaminhamento mais recente de uma indicacao duplicada', () => {
  const envios = deduplicarIndicacoesEnvio([
    { id: 9, nome: 'Indicacao #16576' },
    { id: 8, nome: 'Indicacao #16576' },
    { id: 7, nome: 'Mailing comercial' }
  ]);

  assert.deepEqual(envios.map(envio => envio.id), [9, 7]);
});
