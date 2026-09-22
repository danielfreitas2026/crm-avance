const app = require('./app');
const db = require('./config/database');
const { iniciarAplicacao } = require('./startup');
const vendaArquivoService = require('./services/venda-arquivo.service');
const arquivoService = require('./services/arquivo.service');
const resumoVendasTelegramService = require('./services/resumo-vendas-telegram.service');
const notificacaoService = require('./services/notificacao.service');
const dashboardIntegracaoService = require('./services/dashboard-integracao.service');
const leadDistribuicaoService = require('./services/lead-distribuicao.service');
const leadTelegramPublicacaoService = require('./services/lead-telegram-publicacao.service');
const leadTelegramReconciliacaoService = require('./services/lead-telegram-reconciliacao.service');
const telegramCancelamentoRetroativoService = require('./services/telegram-cancelamento-retroativo.service');
const telegramAprovacoesService = require('./services/telegram-aprovacoes.service');
const leadEnriquecimentoService = require('./services/lead-enriquecimento.service');
const automacaoEmailService = require('./services/automacao-email.service');

const PORT = process.env.APP_PORT || 3000;

/**
 * Limpa arquivos vencidos e restaura o estado inicial.
 */
function limparArquivosVencidos() {
  vendaArquivoService.limparArquivosIndividuaisVencidos()
    .catch(error => {
      console.error('Erro ao limpar arquivos individuais vencidos:', error);
    });

  // Apaga blobs sem nenhum vínculo (ex.: upload pelo chat que o usuário não chegou a enviar).
  arquivoService.limparArquivosOrfaos()
    .catch(error => {
      console.error('Erro ao limpar arquivos orfaos:', error);
    });
}

/**
 * Mantem alertas baseados em prazo atualizados sem bloquear as consultas da interface.
 */
let sincronizandoNotificacoes = false;

function sincronizarNotificacoesPendentes() {
  if (sincronizandoNotificacoes) return;

  sincronizandoNotificacoes = true;
  notificacaoService.sincronizarNotificacoesPendentes()
    .catch(error => {
      console.error('Erro ao sincronizar notificacoes pendentes:', error);
    })
    .finally(() => {
      sincronizandoNotificacoes = false;
    });
}

let processandoPrazosDistribuicao = false;
function processarPrazosDistribuicao() {
  if (processandoPrazosDistribuicao) return;
  processandoPrazosDistribuicao = true;
  leadDistribuicaoService.processarPrazosVencidos()
    .catch(error => {
      console.error('Erro ao processar prazos de contato dos futuros clientes:', error);
    })
    .then(() => leadTelegramReconciliacaoService.processarPendentes(
      leadDistribuicaoService.reconciliarMensagemTelegram
    ))
    .catch(error => {
      console.error('Erro ao reconciliar mensagens dos futuros clientes no Telegram:', error);
    })
    .then(() => leadTelegramPublicacaoService.processarRepublicacoesPendentes())
    .catch(error => {
      console.error('Erro ao processar republicacoes pendentes no Telegram:', error);
    })
    .finally(() => {
      processandoPrazosDistribuicao = false;
    });
}

let processandoAprovacoesTelegram = false;
function processarAprovacoesTelegram() {
  if (processandoAprovacoesTelegram) return;
  processandoAprovacoesTelegram = true;
  telegramAprovacoesService.processarPublicacoesPendentes()
    .catch(error => {
      console.error('Erro ao reconciliar aprovações pendentes no Telegram:', error);
    })
    .finally(() => {
      processandoAprovacoesTelegram = false;
    });
}

function corrigirBotoesCancelamentoAntigos(tentativa = 1) {
  return telegramCancelamentoRetroativoService.corrigirBotoesCancelamento()
    .then(resumo => {
      console.info(
        `Correcao de botoes antigos no Telegram: ${resumo.encontrados} encontrados, `
        + `${resumo.atualizados} atualizados e ${resumo.falhas} falhas.`
      );
      if (resumo.falhas > 0) {
        console.error('Falhas ao corrigir botoes antigos no Telegram:', resumo.erros);
      }
      if (resumo.falhas > 0 && tentativa < 3) {
        setTimeout(() => corrigirBotoesCancelamentoAntigos(tentativa + 1), tentativa * 60 * 1000);
      }
      return resumo;
    })
    .catch(error => {
      console.error('Erro ao corrigir botoes antigos de cancelamento no Telegram:', error);
      if (tentativa < 3) {
        setTimeout(() => corrigirBotoesCancelamentoAntigos(tentativa + 1), tentativa * 60 * 1000);
      }
      return null;
    });
}

