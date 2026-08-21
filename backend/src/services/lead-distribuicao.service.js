const db = require('../database/connection');
const notificacaoService = require('./notificacao.service');
const telegramService = require('./telegram.service');
const leadTelegramPublicacaoService = require('./lead-telegram-publicacao.service');
const leadTelegramReconciliacaoService = require('./lead-telegram-reconciliacao.service');
const { parseUtcDateTime } = require('../utils/datetime');

const ACEITE_AGUARDANDO = 'aguardando_aceite';
const ACEITE_ACEITO = 'aceito';
const ACEITE_RECUSADO = 'recusado';
const ACEITE_CANCELADO = 'cancelado';
const ACEITE_EXPIRADO = 'expirado_sem_acao';
const ACEITE_EXPIRADO_SEM_ACEITE = 'expirado_sem_aceite';
const ACEITE_EXPIRADO_APOS_RETORNO = 'expirado_apos_retorno';

function prazoAcaoMinutos() {
  const configurado = Number(process.env.FUTURO_CLIENTE_PRAZO_ACAO_MINUTOS || 30);
  return Number.isFinite(configurado) && configurado > 0 ? Math.floor(configurado) : 30;
}

function adicionarMinutos(data, minutos) {
  return new Date(data.getTime() + minutos * 60 * 1000);
}

function calcularPrazoAcao(data = new Date()) {
  return adicionarMinutos(data, prazoAcaoMinutos());
}

function prazoEfetivoAtribuicao(atribuicao) {
  if (!atribuicao) return null;
  const valor = atribuicao.prazo_acao_em || atribuicao.atribuido_em;
  if (!valor) return null;
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return null;
  return atribuicao.prazo_acao_em ? data : calcularPrazoAcao(data);
}

function prazoAtribuicaoVencido(atribuicao, agora = new Date()) {
  const prazo = prazoEfetivoAtribuicao(atribuicao);
  const referencia = new Date(agora);
  return Boolean(
    prazo
    && !Number.isNaN(referencia.getTime())
    && prazo.getTime() <= referencia.getTime()
  );
}

function montarPatchAceite(linha, agora = new Date()) {
  const retorno = parseUtcDateTime(linha?.retorno_agendado_em || linha?.futuro_cliente_retorno);
  const prazoPadrao = calcularPrazoAcao(agora);
  const prazoRetorno = retorno ? calcularPrazoAcao(retorno) : null;
  const prazo = prazoRetorno && prazoRetorno.getTime() > prazoPadrao.getTime()
    ? prazoRetorno
    : prazoPadrao;

  return {
    aceite_status: ACEITE_ACEITO,
    aceite_em: agora,
    acao_registrada_em: retorno ? agora : null,
    acao_registrada_tipo: retorno ? 'retorno_agendado' : null,
    prazo_acao_em: prazo,
    updated_at: agora
  };
}

function retornoDistribuicaoVencido(linha, agora = new Date()) {
  const retorno = parseUtcDateTime(linha?.retorno_agendado_em || linha?.futuro_cliente_retorno);
  const referencia = new Date(agora);
  return Boolean(
    retorno
    && !Number.isNaN(referencia.getTime())
    && calcularPrazoAcao(retorno).getTime() <= referencia.getTime()
  );
}

function parseJson(valor, fallback = {}) {
  if (valor && typeof valor === 'object') return valor;
  try {
    return valor ? JSON.parse(valor) : fallback;
  } catch {
    return fallback;
  }
}

