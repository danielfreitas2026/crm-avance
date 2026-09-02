const test = require('node:test');
const assert = require('node:assert/strict');

const leadDistribuicaoService = require('../src/services/lead-distribuicao.service');
const { _internals: leadPlanilhaInternals } = require('../src/services/lead-planilha.service');
const { _internals: distribuicaoInternals } = leadDistribuicaoService;

const {
  adicionarMinutos,
  acaoRegistradaImpedeFinalizacao,
  calcularPrazoAcao,
  encerrarMensagemTelegram,
  futuroClientePodeSerDevolvido,
  linhaTemAcaoValida,
  botaoCancelarEnvio,
  enviarNotificacaoVendaFechada,
  enviarNotificacaoRetornoAgendado,
  montarMensagemAceiteTelegram,
  montarMensagemEnvioExpiradoTelegram,
  montarMensagemRetornoAgendadoTelegram,
  montarMensagemVendaFechadaTelegram,
  montarPatchAceite,
  montarPatchLinhaAposFinalizacao,
  montarPatchPrazoRetorno,
  prazoAcaoMinutos,
  prazoAtribuicaoVencido,
  prazoEfetivoAtribuicao,
  queryAtribuicoesVencidas,
  retornoDistribuicaoVencido,
  tipoAcaoValida,
  vendaCorrespondeAtribuicao
} = leadDistribuicaoService._internals;

test('devolucao administrativa ignora retorno registrado e preserva seus dados na linha', () => {
  const atribuicao = {
    aceite_status: leadDistribuicaoService.ACEITE_ACEITO,
    acao_registrada_em: '2026-08-25T12:00:00.000Z',
    acao_registrada_tipo: 'retorno_agendado'
  };

  assert.equal(acaoRegistradaImpedeFinalizacao(atribuicao, false), true);
  assert.equal(acaoRegistradaImpedeFinalizacao(atribuicao, false, true), false);

  const patch = montarPatchLinhaAposFinalizacao(
    { envio_id: 51, usuario_id: 7 },
    new Date('2026-08-25T13:00:00.000Z')
  );
  assert.deepEqual(patch, {
    envio_id: 51,
    atribuido_para_id: 7,
    etapa_atual: 'sondagem',
    status_operacional: 'qualificado',
    updated_at: new Date('2026-08-25T13:00:00.000Z')
  });
  assert.equal(Object.hasOwn(patch, 'retorno_agendado_em'), false);
  assert.equal(Object.hasOwn(patch, 'futuro_cliente_retorno'), false);

  assert.equal(futuroClientePodeSerDevolvido({
    futuro_cliente: true,
    status_operacional: 'distribuido_venda',
    retorno_agendado_em: '2026-08-28 10:00:00'
  }), true);
  assert.equal(futuroClientePodeSerDevolvido({
    futuro_cliente: true,
    status_operacional: 'vendido',
    venda_id: 91
  }), false);
  assert.equal(futuroClientePodeSerDevolvido({
    futuro_cliente: true,
    status_operacional: 'perdido',
    venda_recusada_em: '2026-08-25 10:00:00'
  }), false);
  assert.equal(futuroClientePodeSerDevolvido({
    futuro_cliente: true,
    futuro_cliente_excluido_em: '2026-08-25 10:00:00'
  }), false);
});

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

test('aplica o limite inclusivo e calcula o prazo legado desde o envio', () => {
  const atribuicao = { atribuido_em: '2026-07-30T15:00:00.000Z' };

  assert.equal(prazoEfetivoAtribuicao(atribuicao).toISOString(), '2026-07-30T15:30:00.000Z');
  assert.equal(prazoAtribuicaoVencido(atribuicao, '2026-07-30T15:29:59.999Z'), false);
  assert.equal(prazoAtribuicaoVencido(atribuicao, '2026-07-30T15:30:00.000Z'), true);
  assert.equal(calcularPrazoAcao(new Date('2026-07-30T16:00:00.000Z')).toISOString(), '2026-07-30T16:30:00.000Z');
});

test('prioriza o prazo persistido em atribuicoes novas', () => {
  const atribuicao = {
    atribuido_em: '2026-07-30T15:00:00.000Z',
    prazo_acao_em: '2026-07-30T15:45:00.000Z'
  };

  assert.equal(prazoEfetivoAtribuicao(atribuicao).toISOString(), '2026-07-30T15:45:00.000Z');
  assert.equal(prazoAtribuicaoVencido(atribuicao, '2026-07-30T15:30:00.000Z'), false);
});

