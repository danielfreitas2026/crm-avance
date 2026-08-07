const app = require('./app');
const db = require('./config/database');
const { iniciarAplicacao } = require('./startup');
const vendaArquivoService = require('./services/venda-arquivo.service');
const arquivoService = require('./services/arquivo.service');
const resumoVendasTelegramService = require('./services/resumo-vendas-telegram.service');
const notificacaoService = require('./services/notificacao.service');
const dashboardIntegracaoService = require('./services/dashboard-integracao.service');
const leadDistribuicaoService = require('./services/lead-distribuicao.service');
const leadEnriquecimentoService = require('./services/lead-enriquecimento.service');

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
    .finally(() => {
      processandoPrazosDistribuicao = false;
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

function iniciarAgendamentos() {
  setTimeout(limparArquivosVencidos, 60 * 1000);
  setInterval(limparArquivosVencidos, 24 * 60 * 60 * 1000);
  resumoVendasTelegramService.iniciarAgendamentoResumoVendas();

  setTimeout(sincronizarNotificacoesPendentes, 5000);
  setInterval(sincronizarNotificacoesPendentes, 30 * 1000);
  setTimeout(processarPrazosDistribuicao, 10000);
  setInterval(processarPrazosDistribuicao, 30 * 1000);

  const enriquecimentoIntervaloMs = Number(process.env.LEAD_ENRIQUECIMENTO_WORKER_MS || 15 * 1000);
  setTimeout(processarEnriquecimentoMailing, 12000);
  setInterval(processarEnriquecimentoMailing, enriquecimentoIntervaloMs);
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