function obterNomeEmpresa(dadosJson, linhaId, razaoSocial = '') {
  if (razaoSocial) return String(razaoSocial).trim();
  const dados = parseJson(dadosJson);
  const entrada = Object.entries(dados).find(([chave, valor]) => {
    const nome = String(chave || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return valor && ['razao social', 'empresa', 'nome fantasia', 'nome'].some(termo => nome.includes(termo));
  });
  return String(entrada?.[1] || `Futuro cliente #${linhaId}`).trim();
}

function obterCnpjEmpresa(dadosJson, cnpj = '') {
  if (cnpj) return String(cnpj).trim();
  const dados = parseJson(dadosJson);
  const entrada = Object.entries(dados).find(([chave, valor]) => {
    const nome = String(chave || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return valor && nome.includes('cnpj');
  });
  return String(entrada?.[1] || 'Não informado').trim();
}

function dataEmOuDepois(valor, limite) {
  if (!valor) return false;
  if (!limite) return true;
  const data = new Date(valor);
  const inicio = new Date(limite);
  return !Number.isNaN(data.getTime())
    && !Number.isNaN(inicio.getTime())
    && data.getTime() >= inicio.getTime();
}

function linhaTemAcaoValida(linha, aceiteEm = null) {
  if (!linha) return false;
  if (aceiteEm) {
    return Boolean(
      linha.venda_id
      || linha.status_operacional === 'vendido'
      || (linha.cliente_recusou && dataEmOuDepois(linha.cliente_recusou_em, aceiteEm))
      || dataEmOuDepois(linha.venda_recusada_em, aceiteEm)
      || (linha.chamada_nao_atendida && dataEmOuDepois(linha.chamada_nao_atendida_em, aceiteEm))
    );
  }
  return Boolean(
    linha.venda_id
    || linha.status_operacional === 'vendido'
    || linha.status_operacional === 'perdido'
    || linha.cliente_recusou
    || linha.venda_recusada_em
    || linha.chamada_nao_atendida
    || linha.retorno_agendado_em
    || linha.futuro_cliente_retorno
  );
}

function tipoAcaoValida(linha, aceiteEm = null) {
  if (linha?.venda_id || linha?.status_operacional === 'vendido') return 'venda_registrada';
  if (linha?.cliente_recusou && (!aceiteEm || dataEmOuDepois(linha.cliente_recusou_em, aceiteEm))) return 'cliente_recusou';
  if (dataEmOuDepois(linha?.venda_recusada_em, aceiteEm)) return 'venda_recusada';
  if (linha?.status_operacional === 'perdido' && !aceiteEm) return 'venda_recusada';
  if (linha?.chamada_nao_atendida && (!aceiteEm || dataEmOuDepois(linha.chamada_nao_atendida_em, aceiteEm))) return 'chamada_nao_atendida';
  if (!aceiteEm && linha?.retorno_agendado_em) return 'retorno_agendado';
  if (!aceiteEm && linha?.futuro_cliente_retorno) return 'retorno_agendado';
  return null;
}

async function buscarAtribuicaoAtiva(linhaId, trx = db) {
  return trx('lead_atribuicoes')
    .where({ lead_linha_id: Number(linhaId), etapa: 'venda' })
    .whereIn('aceite_status', [ACEITE_AGUARDANDO, ACEITE_ACEITO])
    .orderBy('id', 'desc')
    .first();
}

async function obterDistribuicoesUsuario(linhaIds, usuarioId, trx = db) {
  const ids = Array.from(new Set((linhaIds || []).map(Number).filter(Boolean)));
  if (!ids.length) return new Map();

  const query = trx('lead_atribuicoes as la')
    .leftJoin('usuarios as u', 'u.id', 'la.usuario_id')
    .whereIn('la.lead_linha_id', ids)
    .where('la.etapa', 'venda')
    .whereNotNull('la.aceite_status')
    .select('la.*', 'u.nome as usuario_nome')
    .orderBy('la.id', 'desc');
  if (usuarioId) query.where('la.usuario_id', Number(usuarioId));
  const atribuicoes = await query;

  const mapa = new Map();
  for (const atribuicao of atribuicoes) {
    if (!mapa.has(Number(atribuicao.lead_linha_id))) {
      mapa.set(Number(atribuicao.lead_linha_id), atribuicao);
    }
  }
  return mapa;
}

function dadosDistribuicao(atribuicao) {
  if (!atribuicao) return null;
  return {
    id: Number(atribuicao.id),
    status: atribuicao.aceite_status,
    aceite_em: atribuicao.aceite_em || null,
    prazo_acao_em: atribuicao.prazo_acao_em || null,
    acao_registrada_em: atribuicao.acao_registrada_em || null,
    acao_registrada_tipo: atribuicao.acao_registrada_tipo || null,
    usuario_id: Number(atribuicao.usuario_id) || null,
    usuario_nome: atribuicao.usuario_nome || null,
    atribuido_em: atribuicao.atribuido_em || null,
    finalizado_em: atribuicao.finalizado_em || null,
    motivo_resultado: atribuicao.motivo_resultado || null,
    cancelamento_motivo: atribuicao.cancelamento_motivo || null
  };
}

function ocultarDetalhesAntesDoAceite(linha, atribuicao) {
  if (!atribuicao || atribuicao.aceite_status !== ACEITE_AGUARDANDO) {
    return { ...linha, distribuicao: dadosDistribuicao(atribuicao), detalhes_bloqueados: false };
  }

  return {
    id: linha.id,
    futuro_cliente: true,
    futuro_cliente_marcado_em: linha.futuro_cliente_marcado_em,
    status_operacional: linha.status_operacional,
    etapa_atual: linha.etapa_atual,
    dados_json: {},
    sondagem: null,
    envio: { nome: 'Nova indicacao aguardando aceite' },
    distribuicao: dadosDistribuicao(atribuicao),
    detalhes_bloqueados: true
  };
}

async function aceitar(linhaId, usuarioId) {
  const agora = new Date();

  const resultado = await db.transaction(async trx => {
    const linha = await trx('lead_linhas')
      .where('id', Number(linhaId))
      .forUpdate()
      .first();
    const atribuicao = await trx('lead_atribuicoes')
      .where({
        lead_linha_id: Number(linhaId),
        usuario_id: Number(usuarioId),
        etapa: 'venda',
        aceite_status: ACEITE_AGUARDANDO
      })
      .orderBy('id', 'desc')
      .forUpdate()
      .first();
    if (!atribuicao) {
      const atual = await trx('lead_atribuicoes')
        .where({ lead_linha_id: Number(linhaId), usuario_id: Number(usuarioId), etapa: 'venda' })
        .orderBy('id', 'desc')
        .first();
      if (atual?.aceite_status === ACEITE_ACEITO) {
        return { atribuicao: atual, repetido: true };
      }
      const error = new Error('Esta indicação não está mais aguardando o seu aceite.');
      error.statusCode = 409;
      throw error;
    }

    if (prazoAtribuicaoVencido(atribuicao, agora)) {
      return { atribuicao, expirouSemAceite: true };
    }

    if (
      !linha
      || !linha.futuro_cliente
      || linha.futuro_cliente_excluido_em
      || linha.status_operacional !== 'distribuido_venda'
    ) {
      const error = new Error('Esta indicacao nao esta mais disponivel para aceite.');
      error.statusCode = 409;
      throw error;
    }

    const patchAceite = montarPatchAceite(linha, agora);
    await trx('lead_atribuicoes').where('id', atribuicao.id).update(patchAceite);
    await leadTelegramReconciliacaoService.enfileirar(atribuicao.id, trx, agora);
    await trx('lead_linhas').where('id', linha.id).update({
      atribuido_para_id: Number(usuarioId),
      envio_id: atribuicao.envio_id,
      etapa_atual: 'venda',
      status_operacional: 'distribuido_venda',
      updated_at: agora
    });
    const sondagem = await trx('lead_sondagens').where('lead_linha_id', linha.id).first('razao_social', 'cnpj');
    await trx('lead_envios').where('id', atribuicao.envio_id).update({
      nome: obterNomeEmpresa(linha.dados_json, linha.id, sondagem?.razao_social).slice(0, 240),
      updated_at: agora
    });
    await notificacaoService.atualizarNotificacaoFuturoClienteAceito({
      leadLinhaId: linha.id,
      vendedoraId: usuarioId,
      prazoAcaoEm: patchAceite.prazo_acao_em
    }, trx);

    return {
      atribuicao: { ...atribuicao, ...patchAceite },
      linha: { ...linha, sondagem }
    };
  });

  if (resultado.expirouSemAceite) {
    await finalizarAtribuicao(linhaId, {
      aceiteStatus: ACEITE_EXPIRADO_SEM_ACEITE,
      aceiteStatusEsperado: ACEITE_AGUARDANDO,
      atribuicaoIdEsperada: resultado.atribuicao.id,
      motivo: 'Prazo para aceitar a indicacao expirado',
      validarPrazoVencido: true,
      republicar: true,
      silencioso: true
    });
    const error = new Error('O prazo para aceitar esta indicacao expirou. Ela foi devolvida para novo encaminhamento.');
    error.statusCode = 409;
    throw error;
  }

  if (resultado.repetido) {
    await leadTelegramReconciliacaoService.enfileirar(resultado.atribuicao.id);
  }
  await leadTelegramReconciliacaoService.processarDaAtribuicao(
    resultado.atribuicao.id,
    reconciliarMensagemTelegram
  );
  return {
    status: ACEITE_ACEITO,
    prazo_acao_em: resultado.atribuicao.prazo_acao_em
  };
}

async function registrarAcaoValida(linhaId, usuarioId, tipo, trx = null) {
  const knex = trx || db;
  const agora = new Date();
  const query = knex('lead_atribuicoes')
    .where({
      lead_linha_id: Number(linhaId),
      etapa: 'venda',
      aceite_status: ACEITE_ACEITO
    })
    .whereNull('acao_registrada_em');
  if (usuarioId) query.where('usuario_id', Number(usuarioId));

  const atualizadas = await query.orderBy('id', 'desc').limit(1).update({
    acao_registrada_em: agora,
    acao_registrada_tipo: String(tipo || 'acao_crm').slice(0, 64),
    updated_at: agora
  });

  if (atualizadas) {
    await notificacaoService.desativarAlertasObrigatoriosDaLinha(linhaId, trx);
  }
  return atualizadas;
}

function montarPatchPrazoRetorno(retorno, agora = new Date()) {
  const dataRetorno = retorno ? parseUtcDateTime(retorno) : null;
  if (retorno && !dataRetorno) throw new Error('Data de retorno invalida.');
  return {
    acao_registrada_em: dataRetorno ? agora : null,
    acao_registrada_tipo: dataRetorno ? 'retorno_agendado' : null,
    prazo_acao_em: calcularPrazoAcao(dataRetorno || agora),
    updated_at: agora
  };
}

async function atualizarPrazoRetorno(linhaId, usuarioId, retorno, trx = null) {
  const knex = trx || db;
  const agora = new Date();
  const query = knex('lead_atribuicoes')
    .where({
      lead_linha_id: Number(linhaId),
      etapa: 'venda',
      aceite_status: ACEITE_ACEITO
    })
    .where(builder => builder
      .whereNull('acao_registrada_tipo')
      .orWhere('acao_registrada_tipo', 'retorno_agendado'));
  if (usuarioId) query.where('usuario_id', Number(usuarioId));

  const atribuicao = await query.clone().orderBy('id', 'desc').first('id');
  const atualizadas = atribuicao
    ? await knex('lead_atribuicoes').where('id', atribuicao.id)
      .update(montarPatchPrazoRetorno(retorno, agora))
    : 0;

  if (atualizadas) {
    await notificacaoService.desativarAlertasObrigatoriosDaLinha(linhaId, trx);
    await leadTelegramReconciliacaoService.enfileirar(atribuicao.id, knex, agora);
  }
  return atualizadas;
}

async function carregarLinhaTelegram(linhaId) {
  const linha = await db('lead_linhas').where('id', Number(linhaId)).first();
  if (!linha) return null;
  const sondagem = await db('lead_sondagens as ls')
    .leftJoin('usuarios as u', 'u.id', 'ls.usuario_id')
    .leftJoin('operadoras as oa', 'oa.id', 'ls.operadora_atual_id')
    .leftJoin('operadoras as oi', 'oi.id', 'ls.operadora_interesse_id')
    .where('ls.lead_linha_id', Number(linhaId))
    .select('ls.*', 'u.nome as usuario_nome', 'oa.nome as operadora_atual_nome', 'oi.nome as operadora_interesse_nome')
    .first();

  return {
    ...linha,
    dados_json: parseJson(linha.dados_json),
    sondagem: sondagem ? {
      ...sondagem,
      chips_itens: parseJson(sondagem.chips_itens, []),
      usuario: { nome: sondagem.usuario_nome },
      operadoraAtual: { nome: sondagem.operadora_atual_nome },
      operadoraInteresse: { nome: sondagem.operadora_interesse_nome }
    } : null
  };
}

function montarMensagemAceiteTelegram(atribuicao, nomeConsultora, linha = {}) {
  const prazo = new Date(atribuicao.prazo_acao_em);
  const horaPrazoBase = Number.isNaN(prazo.getTime())
    ? 'Não informado'
    : prazo.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo'
    });
  const retorno = parseUtcDateTime(linha.retorno_agendado_em || linha.futuro_cliente_retorno);
  const retornoFormatado = retorno?.toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo'
  });
  const horaPrazo = atribuicao.acao_registrada_tipo === 'retorno_agendado' && retorno
    ? `${horaPrazoBase} (retorno já agendado para ${retornoFormatado})`
    : horaPrazoBase;
  const sondagem = linha.sondagem || {};
  const empresa = obterNomeEmpresa(linha.dados_json, linha.id, sondagem.razao_social);
  const cnpj = obterCnpjEmpresa(linha.dados_json, sondagem.cnpj);
  const enviadoEm = new Date(atribuicao.atribuido_em);
  const dataHoraEnvio = Number.isNaN(enviadoEm.getTime())
    ? 'Não informado'
    : enviadoEm.toLocaleString('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo'
    });

  return [
    `Empresa: ${empresa}`,
    `CNPJ: ${cnpj}`,
    `Data e hora do envio à consultora: ${dataHoraEnvio}`,
    '',
    `✅ Indicação aceita por ${nomeConsultora || 'consultor(a)'}. Prazo para registrar o contato no CRM: ${horaPrazo}`
  ].join('\n');
}

