const { parseUtcDateTime } = require('./datetime');

/** Confirma uma publicação persistida pela identificação da mensagem e sua data. */
function dataPublicacaoTelegramConfirmada(publicacao) {
  if (!String(publicacao.telegram_chat_id || '').trim()
    || !String(publicacao.telegram_message_id || '').trim()) return null;
  return parseUtcDateTime(publicacao.publicado_em);
}

module.exports = { dataPublicacaoTelegramConfirmada };
