const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/database/connection');
const { _internals } = require('../src/services/lead-planilha.service');

test.after(async () => {
  await db.destroy();
});

test('busca textual encontra razao social sem depender do cabecalho da planilha', () => {
  const query = db('lead_linhas').select('*');
  _internals.aplicarFiltrosQuery(query, { busca: 'Empresa Avanço' }, { usuarioId: 17 });
  const consulta = query.toSQL();

  assert.match(consulta.sql, /lower\(cast\(dados_json as char\)\) like/i);
  assert.ok(consulta.bindings.includes('%empresa avanço%'));
  assert.ok(consulta.bindings.includes(17));
});

test('busca de CNPJ ignora pontuacao da consulta e do valor armazenado', () => {
  const query = db('lead_linhas').select('*');
  _internals.aplicarFiltrosQuery(query, { busca: '12.345.678/0001-90' });
  const consulta = query.toSQL();

  assert.match(consulta.sql, /replace\(replace\(replace\(replace\(cast\(dados_json as char\)/i);
  assert.ok(consulta.bindings.includes('%12.345.678/0001-90%'));
  assert.ok(consulta.bindings.includes('%12345678000190%'));
  assert.equal(_internals.normalizarBuscaDocumento('12345678000190'), '12345678000190');
});

test('busca global combina dados do cliente e nome do mailing sem perder o escopo do usuario', () => {
  const query = db('lead_linhas').select('*');
  _internals.aplicarFiltrosQuery(query, { busca_global: 'Mailing Agosto' }, { usuarioId: 23 });
  const consulta = query.toSQL();

  assert.match(consulta.sql, /`atribuido_para_id` = \?/);
  assert.match(consulta.sql, /exists \(select 1 from `lead_envios` as `le_busca`/);
  assert.ok(consulta.bindings.includes('%mailing agosto%'));
  assert.ok(consulta.bindings.includes(23));
  assert.equal(_internals.filtrosPermitemIndicacaoPendente({ busca_global: 'mailing agosto' }), false);
});

test('mailing so corresponde a cliente atribuido ao usuario autenticado', () => {
  const query = db('lead_envios').select('*');
  _internals.aplicarBuscaMailingsUsuario(query, 'Empresa Cliente', 31);
  const consulta = query.toSQL();

  assert.match(consulta.sql, /ll_busca\.envio_id = lead_envios\.id/);
  assert.match(consulta.sql, /`ll_busca`.`atribuido_para_id` = \?/);
  assert.ok(consulta.bindings.includes(31));
  assert.ok(consulta.bindings.includes('%empresa cliente%'));
});
