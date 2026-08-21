const db = require('../database/connection');

const RETENTATIVA_INICIAL_MS = 30 * 1000;
const RETENTATIVA_MAXIMA_MS = 30 * 60 * 1000;
const LEASE_MS = 5 * 60 * 1000;

function calcularAtrasoRetentativa(tentativas) {
  const expoente = Math.max(0, Number(tentativas || 1) - 1);
  return Math.min(RETENTATIVA_INICIAL_MS * (2 ** expoente), RETENTATIVA_MAXIMA_MS);
}

async function enfileirar(atribuicaoId, database = db, agora = new Date()) {
  const id = Number(atribuicaoId);
  if (!id) return false;
  await database('lead_telegram_atualizacoes')
    .insert({
      lead_atribuicao_id: id,
      status: 'pendente',
      tentativas: 0,
      proxima_tentativa_em: agora,
      ultimo_erro: null,
      sincronizado_em: null,
      created_at: agora,
      updated_at: agora
    })
    .onConflict('lead_atribuicao_id')
    .merge({
      status: 'pendente',
      tentativas: 0,
      proxima_tentativa_em: agora,
      ultimo_erro: null,
      sincronizado_em: null,
      updated_at: agora
    });
  return true;
}

async function reivindicar(atribuicaoId = null, agora = new Date()) {
  return db.transaction(async trx => {
    const query = trx('lead_telegram_atualizacoes')
      .whereIn('status', ['pendente', 'processando', 'falhou'])
      .whereNotNull('proxima_tentativa_em')
      .where('proxima_tentativa_em', '<=', agora);
    if (atribuicaoId) query.where('lead_atribuicao_id', Number(atribuicaoId));
    const item = await query.orderBy('proxima_tentativa_em', 'asc').orderBy('id', 'asc').forUpdate().first();
    if (!item) return null;

    const tentativas = Number(item.tentativas || 0) + 1;
    await trx('lead_telegram_atualizacoes').where('id', item.id).update({
      status: 'processando',
      tentativas,
      proxima_tentativa_em: new Date(agora.getTime() + LEASE_MS),
      updated_at: agora
    });
    return { ...item, tentativas };
  });
}

async function marcarSincronizado(item, agora = new Date()) {
  await db('lead_telegram_atualizacoes').where('id', item.id).update({
    status: 'sincronizado',
    proxima_tentativa_em: null,
    ultimo_erro: null,
    sincronizado_em: agora,
    updated_at: agora
  });
}

async function marcarFalha(item, error, agora = new Date()) {
  const atraso = calcularAtrasoRetentativa(item.tentativas);
  await db('lead_telegram_atualizacoes').where('id', item.id).update({
    status: 'falhou',
    proxima_tentativa_em: new Date(agora.getTime() + atraso),
    ultimo_erro: String(error?.message || error || 'Falha desconhecida no Telegram').slice(0, 4000),
    updated_at: agora
  });
}

async function processarItem(item, reconciliar, opcoes = {}) {
  const agora = opcoes.agora || new Date();
  try {
    await reconciliar(item.lead_atribuicao_id);
    await (opcoes.marcarSincronizado || marcarSincronizado)(item, agora);
    return { sincronizado: true };
  } catch (error) {
    await (opcoes.marcarFalha || marcarFalha)(item, error, agora);
    console.error(`Erro ao reconciliar mensagem Telegram da atribuicao #${item.lead_atribuicao_id}:`, error.message);
    return { sincronizado: false, falhou: true, erro: error.message };
  }
}

async function processarDaAtribuicao(atribuicaoId, reconciliar, opcoes = {}) {
  const item = await (opcoes.reivindicar || reivindicar)(atribuicaoId, opcoes.agora || new Date());
  if (!item) return { processado: false };
  return processarItem(item, reconciliar, opcoes);
}

async function processarPendentes(reconciliar, opcoes = {}) {
  const limite = Math.max(1, Number(opcoes.limite || 20));
  const resultado = { processadas: 0, sincronizadas: 0, falhas: 0 };
  for (let indice = 0; indice < limite; indice += 1) {
    const item = await (opcoes.reivindicar || reivindicar)(null, opcoes.agora || new Date());
    if (!item) break;
    const processamento = await processarItem(item, reconciliar, opcoes);
    resultado.processadas += 1;
    if (processamento.sincronizado) resultado.sincronizadas += 1;
    if (processamento.falhou) resultado.falhas += 1;
  }
  return resultado;
}

module.exports = {
  enfileirar,
  processarDaAtribuicao,
  processarPendentes,
  _internals: { calcularAtrasoRetentativa, processarItem, reivindicar }
};
