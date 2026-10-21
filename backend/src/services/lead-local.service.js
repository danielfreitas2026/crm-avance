const { randomUUID } = require('node:crypto');
const db = require('../database/connection');
const { localizarTelefones, normalizarDdd, LOCAIS_DDD } = require('../utils/ddd');

const LOTE = 500;
const SEM_PROGRESSO_MS = 5 * 60 * 1000;

function json(valor, fallback = null) {
  if (typeof valor !== 'string') return valor ?? fallback;
  try { return JSON.parse(valor); } catch { return fallback; }
}

function erroHttp(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function interrompida(config) {
  return config?.status === 'processando'
    && (!Number.isFinite(Date.parse(config.atualizado_em)) || Date.now() - Date.parse(config.atualizado_em) > SEM_PROGRESSO_MS);
}

function escolherColuna(colunas, anterior) {
  if (anterior?.coluna) return anterior.coluna;
  const nomes = new Set(colunas.map(nome => nome.trim().toLocaleLowerCase('pt-BR')));
  if (!nomes.has('local')) return 'Local';
  let nome = 'Local por DDD';
  let indice = 2;
  while (nomes.has(nome.toLocaleLowerCase('pt-BR'))) nome = `Local por DDD (${indice++})`;
  return nome;
}

function prepararConfig(planilha, campos, totais) {
  const colunas = json(planilha.colunas, []);
  const anterior = json(planilha.local_config);
  if (planilha.status !== 'concluida') throw erroHttp(409, 'Conclua a importação da planilha antes de preencher o Local.');
  if (anterior?.status === 'processando' && !interrompida(anterior)) throw erroHttp(409, 'O Local desta planilha já está sendo processado.');
  if (!Array.isArray(campos) || !campos.length || campos.length > colunas.length
    || campos.some(campo => typeof campo !== 'string' || !colunas.includes(campo)
      || campo === anterior?.coluna || campo.endsWith(' (atualizado)'))) {
    throw erroHttp(400, 'Selecione campos de telefone válidos da planilha.');
  }
  return {
    execucao_id: randomUUID(), campos: [...new Set(campos)], coluna: escolherColuna(colunas, anterior),
    status: 'processando', processadas: 0, identificadas: 0,
    total: Number(totais.total), limite_id: Number(totais.limite_id || 0), ultimo_id: 0,
    atualizado_em: new Date().toISOString(), erro: null
  };
}

async function iniciar(planilhaId, campos) {
  const planilha = await db.transaction(async trx => {
    const atual = await trx('lead_planilhas').where('id', planilhaId).forUpdate().first();
    if (!atual) throw erroHttp(404, 'Planilha não encontrada.');
    const totais = await trx('lead_linhas').where('planilha_id', planilhaId)
      .count({ total: 'id' }).max({ limite_id: 'id' }).first();
    const config = prepararConfig(atual, campos, totais);
    const colunas = json(atual.colunas, []);
    if (!colunas.includes(config.coluna)) colunas.push(config.coluna);
    const schema = { ...json(atual.schema_colunas, {}), [config.coluna]: 'string' };
    await trx('lead_planilhas').where('id', planilhaId).update({
      local_config: JSON.stringify(config), colunas: JSON.stringify(colunas),
      schema_colunas: JSON.stringify(schema), updated_at: new Date()
    });
    return { ...atual, colunas, schema_colunas: schema, local_config: config };
  });
  setImmediate(() => processar(planilhaId, planilha.local_config.execucao_id).catch(() => {
    console.error('Falha ao registrar o resultado do preenchimento de Local.', { planilhaId });
  }));
  return planilha;
}

async function processarLote(planilhaId, execucaoId) {
  return db.transaction(async trx => {
    const planilha = await trx('lead_planilhas').where('id', planilhaId).forUpdate().first();
    const config = json(planilha?.local_config);
    if (!config || config.execucao_id !== execucaoId || config.status !== 'processando') return false;
    const linhas = await trx('lead_linhas').where('planilha_id', planilhaId)
      .where('id', '>', config.ultimo_id).where('id', '<=', config.limite_id)
      .orderBy('id').limit(LOTE).forUpdate().select('id', 'dados_json');
    for (const linha of linhas) {
      const resultado = localizarTelefones(json(linha.dados_json, {}), config.campos);
      await trx('lead_linhas').where('id', linha.id).update({
        dados_json: trx.raw('JSON_SET(dados_json, ?, ?)', [`$.${JSON.stringify(config.coluna)}`, resultado.local]),
        local_ddds: JSON.stringify(resultado.ddds)
      });
      config.processadas++;
      if (resultado.ddds.length) config.identificadas++;
      config.ultimo_id = linha.id;
    }
    config.atualizado_em = new Date().toISOString();
    if (linhas.length < LOTE || config.ultimo_id >= config.limite_id) config.status = 'concluido';
    await trx('lead_planilhas').where('id', planilhaId).update({ local_config: JSON.stringify(config) });
    return config.status === 'processando';
  });
}

async function processar(planilhaId, execucaoId) {
  try {
    while (await processarLote(planilhaId, execucaoId)) { /* cada lote tem sua própria transação */ }
  } catch {
    await db.transaction(async trx => {
      const planilha = await trx('lead_planilhas').where('id', planilhaId).forUpdate().first();
      const config = json(planilha?.local_config);
      if (!config || config.execucao_id !== execucaoId || config.status !== 'processando') return;
      config.status = 'erro';
      config.erro = 'Falha ao preencher o Local. Os resultados são parciais; repita o preenchimento.';
      config.atualizado_em = new Date().toISOString();
      await trx('lead_planilhas').where('id', planilhaId).update({ local_config: JSON.stringify(config) });
    });
  }
}

async function reconciliar(planilha) {
  if (!interrompida(json(planilha?.local_config))) return planilha;
  return db.transaction(async trx => {
    const atual = await trx('lead_planilhas').where('id', planilha.id).forUpdate().first();
    if (!atual) return null;
    const config = json(atual.local_config);
    if (interrompida(config)) {
      config.status = 'erro';
      config.erro = 'Preenchimento interrompido. Os resultados são parciais; repita o preenchimento.';
      await trx('lead_planilhas').where('id', atual.id).update({ local_config: JSON.stringify(config) });
    }
    return { ...planilha, local_config: config };
  });
}

function normalizarFiltro(filtros = {}) {
  let valores = filtros.local_ddds;
  if (typeof valores === 'string') valores = valores ? valores.split(',') : [];
  if (valores != null && !Array.isArray(valores)) throw erroHttp(400, 'Filtro de Local inválido.');
  if (valores?.some(valor => !String(valor).trim())) throw erroHttp(400, 'Filtro de DDD inválido.');
  const ddds = [...new Set((valores || []).map(valor => normalizarDdd(valor)))];
  const naoIdentificado = filtros.local_nao_identificado === true || filtros.local_nao_identificado === 'true';
  return { ddds, naoIdentificado, ativo: ddds.length > 0 || naoIdentificado };
}

function aplicarFiltro(query, filtros) {
  const { ddds, naoIdentificado, ativo } = normalizarFiltro(filtros);
  if (!ativo) return;
  query.where(builder => {
    ddds.forEach(ddd => builder.orWhereRaw('JSON_CONTAINS(local_ddds, ?)', [JSON.stringify(ddd)]));
    if (naoIdentificado) builder.orWhereRaw('JSON_LENGTH(local_ddds) = 0');
  });
}

async function exigirConcluido(escopo) {
  const incompleta = await db('lead_planilhas').whereIn('id', escopo).where(builder => builder
    .whereNull('local_config')
    .orWhereRaw("COALESCE(JSON_UNQUOTE(JSON_EXTRACT(local_config, '$.status')), '') <> ?", ['concluido']))
    .first('id');
  if (incompleta) throw erroHttp(409, 'Conclua ou repita o preenchimento de Local nas planilhas selecionadas antes de filtrar por região.');
}

module.exports = {
  iniciar, reconciliar, aplicarFiltro, exigirConcluido, normalizarFiltro,
  listarLocais: () => LOCAIS_DDD,
  _internals: { prepararConfig, escolherColuna, interrompida, processarLote, processar }
};
