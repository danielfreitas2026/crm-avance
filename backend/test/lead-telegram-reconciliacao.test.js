const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const service = require('../src/services/lead-telegram-reconciliacao.service');
const { calcularAtrasoRetentativa, processarItem } = service._internals;

test('retentativa da reconciliacao cresce de 30 segundos ate 30 minutos', () => {
  assert.equal(calcularAtrasoRetentativa(1), 30 * 1000);
  assert.equal(calcularAtrasoRetentativa(2), 60 * 1000);
  assert.equal(calcularAtrasoRetentativa(50), 30 * 60 * 1000);
});

test('falha ao trocar o botao fica pendente e uma nova tentativa pode sincronizar', async () => {
  const item = { id: 5, lead_atribuicao_id: 91, tentativas: 1 };
  const falhas = [];
  const sincronizados = [];
  const erroAnterior = console.error;
  console.error = () => {};
  try {
    const falhou = await processarItem(item, async () => {
      throw new Error('Telegram indisponivel');
    }, {
      marcarFalha: async (tarefa, error) => falhas.push({ tarefa, error }),
      marcarSincronizado: async tarefa => sincronizados.push(tarefa)
    });
    assert.equal(falhou.falhou, true);
    assert.equal(falhas.length, 1);
    assert.equal(sincronizados.length, 0);

    const recuperou = await processarItem({ ...item, tentativas: 2 }, async atribuicaoId => {
      assert.equal(atribuicaoId, 91);
    }, {
      marcarFalha: async () => assert.fail('nao deveria falhar novamente'),
      marcarSincronizado: async tarefa => sincronizados.push(tarefa)
    });
    assert.equal(recuperou.sincronizado, true);
    assert.equal(sincronizados.length, 1);
  } finally {
    console.error = erroAnterior;
  }
});

test('claim atomico evita reconciliar a mesma atribuicao em paralelo', async () => {
  let disponivel = true;
  let edicoes = 0;
  const reivindicar = async () => {
    if (!disponivel) return null;
    disponivel = false;
    return { id: 5, lead_atribuicao_id: 91, tentativas: 1 };
  };
  const reconciliar = async () => { edicoes += 1; };
  const opcoes = { reivindicar, marcarSincronizado: async () => {} };

  const resultados = await Promise.all([
    service.processarDaAtribuicao(91, reconciliar, opcoes),
    service.processarDaAtribuicao(91, reconciliar, opcoes)
  ]);

  assert.equal(edicoes, 1);
  assert.equal(resultados.filter(item => item.sincronizado).length, 1);
  assert.equal(resultados.filter(item => item.processado === false).length, 1);
});

test('migration cria fila duravel unica por atribuicao', () => {
  const arquivo = path.join(__dirname, '../src/database/migrations/20260821120000_create_lead_telegram_atualizacoes.js');
  const conteudo = fs.readFileSync(arquivo, 'utf8');
  assert.match(conteudo, /lead_atribuicao_id/);
  assert.match(conteudo, /proxima_tentativa_em/);
  assert.match(conteudo, /ultimo_erro/);
  assert.match(conteudo, /sincronizado_em/);
  assert.match(conteudo, /unique\(\['lead_atribuicao_id'\]\)/);
});
