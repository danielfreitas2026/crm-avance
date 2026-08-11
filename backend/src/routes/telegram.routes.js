const express = require('express');
const telegramWebhookService = require('../services/telegram-webhook.service');
const telegramAprovacoesService = require('../services/telegram-aprovacoes.service');
const router = express.Router();
// Mantém compatibilidade quando o webhook de aprovações foi apontado para o
// endpoint padrão. Sem esse roteamento, os callbacks "va:*" eram ignorados.
router.post('/webhook', (req, res, next) => {
  const callbackData = String(req.body?.callback_query?.data || '');
  if (callbackData.startsWith('va:')) return telegramAprovacoesService.receberWebhook(req, res, next);
  return telegramWebhookService.receberWebhook(req, res, next);
});
router.post('/aprovacoes/webhook', telegramAprovacoesService.receberWebhook);
module.exports = router;
