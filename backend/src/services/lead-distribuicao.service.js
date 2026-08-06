const db = require('../database/connection');
const notificacaoService = require('./notificacao.service');
const telegramService = require('./telegram.service');

const ACEITE_AGUARDANDO = 'aguardando_aceite';
const ACEITE_ACEITO = 'aceito';
const ACEITE_RECUSADO = 'recusado';
const ACEITE_CANCELADO = 'cancelado';
const ACEITE_EXPIRADO = 'expirado_sem_acao';

function prazoAcaoMinutos() {
  const configurado = Number(process.env.FUTURO_CLIENTE_PRAZO_ACAO_MINUTOS || 30);
  return Number.isFinite(configurado) && configurado > 0 ? Math.floor(configurado) : 30;
}

function adicionarMinutos(data, minutos) {
  return new Date(data.getTime() + minutos * 60 * 1000);
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

  const query = trx('lead_atribuicoes')
    .whereIn('lead_linha_id', ids)
    .where({ etapa: 'venda' })
    .whereNotNull('aceite_status')
    .orderBy('id', 'desc');
  if (usuarioId) query.where('usuario_id', Number(usuarioId));
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
    acao_registrada_tipo: atribuicao.acao_registrada_tipo || null
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
  const prazo = adicionarMinutos(agora, prazoAcaoMinutos());

  const resultado = await db.transaction(async trx => {
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

    const linha = await trx('lead_linhas')
      .where('id', Number(linhaId))
      .where('futuro_cliente', true)
      .whereNull('futuro_cliente_excluido_em')
      .forUpdate()
      .first();
    if (!linha || linha.status_operacional !== 'distribuido_venda') {
      const error = new Error('Esta indicacao nao esta mais disponivel para aceite.');
      error.statusCode = 409;
      throw error;
    }

    await trx('lead_atribuicoes').where('id', atribuicao.id).update({
      aceite_status: ACEITE_ACEITO,
      aceite_em: agora,
      prazo_acao_em: prazo,
      updated_at: agora
    });
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
      prazoAcaoEm: prazo
    }, trx);

    return {
      atribuicao: { ...atribuicao, aceite_status: ACEITE_ACEITO, aceite_em: agora, prazo_acao_em: prazo },
      linha: { ...linha, sondagem }
    };
  });

  if (!resultado.repetido) {
    await notificarAceiteTelegram(resultado.atribuicao, usuarioId, resultado.linha);
  }
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
  const horaPrazo = Number.isNaN(prazo.getTime())
    ? 'Não informado'
    : prazo.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo'
    });
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

function montarMensagemEnvioExpiradoTelegram(atribuicao, linha = {}) {
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
    `Razão social: ${empresa}`,
    `CNPJ: ${cnpj}`,
    `Data do envio: ${dataEnvio}`
  ].join('\n');
}

function botaoCancelarEnvio(linhaId, nomeConsultora) {
  const nome = String(nomeConsultora || '').trim();
  return {
    text: nome ? `Cancelar envio ${nome}` : 'Cancelar envio',
    callback_data: `fc:cancelar:${linhaId}`
  };
}

async function notificarAceiteTelegram(atribuicao, usuarioId, linha) {
  const chatId = atribuicao.telegram_chat_id || process.env.TELEGRAM_FUTUROS_CLIENTES_CHAT_ID;
  if (!chatId) return;
  const usuario = await db('usuarios').where('id', Number(usuarioId)).first('nome');
  try {
    // Recarrega os dados completos: a atribuicao e criada com os detalhes do lead
    // ocultos ate o aceite, portanto nunca deve depender de uma versao parcial da linha.
    const linhaCompleta = await carregarLinhaTelegram(atribuicao.lead_linha_id) || linha;
    const textoAceite = montarMensagemAceiteTelegram(atribuicao, usuario?.nome, linhaCompleta);
    const mensagemAceite = await telegramService.chamarApi('sendMessage', {
      chat_id: chatId,
      text: textoAceite,
      reply_markup: {
        inline_keyboard: [[botaoCancelarEnvio(atribuicao.lead_linha_id, usuario?.nome)]]
      }
    });
    const novoMessageId = mensagemAceite?.message_id;
    if (novoMessageId) {
      await db('lead_atribuicoes').where('id', atribuicao.id).update({
        telegram_chat_id: String(chatId),
        telegram_message_id: String(novoMessageId),
        telegram_mensagem_texto: textoAceite,
        updated_at: new Date()
      });
    }
    if (atribuicao.telegram_message_id && novoMessageId) {
      await telegramService.chamarApi('editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: atribuicao.telegram_message_id,
        reply_markup: { inline_keyboard: [] }
      });
    }
  } catch (error) {
    console.error('Erro ao notificar aceite no Telegram:', error.message);
  }
}

