const Usuario = require('../models/Usuario');
const VendaAprovacaoSolicitacao = require('../models/VendaAprovacaoSolicitacao');
const vendaAprovacaoService = require('./venda-aprovacao.service');
const { usuarioTemPermissaoLocal } = require('../utils/permissoes');
const { chamarApiComToken } = require('./telegram.service');

const PERMISSAO_DECIDIR = 'vendas_aprovacoes_decidir';

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

function mapaAprovadores() {
  const mapa = parseJson(process.env.TELEGRAM_APROVACOES_APROVADORES, {});
  return mapa && typeof mapa === 'object' && !Array.isArray(mapa) ? mapa : {};
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

function botoesDecisao(solicitacaoId) {
  return [[
    { text: '✅ Aprovar', callback_data: `va:aprovar:${solicitacaoId}` },
    { text: '❌ Recusar', callback_data: `va:recusar:${solicitacaoId}` }
  ]];
}

function montarMensagemSolicitacao(solicitacao) {
  const venda = solicitacao?.venda || {};
  return [
    '🔐 VENDA AGUARDANDO APROVAÇÃO',
    '',
    `Venda: ${nomeVenda(venda)}`,
    `ID da venda: ${solicitacao?.venda_id || venda.id || 'Não informado'}`,
    `Solicitada por: ${solicitacao?.solicitante?.nome || 'Não informado'}`,
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

async function obterAprovador(telegramUserId) {
  const email = String(mapaAprovadores()[String(telegramUserId)] || '').trim().toLowerCase();
  if (!email) return null;

  const usuario = await Usuario.query()
    .whereRaw('LOWER(email) = ?', [email])
    .withGraphFetched('role')
    .first();

  return usuario?.ativo && usuarioTemPermissaoLocal(usuario, PERMISSAO_DECIDIR) ? usuario : null;
}

function grupoAutorizado(id) {
  return String(id || '') === chatId();
}

async function finalizarMensagem(query, solicitacao, decisao, aprovador) {
  const texto = `${decisao === 'aprovar' ? '✅ APROVADA' : '❌ RECUSADA'} por ${aprovador.nome}\n\n${montarMensagemSolicitacao(solicitacao)}`;
  await chamarApi('editMessageText', {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    text: texto,
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [] }
  });
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

  const aprovador = await obterAprovador(query?.from?.id);
  if (!aprovador) {
    return chamarApi('answerCallbackQuery', {
      callback_query_id: query.id,
      text: 'Você não possui permissão para decidir esta solicitação.',
      show_alert: true
    });
  }

  try {
    const solicitacao = decisao === 'aprovar'
      ? await vendaAprovacaoService.aprovarSolicitacao(solicitacaoId, { observacao: 'Aprovada via Telegram.' }, aprovador.id)
      : await vendaAprovacaoService.recusarSolicitacao(solicitacaoId, { observacao: 'Recusada via Telegram.' }, aprovador.id);

    await finalizarMensagem(query, solicitacao, decisao, aprovador);
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
  if (segredo && req.get('X-Telegram-Bot-Api-Secret-Token') !== segredo) return res.sendStatus(401);

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
  _internals: { botoesDecisao, mapaAprovadores, montarMensagemSolicitacao, motivosTexto }
};
