const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/database/connection');
const { _internals } = require('../src/services/venda-futuro-cliente.service');

const contexto = {
  cnpj: '12.345.678/0001-90',
  vendedorasIds: [7],
  criadoEm: '2026-08-18 12:00:00'
};

function criarLinha(sobrescrever = {}) {
  return {
    id: 10,
    futuro_cliente: 1,
    futuro_cliente_excluido_em: null,
    futuro_cliente_marcado_em: '2026-08-18 11:00:00',
    atribuido_para_id: 7,
    venda_id: null,
    venda_recusada_em: null,
    venda_recusada_motivo: null,
    status_operacional: 'qualificado',
    sondagem_cnpj: '12.345.678/0001-90',
    dados_json: {},
    ...sobrescrever
  };
}

test('seleciona futuro cliente do mesmo CNPJ e responsavel comercial', () => {
  const linha = criarLinha();

  assert.equal(_internals.candidatoElegivel(linha, contexto), true);
  assert.equal(_internals.selecionarCandidatoUnico([linha], contexto), linha);
});

test('usa um unico CNPJ reconhecido no mailing quando a sondagem nao o possui', () => {
  const linha = criarLinha({ sondagem_cnpj: null, dados_json: { CNPJ: '12.345.678/0001-90' } });

  assert.equal(_internals.candidatoElegivel(linha, contexto), true);
  assert.equal(_internals.candidatoElegivel(criarLinha({
    sondagem_cnpj: null,
    dados_json: { CNPJ: '12.345.678/0001-90', 'CNPJ filial': '98.765.432/0001-10' }
  }), contexto), false);
});

test('reconhece a responsavel como vendedora principal ou compartilhada', () => {
  const linha = criarLinha({ atribuido_para_id: 9 });

  assert.equal(_internals.candidatoElegivel(linha, { ...contexto, vendedorasIds: [7, 9] }), true);
  assert.equal(_internals.candidatoElegivel(linha, { ...contexto, vendedorasIds: [7] }), false);
});

test('criador da venda nao participa da correspondencia comercial', () => {
  const linha = criarLinha({ atribuido_para_id: 9 });

  assert.equal(_internals.candidatoElegivel(linha, {
    ...contexto,
    vendedorasIds: [7],
    criadoPorId: 9
  }), false);
});

test('rejeita CNPJ diferente e estados que nao podem receber venda', () => {
  assert.equal(_internals.candidatoElegivel(criarLinha({ sondagem_cnpj: '98.765.432/0001-10' }), contexto), false);
  assert.equal(_internals.candidatoElegivel(criarLinha({ futuro_cliente_excluido_em: '2026-08-18 11:30:00' }), contexto), false);
  assert.equal(_internals.candidatoElegivel(criarLinha({ venda_id: 44 }), contexto), false);
  assert.equal(_internals.candidatoElegivel(criarLinha({ status_operacional: 'vendido' }), contexto), false);
  assert.equal(_internals.candidatoElegivel(criarLinha({ status_operacional: 'perdido' }), contexto), false);
  assert.equal(_internals.candidatoElegivel(criarLinha({ venda_recusada_em: '2026-08-18 11:30:00' }), contexto), false);
});

test('nao usa futuro cliente marcado depois do cadastro da venda', () => {
  assert.equal(_internals.candidatoElegivel(criarLinha({
    futuro_cliente_marcado_em: '2026-08-18 12:00:01'
  }), contexto), false);
});

test('nao escolhe automaticamente quando existem candidatos duplicados', () => {
  assert.equal(_internals.selecionarCandidatoUnico([
    criarLinha({ id: 10 }),
    criarLinha({ id: 11 })
  ], contexto), null);
});

test('segunda venda nao reutiliza um futuro cliente ja consumido', () => {
  assert.equal(_internals.selecionarCandidatoUnico([
    criarLinha({ venda_id: 55, status_operacional: 'vendido' })
  ], contexto), null);
});

test('query de candidatos restringe disponibilidade, consultoras e data de marcacao', () => {
  const consulta = _internals.montarQueryCandidatos(db, [7, 9], contexto.criadoEm).toSQL();

  assert.match(consulta.sql, /futuro_cliente/);
  assert.match(consulta.sql, /venda_id.*is null/);
  assert.match(consulta.sql, /atribuido_para_id.*in/);
  assert.match(consulta.sql, /futuro_cliente_marcado_em.*<=/);
  assert.ok(consulta.bindings.includes(7));
  assert.ok(consulta.bindings.includes(9));
  assert.ok(consulta.bindings.includes(contexto.criadoEm));
});
