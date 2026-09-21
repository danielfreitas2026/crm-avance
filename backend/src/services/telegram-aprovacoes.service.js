const VendaAprovacaoSolicitacao = require('../models/VendaAprovacaoSolicitacao');
const vendaAprovacaoService = require('./venda-aprovacao.service');
const { chamarApiComToken } = require('./telegram.service');

const RETENTATIVA_INICIAL_MS = 30 * 1000;
const RETENTATIVA_MAXIMA_MS = 30 * 60 * 1000;
const LEASE_MS = 5 * 60 * 1000;

function token() {
  return String(process.env.TELEGRAM_APROVACOES_BOT_TOKEN || '').trim();
}

function chatId() {
  return String(process.env.TELEGRAM_APROVACOES_CHAT_ID || '').trim();
}

function configurado() {
  return Boolean(token() && chatId());
}

function parseJson(valor, fallback = {}) {
  if (!valor) return fallback;
  if (typeof valor === 'object') return valor;
  try { return JSON.parse(valor); } catch { return fallback; }
}

function motivosTexto(motivos = []) {
  const labels = {
    venda_compartilhada: 'Venda compartilhada',
    cliente_venda_em_andamento: 'Cliente com venda em andamento',
    cliente_venda_concluida_recente: 'Cliente com venda concluída há menos de 24 meses'
  };
  const itens = Array.isArray(motivos) ? motivos : parseJson(motivos, []);
  return itens.map(item => labels[item] || item).join(', ') || 'Não informado';
}

function nomeVenda(venda = {}) {
  return venda.cliente?.nome || venda.nome || venda.razao_social || `Venda #${venda.id}`;
}

function valorInformado(valor) {
  return valor === null || valor === undefined || valor === '' ? 'Não informado' : String(valor);
}

function formatarMoeda(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero)
    ? numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\u00a0/g, ' ')
    : 'Não informado';
}

function nomesConsultores(venda = {}) {
  const vendedoras = Array.isArray(venda.vendedoras)
    ? venda.vendedoras.map(item => item?.nome).filter(Boolean)
    : [];
  return vendedoras.length ? vendedoras.join(', ') : valorInformado(venda.vendedora?.nome);
}

function botoesDecisao(solicitacaoId) {
  return [[
    { text: '✅ Aprovar', callback_data: `va:aprovar:${solicitacaoId}` },
    { text: '❌ Recusar', callback_data: `va:recusar:${solicitacaoId}` }
  ]];
}

function montarMensagemSolicitacao(solicitacao) {
  const venda = solicitacao?.venda || {};
  const cliente = venda.cliente || {};
  return [
    '🔐 VENDA AGUARDANDO APROVAÇÃO',
    '',
    `Razão social: ${valorInformado(venda.razao_social || cliente.razao_social || nomeVenda(venda))}`,
    `CNPJ: ${valorInformado(venda.cnpj || cliente.cnpj)}`,
    `Quantidade de chips: ${valorInformado(venda.quantidade_linhas ?? cliente.quantidade_chips)}`,
    `Receita: ${formatarMoeda(venda.valor_total ?? cliente.valor_pago)}`,
    `Consultor(a): ${nomesConsultores(venda)}`,
    `Solicitada por: ${solicitacao?.solicitante?.nome || 'Não informado'}`,
    '',
    `Motivos: ${motivosTexto(solicitacao?.motivos)}`,
    `Descrição: ${solicitacao?.motivo_descricao || 'Não informada'}`
  ].join('\n');
}

async function chamarApi(metodo, dados) {
  return chamarApiComToken(token(), metodo, dados);
}

async function buscarSolicitacao(id) {
  return VendaAprovacaoSolicitacao.query()
    .findById(id)
    .withGraphFetched('[venda.[cliente, vendedora, vendedoras], solicitante, decisor]')
    .modifyGraph('venda.vendedora', builder => builder.select('id', 'nome'))
    .modifyGraph('venda.vendedoras', builder => builder.select('usuarios.id', 'usuarios.nome'))
    .modifyGraph('solicitante', builder => builder.select('id', 'nome', 'email'))
    .modifyGraph('decisor', builder => builder.select('id', 'nome', 'email'));
}