function montarMensagemEnvioExpiradoTelegram(atribuicao, linha = {}, aceiteStatusFinal = ACEITE_EXPIRADO) {
  const sondagem = linha.sondagem || {};
  const empresa = obterNomeEmpresa(linha.dados_json, linha.id, sondagem.razao_social);
  const cnpj = obterCnpjEmpresa(linha.dados_json, sondagem.cnpj);
  const enviadoEm = new Date(atribuicao.atribuido_em);
  const dataEnvio = Number.isNaN(enviadoEm.getTime())
    ? 'Não informada'
    : enviadoEm.toLocaleString('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo'
    });

  return [
    '⛔ ENVIO CANCELADO',
    aceiteStatusFinal === ACEITE_EXPIRADO_SEM_ACEITE
      ? 'Motivo: prazo para aceitar a indicacao expirado.'
      : aceiteStatusFinal === ACEITE_EXPIRADO_APOS_RETORNO
        ? `Motivo: retorno vencido ha ${prazoAcaoMinutos()} minutos sem novo desfecho no CRM.`
        : 'Motivo: prazo para registrar uma acao no CRM expirado.',
    `Razão social: ${empresa}`,
    `CNPJ: ${cnpj}`,
    `Data do envio: ${dataEnvio}`
  ].join('\n');
}

