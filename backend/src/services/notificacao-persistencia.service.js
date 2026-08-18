const Notificacao = require('../models/Notificacao');
const db = require('../database/connection');
const notificacaoEmailService = require('./notificacao-email.service');

const CAMPOS_SEMANTICOS = [
  'tipo',
  'titulo',
  'mensagem',
  'nivel',
  'entidade',
  'entidade_id',
  'dados',
  'ativa'
];

function valorComparavel(valor) {
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === 'boolean') return String(Number(valor));
  if (valor === null || valor === undefined) return null;
  return String(valor);
}

function estaAtiva(valor) {
  return valor === true || Number(valor) === 1;
}

function notificacaoMudou(notificacao, payload) {
  if (!notificacao) return true;
  return CAMPOS_SEMANTICOS.some(campo => (
    valorComparavel(notificacao[campo]) !== valorComparavel(payload[campo])
  ));
}

function deveRearmarRetorno(notificacao, payload) {
  if (!notificacao) return false;
  if (!estaAtiva(notificacao.ativa) && estaAtiva(payload.ativa)) return true;
  return String(notificacao.tipo || '').endsWith('_pre')
    && String(payload.tipo || '').endsWith('_due');
}

function selecionarNotificacaoPrincipal(notificacoes) {
  return (notificacoes || []).find(item => estaAtiva(item.ativa)) || notificacoes?.[0] || null;
}

async function sincronizarDestinatarios(notificacaoId, destinatarios, opcoes = {}) {
  const knex = opcoes.knex || db;
  const ids = [...new Set((destinatarios || []).map(Number).filter(Boolean))];
  const existentes = await knex('notificacao_destinatarios')
    .where('notificacao_id', notificacaoId)
    .select('id', 'usuario_id');
  const idsDesejados = new Set(ids);
  const idsExistentes = new Set(existentes.map(item => Number(item.usuario_id)));
  const removidos = existentes
    .filter(item => !idsDesejados.has(Number(item.usuario_id)))
    .map(item => item.id);

  if (removidos.length > 0) {
    await knex('notificacao_destinatarios').whereIn('id', removidos).delete();
  }

  const mantidos = existentes
    .filter(item => idsDesejados.has(Number(item.usuario_id)))
    .map(item => item.id);

  if (opcoes.rearmar && mantidos.length > 0) {
    await knex('notificacao_destinatarios')
      .whereIn('id', mantidos)
      .update({
        lida_em: null,
        popup_visto_em: null,
        ocultada_em: null,
        email_enviado_em: null
      });
  }

  const adicionados = ids.filter(id => !idsExistentes.has(id));
  if (adicionados.length > 0) {
    await knex('notificacao_destinatarios')
      .insert(adicionados.map(usuarioId => ({
        notificacao_id: notificacaoId,
        usuario_id: usuarioId
      })))
      .onConflict(['notificacao_id', 'usuario_id'])
      .ignore();
  }

  return { adicionados, removidos, mantidos };
}

async function salvarNotificacaoIdempotente({
  sourceKeys,
  sourceKeyNova,
  payload,
  destinatarios,
  agora = new Date(),
  trx = null,
  rearmarQuando = deveRearmarRetorno
}) {
  const knex = trx || db;
  const chaves = [...new Set([...(sourceKeys || []), sourceKeyNova].filter(Boolean))];
  let existentes = await Notificacao.query(trx)
    .whereIn('source_key', chaves)
    .orderBy('id', 'asc');
  let notificacao = selecionarNotificacaoPrincipal(existentes);
  let criada = false;

  if (!notificacao) {
    await knex('notificacoes')
      .insert({ ...payload, source_key: sourceKeyNova, updated_at: agora })
      .onConflict('source_key')
      .ignore();
    existentes = await Notificacao.query(trx)
      .whereIn('source_key', chaves)
      .orderBy('id', 'asc');
    notificacao = selecionarNotificacaoPrincipal(existentes);
    criada = true;
  }

  const rearmar = !criada && rearmarQuando(notificacao, payload);
  const mudou = notificacaoMudou(notificacao, payload);

  if (!criada && mudou) {
    notificacao = await Notificacao.query(trx).patchAndFetchById(notificacao.id, {
      ...payload,
      source_key: notificacao.source_key,
      updated_at: agora
    });
  }

  const duplicadasAtivas = existentes
    .filter(item => Number(item.id) !== Number(notificacao.id) && estaAtiva(item.ativa))
    .map(item => item.id);
  if (duplicadasAtivas.length > 0) {
    await Notificacao.query(trx)
      .whereIn('id', duplicadasAtivas)
      .patch({ ativa: false, updated_at: agora });
  }

  const resultadoDestinatarios = await sincronizarDestinatarios(
    notificacao.id,
    destinatarios,
    { knex, rearmar }
  );

  if (criada || rearmar || resultadoDestinatarios.adicionados.length > 0) {
    notificacaoEmailService.enviarEmailsPendentesAsync(notificacao.id);
  }

  return { notificacao, criada, mudou, rearmar };
}

async function desativarNotificacoesAtivas(query, agora = new Date()) {
  return query.where('ativa', true).patch({ ativa: false, updated_at: agora });
}

module.exports = {
  CAMPOS_SEMANTICOS,
  notificacaoMudou,
  deveRearmarRetorno,
  selecionarNotificacaoPrincipal,
  sincronizarDestinatarios,
  salvarNotificacaoIdempotente,
  desativarNotificacoesAtivas
};
