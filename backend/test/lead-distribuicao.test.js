const test = require('node:test');
const assert = require('node:assert/strict');

const leadDistribuicaoService = require('../src/services/lead-distribuicao.service');
const { _internals: leadPlanilhaInternals } = require('../src/services/lead-planilha.service');

const {
  adicionarMinutos,
  linhaTemAcaoValida,
  montarMensagemAceiteTelegram,
  montarMensagemEnvioExpiradoTelegram,
  prazoAcaoMinutos,
  tipoAcaoValida
} = leadDistribuicaoService._internals;

test('inicia o prazo de acao 30 minutos depois do aceite por padrao', () => {
  const anterior = process.env.FUTURO_CLIENTE_PRAZO_ACAO_MINUTOS;
  delete process.env.FUTURO_CLIENTE_PRAZO_ACAO_MINUTOS;
  try {
    const aceite = new Date('2026-07-30T15:00:00.000Z');
    assert.equal(prazoAcaoMinutos(), 30);
    assert.equal(adicionarMinutos(aceite, prazoAcaoMinutos()).toISOString(), '2026-07-30T15:30:00.000Z');
  } finally {
    if (anterior === undefined) delete process.env.FUTURO_CLIENTE_PRAZO_ACAO_MINUTOS;
    else process.env.FUTURO_CLIENTE_PRAZO_ACAO_MINUTOS = anterior;
  }
});

test('monta a notificacao de aceite com empresa, CNPJ, consultora e prazo', () => {
  const texto = montarMensagemAceiteTelegram({
    atribuido_em: '2026-07-30T15:00:00.000Z',
    prazo_acao_em: '2026-07-30T15:30:00.000Z'
  }, 'Ana Consultora', {
    id: 42,
    dados_json: { Empresa: 'Empresa de fallback', CNPJ: '00.000.000/0001-00' },
    sondagem: { razao_social: 'Empresa Teste LTDA', cnpj: '12.345.678/0001-90' }
  });

  assert.equal(texto, [
    'Empresa: Empresa Teste LTDA',
    'CNPJ: 12.345.678/0001-90',
    'Data e hora do envio à consultora: 30/07/2026, 12:00',
    '',
    '✅ Indicação aceita por Ana Consultora. Prazo para registrar o contato no CRM: 12:30'
  ].join('\n'));
});

test('monta a mensagem de envio expirado apenas com cancelamento e dados essenciais', () => {
  const texto = montarMensagemEnvioExpiradoTelegram({
    atribuido_em: '2026-07-30T15:00:00.000Z'
  }, {
    id: 42,
    dados_json: { Empresa: 'Empresa de fallback', CNPJ: '00.000.000/0001-00' },
    sondagem: { razao_social: 'Empresa Teste LTDA', cnpj: '12.345.678/0001-90' }
  });

  assert.equal(texto, [
    '⛔ ENVIO CANCELADO',
    'Razão social: Empresa Teste LTDA',
    'CNPJ: 12.345.678/0001-90',
    'Data do envio: 30/07/2026, 12:00'
  ].join('\n'));
});

test('reconhece os desfechos do CRM que impedem a devolucao automatica', () => {
  const casos = [
    [{ venda_id: 10 }, 'venda_registrada'],
    [{ status_operacional: 'vendido' }, 'venda_registrada'],
    [{ cliente_recusou: true }, 'cliente_recusou'],
    [{ venda_recusada_em: '2026-07-30 12:00:00' }, 'venda_recusada'],
    [{ chamada_nao_atendida: true }, 'chamada_nao_atendida'],
    [{ retorno_agendado_em: '2026-07-31 12:00:00' }, 'retorno_agendado'],
    [{ futuro_cliente_retorno: '2026-07-31 12:00:00' }, 'retorno_agendado']
  ];

  for (const [linha, tipo] of casos) {
    assert.equal(linhaTemAcaoValida(linha), true);
    assert.equal(tipoAcaoValida(linha), tipo);
  }
  assert.equal(linhaTemAcaoValida({ status_operacional: 'distribuido_venda' }), false);
  assert.equal(tipoAcaoValida({ status_operacional: 'distribuido_venda' }), null);
});

