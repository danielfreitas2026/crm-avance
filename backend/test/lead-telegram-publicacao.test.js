const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const service = require('../src/services/lead-telegram-publicacao.service');
const { calcularAtrasoRetentativa, processarItem } = service._internals;

test('retentativa do Telegram cresce exponencialmente de 30 segundos ate 30 minutos', () => {
  assert.equal(calcularAtrasoRetentativa(1), 30 * 1000);
  assert.equal(calcularAtrasoRetentativa(2), 60 * 1000);
  assert.equal(calcularAtrasoRetentativa(7), 30 * 60 * 1000);
  assert.equal(calcularAtrasoRetentativa(50), 30 * 60 * 1000);
});

test('falha do Telegram conserva a republicacao para sucesso posterior', async () => {
  const item = { id: 9, lead_linha_id: 42, tentativas: 1 };
  const falhas = [];
  const publicacoes = [];
  const erroAnterior = console.error;
  console.error = () => {};
  try {
    const falhou = await processarItem(item, {
      validarLinha: async () => true,
      carregarLinha: async id => ({ id }),
      enviar: async () => ({ enviado: false, motivo: 'Telegram indisponivel' }),
      marcarFalha: async (tarefa, error) => falhas.push({ tarefa, error }),
      registrar: async (...args) => { publicacoes.push(args); return true; }
    });
    assert.equal(falhou.falhou, true);
    assert.equal(falhas.length, 1);
    assert.equal(publicacoes.length, 0);

    const recuperou = await processarItem({ ...item, tentativas: 2 }, {
      validarLinha: async () => true,
      carregarLinha: async id => ({ id }),
      enviar: async () => ({ enviado: true, message_id: 777 }),
      marcarFalha: async () => assert.fail('nao deveria registrar nova falha'),
      registrar: async (...args) => { publicacoes.push(args); return true; }
    });
    assert.equal(recuperou.publicado, true);
    assert.equal(publicacoes.length, 1);
    assert.equal(publicacoes[0][0], 42);
    assert.equal(publicacoes[0][1].message_id, 777);
  } finally {
    console.error = erroAnterior;
  }
});

test('claim atomico impede envio duplicado entre dois workers e em ciclos repetidos', async () => {
  const item = { id: 9, lead_linha_id: 42, tentativas: 1 };
  let disponivel = true;
  let envios = 0;
  const reivindicar = async () => {
    if (!disponivel) return null;
    disponivel = false;
    return item;
  };
  const opcoes = {
    reivindicar,
    validarLinha: async () => true,
    carregarLinha: async id => ({ id }),
    enviar: async () => { envios += 1; return { enviado: true, message_id: 777 }; },
    registrar: async () => true
  };

  const resultados = await Promise.all([
    service.processarRepublicacaoDaLinha(42, opcoes),
    service.processarRepublicacaoDaLinha(42, opcoes)
  ]);
  const repetido = await service.processarRepublicacaoDaLinha(42, opcoes);

  assert.equal(envios, 1);
  assert.equal(resultados.filter(resultado => resultado.publicado).length, 1);
  assert.equal(resultados.filter(resultado => resultado.processado === false).length, 1);
  assert.deepEqual(repetido, { processado: false });
});

test('tarefa deixa de publicar quando o lead foi reatribuido antes do envio', async () => {
  let enviou = false;
  let ignorou = false;
  const resultado = await processarItem({ id: 9, lead_linha_id: 42, tentativas: 1 }, {
    validarLinha: async () => false,
    enviar: async () => { enviou = true; },
    marcarIgnorado: async () => { ignorou = true; }
  });

  assert.equal(resultado.ignorado, true);
  assert.equal(ignorou, true);
  assert.equal(enviou, false);
});

test('migration protege atribuicoes atuais e adiciona metadados duraveis da fila', () => {
  const arquivo = path.join(__dirname, '../src/database/migrations/20260819130000_fix_futuro_cliente_prazos_e_republicacao.js');
  const conteudo = fs.readFileSync(arquivo, 'utf8');

  assert.match(conteudo, /proxima_tentativa_em/);
  assert.match(conteudo, /ultimo_erro/);
  assert.match(conteudo, /aceite_status = 'aceito'/);
  assert.match(conteudo, /acao_registrada_tipo IS NULL/);
  assert.match(conteudo, /INTERVAL 30 MINUTE/);
  assert.match(conteudo, /ELSE DATE_ADD\(UTC_TIMESTAMP\(\), INTERVAL 30 MINUTE\)/);
});
