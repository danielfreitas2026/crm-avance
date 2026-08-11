const express = require('express');
const telegramWebhookService = require('../services/telegram-webhook.service');
const telegramAprovacoesService = require('../services/telegram-aprovacoes.service');
const router = express.Router();
router.post('/webhook', telegramWebhookService.receberWebhook);
router.post('/aprovacoes/webhook', telegramAprovacoesService.receberWebhook);
module.exports = router;
