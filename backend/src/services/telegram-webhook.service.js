const Usuario = require('../models/Usuario');
const db = require('../database/connection');
const notificacaoService = require('./notificacao.service');
const telegramService = require('./telegram.service');
const leadDistribuicaoService = require('./lead-distribuicao.service');

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
  return vendedoras.map(vendedora => ([{
    text: vendedora.nome,
    callback_data: `fc:atribuir:${linhaId}:${vendedora.id}`
  }]));
}
async function distribuir(linhaId, vendedoraId, gerenteTelegramId, telegramContexto = {}) {
  return db.transaction(async trx => {
    const linha = await trx('lead_linhas').where('id', linhaId).where('futuro_cliente', true).whereNull('futuro_cliente_excluido_em').first();
    if (!linha) throw new Error('Este futuro cliente nao esta mais disponivel.');
    if (linha.status_operacional === 'distribuido_venda' || linha.status_operacional === 'vendido' || linha.status_operacional === 'perdido') throw new Error('Este futuro cliente ja foi encaminhado.');
    const vendedora = await trx('usuarios').where({ id: vendedoraId, ativo: true }).first();
    if (!vendedora) throw new Error('Vendedora indisponivel.');
    const nomeEmpresa = obterNomeEmpresa(linha.dados_json, linhaId);
    const dadosLead = obterDadosLead(linha.dados_json);
    const resultadoEnvio = await trx('lead_envios').insert({
      nome: `Indicacao #${linhaId}`,
      total_linhas: 1,
      colunas_visiveis: JSON.stringify(Object.keys(dadosLead)),
      criado_por_id: null
    });
    const envioId = Number(Array.isArray(resultadoEnvio) ? resultadoEnvio[0] : resultadoEnvio);
    await trx('lead_envio_usuarios').insert({ envio_id: envioId, usuario_id: vendedoraId, quantidade: 1 });
    await trx('lead_linhas').where('id', linhaId).update({
      status_operacional: 'distribuido_venda',
      updated_at: new Date()
    });
    await trx('lead_atribuicoes').insert({
      lead_linha_id: linhaId,
      envio_id: envioId,
      usuario_id: vendedoraId,
      etapa: 'venda',
      status: 'atribuido',
      aceite_status: leadDistribuicaoService.ACEITE_AGUARDANDO,
      telegram_chat_id: String(telegramContexto.chatId || ''),
      telegram_message_id: String(telegramContexto.messageId || ''),
      telegram_mensagem_texto: String(telegramContexto.mensagemTexto || ''),
      gerente_telegram_id: String(gerenteTelegramId || ''),
      criado_por_id: null
    });
    await notificacaoService.criarNotificacaoFuturoClienteDistribuido({ leadLinhaId: linhaId, vendedoraId, gerenteTelegramId, nomeEmpresa }, trx);
    return vendedora;
  });
}
async function cancelarEnvio(linhaId) {
  return leadDistribuicaoService.finalizarAtribuicao(linhaId, {
    aceiteStatus: leadDistribuicaoService.ACEITE_CANCELADO,
    motivo: 'Envio cancelado pelo gerente no Telegram',
    republicar: true
  });
}
async function processarCallback(query) {
  const telegramId = query?.from?.id;
  if (!grupoAutorizado(query?.message?.chat?.id)) return telegramService.chamarApi('answerCallbackQuery', { callback_query_id: query.id, text: 'Este grupo nao pode encaminhar futuros clientes.', show_alert: true });
  const [, acao, linhaId, vendedoraId] = callbackPartes(query.data);
  if (acao === 'selecionar') {
    const vendedoras = await listarVendedoras();
    await telegramService.chamarApi('editMessageReplyMarkup', { chat_id: query.message.chat.id, message_id: query.message.message_id, reply_markup: { inline_keyboard: botoesVendedoras(vendedoras, linhaId) } });
    return telegramService.chamarApi('answerCallbackQuery', { callback_query_id: query.id, text: 'Selecione a vendedora.' });
  }
  if (acao === 'atribuir') {
    const vendedora = await distribuir(Number(linhaId), Number(vendedoraId), telegramId, {
      chatId: query.message.chat.id,
      messageId: query.message.message_id,
      mensagemTexto: query.message.text || query.message.caption || ''
    });
    await telegramService.chamarApi('editMessageReplyMarkup', { chat_id: query.message.chat.id, message_id: query.message.message_id, reply_markup: { inline_keyboard: [[{ text: `Cancelar envio ${vendedora.nome}`, callback_data: `fc:cancelar:${linhaId}` }]] } });
    return telegramService.chamarApi('answerCallbackQuery', { callback_query_id: query.id, text: `Encaminhado para ${vendedora.nome}.` });
  }
  if (acao === 'cancelar') {
    await cancelarEnvio(Number(linhaId));
    return telegramService.chamarApi('answerCallbackQuery', { callback_query_id: query.id, text: 'Envio cancelado. Uma nova mensagem foi publicada para encaminhamento.' });
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
  _internals: { botoesVendedoras }
};