function calcularAtrasoRetentativa(tentativas) {
  const expoente = Math.max(0, Number(tentativas || 1) - 1);
  return Math.min(RETENTATIVA_INICIAL_MS * (2 ** expoente), RETENTATIVA_MAXIMA_MS);
}

async function reivindicarSincronizacao(solicitacaoId = null, agora = new Date()) {
  return VendaAprovacaoSolicitacao.transaction(async trx => {
    const query = VendaAprovacaoSolicitacao.query(trx)
      .where(builder => builder
        .whereNull('telegram_proxima_tentativa_em')
        .orWhere('telegram_proxima_tentativa_em', '<=', agora))
      .where(builder => builder
        .where(subquery => subquery
          .where('status', 'pendente')
          .whereNull('telegram_message_id'))
        .orWhere(subquery => subquery
          .whereNotNull('telegram_message_id')
          .where(statusQuery => statusQuery
            .whereNull('telegram_status_sincronizado')
            .orWhereColumn('telegram_status_sincronizado', '<>', 'status'))));
    if (solicitacaoId) query.where('id', Number(solicitacaoId));

    const item = await query
      .orderBy('telegram_proxima_tentativa_em', 'asc')
      .orderBy('id', 'asc')
      .forUpdate()
      .first();
    if (!item) return null;

    const tentativas = Number(item.telegram_tentativas || 0) + 1;
    await VendaAprovacaoSolicitacao.query(trx).findById(item.id).patch({
      telegram_tentativas: tentativas,
      telegram_proxima_tentativa_em: new Date(agora.getTime() + LEASE_MS),
      updated_at: agora
    });
    return { ...item, telegram_tentativas: tentativas };
  });
}

async function registrarFalha(item, error, agora = new Date()) {
  const atraso = calcularAtrasoRetentativa(item.telegram_tentativas);
  return VendaAprovacaoSolicitacao.query().findById(item.id).patch({
    telegram_proxima_tentativa_em: new Date(agora.getTime() + atraso),
    telegram_ultimo_erro: String(error?.message || error || 'Falha desconhecida no Telegram').slice(0, 4000),
    updated_at: agora
  });
}

async function registrarPublicacaoSucesso(item, resultado, agora = new Date()) {
  return VendaAprovacaoSolicitacao.query()
    .findById(item.id)
    .whereNull('telegram_message_id')
    .patch({
      telegram_chat_id: chatId(),
      telegram_message_id: String(resultado.message_id),
      telegram_notificado_em: agora,
      telegram_status_sincronizado: 'pendente',
      telegram_sincronizado_em: agora,
      telegram_proxima_tentativa_em: null,
      telegram_ultimo_erro: null,
      updated_at: agora
    });
}

async function registrarEdicaoSucesso(item, status, agora = new Date()) {
  return VendaAprovacaoSolicitacao.query().findById(item.id).patch({
    telegram_status_sincronizado: status,
    telegram_sincronizado_em: agora,
    telegram_proxima_tentativa_em: null,
    telegram_ultimo_erro: null,
    updated_at: agora
  });
}

async function liberarSincronizacao(item, agora = new Date()) {
  return VendaAprovacaoSolicitacao.query().findById(item.id).patch({
    telegram_proxima_tentativa_em: null,
    telegram_ultimo_erro: null,
    updated_at: agora
  });
}

function dadosEdicao(solicitacao) {
  const pendente = solicitacao.status === 'pendente';
  return {
    chat_id: solicitacao.telegram_chat_id,
    message_id: solicitacao.telegram_message_id,
    text: pendente ? montarMensagemSolicitacao(solicitacao) : montarMensagemDecisao(solicitacao),
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: pendente ? botoesDecisao(solicitacao.id) : []
    }
  };
}

function erroMensagemSemAlteracao(error) {
  return /message is not modified/i.test(String(error?.message || error || ''));
}