test('aceite sem retorno inicia uma janela completa a partir do aceite', () => {
  const agora = new Date('2026-07-30T15:00:00.000Z');
  const patch = montarPatchAceite({}, agora);

  assert.equal(patch.acao_registrada_tipo, null);
  assert.equal(patch.acao_registrada_em, null);
  assert.equal(patch.prazo_acao_em.toISOString(), '2026-07-30T15:30:00.000Z');
});

test('aceite reconhece retorno futuro preexistente e usa retorno mais trinta minutos', () => {
  const agora = new Date('2026-07-30T15:00:00.000Z');
  const patch = montarPatchAceite({ retorno_agendado_em: '2026-07-30T16:00:00.000Z' }, agora);

  assert.equal(patch.acao_registrada_tipo, 'retorno_agendado');
  assert.equal(patch.acao_registrada_em, agora);
  assert.equal(patch.prazo_acao_em.toISOString(), '2026-07-30T16:30:00.000Z');
});

test('aceite com retorno vencido concede trinta minutos a partir do aceite', () => {
  const agora = new Date('2026-07-30T15:00:00.000Z');
  const patch = montarPatchAceite({ futuro_cliente_retorno: '2026-07-30T14:00:00.000Z' }, agora);

  assert.equal(patch.acao_registrada_tipo, 'retorno_agendado');
  assert.equal(patch.prazo_acao_em.toISOString(), '2026-07-30T15:30:00.000Z');
});

test('agenda devolucao para 30 minutos apos o retorno e reinicia prazo ao remover', () => {
  const agora = new Date('2026-07-30T15:00:00.000Z');
  const agendado = montarPatchPrazoRetorno('2026-07-31 15:30:00', agora);
  assert.equal(agendado.acao_registrada_tipo, 'retorno_agendado');
  assert.equal(agendado.acao_registrada_em, agora);
  assert.equal(agendado.prazo_acao_em.toISOString(), '2026-07-31T16:00:00.000Z');

  const removido = montarPatchPrazoRetorno(null, agora);
  assert.equal(removido.acao_registrada_tipo, null);
  assert.equal(removido.acao_registrada_em, null);
  assert.equal(removido.prazo_acao_em.toISOString(), '2026-07-30T15:30:00.000Z');
});

test('revalida o retorno no limite para respeitar remarcacao concorrente', () => {
  assert.equal(retornoDistribuicaoVencido({
    retorno_agendado_em: '2026-07-30 15:00:00'
  }, '2026-07-30T15:29:59.999Z'), false);
  assert.equal(retornoDistribuicaoVencido({
    retorno_agendado_em: '2026-07-30 15:00:00'
  }, '2026-07-30T15:30:00.000Z'), true);
  assert.equal(retornoDistribuicaoVencido({
    retorno_agendado_em: '2026-07-31 15:00:00',
    futuro_cliente_retorno: '2026-07-30 15:00:00'
  }, '2026-07-30T15:30:00.000Z'), false);
});

test('consulta prazos vencidos dos dois estados e inclui fallback legado', () => {
  const consulta = queryAtribuicoesVencidas(new Date('2026-07-30T15:30:00.000Z')).toSQL();

  assert.match(consulta.sql, /`aceite_status` in \(\?, \?\)/);
  assert.match(consulta.sql, /`acao_registrada_em` is null/);
  assert.match(consulta.sql, /`prazo_acao_em` <= \?/);
  assert.match(consulta.sql, /`prazo_acao_em` is null/);
  assert.match(consulta.sql, /`atribuido_em` <= \?/);
  assert.match(consulta.sql, /`acao_registrada_tipo` = \? and `la`\.`prazo_acao_em` is not null and `la`\.`prazo_acao_em` <= \?/i);
  assert.doesNotMatch(consulta.sql, /coalesce\(ll\.retorno_agendado_em, ll\.futuro_cliente_retorno\)/i);
  assert.deepEqual(consulta.bindings.slice(1, 3), [
    leadDistribuicaoService.ACEITE_AGUARDANDO,
    leadDistribuicaoService.ACEITE_ACEITO
  ]);
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

test('identifica a consultora no botao de cancelar envio da mensagem de aceite', () => {
  assert.deepEqual(botaoCancelarEnvio(42, 'Ana Consultora'), {
    text: 'Cancelar envio Ana Consultora',
    callback_data: 'fc:cancelar:42'
  });
  assert.deepEqual(botaoCancelarEnvio(42), {
    text: 'Cancelar envio',
    callback_data: 'fc:cancelar:42'
  });
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
    'Motivo: prazo para registrar uma acao no CRM expirado.',
    'Razão social: Empresa Teste LTDA',
    'CNPJ: 12.345.678/0001-90',
    'Data do envio: 30/07/2026, 12:00'
  ].join('\n'));
});

