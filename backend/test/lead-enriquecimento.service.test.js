const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/database/connection');
const {
  extrairDadosEmpresa,
  _internals: { valorPorAliases, interpretarResultadoGoogle, montarContatos }
} = require('../src/services/lead-enriquecimento.service');

test.after(async () => {
  await db.destroy();
});

test('extrairDadosEmpresa mapeia cabecalhos comuns do mailing', () => {
  const dados = JSON.stringify({
    'Razao Social': 'Padaria Sao Joao LTDA',
    'Nome Fantasia': 'Padaria Sao Joao',
    Cidade: 'Sao Paulo',
    UF: 'SP',
    CNPJ: '11.222.333/0001-81'
  });
  assert.deepEqual(extrairDadosEmpresa(dados), {
    razaoSocial: 'Padaria Sao Joao LTDA',
    nomeFantasia: 'Padaria Sao Joao',
    municipio: 'Sao Paulo',
    uf: 'SP'
  });
});

test('valorPorAliases prefere a coluna (atualizado)', () => {
  const dados = {
    'Razao Social': 'Nome Antigo',
    'Razao Social (atualizado)': 'Nome Novo'
  };
  assert.equal(valorPorAliases(dados, ['razao']), 'Nome Novo');
});

test('interpretarResultadoGoogle: telefone encontrado vira patch concluido', () => {
  const r = interpretarResultadoGoogle({
    encontrado: true,
    telefone: '11999998888',
    query: 'Padaria Sao Joao SP',
    place: {
      nome: 'Padaria Sao Joao', endereco: 'Rua X - Sao Paulo, SP', site: 'site.com',
      telefone: '11999998888', confianca: 0.95, confianca_pct: 95, confianca_nivel: 'alta',
      recomenda_apify: false, apify_motivo: ''
    }
  });
  assert.equal(r.patch.status, 'concluido');
  assert.equal(r.patch.telefone, '11999998888');
  assert.equal(r.patch.confianca_pct, 95);
  assert.equal(r.patch.recomenda_apify, false);
  assert.equal(JSON.parse(r.patch.contatos_json).length, 2); // telefone + site
});

test('interpretarResultadoGoogle: cota esgotada adia (mantem pendente)', () => {
  assert.deepEqual(interpretarResultadoGoogle({ encontrado: false, motivo: 'credenciais_esgotadas' }), { adiar: true });
  assert.deepEqual(interpretarResultadoGoogle({ encontrado: false, motivo: 'limite' }), { adiar: true });
});

test('interpretarResultadoGoogle: sem match recomenda Apify', () => {
  const r = interpretarResultadoGoogle({ encontrado: false, motivo: 'sem_match', candidatos: [] });
  assert.equal(r.patch.status, 'sem_resultado');
  assert.equal(r.patch.recomenda_apify, true);
  assert.ok(r.patch.apify_motivo.length > 0);
});

test('interpretarResultadoGoogle: erro de rede é transitorio', () => {
  const r = interpretarResultadoGoogle({ encontrado: false, motivo: 'erro', message: 'timeout' });
  assert.equal(r.erroTransitorio, true);
});

test('montarContatos monta telefone e site com fonte', () => {
  const contatos = montarContatos({ telefone: '1133334444', site: 'x.com', confianca: 0.8 });
  assert.deepEqual(contatos, [
    { tipo: 'telefone', valor: '1133334444', fonte: 'google_places', confianca: 0.8 },
    { tipo: 'site', valor: 'x.com', fonte: 'google_places', confianca: 0.8 }
  ]);
});
