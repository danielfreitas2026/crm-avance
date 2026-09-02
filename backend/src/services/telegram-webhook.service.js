const Usuario = require('../models/Usuario');
const db = require('../database/connection');
const notificacaoService = require('./notificacao.service');
const telegramService = require('./telegram.service');
const leadDistribuicaoService = require('./lead-distribuicao.service');
const leadTelegramPublicacaoService = require('./lead-telegram-publicacao.service');
const leadTelegramReconciliacaoService = require('./lead-telegram-reconciliacao.service');
const { botaoCancelarEnvio, textoInfoBotao } = require('./telegram-botoes.util');

function grupoAutorizado(chatId) {
  return String(chatId || '') === String(process.env.TELEGRAM_FUTUROS_CLIENTES_CHAT_ID || '').trim();
}
function callbackPartes(valor) { return String(valor || '').split(':'); }

function obterDadosLead(dadosJson) {
  try { return typeof dadosJson === 'string' ? JSON.parse(dadosJson) : (dadosJson || {}); } catch { return {}; }
}

function obterNomeEmpresa(dadosJson, linhaId) {
  const dados = obterDadosLead(dadosJson);
  const entrada = Object.entries(dados).find(([chave, valor]) => {
    const nome = String(chave || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return valor && ['razao social', 'empresa', 'nome fantasia', 'nome'].some(termo => nome.includes(termo));
  });
  return String(entrada?.[1] || `Futuro cliente #${linhaId}`).trim();
}

async function listarVendedoras() {
  return Usuario.query().select('id', 'nome').where('ativo', true).orderBy('nome', 'asc');
}

function botoesVendedoras(vendedoras, linhaId) {
  return [...vendedoras.map(vendedora => ([{
    text: vendedora.nome,
    callback_data: `fc:atribuir:${linhaId}:${vendedora.id}`
  }])), [{ text: 'Fechar', callback_data: `fc:fechar:${linhaId}` }]];
}

function botaoEncaminhar(linhaId) {
  return [[{ text: 'Encaminhar', callback_data: `fc:selecionar:${linhaId}` }]];
}

async function garantirBotaoCancelarEnvio(linhaId, nomeConsultora, telegramContexto = {}, opcoes = {}) {
  const chamarApi = opcoes.chamarApi || telegramService.chamarApi;
  try {
    await chamarApi('editMessageReplyMarkup', {
      chat_id: telegramContexto.chatId,
      message_id: telegramContexto.messageId,
      reply_markup: {
        inline_keyboard: [[botaoCancelarEnvio(linhaId, nomeConsultora)]]
      }
    });
    return true;
  } catch (error) {
    if (/message is not modified/i.test(String(error?.message || ''))) return true;
    console.error('Erro ao garantir botao de cancelamento do futuro cliente no Telegram:', error.message);
    return false;
  }
}

function montarAtribuicaoDistribuicao({ linhaId, envioId, vendedoraId, gerenteTelegramId, telegramContexto }, agora) {
  return {
    lead_linha_id: linhaId,
    envio_id: envioId,
    usuario_id: vendedoraId,
    etapa: 'venda',
    status: 'atribuido',
    aceite_status: leadDistribuicaoService.ACEITE_AGUARDANDO,
    atribuido_em: agora,
    prazo_acao_em: leadDistribuicaoService.calcularPrazoAcao(agora),
    telegram_chat_id: String(telegramContexto.chatId || ''),
    telegram_message_id: String(telegramContexto.messageId || ''),
    telegram_mensagem_texto: String(telegramContexto.mensagemTexto || ''),
    gerente_telegram_id: String(gerenteTelegramId || ''),
    criado_por_id: null
  };
}

function atribuicaoRepetidaValida(atribuicao, vendedoraId, telegramContexto = {}) {
  if (!atribuicao) return false;
  const mesmaMensagem = String(atribuicao.telegram_chat_id || '') === String(telegramContexto.chatId || '')
    && String(atribuicao.telegram_message_id || '') === String(telegramContexto.messageId || '');
  return Number(atribuicao.usuario_id) === Number(vendedoraId) && mesmaMensagem;
}

async function distribuir(linhaId, vendedoraId, gerenteTelegramId, telegramContexto = {}) {
  const resultado = await db.transaction(async trx => {
    const agora = new Date();
    const linha = await trx('lead_linhas')
      .where('id', linhaId)
      .where('futuro_cliente', true)
      .whereNull('futuro_cliente_excluido_em')
      .forUpdate()
      .first();
    if (!linha) throw new Error('Este futuro cliente nao esta mais disponivel.');
    const atribuicaoAtiva = await trx('lead_atribuicoes as la')
      .leftJoin('usuarios as u', 'u.id', 'la.usuario_id')
      .where({ 'la.lead_linha_id': linhaId, 'la.etapa': 'venda' })
      .whereIn('la.aceite_status', [
        leadDistribuicaoService.ACEITE_AGUARDANDO,
        leadDistribuicaoService.ACEITE_ACEITO
      ])
      .orderBy('la.id', 'desc')
      .select('la.*', 'u.nome')
      .first();
    if (atribuicaoAtiva) {
      if (atribuicaoRepetidaValida(atribuicaoAtiva, vendedoraId, telegramContexto)) {
        await leadTelegramReconciliacaoService.enfileirar(atribuicaoAtiva.id, trx, agora);
        return { ...atribuicaoAtiva, atribuicao_id: Number(atribuicaoAtiva.id), repetido: true };
      }
      const error = new Error(`Este futuro cliente ja foi encaminhado para ${atribuicaoAtiva.nome || 'outra consultora'}.`);
      error.statusCode = 409;
      throw error;
    }
    if (linha.status_operacional === 'distribuido_venda' || linha.status_operacional === 'vendido' || linha.status_operacional === 'perdido') throw new Error('Este futuro cliente ja foi encaminhado.');
    const vendedora = await trx('usuarios').where({ id: vendedoraId, ativo: true }).first();
    if (!vendedora) throw new Error('Vendedora indisponivel.');
    const nomeEmpresa = obterNomeEmpresa(linha.dados_json, linhaId);
    const dadosLead = obterDadosLead(linha.dados_json);
    const resultadoEnvio = await trx('lead_envios').insert({
      nome: `Indicacao #${linhaId}`,
      origem: 'futuro_cliente_telegram',
      total_linhas: 1,
      colunas_visiveis: JSON.stringify(Object.keys(dadosLead)),
      criado_por_id: null
    });
    const envioId = Number(Array.isArray(resultadoEnvio) ? resultadoEnvio[0] : resultadoEnvio);
    await trx('lead_envio_usuarios').insert({ envio_id: envioId, usuario_id: vendedoraId, quantidade: 1 });
    await trx('lead_linhas').where('id', linhaId).update({
      status_operacional: 'distribuido_venda',
      updated_at: agora
    });
    const resultadoAtribuicao = await trx('lead_atribuicoes').insert(montarAtribuicaoDistribuicao({
      linhaId,
      envioId,
      vendedoraId,
      gerenteTelegramId,
      telegramContexto
    }, agora));
    const atribuicaoId = Number(Array.isArray(resultadoAtribuicao) ? resultadoAtribuicao[0] : resultadoAtribuicao);
    await leadTelegramReconciliacaoService.enfileirar(atribuicaoId, trx, agora);
    await notificacaoService.criarNotificacaoFuturoClienteDistribuido({ leadLinhaId: linhaId, vendedoraId, gerenteTelegramId, nomeEmpresa }, trx);
    return { ...vendedora, atribuicao_id: atribuicaoId, repetido: false };
  });
  await leadTelegramReconciliacaoService.processarDaAtribuicao(
    resultado.atribuicao_id,
    leadDistribuicaoService.reconciliarMensagemTelegram
  );
  return resultado;
}
async function cancelarEnvio(linhaId) {
  return leadDistribuicaoService.finalizarAtribuicao(linhaId, {
    aceiteStatus: leadDistribuicaoService.ACEITE_CANCELADO,
    motivo: 'Envio cancelado pelo gerente no Telegram',
    republicar: true,
    ignorarAcaoRegistrada: true
  });
}
async function processarCallback(query) {
  const telegramId = query?.from?.id;
  if (!grupoAutorizado(query?.message?.chat?.id)) return telegramService.chamarApi('answerCallbackQuery', { callback_query_id: query.id, text: 'Este grupo nao pode encaminhar futuros clientes.', show_alert: true });
  const [, acao, linhaId, complemento] = callbackPartes(query.data);
  const vendedoraId = complemento;
  if (acao === 'selecionar') {
    await leadTelegramPublicacaoService.registrar(Number(linhaId), {
      telegram_chat_id: query.message.chat.id,
      telegram_message_id: query.message.message_id
    });
    const vendedoras = await listarVendedoras();
    await telegramService.chamarApi('editMessageReplyMarkup', { chat_id: query.message.chat.id, message_id: query.message.message_id, reply_markup: { inline_keyboard: botoesVendedoras(vendedoras, linhaId) } });
    return telegramService.chamarApi('answerCallbackQuery', { callback_query_id: query.id, text: 'Selecione a vendedora.' });
  }
  if (acao === 'fechar') {
    await telegramService.chamarApi('editMessageReplyMarkup', {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      reply_markup: { inline_keyboard: botaoEncaminhar(linhaId) }
    });
    return telegramService.chamarApi('answerCallbackQuery', {
      callback_query_id: query.id,
      text: 'Selecao fechada.'
    });
  }
  if (acao === 'atribuir') {
    try {
      const telegramContexto = {
        chatId: query.message.chat.id,
        messageId: query.message.message_id,
        mensagemTexto: query.message.text || query.message.caption || ''
      };
      const vendedora = await distribuir(Number(linhaId), Number(vendedoraId), telegramId, telegramContexto);
      await garantirBotaoCancelarEnvio(Number(linhaId), vendedora.nome, telegramContexto);
      return telegramService.chamarApi('answerCallbackQuery', { callback_query_id: query.id, text: `Encaminhado para ${vendedora.nome}.` });
    } catch (error) {
      return telegramService.chamarApi('answerCallbackQuery', {
        callback_query_id: query.id,
        text: error.message || 'Este futuro cliente ja foi encaminhado.',
        show_alert: true
      });
    }
  }
  if (acao === 'cancelar') {
    try {
      await cancelarEnvio(Number(linhaId));
      return telegramService.chamarApi('answerCallbackQuery', { callback_query_id: query.id, text: 'Envio cancelado. Uma nova mensagem foi publicada para encaminhamento.' });
    } catch (error) {
      return telegramService.chamarApi('answerCallbackQuery', {
        callback_query_id: query.id,
        text: error.message || 'Nao foi possivel cancelar este envio.',
        show_alert: true
      });
    }
  }
  if (acao === 'info') {
    return telegramService.chamarApi('answerCallbackQuery', {
      callback_query_id: query.id,
      text: textoInfoBotao(complemento),
      show_alert: true
    });
  }
  return null;
}
async function receberWebhook(req, res) {
  const segredo = String(process.env.TELEGRAM_WEBHOOK_SECRET || '');
  if (segredo && req.get('X-Telegram-Bot-Api-Secret-Token') !== segredo) return res.sendStatus(401);
  res.sendStatus(200);
  if (req.body?.callback_query) processarCallback(req.body.callback_query).catch(error => console.error('Erro ao processar callback do Telegram:', error.message));
}
module.exports = {
  receberWebhook,
  processarCallback,
  distribuir,
  cancelarEnvio,
  _internals: {
    atribuicaoRepetidaValida,
    botaoCancelarEnvio,
    botaoEncaminhar,
    botoesVendedoras,
    garantirBotaoCancelarEnvio,
    montarAtribuicaoDistribuicao
  }
};