test('monta a notificacao de aceite exibindo o retorno preexistente', () => {
  const texto = montarMensagemAceiteTelegram({
    atribuido_em: '2026-07-30T15:00:00.000Z',
    prazo_acao_em: '2026-07-31T16:00:00.000Z',
    acao_registrada_tipo: 'retorno_agendado'
  }, 'Ana Consultora', {
    id: 42,
    retorno_agendado_em: '2026-07-31T15:30:00.000Z',
    sondagem: { razao_social: 'Empresa Teste LTDA', cnpj: '12.345.678/0001-90' }
  });

  assert.match(texto, /retorno já agendado para 31\/07\/2026, 12:30/i);
  assert.match(texto, /Prazo para registrar o contato no CRM: 13:00/);
});

test('diferencia no Telegram a expiracao sem aceite', () => {
  const texto = montarMensagemEnvioExpiradoTelegram({
    atribuido_em: '2026-07-30T15:00:00.000Z'
  }, {
    id: 42,
    sondagem: { razao_social: 'Empresa Teste LTDA', cnpj: '12.345.678/0001-90' }
  }, leadDistribuicaoService.ACEITE_EXPIRADO_SEM_ACEITE);

  assert.match(texto, /Motivo: prazo para aceitar a indicacao expirado\./);
  assert.doesNotMatch(texto, /registrar uma acao/);
});

test('diferencia no Telegram a devolucao depois do retorno vencido', () => {
  const texto = montarMensagemEnvioExpiradoTelegram({
    atribuido_em: '2026-07-30T15:00:00.000Z'
  }, {
    id: 42,
    sondagem: { razao_social: 'Empresa Teste LTDA', cnpj: '12.345.678/0001-90' }
  }, leadDistribuicaoService.ACEITE_EXPIRADO_APOS_RETORNO);

  assert.match(texto, /retorno vencido ha 30 minutos sem novo desfecho/);
});

test('exclui a mensagem anterior quando a distribuicao expira automaticamente', async () => {
  const chamadas = [];
  const resultado = await encerrarMensagemTelegram({
    lead_linha_id: 42,
    telegram_chat_id: '-100123',
    telegram_message_id: '777'
  }, 'prazo expirado', leadDistribuicaoService.ACEITE_EXPIRADO, {
    carregarLinha: async id => ({ id, sondagem: { razao_social: 'Empresa Teste' } }),
    chamarApi: async (metodo, dados) => {
      chamadas.push({ metodo, dados });
      return true;
    },
    propagarErro: true
  });

  assert.deepEqual(resultado, { excluida: true });
  assert.deepEqual(chamadas, [{
    metodo: 'deleteMessage',
    dados: { chat_id: '-100123', message_id: '777' }
  }]);
});

test('neutraliza a mensagem sem botoes quando o Telegram nao permite exclui-la', async () => {
  const chamadas = [];
  const resultado = await encerrarMensagemTelegram({
    lead_linha_id: 42,
    telegram_chat_id: '-100123',
    telegram_message_id: '777'
  }, 'prazo expirado', leadDistribuicaoService.ACEITE_EXPIRADO, {
    carregarLinha: async id => ({ id, sondagem: { razao_social: 'Empresa Teste' } }),
    chamarApi: async (metodo, dados) => {
      chamadas.push({ metodo, dados });
      if (metodo === 'deleteMessage') throw new Error('not enough rights to delete messages');
      return true;
    },
    propagarErro: true
  });

  assert.deepEqual(resultado, { atualizada: true });
  assert.deepEqual(chamadas.map(item => item.metodo), ['deleteMessage', 'editMessageText']);
  assert.deepEqual(chamadas[1].dados.reply_markup, { inline_keyboard: [] });
  assert.match(chamadas[1].dados.text, /ENVIO CANCELADO/);
});