async function encerrarMensagemTelegram(atribuicao, textoStatus, aceiteStatusFinal) {
  const chatId = atribuicao.telegram_chat_id || process.env.TELEGRAM_FUTUROS_CLIENTES_CHAT_ID;
  if (!chatId || !atribuicao.telegram_message_id) return;
  const original = String(atribuicao.telegram_mensagem_texto || 'Futuro cliente encaminhado.');
  try {
    const linha = aceiteStatusFinal === ACEITE_EXPIRADO
      ? await carregarLinhaTelegram(atribuicao.lead_linha_id)
      : null;
    const texto = aceiteStatusFinal === ACEITE_EXPIRADO
      ? montarMensagemEnvioExpiradoTelegram(atribuicao, linha || {})
      : `\u26D4 ENVIO CANCELADO - ${textoStatus}\n\n${original}`.slice(0, 4096);
    await telegramService.chamarApi('editMessageText', {
      chat_id: chatId,
      message_id: atribuicao.telegram_message_id,
      text: texto,
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [] }
    });
  } catch (error) {
    console.error('Erro ao marcar envio cancelado no Telegram:', error.message);
  }
}

async function republicarNoTelegram(linhaId) {
  try {
    const linha = await carregarLinhaTelegram(linhaId);
    if (linha) await telegramService.enviarFuturoCliente(linha);
  } catch (error) {
    console.error('Erro ao republicar futuro cliente no Telegram:', error.message);
  }
}

function deveRepublicarPendenteAntiga(linha, possuiEncaminhamentoDeVenda) {
  return Boolean(
    linha
    && linha.futuro_cliente
    && !linha.futuro_cliente_excluido_em
    && linha.status_operacional === 'qualificado'
    && !possuiEncaminhamentoDeVenda
  );
}

async function reservarRepublicacaoPendente(linhaId) {
  try {
    await db('lead_telegram_republicacoes').insert({
      lead_linha_id: Number(linhaId),
      status: 'processando',
      tentativas: 1
    });
    return true;
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY') throw error;
    const atualizada = await db('lead_telegram_republicacoes')
      .where({ lead_linha_id: Number(linhaId), status: 'falhou' })
      .update({ status: 'processando', tentativas: db.raw('tentativas + 1'), updated_at: new Date() });
    return Boolean(atualizada);
  }
}

async function republicarPendentesAntigosNoTelegram() {
  const pendentes = await db('lead_linhas as ll')
    .where({ 'll.futuro_cliente': true, 'll.status_operacional': 'qualificado' })
    .whereNull('ll.futuro_cliente_excluido_em')
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
    if (!await reservarRepublicacaoPendente(linhaId)) continue;
    try {
      const linha = await carregarLinhaTelegram(linhaId);
      if (!deveRepublicarPendenteAntiga(linha, false)) {
        await db('lead_telegram_republicacoes').where('lead_linha_id', linhaId).update({ status: 'ignorado', updated_at: new Date() });
        continue;
      }
      const resultado = await telegramService.enviarFuturoCliente(linha);
      if (!resultado.enviado) throw new Error(resultado.motivo || 'Telegram nao configurado');
      await db('lead_telegram_republicacoes').where('lead_linha_id', linhaId).update({
        status: 'publicado',
        telegram_chat_id: String(process.env.TELEGRAM_FUTUROS_CLIENTES_CHAT_ID || ''),
        telegram_message_id: String(resultado.message_id || ''),
        publicado_em: new Date(),
        updated_at: new Date()
      });
      publicados += 1;
    } catch (error) {
      console.error(`Erro ao republicar futuro cliente pendente #${linhaId}:`, error.message);
      await db('lead_telegram_republicacoes').where('lead_linha_id', linhaId).update({ status: 'falhou', updated_at: new Date() });
      falhas += 1;
    }
  }
  return { encontrados: pendentes.length, publicados, falhas };
}