function montarMensagemRetornoAgendadoTelegram(atribuicao, linha = {}, retorno) {
  const sondagem = linha.sondagem || {};
  const empresa = obterNomeEmpresa(linha.dados_json, linha.id, sondagem.razao_social);
  const cnpj = obterCnpjEmpresa(linha.dados_json, sondagem.cnpj);
  const dataRetorno = parseUtcDateTime(retorno);
  const retornoFormatado = !dataRetorno
    ? 'Nao informado'
    : dataRetorno.toLocaleString('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo'
    });

  return [
    '📅 RETORNO AGENDADO',
    `Razão social: ${empresa}`,
    `CNPJ: ${cnpj}`,
    `Consultora: ${atribuicao.consultora_nome || 'Nao informada'}`,
    `Retorno: ${retornoFormatado}`
  ].join('\n');
}

function botaoCancelarEnvio(linhaId, nomeConsultora) {
  const nome = String(nomeConsultora || '').trim();
  return {
    text: nome ? `Cancelar envio ${nome}` : 'Cancelar envio',
    callback_data: `fc:cancelar:${linhaId}`
  };
}

function normalizarItensChipsVenda(valor) {
  if (Array.isArray(valor)) return valor;
  try {
    const itens = valor ? JSON.parse(valor) : [];
    return Array.isArray(itens) ? itens : [];
  } catch {
    return [];
  }
}