test('considera encerrada uma mensagem que ja nao existe no Telegram', async () => {
  const resultado = await encerrarMensagemTelegram({
    lead_linha_id: 42,
    telegram_chat_id: '-100123',
    telegram_message_id: '777'
  }, 'prazo expirado', leadDistribuicaoService.ACEITE_EXPIRADO, {
    chamarApi: async () => { throw new Error('Bad Request: message to delete not found'); },
    propagarErro: true
  });

  assert.deepEqual(resultado, { ausente: true });
});

test('propaga a falha quando nao consegue excluir nem neutralizar a mensagem antiga', async () => {
  const erroAnterior = console.error;
  console.error = () => {};
  try {
    await assert.rejects(() => encerrarMensagemTelegram({
      lead_linha_id: 42,
      telegram_chat_id: '-100123',
      telegram_message_id: '777'
    }, 'prazo expirado', leadDistribuicaoService.ACEITE_EXPIRADO, {
      carregarLinha: async id => ({ id, sondagem: { razao_social: 'Empresa Teste' } }),
      chamarApi: async metodo => {
        throw new Error(metodo === 'deleteMessage' ? 'falha ao excluir' : 'falha ao editar');
      },
      propagarErro: true
    }), /falha ao editar/);
  } finally {
    console.error = erroAnterior;
  }
});

test('monta mensagem de retorno com razao social, CNPJ, consultora e horario', () => {
  const texto = montarMensagemRetornoAgendadoTelegram({
    consultora_nome: 'Ana Consultora'
  }, {
    id: 42,
    dados_json: { Empresa: 'Empresa de fallback' },
    sondagem: { razao_social: 'Empresa Teste LTDA', cnpj: '12.345.678/0001-90' }
  }, '2026-07-31 15:30:00');

  assert.equal(texto, [
    '📅 RETORNO AGENDADO',
    'Razão social: Empresa Teste LTDA',
    'CNPJ: 12.345.678/0001-90',
    'Consultora: Ana Consultora',
    'Retorno: 31/07/2026, 12:30'
  ].join('\n'));
});

test('mantem o botao de cancelamento e envia o retorno ao grupo da atribuicao aceita', async () => {
  const chamadas = [];
  const resultado = await enviarNotificacaoRetornoAgendado({
    aceite_status: leadDistribuicaoService.ACEITE_ACEITO,
    lead_linha_id: 42,
    telegram_chat_id: '-100123',
    telegram_message_id: '777',
    consultora_nome: 'Ana Consultora'
  }, {
    id: 42,
    sondagem: { razao_social: 'Empresa Teste', cnpj: '12.345.678/0001-90' }
  }, '2026-07-31 15:30:00', {
    chamarApi: async (metodo, dados) => {
      chamadas.push({ metodo, dados });
      return metodo === 'sendMessage' ? { message_id: 889 } : {};
    }
  });

  assert.equal(resultado.enviado, true);
  assert.equal(resultado.botao_atualizado, true);
  assert.equal(resultado.message_id, 889);
  assert.deepEqual(chamadas.map(item => item.metodo), ['editMessageReplyMarkup', 'sendMessage']);
  assert.deepEqual(chamadas[0].dados.reply_markup.inline_keyboard, [[{
    text: 'Cancelar envio Ana Consultora',
    callback_data: 'fc:cancelar:42'
  }]]);
  assert.match(chamadas[1].dados.text, /Consultora: Ana Consultora/);
  assert.match(chamadas[1].dados.text, /Retorno: 31\/07\/2026, 12:30/);
});

test('nao envia retorno sem atribuicao aceita e isola falhas do Telegram', async () => {
  assert.deepEqual(await enviarNotificacaoRetornoAgendado({
    aceite_status: leadDistribuicaoService.ACEITE_AGUARDANDO,
    telegram_chat_id: '-100123'
  }, {}, '2026-07-31 15:30:00'), {
    enviado: false,
    motivo: 'atribuicao_nao_aceita'
  });

  const erroAnterior = console.error;
  console.error = () => {};
  try {
    const resultado = await enviarNotificacaoRetornoAgendado({
      aceite_status: leadDistribuicaoService.ACEITE_ACEITO,
      telegram_chat_id: '-100123',
      telegram_message_id: '777'
    }, { id: 42 }, '2026-07-31 15:30:00', {
      chamarApi: async () => { throw new Error('Telegram indisponivel'); }
    });
    assert.equal(resultado.enviado, false);
    assert.equal(resultado.botao_atualizado, false);
    assert.deepEqual(resultado.erros.map(item => item.operacao), ['atualizar_botao', 'enviar_mensagem']);
  } finally {
    console.error = erroAnterior;
  }
});

