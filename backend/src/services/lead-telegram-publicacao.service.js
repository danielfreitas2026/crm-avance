const db = require('../database/connection');
const telegramService = require('./telegram.service');
const { parseUtcDateTime } = require('../utils/datetime');

const RETENTATIVA_INICIAL_MS = 30 * 1000;
const RETENTATIVA_MAXIMA_MS = 30 * 60 * 1000;
const LEASE_MS = 5 * 60 * 1000;

const MOTIVOS_RETORNO_POR_STATUS = {
  recusado: 'Recusado pela consultora anterior',
  cancelado: 'Envio anterior cancelado',
  expirado_sem_aceite: 'Prazo para aceitar a indicação expirado',
  expirado_sem_acao: 'Prazo de contato expirado sem ação registrada no CRM',
  expirado_apos_retorno: 'Retorno agendado venceu sem novo desfecho registrado no CRM'
};

function parseJson(valor, fallback = {}) {
  if (valor && typeof valor === 'object') return valor;
  try {
    return valor ? JSON.parse(valor) : fallback;
  } catch {
    return fallback;
  }
}

function calcularAtrasoRetentativa(tentativas) {
  const expoente = Math.max(0, Number(tentativas || 1) - 1);
  return Math.min(RETENTATIVA_INICIAL_MS * (2 ** expoente), RETENTATIVA_MAXIMA_MS);
}

function montarContextoPublicacao(atribuicao) {
  if (!atribuicao) return { tipo: 'novo' };
  const motivoPersistido = String(
    atribuicao.cancelamento_motivo || atribuicao.motivo_resultado || ''
  ).trim();
  return {
    tipo: 'retorno',
    aceite_status_anterior: atribuicao.aceite_status || null,
    motivo_retorno: motivoPersistido
      || MOTIVOS_RETORNO_POR_STATUS[atribuicao.aceite_status]
      || 'Envio anterior encerrado sem motivo informado',
    responsavel_anterior: String(atribuicao.usuario_nome || '').trim()
      || 'Usuário removido ou não informado'
  };
}

async function carregarContextoPublicacao(linhaId, database = db) {
  const ultimaAtribuicao = await database('lead_atribuicoes as la')
    .leftJoin('usuarios as u', 'u.id', 'la.usuario_id')
    .where({ 'la.lead_linha_id': Number(linhaId), 'la.etapa': 'venda' })
    .whereNotNull('la.aceite_status')
    .whereNotNull('la.finalizado_em')
    .select(
      'la.aceite_status',
      'la.cancelamento_motivo',
      'la.motivo_resultado',
      'u.nome as usuario_nome'
    )
    .orderBy('la.id', 'desc')
    .first();
  return montarContextoPublicacao(ultimaAtribuicao);
}

async function prepararLinhaPublicacao(linha, database = db) {
  if (!linha?.id) return linha;
  return {
    ...linha,
    contexto_publicacao_telegram: await carregarContextoPublicacao(linha.id, database)
  };
}

async function carregarLinhaPublicacao(linhaId) {
  const linha = await db('lead_linhas').where('id', Number(linhaId)).first();
  if (!linha) return null;
  const sondagem = await db('lead_sondagens as ls')
    .leftJoin('usuarios as u', 'u.id', 'ls.usuario_id')
    .leftJoin('operadoras as oa', 'oa.id', 'ls.operadora_atual_id')
    .leftJoin('operadoras as oi', 'oi.id', 'ls.operadora_interesse_id')
    .where('ls.lead_linha_id', Number(linhaId))
    .select('ls.*', 'u.nome as usuario_nome', 'oa.nome as operadora_atual_nome', 'oi.nome as operadora_interesse_nome')
    .first();

  return prepararLinhaPublicacao({
    ...linha,
    dados_json: parseJson(linha.dados_json),
    sondagem: sondagem ? {
      ...sondagem,
      chips_itens: parseJson(sondagem.chips_itens, []),
      usuario: { nome: sondagem.usuario_nome },
      operadoraAtual: { nome: sondagem.operadora_atual_nome },
      operadoraInteresse: { nome: sondagem.operadora_interesse_nome }
    } : null
  });
}

