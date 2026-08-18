const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/database/connection');
const { _internals } = require('../src/services/lead-planilha.service');

function compilarFiltro(status) {
  const query = db('lead_linhas').select('*');
  _internals.aplicarFiltrosQuery(query, { status });
  return query.toSQL();
}

function compilarSituacao(situacao) {
  const query = db('lead_linhas').select('*');
  _internals.aplicarFiltrosFuturosClientes(query, { situacao });
  return query.toSQL();
}

test('filtro de vendas recusadas independe de futuro cliente ativo', () => {
  const consulta = compilarFiltro('venda_recusada');

  assert.doesNotMatch(consulta.sql, /futuro_cliente/);
  assert.match(consulta.sql, /venda_recusada_em/);
  assert.match(consulta.sql, /venda_recusada_motivo/);
  assert.ok(consulta.bindings.includes('perdido'));
});

test('filtro pendente exclui venda recusada depois da reversao', () => {
  const consulta = compilarFiltro('pendente');

  assert.match(consulta.sql, /venda_recusada_em/);
  assert.match(consulta.sql, /venda_recusada_motivo/);
  assert.ok(consulta.bindings.includes('perdido'));
});

test('filtro em negociacao exclui qualquer linha que ja tenha venda vinculada', () => {
  const consulta = compilarSituacao('em_negociacao');

  assert.match(consulta.sql, /`venda_id` is null/);
  assert.ok(consulta.bindings.includes('vendido'));
  assert.ok(consulta.bindings.includes('perdido'));
});

test('filtro venda concluida reconhece venda_id ou status vendido', () => {
  const consulta = compilarSituacao('venda_concluida');

  assert.match(consulta.sql, /`status_operacional` = \? or `venda_id` is not null/);
  assert.ok(consulta.bindings.includes('vendido'));
});
