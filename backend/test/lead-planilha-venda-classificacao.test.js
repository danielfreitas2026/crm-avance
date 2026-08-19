const test = require('node:test');
const assert = require('node:assert/strict');

const { _internals } = require('../src/services/lead-planilha.service');

const CNPJ = '03465862000188';
const linha = {
  recebido_em: '2026-08-18 12:00:00',
  dados_json: { CNPJ }
};

function mapaCom(...vendas) {
  return new Map([[CNPJ, vendas]]);
}

test('venda antiga usa janela estrita anterior de 24 meses', () => {
  const dentro = { id: 1, entrada_etapa_final_em: '2024-08-18 12:00:01' };
  const noLimite = { id: 2, entrada_etapa_final_em: '2024-08-18 12:00:00' };
  const depoisDoRecebimento = { id: 3, entrada_etapa_final_em: '2026-08-18 12:00:01' };

  assert.equal(_internals.selecionarVendaAntiga(linha, mapaCom(noLimite, dentro, depoisDoRecebimento)).id, 1);
  assert.equal(_internals.selecionarVendaAntiga(linha, mapaCom(noLimite)), null);
  assert.equal(_internals.selecionarVendaAntiga(linha, mapaCom(depoisDoRecebimento)), null);
});

test('venda antiga exige o mesmo CNPJ e escolhe a conclusao mais recente', () => {
  const antiga = { id: 4, entrada_etapa_final_em: '2025-01-10 10:00:00' };
  const recente = { id: 5, entrada_etapa_final_em: '2026-01-10 10:00:00' };

  assert.equal(_internals.selecionarVendaAntiga(linha, mapaCom(antiga, recente)).id, 5);
  assert.equal(_internals.selecionarVendaAntiga(linha, new Map([['11111111111111', [recente]]])), null);
});

test('data de conclusao vem do historico do funil e nao de coluna inexistente em vendas', () => {
  const sql = _internals.sqlEntradaEtapaFinal('vendas');

  assert.match(sql, /FROM venda_historicos vh/);
  assert.match(sql, /vh\.venda_id = vendas\.id/);
  assert.doesNotMatch(sql, /vendas\.entrada_etapa_final_em/);
});
