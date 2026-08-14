const test = require('node:test');
const assert = require('node:assert/strict');

const VendaHistorico = require('../src/models/VendaHistorico');

test('created_at de venda historico nao e serializado como JSON', () => {
  assert.equal(VendaHistorico.getJsonAttributes().includes('created_at'), false);
  assert.equal(VendaHistorico.getJsonAttributes().includes('deleted_at'), false);
  assert.equal(VendaHistorico.getJsonAttributes().includes('dados'), true);
});
