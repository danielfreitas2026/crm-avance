const db = require('../database/connection');
const telegramService = require('./telegram.service');

/** Guarda a mensagem de origem para permitir atualizacoes posteriores no Telegram. */
async function registrar(linhaId, publicacao = {}) {
  const id = Number(linhaId);
  const chatId = String(publicacao.telegram_chat_id || process.env.TELEGRAM_FUTUROS_CLIENTES_CHAT_ID || '').trim();
  const messageId = String(publicacao.telegram_message_id || publicacao.message_id || '').trim();
  if (!id || !chatId || !messageId) return false;

  const agora = new Date();
  await db('lead_telegram_republicacoes')
    .insert({
      lead_linha_id: id,
      status: 'publicado',
      tentativas: 1,
      telegram_chat_id: chatId,
      telegram_message_id: messageId,
      publicado_em: agora,
      created_at: agora,
      updated_at: agora
    })
    .onConflict('lead_linha_id')
    .merge({
      status: 'publicado',
      telegram_chat_id: chatId,
      telegram_message_id: messageId,
      publicado_em: agora,
      updated_at: agora
    });
  return true;
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

module.exports = { registrar, marcarRevertido };
