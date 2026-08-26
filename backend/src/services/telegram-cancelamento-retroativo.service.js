const db = require('../database/connection');
const telegramService = require('./telegram.service');
const { ACEITE_AGUARDANDO, ACEITE_ACEITO } = require('./lead-distribuicao.service');

const ACEITES_ATIVOS = [ACEITE_AGUARDANDO, ACEITE_ACEITO];

function montarBotaoCancelarEnvio(linhaId, nomeConsultora) {
  const nome = String(nomeConsultora || '').trim();
  return {
    text: nome ? `Cancelar envio ${nome}` : 'Cancelar envio',
    callback_data: `fc:cancelar:${linhaId}`
  };
}

function atribuicaoElegivel(atribuicao = {}) {
  return ACEITES_ATIVOS.includes(atribuicao.aceite_status)
    && Boolean(String(atribuicao.telegram_chat_id || '').trim())
    && Boolean(String(atribuicao.telegram_message_id || '').trim());
}

function resolverMensagemTelegram(atribuicao = {}) {
  return {
    ...atribuicao,
    telegram_chat_id: String(
      atribuicao.telegram_chat_id || atribuicao.publicacao_telegram_chat_id || ''
    ).trim(),
    telegram_message_id: String(
      atribuicao.telegram_message_id || atribuicao.publicacao_telegram_message_id || ''
    ).trim()
  };
}

async function listarAtribuicoesElegiveis() {
  const atribuicoes = await db('lead_atribuicoes as la')
    .leftJoin('usuarios as u', 'u.id', 'la.usuario_id')
    .leftJoin('lead_telegram_republicacoes as ltr', 'ltr.lead_linha_id', 'la.lead_linha_id')
    .where('la.etapa', 'venda')
    .whereIn('la.aceite_status', ACEITES_ATIVOS)
    .select(
      'la.id',
      'la.lead_linha_id',
      'la.aceite_status',
      'la.telegram_chat_id',
      'la.telegram_message_id',
      'ltr.telegram_chat_id as publicacao_telegram_chat_id',
      'ltr.telegram_message_id as publicacao_telegram_message_id',
      'u.nome as consultora_nome'
    );

  return atribuicoes.map(resolverMensagemTelegram).filter(atribuicaoElegivel);
}

async function atualizarBotoesCancelamento(atribuicoes, opcoes = {}) {
  const preview = Boolean(opcoes.preview);
  const chamarApi = opcoes.chamarApi || telegramService.chamarApi;
  const resumo = { encontrados: 0, atualizados: 0, ignorados: 0, falhas: 0, erros: [] };

  for (const atribuicao of atribuicoes || []) {
    if (!atribuicaoElegivel(atribuicao)) {
      resumo.ignorados += 1;
      continue;
    }

    resumo.encontrados += 1;
    if (preview) continue;

    try {
      await chamarApi('editMessageReplyMarkup', {
        chat_id: String(atribuicao.telegram_chat_id),
        message_id: String(atribuicao.telegram_message_id),
        reply_markup: {
          inline_keyboard: [[montarBotaoCancelarEnvio(atribuicao.lead_linha_id, atribuicao.consultora_nome)]]
        }
      });
      resumo.atualizados += 1;
    } catch (error) {
      if (/message is not modified/i.test(String(error?.message || ''))) {
        resumo.atualizados += 1;
        continue;
      }
      resumo.falhas += 1;
      resumo.erros.push({
        atribuicao_id: atribuicao.id,
        lead_linha_id: atribuicao.lead_linha_id,
        mensagem: error.message
      });
    }
  }

  return resumo;
}

async function corrigirBotoesCancelamento(opcoes = {}) {
  const atribuicoes = await listarAtribuicoesElegiveis();
  return atualizarBotoesCancelamento(atribuicoes, opcoes);
}

module.exports = {
  corrigirBotoesCancelamento,
  _internals: {
    ACEITES_ATIVOS,
    atribuicaoElegivel,
    atualizarBotoesCancelamento,
    listarAtribuicoesElegiveis,
    montarBotaoCancelarEnvio,
    resolverMensagemTelegram
  }
};
