const test = require('node:test');
const assert = require('node:assert/strict');
const LeadLinha = require('../src/models/LeadLinha');
const { _internals } = require('../src/services/lead-planilha.service');

const {
  aplicarBuscaFuturosClientes,
  aplicarFiltrosFuturosClientes
} = _internals;

function compilar(aplicar) {
  return aplicar(LeadLinha.query()).toKnexQuery().toSQL();
}

test('busca futuros clientes nos dados, notas, mailing e nomes de usuarios', () => {
  const consulta = compilar(query => aplicarBuscaFuturosClientes(query, 'Ana'));

  assert.match(consulta.sql, /lead_linhas\.dados_json/i);
  assert.match(consulta.sql, /lead_envios.*le_busca/i);
  assert.match(consulta.sql, /usuarios.*u_busca/i);
  assert.match(consulta.sql, /lead_atribuicoes.*la_busca/i);
  assert.equal(consulta.bindings.filter(item => item === '%ana%').length, 5);
});

test('filtra pelo responsavel atual considerando a ultima distribuicao ativa', () => {
  const consulta = compilar(query => aplicarFiltrosFuturosClientes(query, { responsavel_id: '7' }));

  assert.match(consulta.sql, /COALESCE\(lead_linhas\.atribuido_para_id, lead_linhas\.futuro_cliente_marcado_por_id\) = \?/i);
  assert.match(consulta.sql, /la_responsavel_nova\.id > la_responsavel\.id/i);
  assert.match(consulta.sql, /la_responsavel.*usuario_id.*= \?/i);
  assert.ok(consulta.bindings.includes(7));
});

test('combina destino, periodo e retornos futuros nos filtros avancados', () => {
  const consulta = compilar(query => aplicarFiltrosFuturosClientes(query, {
    destino: 'distribuicao',
    marcado_de: '2026-08-01',
    marcado_ate: '2026-08-20',
    retorno: 'futuro'
  }));

  assert.match(consulta.sql, /futuro_cliente_destino.*= \?/i);
  assert.match(consulta.sql, /futuro_cliente_marcado_em.*>= \?/i);
  assert.match(consulta.sql, /DATE_ADD\(\?, INTERVAL 1 DAY\)/i);
  assert.match(consulta.sql, /futuro_cliente_retorno.*>= \?/i);
  assert.ok(consulta.bindings.includes('2026-08-01 00:00:00'));
  assert.ok(consulta.bindings.includes('2026-08-20'));
});

test('permite localizar futuros clientes sem responsavel atual', () => {
  const consulta = compilar(query => aplicarFiltrosFuturosClientes(query, {
    responsavel_id: 'sem_responsavel'
  }));

  assert.match(consulta.sql, /not exists.*la_responsavel/is);
  assert.match(consulta.sql, /futuro_cliente_destino.*= \?/i);
  assert.ok(consulta.bindings.includes('distribuicao'));
});