test('worker separa expiracao sem aceite e sem acao e protege contra concorrencia', async () => {
  const chamadas = [];
  const expiradas = await leadDistribuicaoService.processarPrazosVencidos({
    agora: new Date('2026-07-30T15:30:00.000Z'),
    vencidas: [
      { id: 11, lead_linha_id: 41, aceite_status: leadDistribuicaoService.ACEITE_AGUARDANDO },
      { id: 12, lead_linha_id: 42, aceite_status: leadDistribuicaoService.ACEITE_ACEITO },
      { id: 13, lead_linha_id: 43, aceite_status: leadDistribuicaoService.ACEITE_ACEITO },
      {
        id: 14,
        lead_linha_id: 44,
        aceite_status: leadDistribuicaoService.ACEITE_ACEITO,
        acao_registrada_tipo: 'retorno_agendado'
      }
    ],
    finalizar: async (linhaId, opcoes) => {
      chamadas.push({ linhaId, opcoes });
      if (linhaId === 43) return { acaoEncontrada: true };
      return { linhaId };
    }
  });

  assert.equal(expiradas, 3);
  assert.deepEqual(chamadas.map(item => item.opcoes.aceiteStatus), [
    leadDistribuicaoService.ACEITE_EXPIRADO_SEM_ACEITE,
    leadDistribuicaoService.ACEITE_EXPIRADO,
    leadDistribuicaoService.ACEITE_EXPIRADO,
    leadDistribuicaoService.ACEITE_EXPIRADO_APOS_RETORNO
  ]);
  assert.deepEqual(chamadas.map(item => item.opcoes.aceiteStatusEsperado), [
    leadDistribuicaoService.ACEITE_AGUARDANDO,
    leadDistribuicaoService.ACEITE_ACEITO,
    leadDistribuicaoService.ACEITE_ACEITO,
    leadDistribuicaoService.ACEITE_ACEITO
  ]);
  assert.deepEqual(chamadas.map(item => item.opcoes.atribuicaoIdEsperada), [11, 12, 13, 14]);
  assert.equal(chamadas.every(item => item.opcoes.validarPrazoVencido), true);
  assert.equal(chamadas.every(item => item.opcoes.processarTelegram === false), true);
  assert.equal(chamadas[3].opcoes.permitirRetornoVencido, true);
});

test('worker e idempotente quando a atribuicao ja foi encerrada por outra execucao', async () => {
  const vencida = { id: 11, lead_linha_id: 41, aceite_status: leadDistribuicaoService.ACEITE_AGUARDANDO };
  let ativa = true;
  const finalizar = async () => {
    if (!ativa) return null;
    ativa = false;
    return { linhaId: 41 };
  };

  assert.equal(await leadDistribuicaoService.processarPrazosVencidos({ vencidas: [vencida], finalizar }), 1);
  assert.equal(await leadDistribuicaoService.processarPrazosVencidos({ vencidas: [vencida], finalizar }), 0);
});