function formatarMoedaVenda(valor) {
  if (valor === null || valor === undefined || String(valor).trim() === '') return 'Não informado';
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return 'Não informado';
  return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function montarMensagemVendaFechadaTelegram(venda = {}, atribuicao = {}) {
  const itensChips = normalizarItensChipsVenda(venda.valores_unitarios_chips)
    .map(item => ({
      quantidade: Number(item?.quantidade || 0),
      valorUnitario: Number(item?.valor_unitario)
    }))
    .filter(item => item.quantidade > 0);
  const quantidadeItens = itensChips.reduce((total, item) => total + item.quantidade, 0);
  const quantidadeFallback = Number(venda.quantidade_linhas || 0);
  const quantidadeChips = quantidadeItens > 0
    ? quantidadeItens
    : (quantidadeFallback > 0 ? quantidadeFallback : 'Não informado');
  const valoresUnitarios = itensChips.length
    ? itensChips.map(item => `- ${item.quantidade} chip(s): ${formatarMoedaVenda(item.valorUnitario)} cada`)
    : ['Não informado'];

  return [
    '🎉 VENDA FECHADA',
    '',
    `${atribuicao.consultora_nome || 'Consultora não informada'} fechou uma venda com o futuro cliente encaminhado.`,
    '',
    `Consultora: ${atribuicao.consultora_nome || 'Não informada'}`,
    `Razão social: ${venda.razao_social || venda.nome || 'Não informada'}`,
    `CNPJ: ${venda.cnpj || 'Não informado'}`,
    `Quantidade de chips: ${quantidadeChips}`,
    'Valores unitários:',
    ...valoresUnitarios,
    `Valor total da venda: ${formatarMoedaVenda(venda.valor_total)}`,
    '',
    `Venda: #${venda.id || 'Não informado'}`,
    `Futuro cliente: #${atribuicao.lead_linha_id || venda.origem_lead_linha_id || 'Não informado'}`
  ].join('\n');
}

function vendaCorrespondeAtribuicao(venda = {}, atribuicao = {}) {
  const vendedorasIds = new Set([
    Number(venda.vendedora_id),
    ...(Array.isArray(venda.vendedoras_ids) ? venda.vendedoras_ids.map(Number) : [])
  ].filter(Boolean));
  const consultoraCorresponde = Number(venda.criado_por_id) === Number(atribuicao.usuario_id)
    || vendedorasIds.has(Number(atribuicao.usuario_id));
  return Number(venda.origem_lead_linha_id) > 0
    && Number(venda.origem_lead_linha_id) === Number(atribuicao.lead_linha_id)
    && consultoraCorresponde
    && atribuicao.etapa === 'venda';
}

async function enviarNotificacaoVendaFechada(venda, atribuicao, opcoes = {}) {
  if (!vendaCorrespondeAtribuicao(venda, atribuicao)) {
    return { enviado: false, motivo: 'atribuicao_nao_corresponde' };
  }
  const chatId = String(atribuicao.telegram_chat_id || '').trim();
  const messageId = String(atribuicao.telegram_message_id || '').trim();
  if (!chatId || !messageId) return { enviado: false, motivo: 'mensagem_telegram_nao_encontrada' };

  const chamarApi = opcoes.chamarApi || telegramService.chamarApi;
  const resultado = { enviado: false, botao_removido: false, erros: [] };
  try {
    await chamarApi('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] }
    });
    resultado.botao_removido = true;
  } catch (error) {
    resultado.erros.push({ operacao: 'remover_botao', mensagem: error.message });
    console.error('Erro ao remover botao de cancelamento da venda fechada no Telegram:', error.message);
  }

  try {
    const mensagem = await chamarApi('sendMessage', {
      chat_id: chatId,
      text: montarMensagemVendaFechadaTelegram(venda, atribuicao),
      disable_web_page_preview: true
    });
    resultado.enviado = true;
    resultado.message_id = mensagem?.message_id || null;
  } catch (error) {
    resultado.erros.push({ operacao: 'enviar_mensagem', mensagem: error.message });
    console.error('Erro ao notificar venda fechada no Telegram:', error.message);
  }
  return resultado;
}

async function enviarNotificacaoRetornoAgendado(atribuicao, linha, retorno, opcoes = {}) {
  if (atribuicao?.aceite_status !== ACEITE_ACEITO) {
    return { enviado: false, motivo: 'atribuicao_nao_aceita' };
  }
  const chatId = String(atribuicao.telegram_chat_id || '').trim();
  if (!chatId) return { enviado: false, motivo: 'chat_telegram_nao_encontrado' };

  const chamarApi = opcoes.chamarApi || telegramService.chamarApi;
  const resultado = { enviado: false, botao_removido: false, erros: [] };
  if (atribuicao.telegram_message_id) {
    try {
      await chamarApi('editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: String(atribuicao.telegram_message_id),
        reply_markup: { inline_keyboard: [] }
      });
      resultado.botao_removido = true;
    } catch (error) {
      resultado.erros.push({ operacao: 'remover_botao', mensagem: error.message });
      console.error('Erro ao remover botao de cancelamento do retorno agendado no Telegram:', error.message);
    }
  }

  try {
    const mensagem = await chamarApi('sendMessage', {
      chat_id: chatId,
      text: montarMensagemRetornoAgendadoTelegram(atribuicao, linha, retorno),
      disable_web_page_preview: true
    });
    resultado.enviado = true;
    resultado.message_id = mensagem?.message_id || null;
  } catch (error) {
    resultado.erros.push({ operacao: 'enviar_mensagem', mensagem: error.message });
    console.error('Erro ao notificar retorno agendado no Telegram:', error.message);
  }
  return resultado;
}

async function notificarRetornoAgendadoTelegram(linhaId, retorno, opcoes = {}) {
  try {
    const [atribuicao, linha] = await Promise.all([
      db('lead_atribuicoes as la')
        .leftJoin('usuarios as u', 'u.id', 'la.usuario_id')
        .where({
          'la.lead_linha_id': Number(linhaId),
          'la.etapa': 'venda',
          'la.aceite_status': ACEITE_ACEITO
        })
        .orderBy('la.id', 'desc')
        .select('la.*', 'u.nome as consultora_nome')
        .first(),
      carregarLinhaTelegram(linhaId)
    ]);
    if (!atribuicao || !linha) return { enviado: false, motivo: 'atribuicao_ou_linha_nao_encontrada' };
    return enviarNotificacaoRetornoAgendado(atribuicao, linha, retorno, opcoes);
  } catch (error) {
    console.error('Erro ao preparar notificacao de retorno agendado no Telegram:', error.message);
    return { enviado: false, motivo: 'erro_ao_preparar_notificacao', erro: error.message };
  }
}

async function notificarVendaFechadaTelegram(vendaId, atribuicaoId, opcoes = {}) {
  const [venda, atribuicao, vendedoras] = await Promise.all([
    db('vendas').where('id', Number(vendaId)).first(),
    db('lead_atribuicoes as la')
      .leftJoin('usuarios as u', 'u.id', 'la.usuario_id')
      .where('la.id', Number(atribuicaoId))
      .select('la.*', 'u.nome as consultora_nome')
      .first(),
    db('venda_vendedoras').where('venda_id', Number(vendaId)).select('usuario_id')
  ]);
  if (!venda || !atribuicao) return { enviado: false, motivo: 'venda_ou_atribuicao_nao_encontrada' };
  return enviarNotificacaoVendaFechada({
    ...venda,
    vendedoras_ids: vendedoras.map(item => Number(item.usuario_id))
  }, atribuicao, opcoes);
}

