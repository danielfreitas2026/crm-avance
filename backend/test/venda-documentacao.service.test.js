const test = require('node:test');
const assert = require('node:assert/strict');

const dashboardIntegracaoService = require('../src/services/dashboard-integracao.service');
const vendaArquivoService = require('../src/services/venda-arquivo.service');
const vendaDocumentacaoService = require('../src/services/venda-documentacao.service');

test('regra efetiva aceita documento fisico ou qualquer arquivo ativo', () => {
  assert.equal(vendaDocumentacaoService.possuiDocumentacao({ possui_doc_na_casa: true, total_arquivos: 0 }), true);
  assert.equal(vendaDocumentacaoService.possuiDocumentacao({ possui_doc_na_casa: false, total_arquivos: 1 }), true);
  assert.equal(vendaDocumentacaoService.possuiDocumentacao({ possui_doc_na_casa: false, total_arquivos: 0 }), false);
});

test('sincroniza dashboard somente quando o estado efetivo da documentacao muda', async () => {
  const obterOriginal = vendaDocumentacaoService.obterEstadoDocumentacao;
  const sincronizarOriginal = dashboardIntegracaoService.sincronizarDocumentacaoAtualizada;
  const chamadas = [];
  const estadosAtuais = [true, false, true];

  vendaDocumentacaoService.obterEstadoDocumentacao = async () => estadosAtuais.shift();
  dashboardIntegracaoService.sincronizarDocumentacaoAtualizada = async vendaId => chamadas.push(vendaId);
  try {
    await vendaArquivoService._internals.sincronizarDashboardSeDocumentacaoMudou(12, false);
    await vendaArquivoService._internals.sincronizarDashboardSeDocumentacaoMudou(12, true);
    await vendaArquivoService._internals.sincronizarDashboardSeDocumentacaoMudou(12, true);
    assert.deepEqual(chamadas, [12, 12]);
  } finally {
    vendaDocumentacaoService.obterEstadoDocumentacao = obterOriginal;
    dashboardIntegracaoService.sincronizarDocumentacaoAtualizada = sincronizarOriginal;
  }
});
