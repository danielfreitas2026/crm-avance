const test = require('node:test');
const assert = require('node:assert/strict');
const leadPlanilhaController = require('../src/controllers/lead-planilha.controller');
const leadPlanilhaService = require('../src/services/lead-planilha.service');
const leadVendaVinculoManualService = require('../src/services/lead-venda-vinculo-manual.service');

function criarResposta() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

async function testarRespostaEnriquecida(nomeMetodoController, nomeMetodoVinculo, vendaId) {
  const originalVinculo = leadVendaVinculoManualService[nomeMetodoVinculo];
  const originalBuscar = leadPlanilhaService.buscarLinhaFormatada;
  const chamadas = [];
  leadVendaVinculoManualService[nomeMetodoVinculo] = async () => ({ venda_id: vendaId });
  leadPlanilhaService.buscarLinhaFormatada = async (...args) => {
    chamadas.push(args);
    return {
      linha: {
        id: 8,
        venda_id: vendaId,
        venda_classificacao: vendaId ? { tipo: 'venda_futuro_cliente', venda_id: vendaId } : null,
        distribuicao: null,
        estado_atual: { codigo: vendaId ? 'venda_registrada' : 'na_carteira' }
      }
    };
  };

  const resposta = criarResposta();
  try {
    await leadPlanilhaController[nomeMetodoController]({
      params: { id: '8' },
      body: { venda_id: vendaId },
      usuario: { id: 3 }
    }, resposta);
  } finally {
    leadVendaVinculoManualService[nomeMetodoVinculo] = originalVinculo;
    leadPlanilhaService.buscarLinhaFormatada = originalBuscar;
  }

  assert.equal(resposta.statusCode, 200);
  assert.deepEqual(chamadas, [['8', { incluirEstadoAtual: true }]]);
  assert.ok(Object.hasOwn(resposta.body.linha, 'venda_classificacao'));
  assert.ok(Object.hasOwn(resposta.body.linha, 'distribuicao'));
  assert.ok(Object.hasOwn(resposta.body.linha, 'estado_atual'));
  return resposta.body.linha;
}

test('vinculo administrativo devolve a linha com venda e estado canonico', async () => {
  const linha = await testarRespostaEnriquecida('adminVincularVenda', 'vincularVenda', 21);
  assert.equal(linha.venda_classificacao.tipo, 'venda_futuro_cliente');
  assert.equal(linha.estado_atual.codigo, 'venda_registrada');
});

test('desvinculo administrativo recalcula o estado canonico da linha', async () => {
  const linha = await testarRespostaEnriquecida('adminDesvincularVenda', 'desvincularVenda', null);
  assert.equal(linha.venda_classificacao, null);
  assert.equal(linha.estado_atual.codigo, 'na_carteira');
});