async function encerrarMensagemTelegram(atribuicao, textoStatus, aceiteStatusFinal, opcoes = {}) {
  const chatId = atribuicao.telegram_chat_id || process.env.TELEGRAM_FUTUROS_CLIENTES_CHAT_ID;
  if (!chatId || !atribuicao.telegram_message_id) return;
  const original = String(atribuicao.telegram_mensagem_texto || 'Futuro cliente encaminhado.');
  const chamarApi = opcoes.chamarApi || telegramService.chamarApi;
  const carregarLinha = opcoes.carregarLinha || carregarLinhaTelegram;
  const expiradoAutomaticamente = [
    ACEITE_EXPIRADO,
    ACEITE_EXPIRADO_SEM_ACEITE,
    ACEITE_EXPIRADO_APOS_RETORNO
  ].includes(aceiteStatusFinal);

  if (expiradoAutomaticamente) {
    try {
      await chamarApi('deleteMessage', {
        chat_id: chatId,
        message_id: atribuicao.telegram_message_id
      });
      return { excluida: true };
    } catch (error) {
      if (/message to delete not found/i.test(String(error?.message || ''))) {
        return { ausente: true };
      }
    }
  }

  try {
    const linha = expiradoAutomaticamente
      ? await carregarLinha(atribuicao.lead_linha_id)
      : null;
    const texto = expiradoAutomaticamente
      ? montarMensagemEnvioExpiradoTelegram(atribuicao, linha || {}, aceiteStatusFinal)
      : `\u26D4 ENVIO CANCELADO - ${textoStatus}\n\n${original}`.slice(0, 4096);
    await chamarApi('editMessageText', {
      chat_id: chatId,
      message_id: atribuicao.telegram_message_id,
      text: texto,
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [] }
    });
    return { atualizada: true };
  } catch (error) {
    if (/message is not modified/i.test(String(error?.message || ''))) return;
    if (/message to edit not found/i.test(String(error?.message || ''))) return { ausente: true };
    console.error('Erro ao marcar envio cancelado no Telegram:', error.message);
    if (opcoes.propagarErro) throw error;
    return { atualizada: false };
  }
}

function textoStatusAtribuicao(atribuicao) {
  const nome = atribuicao.consultora_nome || 'consultor(a)';
  if (atribuicao.aceite_status === ACEITE_RECUSADO) return `recusado por ${nome}`;
  if (atribuicao.aceite_status === ACEITE_EXPIRADO_SEM_ACEITE) return `prazo de ${prazoAcaoMinutos()} minutos expirado sem aceite de ${nome}`;
  if (atribuicao.aceite_status === ACEITE_EXPIRADO) return `prazo de ${prazoAcaoMinutos()} minutos expirado sem acao no CRM para ${nome}`;
  if (atribuicao.aceite_status === ACEITE_EXPIRADO_APOS_RETORNO) return `retorno vencido ha ${prazoAcaoMinutos()} minutos sem novo desfecho para ${nome}`;
  return `cancelado${atribuicao.consultora_nome ? ` para ${atribuicao.consultora_nome}` : ''}`;
}

async function editarMensagemTelegram(metodo, dados) {
  try {
    return await telegramService.chamarApi(metodo, dados);
  } catch (error) {
    if (/message is not modified/i.test(String(error?.message || ''))) return null;
    throw error;
  }
}

async function reconciliarMensagemTelegram(atribuicaoId) {
  const atribuicao = await db('lead_atribuicoes as la')
    .leftJoin('usuarios as u', 'u.id', 'la.usuario_id')
    .where('la.id', Number(atribuicaoId))
    .select('la.*', 'u.nome as consultora_nome')
    .first();
  if (!atribuicao) return { ignorado: true };
  const chatId = atribuicao.telegram_chat_id || process.env.TELEGRAM_FUTUROS_CLIENTES_CHAT_ID;
  if (!chatId || !atribuicao.telegram_message_id) return { ignorado: true };

  if (atribuicao.aceite_status === ACEITE_AGUARDANDO) {
    await editarMensagemTelegram('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: atribuicao.telegram_message_id,
      reply_markup: { inline_keyboard: [[botaoCancelarEnvio(atribuicao.lead_linha_id, atribuicao.consultora_nome)]] }
    });
    return { sincronizado: true };
  }

  if (atribuicao.aceite_status === ACEITE_ACEITO) {
    if (atribuicao.acao_registrada_tipo === 'retorno_agendado') {
      await editarMensagemTelegram('editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: atribuicao.telegram_message_id,
        reply_markup: { inline_keyboard: [] }
      });
      return { sincronizado: true };
    }
    const linha = await carregarLinhaTelegram(atribuicao.lead_linha_id);
    await editarMensagemTelegram('editMessageText', {
      chat_id: chatId,
      message_id: atribuicao.telegram_message_id,
      text: montarMensagemAceiteTelegram(atribuicao, atribuicao.consultora_nome, linha || {}),
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[botaoCancelarEnvio(atribuicao.lead_linha_id, atribuicao.consultora_nome)]] }
    });
    return { sincronizado: true };
  }

  await encerrarMensagemTelegram(
    atribuicao,
    textoStatusAtribuicao(atribuicao),
    atribuicao.aceite_status,
    { propagarErro: true }
  );
  return { sincronizado: true };
}

function deveRepublicarPendenteAntiga(linha, possuiEncaminhamentoDeVenda) {
  return Boolean(
    linha
    && linha.futuro_cliente
    && !linha.futuro_cliente_excluido_em
    && linha.status_operacional === 'qualificado'
    && linha.futuro_cliente_destino !== 'carteira'
    && !possuiEncaminhamentoDeVenda
  );
}

