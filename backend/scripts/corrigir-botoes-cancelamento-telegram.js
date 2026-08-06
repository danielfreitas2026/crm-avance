const path = require('node:path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const db = require('../src/database/connection');
const { corrigirBotoesCancelamento } = require('../src/services/telegram-cancelamento-retroativo.service');

const confirmada = process.argv.includes('--confirm');
const previewExplicito = process.argv.includes('--preview');

if (confirmada && previewExplicito) {
  console.error('Use somente --preview ou --confirm. Sem argumento, o script executa uma prévia segura.');
  process.exit(1);
}

async function executar() {
  const preview = !confirmada;
  if (!preview && !String(process.env.TELEGRAM_BOT_TOKEN || '').trim()) {
    throw new Error('TELEGRAM_BOT_TOKEN não está configurado.');
  }
  const resumo = await corrigirBotoesCancelamento({ preview });
  console.log(JSON.stringify({ modo: preview ? 'preview' : 'confirmado', ...resumo }, null, 2));
  if (resumo.erros.length) process.exitCode = 1;
}

executar()
  .catch(error => {
    console.error(`Falha ao corrigir botões de cancelamento: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