async function processarSincronizacao(item, opcoes = {}) {
  const carregar = opcoes.buscarSolicitacao || buscarSolicitacao;
  const enviar = opcoes.enviar || (solicitacao => chamarApi('sendMessage', {
    chat_id: chatId(),
    text: montarMensagemSolicitacao(solicitacao),
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: botoesDecisao(solicitacao.id) }
  }));
  const editar = opcoes.editar || (solicitacao => chamarApi('editMessageText', dadosEdicao(solicitacao)));
  const salvarPublicacao = opcoes.registrarPublicacaoSucesso || opcoes.registrarSucesso || registrarPublicacaoSucesso;
  const salvarEdicao = opcoes.registrarEdicaoSucesso || registrarEdicaoSucesso;
  const salvarFalha = opcoes.registrarFalha || registrarFalha;
  const liberar = opcoes.liberarSincronizacao || opcoes.liberarPublicacao || liberarSincronizacao;
  const agora = opcoes.agora || new Date();

  try {
    const solicitacao = await carregar(item.id);
    if (!solicitacao) {
      await liberar(item, agora);
      return { ignorado: true, motivo: 'solicitacao_nao_encontrada' };
    }

    if (solicitacao.status === 'pendente' && !solicitacao.telegram_message_id) {
      const resultado = await enviar(solicitacao);
      if (!resultado?.message_id) throw new Error('Telegram não confirmou a publicação.');
      await salvarPublicacao(item, resultado, agora);
      return { enviado: true, message_id: resultado.message_id };
    }

    if (
      solicitacao.telegram_message_id
      && solicitacao.telegram_status_sincronizado !== solicitacao.status
    ) {
      try {
        await editar(solicitacao);
      } catch (error) {
        if (!erroMensagemSemAlteracao(error)) throw error;
      }
      await salvarEdicao(item, solicitacao.status, agora);
      return { atualizado: true, status: solicitacao.status };
    }

    await liberar(item, agora);
    return { ignorado: true, motivo: 'solicitacao_ja_sincronizada' };
  } catch (error) {
    await salvarFalha(item, error, agora);
    console.error(`Erro ao sincronizar aprovação #${item.id} no Telegram:`, error.message);
    return { falhou: true, motivo: error.message };
  }
}

/** Converge uma solicitacao com claim atomico e retentativa duravel. */
async function reconciliarSolicitacao(solicitacaoId, opcoes = {}) {
  if (!configurado()) return { enviado: false, motivo: 'telegram_aprovacoes_nao_configurado' };
  const reivindicar = opcoes.reivindicar || reivindicarSincronizacao;
  const item = await reivindicar(solicitacaoId, opcoes.agora || new Date());
  if (!item) return { enviado: false, motivo: 'solicitacao_indisponivel' };
  return processarSincronizacao(item, opcoes);
}

async function notificarSolicitacaoPendente(solicitacaoId, opcoes = {}) {
  return reconciliarSolicitacao(solicitacaoId, opcoes);
}

async function processarPublicacoesPendentes(opcoes = {}) {
  const resultado = { processadas: 0, enviadas: 0, atualizadas: 0, falhas: 0, ignoradas: 0 };
  if (!configurado()) return { ...resultado, configurado: false };

  const limite = Math.max(1, Number(opcoes.limite || 20));
  const reivindicar = opcoes.reivindicar || reivindicarSincronizacao;
  for (let indice = 0; indice < limite; indice += 1) {
    const item = await reivindicar(null, opcoes.agora || new Date());
    if (!item) break;
    const processamento = await processarSincronizacao(item, opcoes);
    resultado.processadas += 1;
    if (processamento.enviado) resultado.enviadas += 1;
    if (processamento.atualizado) resultado.atualizadas += 1;
    if (processamento.falhou) resultado.falhas += 1;
    if (processamento.ignorado) resultado.ignoradas += 1;
  }
  return resultado;
}

function grupoAutorizado(id) {
  return String(id || '') === chatId();
}

function identidadeTelegram(usuario = {}) {
  const nome = [usuario.first_name, usuario.last_name].filter(Boolean).join(' ').trim()
    || String(usuario.username || '').trim()
    || 'Membro do grupo';
  const username = String(usuario.username || '').trim();
  return {
    nome,
    username: username ? `@${username}` : null,
    id: usuario.id ? String(usuario.id) : null
  };
}

function nomeExibicaoTelegram(identidade = {}) {
  return [identidade.nome, identidade.username].filter(Boolean).join(' ') || 'Membro do grupo';
}