async function linhaAindaPublicavel(linhaId) {
  const linha = await db('lead_linhas').where('id', Number(linhaId)).first(
    'futuro_cliente',
    'futuro_cliente_excluido_em',
    'status_operacional'
  );
  if (!linha || !linha.futuro_cliente || linha.futuro_cliente_excluido_em || linha.status_operacional !== 'qualificado') {
    return false;
  }
  const atribuicaoAtiva = await db('lead_atribuicoes')
    .where({ lead_linha_id: Number(linhaId), etapa: 'venda' })
    .whereIn('aceite_status', ['aguardando_aceite', 'aceito'])
    .first('id');
  return !atribuicaoAtiva;
}

async function possuiReconciliacaoPendente(linhaId) {
  const atualizacao = await db('lead_telegram_atualizacoes as lta')
    .join('lead_atribuicoes as la', 'la.id', 'lta.lead_atribuicao_id')
    .where('la.lead_linha_id', Number(linhaId))
    .whereIn('lta.status', ['pendente', 'processando', 'falhou'])
    .first('lta.id');
  return Boolean(atualizacao);
}

async function enfileirarRepublicacao(linhaId, database = db, agora = new Date()) {
  const id = Number(linhaId);
  if (!id) return false;
  await database('lead_telegram_republicacoes')
    .insert({
      lead_linha_id: id,
      status: 'processando',
      tentativas: 0,
      proxima_tentativa_em: agora,
      ultimo_erro: null,
      telegram_chat_id: null,
      telegram_message_id: null,
      publicado_em: null,
      created_at: agora,
      updated_at: agora
    })
    .onConflict('lead_linha_id')
    .merge({
      status: 'processando',
      tentativas: 0,
      proxima_tentativa_em: agora,
      ultimo_erro: null,
      telegram_chat_id: null,
      telegram_message_id: null,
      publicado_em: null,
      updated_at: agora
    });
  return true;
}

async function reivindicarRepublicacao(linhaId = null, agora = new Date()) {
  return db.transaction(async trx => {
    const query = trx('lead_telegram_republicacoes')
      .whereIn('status', ['processando', 'falhou'])
      .whereNotNull('proxima_tentativa_em')
      .where('proxima_tentativa_em', '<=', agora);
    if (linhaId) query.where('lead_linha_id', Number(linhaId));
    const item = await query.orderBy('proxima_tentativa_em', 'asc').orderBy('id', 'asc').forUpdate().first();
    if (!item) return null;

    const tentativas = Number(item.tentativas || 0) + 1;
    await trx('lead_telegram_republicacoes').where('id', item.id).update({
      status: 'processando',
      tentativas,
      proxima_tentativa_em: new Date(agora.getTime() + LEASE_MS),
      updated_at: agora
    });
    return { ...item, tentativas };
  });
}

function classificarPublicacao(historicoAnterior, atendimentoAnterior, contexto = {}) {
  return historicoAnterior || atendimentoAnterior || contexto.tipo === 'retorno' ? 'republicacao' : 'primeiro_envio';
}

/** O histórico confirmado permanece válido mesmo após devolução ou nova tentativa. */
async function obterResumoEnvio(linhaId, database = db) {
  const publicacoes = await database('lead_telegram_publicacoes')
    .where('lead_linha_id', Number(linhaId))
    .select('telegram_chat_id', 'telegram_message_id', 'publicado_em');
  let ultimoEnvio = null;
  for (const publicacao of publicacoes) {
    const data = parseUtcDateTime(publicacao.publicado_em);
    if (!String(publicacao.telegram_chat_id || '').trim()
      || !String(publicacao.telegram_message_id || '').trim() || !data) continue;
    if (!ultimoEnvio || data > ultimoEnvio) ultimoEnvio = data;
  }
  return {
    situacao: ultimoEnvio ? 'enviado' : publicacoes.length ? 'historico_incompleto' : 'sem_confirmacao',
    ultimo_envio_em: ultimoEnvio?.toISOString() || null
  };
}

