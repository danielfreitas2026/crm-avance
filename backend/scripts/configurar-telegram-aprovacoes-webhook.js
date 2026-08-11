const path = require('node:path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const { chamarApiComToken } = require('../src/services/telegram.service');

const token = String(process.env.TELEGRAM_APROVACOES_BOT_TOKEN || '').trim();
const webhookUrl = String(process.env.TELEGRAM_APROVACOES_WEBHOOK_URL || '').trim();
const segredo = String(process.env.TELEGRAM_APROVACOES_WEBHOOK_SECRET || '').trim();

async function executar() {
  if (!token) throw new Error('TELEGRAM_APROVACOES_BOT_TOKEN não está configurado.');
  if (!webhookUrl.startsWith('https://')) throw new Error('TELEGRAM_APROVACOES_WEBHOOK_URL deve ser uma URL pública HTTPS.');

  await chamarApiComToken(token, 'setWebhook', {
    url: webhookUrl,
    ...(segredo ? { secret_token: segredo } : {}),
    allowed_updates: ['callback_query'],
    // Não descarta cliques pendentes: o Telegram os entrega assim que a URL responder.
    drop_pending_updates: false
  });

  const info = await chamarApiComToken(token, 'getWebhookInfo', {});
  console.log(JSON.stringify({
    webhookUrl: info?.url || '',
    pendentes: info?.pending_update_count || 0,
    ultimoErro: info?.last_error_message || ''
  }));
}

executar().catch(error => {
  console.error(`Falha ao configurar webhook de aprovações: ${error.message}`);
  process.exitCode = 1;
});