test('monta o aviso de venda fechada com consultora, cliente, chips e valores', () => {
  const texto = montarMensagemVendaFechadaTelegram({
    id: 91,
    origem_lead_linha_id: 42,
    criado_por_id: 7,
    razao_social: 'Empresa Teste LTDA',
    cnpj: '12.345.678/0001-90',
    valores_unitarios_chips: JSON.stringify([
      { quantidade: 2, valor_unitario: 49.9 },
      { quantidade: 1, valor_unitario: 79.9 }
    ]),
    quantidade_linhas: 3,
    valor_total: 179.7
  }, {
    lead_linha_id: 42,
    usuario_id: 7,
    consultora_nome: 'Ana Consultora'
  });

  assert.match(texto, /^🎉 VENDA FECHADA/);
  assert.match(texto, /Ana Consultora fechou uma venda/);
  assert.match(texto, /Razão social: Empresa Teste LTDA/);
  assert.match(texto, /CNPJ: 12\.345\.678\/0001-90/);
  assert.match(texto, /Quantidade de chips: 3/);
  assert.match(texto, /- 2 chip\(s\): R\$\s?49,90 cada/);
  assert.match(texto, /- 1 chip\(s\): R\$\s?79,90 cada/);
  assert.match(texto, /Valor total da venda: R\$\s?179,70/);
  assert.match(texto, /Venda: #91/);
  assert.match(texto, /Futuro cliente: #42/);
});

test('usa quantidade de linhas como fallback quando nao ha itens de chips', () => {
  const texto = montarMensagemVendaFechadaTelegram({
    id: 92,
    quantidade_linhas: 4
  }, { lead_linha_id: 43 });

  assert.match(texto, /Razão social: Não informada/);
  assert.match(texto, /CNPJ: Não informado/);
  assert.match(texto, /Quantidade de chips: 4/);
  assert.match(texto, /Valores unitários:\nNão informado/);
  assert.match(texto, /Valor total da venda: Não informado/);
});

test('sinaliza venda registrada e envia o aviso de venda fechada ao mesmo grupo', async () => {
  const chamadas = [];
  const venda = {
    id: 91,
    origem_lead_linha_id: 42,
    criado_por_id: 7,
    razao_social: 'Empresa Teste',
    quantidade_linhas: 2,
    valor_total: 100
  };
  const atribuicao = {
    lead_linha_id: 42,
    usuario_id: 7,
    etapa: 'venda',
    telegram_chat_id: '-100123',
    telegram_message_id: '777',
    consultora_nome: 'Ana Consultora'
  };

  const resultado = await enviarNotificacaoVendaFechada(venda, atribuicao, {
    chamarApi: async (metodo, dados) => {
      chamadas.push({ metodo, dados });
      return metodo === 'sendMessage' ? { message_id: 888 } : {};
    }
  });

  assert.equal(resultado.enviado, true);
  assert.equal(resultado.botao_atualizado, true);
  assert.equal(resultado.message_id, 888);
  assert.deepEqual(chamadas.map(item => item.metodo), ['editMessageReplyMarkup', 'sendMessage']);
  assert.equal(chamadas[0].dados.chat_id, '-100123');
  assert.equal(chamadas[0].dados.message_id, '777');
  assert.deepEqual(chamadas[0].dados.reply_markup, {
    inline_keyboard: [[{ text: '✅ Venda registrada', callback_data: 'fc:info:42:venda' }]]
  });
  assert.equal(chamadas[1].dados.chat_id, '-100123');
  assert.match(chamadas[1].dados.text, /Ana Consultora fechou uma venda/);
});

test('nao notifica venda direta ou atribuicao de outra consultora', async () => {
  const atribuicao = {
    lead_linha_id: 42,
    usuario_id: 7,
    etapa: 'venda',
    telegram_chat_id: '-100123',
    telegram_message_id: '777'
  };
  let chamadas = 0;
  const chamarApi = async () => { chamadas += 1; };

  assert.equal(vendaCorrespondeAtribuicao({ id: 1, criado_por_id: 7 }, atribuicao), false);
  assert.equal(vendaCorrespondeAtribuicao({ id: 2, origem_lead_linha_id: 42, criado_por_id: 8 }, atribuicao), false);
  assert.deepEqual(
    await enviarNotificacaoVendaFechada({ id: 2, origem_lead_linha_id: 42, criado_por_id: 8 }, atribuicao, { chamarApi }),
    { enviado: false, motivo: 'atribuicao_nao_corresponde' }
  );
  assert.equal(chamadas, 0);
});

test('venda vinculada corresponde quando a responsavel e vendedora principal ou compartilhada', () => {
  const atribuicao = { lead_linha_id: 42, usuario_id: 7, etapa: 'venda' };

  assert.equal(vendaCorrespondeAtribuicao({
    origem_lead_linha_id: 42,
    criado_por_id: 8,
    vendedora_id: 7
  }, atribuicao), true);
  assert.equal(vendaCorrespondeAtribuicao({
    origem_lead_linha_id: 42,
    criado_por_id: 8,
    vendedora_id: 9,
    vendedoras_ids: [9, 7]
  }, atribuicao), true);
});

test('falhas do Telegram nao interrompem o processamento da venda fechada', async () => {
  const erroAnterior = console.error;
  console.error = () => {};
  try {
    const resultado = await enviarNotificacaoVendaFechada({
      id: 91,
      origem_lead_linha_id: 42,
      criado_por_id: 7
    }, {
      lead_linha_id: 42,
      usuario_id: 7,
      etapa: 'venda',
      telegram_chat_id: '-100123',
      telegram_message_id: '777'
    }, {
      chamarApi: async () => { throw new Error('Telegram indisponivel'); }
    });

    assert.equal(resultado.enviado, false);
    assert.equal(resultado.botao_atualizado, false);
    assert.deepEqual(resultado.erros.map(item => item.operacao), ['atualizar_botao', 'enviar_mensagem']);
  } finally {
    console.error = erroAnterior;
  }
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

test('reconhece desfecho registrado enquanto ainda aguardava aceite', () => {
  const enviadoEm = '2026-07-30T15:00:00.000Z';

  assert.equal(linhaTemAcaoValida({ venda_id: 10 }, enviadoEm), true);
  assert.equal(linhaTemAcaoValida({
    cliente_recusou: true,
    cliente_recusou_em: '2026-07-30T15:05:00.000Z'
  }, enviadoEm), true);
  assert.equal(linhaTemAcaoValida({
    cliente_recusou: true,
    cliente_recusou_em: '2026-07-30T14:59:59.000Z'
  }, enviadoEm), false);
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

test('mantem o botao de cancelar apos o aceite, inclusive com retorno agendado', async () => {
  const teclado = await distribuicaoInternals.montarTecladoAtribuicao({
    lead_linha_id: 42,
    aceite_status: leadDistribuicaoService.ACEITE_ACEITO,
    acao_registrada_tipo: 'retorno_agendado',
    consultora_nome: 'Ana Consultora'
  }, { buscarVendaVinculada: async () => null });

  assert.deepEqual(teclado, {
    inline_keyboard: [[{ text: 'Cancelar envio Ana Consultora', callback_data: 'fc:cancelar:42' }]]
  });
});

test('troca o cancelamento pelo selo quando a venda esta vinculada a consultora', async () => {
  const teclado = await distribuicaoInternals.montarTecladoAtribuicao({
    lead_linha_id: 42,
    aceite_status: leadDistribuicaoService.ACEITE_ACEITO,
    consultora_nome: 'Ana Consultora'
  }, { buscarVendaVinculada: async () => ({ id: 91 }) });

  assert.deepEqual(teclado, {
    inline_keyboard: [[{ text: '✅ Venda registrada', callback_data: 'fc:info:42:venda' }]]
  });
});

test('aguardando aceite nao consulta vendas e mantem o cancelamento', async () => {
  let consultas = 0;
  const teclado = await distribuicaoInternals.montarTecladoAtribuicao({
    lead_linha_id: 42,
    aceite_status: leadDistribuicaoService.ACEITE_AGUARDANDO,
    consultora_nome: 'Ana Consultora'
  }, { buscarVendaVinculada: async () => { consultas += 1; return { id: 91 }; } });

  assert.equal(consultas, 0);
  assert.equal(teclado.inline_keyboard[0][0].callback_data, 'fc:cancelar:42');
});

test('envio cancelado conserva o selo informativo na mensagem encerrada', async () => {
  const chamadas = [];
  const resultado = await encerrarMensagemTelegram({
    lead_linha_id: 42,
    telegram_chat_id: '-100123',
    telegram_message_id: '777',
    telegram_mensagem_texto: 'NOVO FUTURO CLIENTE'
  }, 'cancelado para Ana Consultora', leadDistribuicaoService.ACEITE_CANCELADO, {
    chamarApi: async (metodo, dados) => {
      chamadas.push({ metodo, dados });
      return true;
    },
    propagarErro: true
  });

  assert.deepEqual(resultado, { atualizada: true });
  assert.deepEqual(chamadas.map(item => item.metodo), ['editMessageText']);
  assert.match(chamadas[0].dados.text, /ENVIO CANCELADO/);
  assert.deepEqual(chamadas[0].dados.reply_markup, {
    inline_keyboard: [[{ text: '⛔ Envio cancelado', callback_data: 'fc:info:42:cancelado' }]]
  });
});

test('recusa e expiracao continuam encerrando a mensagem sem botoes', async () => {
  assert.deepEqual(distribuicaoInternals.tecladoEncerramento({ lead_linha_id: 42 }, leadDistribuicaoService.ACEITE_RECUSADO), []);
  assert.deepEqual(distribuicaoInternals.tecladoEncerramento({ lead_linha_id: 42 }, leadDistribuicaoService.ACEITE_EXPIRADO), []);
});