/** Serializa por lead e conserva a confirmação de cada mensagem junto do estado da fila. */
async function registrar(linhaId, publicacao = {}, database = db) {
  const id = Number(linhaId);
  const chatId = String(publicacao.telegram_chat_id || process.env.TELEGRAM_FUTUROS_CLIENTES_CHAT_ID || '').trim();
  const messageId = String(publicacao.telegram_message_id || publicacao.message_id || '').trim();
  if (!id || !chatId || !messageId) return false;
  const agora = new Date();

  const salvar = async trx => {
    const linha = await trx('lead_linhas').where('id', id).forUpdate().first('id');
    if (!linha) return false;
    const existente = await trx('lead_telegram_publicacoes')
      .where({ telegram_chat_id: chatId, telegram_message_id: messageId }).first('id');
    if (existente) return true;
    const historico = await trx('lead_telegram_publicacoes').where('lead_linha_id', id).first('id');
    const anterior = await trx('lead_atribuicoes').where({ lead_linha_id: id, etapa: 'venda' })
      .whereNotNull('aceite_status').whereNotNull('finalizado_em').first('id');
    const sondagem = await trx('lead_atribuicoes').where({ lead_linha_id: id, etapa: 'sondagem' })
      .orderBy('atribuido_em', 'desc').orderBy('id', 'desc').first('id');
    await trx('lead_telegram_publicacoes').insert({
      lead_linha_id: id, atribuicao_sondagem_id: sondagem?.id || null,
      usuario_id: Number(publicacao.usuario_id) || null,
      tipo: classificarPublicacao(historico, anterior, publicacao.contexto_publicacao_telegram),
      telegram_chat_id: chatId, telegram_message_id: messageId,
      publicado_em: agora, created_at: agora
    });
    await trx('lead_telegram_republicacoes').insert({
      lead_linha_id: id, status: 'publicado', tentativas: 1,
      telegram_chat_id: chatId, telegram_message_id: messageId,
      proxima_tentativa_em: null, ultimo_erro: null, publicado_em: agora, created_at: agora, updated_at: agora
    }).onConflict('lead_linha_id').merge({
      status: 'publicado', telegram_chat_id: chatId, telegram_message_id: messageId,
      proxima_tentativa_em: null, ultimo_erro: null, publicado_em: agora, updated_at: agora
    });
    return true;
  };
  return database.isTransaction ? salvar(database) : database.transaction(salvar);
}

/** Registra uma tentativa sem publicacao para permitir nova tentativa segura. */
async function registrarFalha(linhaId) {
  return enfileirarRepublicacao(linhaId);
}

async function marcarFalha(item, error, agora = new Date()) {
  const mensagem = String(error?.message || error || 'Falha desconhecida no Telegram').slice(0, 4000);
  const atraso = calcularAtrasoRetentativa(item.tentativas);
  await db('lead_telegram_republicacoes').where('id', item.id).update({
    status: 'falhou',
    proxima_tentativa_em: new Date(agora.getTime() + atraso),
    ultimo_erro: mensagem,
    updated_at: agora
  });
}

async function marcarIgnorado(item, agora = new Date()) {
  await db('lead_telegram_republicacoes').where('id', item.id).update({
    status: 'ignorado',
    proxima_tentativa_em: null,
    ultimo_erro: null,
    updated_at: agora
  });
}