/**
 * Consome a fila de enriquecimento automatico de contatos do mailing sem
 * bloquear as consultas da interface. A reentrancia ja e tratada dentro do
 * service; a flag aqui evita empilhar ciclos.
 */
let processandoEnriquecimento = false;
function processarEnriquecimentoMailing() {
  if (processandoEnriquecimento) return;
  processandoEnriquecimento = true;
  leadEnriquecimentoService.processarFila()
    .catch(error => {
      console.error('Erro ao enriquecer contatos do mailing:', error);
    })
    .finally(() => {
      processandoEnriquecimento = false;
    });
}

let processandoEmailsVivo = false;
function processarEmailsVivo() {
  if (processandoEmailsVivo) return;
  processandoEmailsVivo = true;
  automacaoEmailService.ciclo()
    .catch(error => console.error('Erro ao processar e-mails da VIVO:', error))
    .finally(() => { processandoEmailsVivo = false; });
}

let processandoEmailsClaro = false;
function processarEmailsClaro() {
  if (processandoEmailsClaro) return;
  processandoEmailsClaro = true;
  automacaoEmailService.cicloClaro()
    .catch(error => console.error('Erro ao processar e-mails da Claro:', error))
    .finally(() => { processandoEmailsClaro = false; });
}

function iniciarAgendamentos() {
  setTimeout(limparArquivosVencidos, 60 * 1000);
  setInterval(limparArquivosVencidos, 24 * 60 * 60 * 1000);
  resumoVendasTelegramService.iniciarAgendamentoResumoVendas();

  setTimeout(sincronizarNotificacoesPendentes, 5000);
  setInterval(sincronizarNotificacoesPendentes, 30 * 1000);
  setTimeout(processarPrazosDistribuicao, 10000);
  setInterval(processarPrazosDistribuicao, 30 * 1000);
  setTimeout(processarAprovacoesTelegram, 8000);
  setInterval(processarAprovacoesTelegram, 30 * 1000);
  setTimeout(corrigirBotoesCancelamentoAntigos, 15000);

  const enriquecimentoIntervaloMs = Number(process.env.LEAD_ENRIQUECIMENTO_WORKER_MS || 15 * 1000);
  setTimeout(processarEnriquecimentoMailing, 12000);
  setInterval(processarEnriquecimentoMailing, enriquecimentoIntervaloMs);
  const gmailIntervaloMs = Math.max(30000, Number(process.env.GMAIL_VIVO_POLL_INTERVAL_MS) || 60000);
  setTimeout(processarEmailsVivo, 20000);
  setInterval(processarEmailsVivo, gmailIntervaloMs);
  const claroIntervaloMs = Math.max(30000, Number(process.env.CLARO_IMAP_POLL_INTERVAL_MS) || 60000);
  setTimeout(processarEmailsClaro, 22000);
  setInterval(processarEmailsClaro, claroIntervaloMs);
  setTimeout(() => automacaoEmailService.limparCorposExpirados().catch(error => console.error('Erro ao expirar corpos de e-mail:', error)), 25000);
  setInterval(() => automacaoEmailService.limparCorposExpirados().catch(error => console.error('Erro ao expirar corpos de e-mail:', error)), 24 * 60 * 60 * 1000);
}

iniciarAplicacao({
  app,
  db,
  port: PORT,
  iniciarAgendamentos
}).catch(async error => {
  console.error('Falha ao iniciar o servidor:', error);

  try {
    await db.destroy();
  } catch (destroyError) {
    console.error('Falha ao encerrar a conexao com o banco:', destroyError);
  }

  process.exitCode = 1;
});