function montarMensagemDecisao(solicitacao) {
  if (solicitacao?.status === 'obsoleta') {
    return `⚪ DESATUALIZADA\n\n${montarMensagemSolicitacao(solicitacao)}`;
  }

  const aprovada = solicitacao?.status === 'aprovada';
  const nomeAprovador = solicitacao?.telegram_decisor_nome
    || solicitacao?.decisor?.nome
    || 'Não informado';
  return `${aprovada ? '✅ APROVADA' : '❌ RECUSADA'} por ${nomeAprovador}\n\n${montarMensagemSolicitacao(solicitacao)}`;
}

/** Mantem compatibilidade com consumidores antigos usando a reconciliacao duravel. */
async function atualizarMensagemDecisao(solicitacao) {
  if (!solicitacao?.id) {
    return { atualizado: false, motivo: 'mensagem_telegram_nao_encontrada' };
  }
  return reconciliarSolicitacao(solicitacao.id);
}

async function processarCallback(query, opcoes = {}) {
  const [prefixo, decisao, solicitacaoId] = String(query?.data || '').split(':');
  if (prefixo !== 'va' || !['aprovar', 'recusar'].includes(decisao) || !Number(solicitacaoId)) return null;

  const responder = opcoes.responder || (dados => chamarApi('answerCallbackQuery', dados));
  if (!grupoAutorizado(query?.message?.chat?.id)) {
    return responder({
      callback_query_id: query.id,
      text: 'Este chat não está autorizado para aprovações.',
      show_alert: true
    });
  }

  const aprovador = identidadeTelegram(query?.from);
  const nomeAprovador = nomeExibicaoTelegram(aprovador);
  const aprovar = opcoes.aprovar || vendaAprovacaoService.aprovarSolicitacao;
  const recusar = opcoes.recusar || vendaAprovacaoService.recusarSolicitacao;
  const reconciliar = opcoes.reconciliar || reconciliarSolicitacao;

  try {
    const observacao = `${decisao === 'aprovar' ? 'Aprovada' : 'Recusada'} via Telegram por ${nomeAprovador}.`;
    const solicitacao = decisao === 'aprovar'
      ? await aprovar(solicitacaoId, { observacao }, null, { telegram: aprovador })
      : await recusar(solicitacaoId, { observacao }, null, { telegram: aprovador });

    const sincronizacao = await reconciliar(solicitacao.id);
    const aguardandoSincronizacao = sincronizacao?.falhou;
    return responder({
      callback_query_id: query.id,
      text: `${decisao === 'aprovar' ? 'Venda aprovada.' : 'Venda recusada.'}${aguardandoSincronizacao ? ' A mensagem será atualizada automaticamente.' : ''}`
    });
  } catch (error) {
    return responder({
      callback_query_id: query.id,
      text: error.message || 'Não foi possível processar a solicitação.',
      show_alert: true
    });
  }
}

async function receberWebhook(req, res) {
  const segredo = String(process.env.TELEGRAM_APROVACOES_WEBHOOK_SECRET || '');
  const segredoPadrao = String(process.env.TELEGRAM_WEBHOOK_SECRET || '');
  const segredoRecebido = req.get('X-Telegram-Bot-Api-Secret-Token');
  // O segredo do webhook padrão é aceito para instalações que já usavam
  // /api/telegram/webhook antes da separação do bot de aprovações.
  const segredosAceitos = [segredo, segredoPadrao].filter(Boolean);
  if (segredosAceitos.length && !segredosAceitos.includes(segredoRecebido)) return res.sendStatus(401);

  res.sendStatus(200);
  if (req.body?.callback_query) {
    processarCallback(req.body.callback_query)
      .catch(error => console.error('Erro ao processar aprovação de venda no Telegram:', error.message));
  }
}

module.exports = {
  receberWebhook,
  processarCallback,
  notificarSolicitacaoPendente,
  reconciliarSolicitacao,
  processarPublicacoesPendentes,
  atualizarMensagemDecisao,
  _internals: {
    botoesDecisao,
    identidadeTelegram,
    nomeExibicaoTelegram,
    grupoAutorizado,
    montarMensagemSolicitacao,
    montarMensagemDecisao,
    dadosEdicao,
    motivosTexto,
    nomesConsultores,
    calcularAtrasoRetentativa,
    erroMensagemSemAlteracao,
    reivindicarSincronizacao,
    processarSincronizacao
  }
};
