const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const service = require('../src/services/lead-telegram-publicacao.service');
const { calcularAtrasoRetentativa, montarContextoPublicacao, processarItem } = service._internals;

test('classifica como novo somente quando nao existe atribuicao de venda encerrada', () => {
  assert.deepEqual(montarContextoPublicacao(null), { tipo: 'novo' });
});

test('monta os motivos de retorno para todos os encerramentos da distribuicao', () => {
  const cenarios = [
    ['recusado', 'Recusado pela consultora anterior'],
    ['cancelado', 'Envio anterior cancelado'],
    ['expirado_sem_aceite', 'Prazo para aceitar a indicação expirado'],
    ['expirado_sem_acao', 'Prazo de contato expirado sem ação registrada no CRM'],
    ['expirado_apos_retorno', 'Retorno agendado venceu sem novo desfecho registrado no CRM']
  ];

  for (const [aceiteStatus, motivo] of cenarios) {
    assert.deepEqual(montarContextoPublicacao({
      aceite_status: aceiteStatus,
      usuario_nome: 'Beatriz Consultora'
    }), {
      tipo: 'retorno',
      aceite_status_anterior: aceiteStatus,
      motivo_retorno: motivo,
      responsavel_anterior: 'Beatriz Consultora'
    });
  }
});

test('prioriza motivo persistido e identifica usuario anterior removido', () => {
  assert.deepEqual(montarContextoPublicacao({
    aceite_status: 'recusado',
    cancelamento_motivo: 'Sem disponibilidade para assumir o contato',
    usuario_nome: null
  }), {
    tipo: 'retorno',
    aceite_status_anterior: 'recusado',
    motivo_retorno: 'Sem disponibilidade para assumir o contato',
    responsavel_anterior: 'Usuário removido ou não informado'
  });
});

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
      reconciliacaoPendente: async () => false,
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
      reconciliacaoPendente: async () => false,
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
    reconciliacaoPendente: async () => false,
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

test('republicacao preserva o contexto de retorno ao enviar a mensagem', async () => {
  const contexto = {
    tipo: 'retorno',
    motivo_retorno: 'Envio anterior cancelado',
    responsavel_anterior: 'Ana Consultora'
  };
  let linhaEnviada = null;

  const resultado = await processarItem({ id: 9, lead_linha_id: 42, tentativas: 1 }, {
    validarLinha: async () => true,
    reconciliacaoPendente: async () => false,
    carregarLinha: async id => ({ id, contexto_publicacao_telegram: contexto }),
    enviar: async linha => {
      linhaEnviada = linha;
      return { enviado: true, message_id: 777 };
    },
    registrar: async () => true
  });

  assert.equal(resultado.publicado, true);
  assert.deepEqual(linhaEnviada.contexto_publicacao_telegram, contexto);
});

test('republicacao aguarda o encerramento da mensagem anterior e envia uma unica vez apos recuperar', async () => {
  const item = { id: 9, lead_linha_id: 42, tentativas: 1 };
  const falhas = [];
  let pendente = true;
  let envios = 0;
  const erroAnterior = console.error;
  console.error = () => {};
  try {
    const bloqueado = await processarItem(item, {
      validarLinha: async () => true,
      reconciliacaoPendente: async () => pendente,
      carregarLinha: async () => assert.fail('nao deve carregar antes da reconciliacao'),
      enviar: async () => { envios += 1; },
      marcarFalha: async (tarefa, error) => falhas.push({ tarefa, error })
    });

    assert.equal(bloqueado.falhou, true);
    assert.equal(envios, 0);
    assert.equal(falhas.length, 1);

    pendente = false;
    const recuperado = await processarItem({ ...item, tentativas: 2 }, {
      validarLinha: async () => true,
      reconciliacaoPendente: async () => pendente,
      carregarLinha: async id => ({ id }),
      enviar: async () => { envios += 1; return { enviado: true, message_id: 777 }; },
      registrar: async () => true,
      marcarFalha: async () => assert.fail('nao deveria falhar apos a reconciliacao')
    });

    assert.equal(recuperado.publicado, true);
    assert.equal(envios, 1);
  } finally {
    console.error = erroAnterior;
  }
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
