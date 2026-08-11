const VendaAprovacaoSolicitacao = require('../models/VendaAprovacaoSolicitacao');
const vendaAprovacaoService = require('./venda-aprovacao.service');
const { chamarApiComToken } = require('./telegram.service');

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

/** Publica uma solicitacao pendente no grupo do bot apenas uma vez. */
async function notificarSolicitacaoPendente(solicitacaoId) {
  if (!configurado()) return { enviado: false, motivo: 'telegram_aprovacoes_nao_configurado' };

  const solicitacao = await buscarSolicitacao(solicitacaoId);
  if (!solicitacao || solicitacao.status !== 'pendente') return { enviado: false, motivo: 'solicitacao_nao_pendente' };
  if (solicitacao.telegram_message_id) return { enviado: false, motivo: 'ja_notificada' };

  const resultado = await chamarApi('sendMessage', {
    chat_id: chatId(),
    text: montarMensagemSolicitacao(solicitacao),
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: botoesDecisao(solicitacao.id) }
  });

  if (resultado?.message_id) {
    await VendaAprovacaoSolicitacao.query()
      .findById(solicitacao.id)
      .where('status', 'pendente')
      .whereNull('telegram_message_id')
      .patch({
        telegram_chat_id: chatId(),
        telegram_message_id: String(resultado.message_id),
        telegram_notificado_em: new Date(),
        updated_at: new Date()
      });
  }

  return { enviado: Boolean(resultado?.message_id), message_id: resultado?.message_id || null };
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

async function finalizarMensagem(query, solicitacao, decisao, aprovador) {
  const texto = montarMensagemDecisao(solicitacao, decisao, aprovador);
  await chamarApi('editMessageText', {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    text: texto,
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [] }
  });
}

function montarMensagemDecisao(solicitacao, decisao = null, aprovador = null) {
  const aprovada = (decisao || solicitacao?.status) === 'aprovar' || solicitacao?.status === 'aprovada';
  const nomeAprovador = aprovador?.nome || solicitacao?.decisor?.nome || 'Não informado';
  return `${aprovada ? '✅ APROVADA' : '❌ RECUSADA'} por ${nomeAprovador}\n\n${montarMensagemSolicitacao(solicitacao)}`;
}

/** Atualiza a mensagem original quando a decisão foi tomada pelo CRM. */
async function atualizarMensagemDecisao(solicitacao) {
  if (!token() || !solicitacao?.telegram_chat_id || !solicitacao?.telegram_message_id) {
    return { atualizado: false, motivo: 'mensagem_telegram_nao_encontrada' };
  }

  await chamarApi('editMessageText', {
    chat_id: solicitacao.telegram_chat_id,
    message_id: solicitacao.telegram_message_id,
    text: montarMensagemDecisao(solicitacao),
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [] }
  });
  return { atualizado: true };
}

async function processarCallback(query) {
  const [prefixo, decisao, solicitacaoId] = String(query?.data || '').split(':');
  if (prefixo !== 'va' || !['aprovar', 'recusar'].includes(decisao) || !Number(solicitacaoId)) return null;

  if (!grupoAutorizado(query?.message?.chat?.id)) {
    return chamarApi('answerCallbackQuery', {
      callback_query_id: query.id,
      text: 'Este chat não está autorizado para aprovações.',
      show_alert: true
    });
  }

  const aprovador = identidadeTelegram(query?.from);
  const nomeAprovador = nomeExibicaoTelegram(aprovador);

  try {
    const observacao = `${decisao === 'aprovar' ? 'Aprovada' : 'Recusada'} via Telegram por ${nomeAprovador}.`;
    const solicitacao = decisao === 'aprovar'
      ? await vendaAprovacaoService.aprovarSolicitacao(solicitacaoId, { observacao }, null, { telegram: aprovador })
      : await vendaAprovacaoService.recusarSolicitacao(solicitacaoId, { observacao }, null, { telegram: aprovador });

    await finalizarMensagem(query, solicitacao, decisao, { nome: nomeAprovador });
    return chamarApi('answerCallbackQuery', {
      callback_query_id: query.id,
      text: decisao === 'aprovar' ? 'Venda aprovada.' : 'Venda recusada.'
    });
  } catch (error) {
    return chamarApi('answerCallbackQuery', {
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
  atualizarMensagemDecisao,
  _internals: { botoesDecisao, identidadeTelegram, nomeExibicaoTelegram, grupoAutorizado, montarMensagemSolicitacao, montarMensagemDecisao, motivosTexto, nomesConsultores }
};