async function republicarPendentesAntigosNoTelegram() {
  const pendentes = await db('lead_linhas as ll')
    .where({ 'll.futuro_cliente': true, 'll.status_operacional': 'qualificado' })
    .whereNull('ll.futuro_cliente_excluido_em')
    .where(builder => builder.whereNull('ll.futuro_cliente_destino').orWhere('ll.futuro_cliente_destino', 'distribuicao'))
    .whereNotExists(function semEncaminhamentoDeVenda() {
      this.select('*')
        .from('lead_atribuicoes as la')
        .whereRaw('la.lead_linha_id = ll.id')
        .where('la.etapa', 'venda');
    })
    .select('ll.id');

  let publicados = 0;
  let falhas = 0;
  for (const pendente of pendentes) {
    const linhaId = Number(pendente.id);
    await leadTelegramPublicacaoService.enfileirarRepublicacao(linhaId);
    const resultado = await leadTelegramPublicacaoService.processarRepublicacaoDaLinha(linhaId, {
      carregarLinha: carregarLinhaTelegram
    });
    if (resultado.publicado) publicados += 1;
    if (resultado.falhou) falhas += 1;
  }
  return { encontrados: pendentes.length, publicados, falhas };
}

async function finalizarAtribuicao(linhaId, opcoes = {}) {
  const aceiteStatusFinal = opcoes.aceiteStatus || ACEITE_CANCELADO;
  const agora = new Date();
  const resultado = await db.transaction(async trx => {
    const linha = await trx('lead_linhas')
      .where('id', Number(linhaId))
      .forUpdate()
      .first();
    const queryAtribuicao = trx('lead_atribuicoes')
      .where({ lead_linha_id: Number(linhaId), etapa: 'venda' })
      .whereIn('aceite_status', [ACEITE_AGUARDANDO, ACEITE_ACEITO]);
    if (opcoes.aceiteStatusEsperado) {
      queryAtribuicao.where('aceite_status', opcoes.aceiteStatusEsperado);
    }
    if (opcoes.atribuicaoIdEsperada) {
      queryAtribuicao.where('id', Number(opcoes.atribuicaoIdEsperada));
    }
    const atribuicao = await queryAtribuicao.orderBy('id', 'desc').forUpdate().first();
    if (!atribuicao) {
      if (opcoes.silencioso) return null;
      const error = new Error('Este futuro cliente nao possui um envio ativo.');
      error.statusCode = 409;
      throw error;
    }
    if (opcoes.usuarioId && Number(atribuicao.usuario_id) !== Number(opcoes.usuarioId)) {
      const error = new Error('Esta indicacao nao foi encaminhada para voce.');
      error.statusCode = 403;
      throw error;
    }
    if (!linha) return null;
    const expirandoRetorno = opcoes.permitirRetornoVencido
      && atribuicao.acao_registrada_tipo === 'retorno_agendado';
    if ((opcoes.validarPrazoVencido || expirandoRetorno) && !prazoAtribuicaoVencido(atribuicao, agora)) {
      return { prazoAtualizado: true };
    }
    if (atribuicao.aceite_status === ACEITE_ACEITO && atribuicao.acao_registrada_em && !expirandoRetorno) {
      return { acaoEncontrada: true };
    }

    const inicioJanelaAcao = atribuicao.aceite_em || atribuicao.atribuido_em;
    if (linhaTemAcaoValida(linha, inicioJanelaAcao)) {
      await trx('lead_atribuicoes').where('id', atribuicao.id).update({
        acao_registrada_em: agora,
        acao_registrada_tipo: tipoAcaoValida(linha, inicioJanelaAcao),
        updated_at: agora
      });
      await trx('notificacoes')
        .where('source_key', `futuro_cliente_distribuido:${Number(linhaId)}`)
        .update({ ativa: false, updated_at: agora });
      return { acaoEncontrada: true };
    }

    const atribuicaoSondagem = await trx('lead_atribuicoes')
      .where({ lead_linha_id: Number(linhaId), etapa: 'sondagem' })
      .orderBy('id', 'desc')
      .first();
    await trx('lead_atribuicoes').where('id', atribuicao.id).update({
      aceite_status: aceiteStatusFinal,
      recusado_em: aceiteStatusFinal === ACEITE_RECUSADO ? agora : atribuicao.recusado_em,
      cancelamento_motivo: String(opcoes.motivo || '').slice(0, 255) || null,
      finalizado_em: agora,
      updated_at: agora
    });
    if (atribuicao.envio_id) {
      await trx('lead_envios').where('id', atribuicao.envio_id).update({
        cancelado_em: agora,
        cancelado_por_id: opcoes.canceladoPorId || null,
        updated_at: agora
      });
    }
    await trx('lead_linhas').where('id', Number(linhaId)).update({
      envio_id: atribuicaoSondagem?.envio_id || null,
      atribuido_para_id: atribuicaoSondagem?.usuario_id || null,
      etapa_atual: 'sondagem',
      status_operacional: 'qualificado',
      updated_at: agora
    });
    await trx('notificacoes')
      .where('source_key', `futuro_cliente_distribuido:${Number(linhaId)}`)
      .update({ ativa: false, updated_at: agora });
    if (opcoes.republicar !== false) {
      await leadTelegramPublicacaoService.enfileirarRepublicacao(linhaId, trx, agora);
    }
    await leadTelegramReconciliacaoService.enfileirar(atribuicao.id, trx, agora);
    return { atribuicao, linhaId: Number(linhaId) };
  });

  if (!resultado) return resultado;
  if (resultado.acaoEncontrada) {
    if (!opcoes.silencioso) {
      const error = new Error('Esta indicacao ja possui uma acao registrada no CRM e nao pode mais ser devolvida.');
      error.statusCode = 409;
      throw error;
    }
    return resultado;
  }
  if (resultado.prazoAtualizado) return resultado;
  if (opcoes.processarTelegram !== false) {
    await leadTelegramReconciliacaoService.processarDaAtribuicao(
      resultado.atribuicao.id,
      reconciliarMensagemTelegram
    );
  }
  if (opcoes.republicar !== false && opcoes.processarTelegram !== false) {
    await leadTelegramPublicacaoService.processarRepublicacaoDaLinha(resultado.linhaId, {
      carregarLinha: carregarLinhaTelegram
    });
  }
  return resultado;
}