test('nao considera um retorno antigo como acao feita depois do aceite', () => {
  const aceiteEm = '2026-07-30T15:00:00.000Z';
  assert.equal(linhaTemAcaoValida({
    futuro_cliente_retorno: '2026-07-31T15:00:00.000Z'
  }, aceiteEm), false);
  assert.equal(linhaTemAcaoValida({
    cliente_recusou: true,
    cliente_recusou_em: '2026-07-30T14:59:59.000Z'
  }, aceiteEm), false);
  assert.equal(linhaTemAcaoValida({
    cliente_recusou: true,
    cliente_recusou_em: '2026-07-30T15:00:01.000Z'
  }, aceiteEm), true);
});

test('oculta todos os detalhes do registro enquanto aguarda aceite', () => {
  const linha = {
    id: 42,
    dados_json: { Empresa: 'Empresa sigilosa', Telefone: '11999999999' },
    sondagem: { razao_social: 'Empresa sigilosa', cnpj: '00.000.000/0001-00' },
    futuro_cliente: true,
    futuro_cliente_notas: 'Nao revelar',
    futuro_cliente_marcado_em: '2026-07-30 10:00:00',
    status_operacional: 'distribuido_venda',
    etapa_atual: 'sondagem',
    envio: { nome: 'Empresa sigilosa' }
  };
  const atribuicao = {
    id: 7,
    aceite_status: leadDistribuicaoService.ACEITE_AGUARDANDO
  };

  const ocultada = leadDistribuicaoService.ocultarDetalhesAntesDoAceite(linha, atribuicao);
  assert.equal(ocultada.detalhes_bloqueados, true);
  assert.deepEqual(ocultada.dados_json, {});
  assert.equal(ocultada.sondagem, null);
  assert.equal(ocultada.futuro_cliente_notas, undefined);
  assert.equal(ocultada.envio.nome, 'Nova indicacao aguardando aceite');
  assert.equal(JSON.stringify(ocultada).includes('Empresa sigilosa'), false);
  assert.equal(JSON.stringify(ocultada).includes('11999999999'), false);
});

test('libera o registro completo depois do aceite', () => {
  const linha = {
    id: 42,
    dados_json: { Empresa: 'Empresa liberada' },
    sondagem: { razao_social: 'Empresa liberada' }
  };
  const atribuicao = {
    id: 7,
    aceite_status: leadDistribuicaoService.ACEITE_ACEITO,
    prazo_acao_em: '2026-07-30 15:30:00'
  };

  const liberada = leadDistribuicaoService.ocultarDetalhesAntesDoAceite(linha, atribuicao);
  assert.equal(liberada.detalhes_bloqueados, false);
  assert.equal(liberada.dados_json.Empresa, 'Empresa liberada');
  assert.equal(liberada.distribuicao.status, leadDistribuicaoService.ACEITE_ACEITO);
});

test('conta a indicacao pendente no cartao antes de vincular a linha ao envio', () => {
  const metricas = leadPlanilhaInternals.combinarMetricasEnvio({
    totalLinhas: 0,
    totalTrabalhados: 0,
    totalRecusados: 0,
    totalNaoAtendidos: 0,
    totalFuturos: 0
  }, 1);

  assert.equal(metricas.totalLinhas, 1);
  assert.equal(metricas.totalATrabalhar, 1);
  assert.equal(metricas.totalTrabalhados, 0);
});

test('lista indicacao pendente sem permitir busca pelos detalhes protegidos', () => {
  assert.equal(leadPlanilhaInternals.filtrosPermitemIndicacaoPendente({}), true);
  assert.equal(leadPlanilhaInternals.filtrosPermitemIndicacaoPendente({ status: 'futuro_cliente' }), true);
  assert.equal(leadPlanilhaInternals.filtrosPermitemIndicacaoPendente({ status: 'venda_registrada' }), false);
  assert.equal(leadPlanilhaInternals.filtrosPermitemIndicacaoPendente({ busca: 'empresa sigilosa' }), false);
});