async function processarItem(item, opcoes = {}) {
  const carregarLinha = opcoes.carregarLinha || carregarLinhaPublicacao;
  const validarLinha = opcoes.validarLinha || linhaAindaPublicavel;
  const reconciliacaoPendente = opcoes.reconciliacaoPendente || possuiReconciliacaoPendente;
  const enviar = opcoes.enviar || telegramService.enviarFuturoCliente;
  const salvarSucesso = opcoes.registrar || registrar;
  const salvarFalha = opcoes.marcarFalha || marcarFalha;
  const salvarIgnorado = opcoes.marcarIgnorado || marcarIgnorado;
  const agora = opcoes.agora || new Date();
  try {
    if (!await validarLinha(item.lead_linha_id)) {
      await salvarIgnorado(item, agora);
      return { publicado: false, ignorado: true };
    }
    if (await reconciliacaoPendente(item.lead_linha_id)) {
      throw new Error('A mensagem anterior do Telegram ainda nao foi encerrada');
    }
    const linha = await carregarLinha(item.lead_linha_id);
    if (!linha) throw new Error('Linha do futuro cliente nao encontrada');
    const resultado = await enviar(linha);
    if (!resultado?.enviado || !resultado?.message_id) {
      throw new Error(resultado?.motivo || 'Telegram nao confirmou a publicacao');
    }
    if (!await salvarSucesso(item.lead_linha_id, { ...resultado, contexto_publicacao_telegram: linha.contexto_publicacao_telegram })) {
      throw new Error('Telegram confirmou o envio, mas a identificacao da mensagem esta incompleta');
    }
    return { publicado: true, message_id: resultado.message_id };
  } catch (error) {
    await salvarFalha(item, error, agora);
    console.error(`Erro ao republicar futuro cliente #${item.lead_linha_id}:`, error.message);
    return { publicado: false, falhou: true, erro: error.message };
  }
}

async function processarRepublicacaoDaLinha(linhaId, opcoes = {}) {
  const reivindicar = opcoes.reivindicar || reivindicarRepublicacao;
  const item = await reivindicar(linhaId, opcoes.agora || new Date());
  if (!item) return { processado: false };
  return processarItem(item, opcoes);
}

async function processarRepublicacoesPendentes(opcoes = {}) {
  const limite = Math.max(1, Number(opcoes.limite || 20));
  const resultado = { processadas: 0, publicadas: 0, falhas: 0, ignoradas: 0 };
  const reivindicar = opcoes.reivindicar || reivindicarRepublicacao;
  for (let indice = 0; indice < limite; indice += 1) {
    const item = await reivindicar(null, opcoes.agora || new Date());
    if (!item) break;
    const processamento = await processarItem(item, opcoes);
    resultado.processadas += 1;
    if (processamento.publicado) resultado.publicadas += 1;
    if (processamento.falhou) resultado.falhas += 1;
    if (processamento.ignorado) resultado.ignoradas += 1;
  }
  return resultado;
}

async function marcarRevertido(linha, opcoes = {}) {
  const publicacao = await db('lead_telegram_republicacoes')
    .where('lead_linha_id', Number(linha?.id))
    .whereNotNull('telegram_chat_id')
    .whereNotNull('telegram_message_id')
    .first();
  if (!publicacao) return { atualizado: false, motivo: 'mensagem_telegram_nao_encontrada' };

  const resultado = await telegramService.atualizarMensagemFuturoClienteRevertido(publicacao, linha, opcoes);
  if (resultado.atualizado) {
    await db('lead_telegram_republicacoes')
      .where('id', publicacao.id)
      .update({ status: 'ignorado', updated_at: new Date() });
  }
  return resultado;
}

module.exports = {
  obterResumoEnvio,
  registrar,
  registrarFalha,
  marcarRevertido,
  prepararLinhaPublicacao,
  enfileirarRepublicacao,
  processarRepublicacaoDaLinha,
  processarRepublicacoesPendentes,
  _internals: {
    classificarPublicacao,
    calcularAtrasoRetentativa,
    montarContextoPublicacao,
    carregarContextoPublicacao,
    carregarLinhaPublicacao,
    linhaAindaPublicavel,
    possuiReconciliacaoPendente,
    reivindicarRepublicacao,
    processarItem
  }
};