async function recusar(linhaId, usuarioId, motivo = '') {
  await finalizarAtribuicao(linhaId, {
    usuarioId,
    aceiteStatus: ACEITE_RECUSADO,
    motivo: motivo || 'Recusado pelo consultor',
    republicar: true
  });
  return { status: ACEITE_RECUSADO };
}

function queryAtribuicoesVencidas(agora = new Date(), database = db) {
  const limiteLegado = adicionarMinutos(new Date(agora), -prazoAcaoMinutos());
  return database('lead_atribuicoes as la')
    .join('lead_linhas as ll', 'll.id', 'la.lead_linha_id')
    .where({ 'la.etapa': 'venda' })
    .whereIn('la.aceite_status', [ACEITE_AGUARDANDO, ACEITE_ACEITO])
    .where(function distribuicaoVencida() {
      this.where(function prazoSemAcaoVencido() {
        this.whereNull('la.acao_registrada_em')
          .where(function prazoVencido() {
            this.where('la.prazo_acao_em', '<=', agora)
              .orWhere(function prazoLegadoVencido() {
                this.whereNull('la.prazo_acao_em')
                  .whereNotNull('la.atribuido_em')
                  .where('la.atribuido_em', '<=', limiteLegado);
              });
          });
      }).orWhere(function retornoVencido() {
        this.where('la.aceite_status', ACEITE_ACEITO)
          .where('la.acao_registrada_tipo', 'retorno_agendado')
          .whereNotNull('la.prazo_acao_em')
          .where('la.prazo_acao_em', '<=', agora);
      });
    })
    .select('la.id', 'la.lead_linha_id', 'la.aceite_status', 'la.acao_registrada_tipo');
}

async function processarPrazosVencidos(opcoes = {}) {
  const agora = opcoes.agora || new Date();
  const finalizar = opcoes.finalizar || finalizarAtribuicao;
  const vencidas = opcoes.vencidas || await queryAtribuicoesVencidas(agora);
  let expiradas = 0;
  for (const item of vencidas) {
    try {
      const aguardandoAceite = item.aceite_status === ACEITE_AGUARDANDO;
      const retornoVencido = item.acao_registrada_tipo === 'retorno_agendado';
      const resultado = await finalizar(item.lead_linha_id, {
        aceiteStatus: aguardandoAceite
          ? ACEITE_EXPIRADO_SEM_ACEITE
          : retornoVencido
            ? ACEITE_EXPIRADO_APOS_RETORNO
            : ACEITE_EXPIRADO,
        aceiteStatusEsperado: item.aceite_status,
        atribuicaoIdEsperada: item.id,
        permitirRetornoVencido: retornoVencido,
        validarPrazoVencido: true,
        motivo: aguardandoAceite
            ? 'Prazo para aceitar a indicacao expirado'
          : retornoVencido
            ? `Retorno vencido ha ${prazoAcaoMinutos()} minutos sem novo desfecho registrado no CRM`
            : 'Prazo de contato expirado sem acao registrada no CRM',
        republicar: true,
        processarTelegram: false,
        silencioso: true
      });
      if (resultado && !resultado.acaoEncontrada && !resultado.prazoAtualizado) expiradas += 1;
    } catch (error) {
      console.error(`Erro ao expirar distribuicao do futuro cliente #${item.lead_linha_id}:`, error.message);
    }
  }
  return expiradas;
}

module.exports = {
  ACEITE_AGUARDANDO,
  ACEITE_ACEITO,
  ACEITE_RECUSADO,
  ACEITE_CANCELADO,
  ACEITE_EXPIRADO,
  ACEITE_EXPIRADO_SEM_ACEITE,
  ACEITE_EXPIRADO_APOS_RETORNO,
  prazoAcaoMinutos,
  calcularPrazoAcao,
  aceitar,
  recusar,
  finalizarAtribuicao,
  notificarVendaFechadaTelegram,
  notificarRetornoAgendadoTelegram,
  registrarAcaoValida,
  atualizarPrazoRetorno,
  processarPrazosVencidos,
  reconciliarMensagemTelegram,
  republicarPendentesAntigosNoTelegram,
  buscarAtribuicaoAtiva,
  obterDistribuicoesUsuario,
  dadosDistribuicao,
  ocultarDetalhesAntesDoAceite,
  _internals: {
    adicionarMinutos,
    calcularPrazoAcao,
    dataEmOuDepois,
    linhaTemAcaoValida,
    prazoAcaoMinutos,
    prazoAtribuicaoVencido,
    prazoEfetivoAtribuicao,
    retornoDistribuicaoVencido,
    montarPatchAceite,
    montarPatchPrazoRetorno,
    queryAtribuicoesVencidas,
    tipoAcaoValida,
    deveRepublicarPendenteAntiga,
    montarMensagemAceiteTelegram,
    montarMensagemEnvioExpiradoTelegram,
    montarMensagemRetornoAgendadoTelegram,
    montarMensagemVendaFechadaTelegram,
    enviarNotificacaoVendaFechada,
    enviarNotificacaoRetornoAgendado,
    vendaCorrespondeAtribuicao,
    botaoCancelarEnvio,
    encerrarMensagemTelegram
  }
};