async function finalizarAtribuicao(linhaId, opcoes = {}) {
  const aceiteStatusFinal = opcoes.aceiteStatus || ACEITE_CANCELADO;
  const agora = new Date();
  const resultado = await db.transaction(async trx => {
    const atribuicao = await trx('lead_atribuicoes')
      .where({ lead_linha_id: Number(linhaId), etapa: 'venda' })
      .whereIn('aceite_status', [ACEITE_AGUARDANDO, ACEITE_ACEITO])
      .orderBy('id', 'desc')
      .forUpdate()
      .first();
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
    if (atribuicao.aceite_status === ACEITE_ACEITO && atribuicao.acao_registrada_em) {
      return { acaoEncontrada: true };
    }

    const linha = await trx('lead_linhas').where('id', Number(linhaId)).forUpdate().first();
    if (!linha) return null;
    if (atribuicao.aceite_status === ACEITE_ACEITO && linhaTemAcaoValida(linha, atribuicao.aceite_em)) {
      await trx('lead_atribuicoes').where('id', atribuicao.id).update({
        acao_registrada_em: agora,
        acao_registrada_tipo: tipoAcaoValida(linha, atribuicao.aceite_em),
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
  const usuario = await db('usuarios').where('id', resultado.atribuicao.usuario_id).first('nome');
  const textoStatus = aceiteStatusFinal === ACEITE_RECUSADO
    ? `recusado por ${usuario?.nome || 'consultor(a)'}`
    : aceiteStatusFinal === ACEITE_EXPIRADO
      ? `prazo de ${prazoAcaoMinutos()} minutos expirado sem acao no CRM para ${usuario?.nome || 'consultor(a)'}`
      : `cancelado${usuario?.nome ? ` para ${usuario.nome}` : ''}`;
  await encerrarMensagemTelegram(resultado.atribuicao, textoStatus, aceiteStatusFinal);
  if (opcoes.republicar !== false) await republicarNoTelegram(resultado.linhaId);
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

async function processarPrazosVencidos() {
  const vencidas = await db('lead_atribuicoes')
    .where({ etapa: 'venda', aceite_status: ACEITE_ACEITO })
    .whereNull('acao_registrada_em')
    .whereNotNull('prazo_acao_em')
    .where('prazo_acao_em', '<=', new Date())
    .select('lead_linha_id');
  let expiradas = 0;
  for (const item of vencidas) {
    try {
      const resultado = await finalizarAtribuicao(item.lead_linha_id, {
        aceiteStatus: ACEITE_EXPIRADO,
        motivo: 'Prazo de contato expirado sem acao registrada no CRM',
        republicar: true,
        silencioso: true
      });
      if (resultado && !resultado.acaoEncontrada) expiradas += 1;
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
  aceitar,
  recusar,
  finalizarAtribuicao,
  registrarAcaoValida,
  processarPrazosVencidos,
  republicarPendentesAntigosNoTelegram,
  buscarAtribuicaoAtiva,
  obterDistribuicoesUsuario,
  dadosDistribuicao,
  ocultarDetalhesAntesDoAceite,
  _internals: {
    adicionarMinutos,
    dataEmOuDepois,
    linhaTemAcaoValida,
    prazoAcaoMinutos,
    tipoAcaoValida,
    deveRepublicarPendenteAntiga,
    montarMensagemAceiteTelegram,
    montarMensagemEnvioExpiradoTelegram,
    botaoCancelarEnvio
  }
};
