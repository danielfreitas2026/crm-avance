/**
 * Enriquecimento automatico de contatos do mailing.
 *
 * Quando um mailing e dividido para sondagem, cada linha e enfileirada aqui
 * (status "pendente"). Um worker em background (ver server.js) consome a fila
 * em lotes pequenos, consulta o Google Places pelo telefone da empresa, mede a
 * confiabilidade do match com o motor fuzzy e grava o resultado + a % de
 * confianca. Nada e chamado de forma sincrona na divisao, e a fila vive no
 * banco, entao o processamento sobrevive a reinicios do servidor.
 */
const db = require('../database/connection');
const googlePlacesService = require('./google-places.service');
const apifyService = require('./apify.service');
const fuzzy = require('../utils/fuzzy');

const TABELA = 'lead_enriquecimento';

// Liga/desliga o enriquecimento automatico. Interruptor geral: com "false" o
// worker nao faz NENHUMA chamada ao Google (as linhas so ficam enfileiradas).
const ATIVO = String(process.env.LEAD_ENRIQUECIMENTO_ATIVO ?? 'true').trim().toLowerCase() !== 'false';

// Quantas linhas processar por ciclo do worker. Pequeno de proposito: o
// controle fino de custo/cota vem dos tetos abaixo e do limite de cota
// configurado no Google Cloud Console.
const LOTE = Number(process.env.LEAD_ENRIQUECIMENTO_LOTE || 5);
// Pausa entre chamadas para nao pressionar a API dentro de um mesmo ciclo.
const INTERVALO_MS = Number(process.env.LEAD_ENRIQUECIMENTO_INTERVALO_MS || 250);

// TETOS DE PROTECAO DE CUSTO (0 = sem teto).
//
// Cada linha enriquecida gasta ~2 chamadas do Google (1 Text Search + 1 Place
// Details), ou seja ~2 SKUs. A franquia gratuita do Google gira em torno de
// ~5.000 chamadas/mes POR SKU. Por isso os padroes abaixo sao propositalmente
// baixos: mesmo que voce esqueca de configurar a cota no Google Console, o
// worker para sozinho bem antes de sair do gratuito.
const TETO_DIARIO = Number(process.env.LEAD_ENRIQUECIMENTO_TETO_DIARIO ?? 150);
const TETO_MENSAL = Number(process.env.LEAD_ENRIQUECIMENTO_TETO_MENSAL ?? 3000);

// Maximo de tentativas antes de marcar uma linha como "erro".
const MAX_TENTATIVAS = Number(process.env.LEAD_ENRIQUECIMENTO_MAX_TENTATIVAS || 3);

// Fallback Apify (2a fonte). Desligado por padrao. Mesmo ligado, so faz efeito
// depois que o apify.service deixar de ser stub. Ver docs/plano-*.md.
const APIFY_ATIVO = String(process.env.LEAD_ENRIQUECIMENTO_APIFY_ATIVO ?? 'false').trim().toLowerCase() === 'true';

// Motivos do Google que indicam falta de cota/credencial: nao "queimam" a
// linha (ela continua pendente para ser tentada de novo mais tarde).
const MOTIVOS_COTA = new Set(['sem_chave', 'credenciais_esgotadas', 'limite', 'pausado', 'permissao', 'autenticacao']);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseJson(valor, fallback) {
  if (valor === null || valor === undefined) return fallback;
  if (typeof valor !== 'string') return valor;
  try {
    return JSON.parse(valor);
  } catch {
    return fallback;
  }
}

function normalizarChave(chave) {
  return String(chave || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Procura, no dados_json do lead, o valor de uma coluna cujo cabecalho bate com
 * um dos aliases. Prefere a versao "(atualizado)" quando existir.
 */
function valorPorAliases(dados, aliases) {
  let encontrado = '';
  for (const [chave, valor] of Object.entries(dados)) {
    const nome = normalizarChave(chave);
    if (!aliases.some(alias => nome.includes(alias))) continue;
    const texto = String(valor || '').trim();
    if (!texto) continue;
    if (nome.includes('atualizado')) return texto; // versao corrigida tem prioridade
    if (!encontrado) encontrado = texto;
  }
  return encontrado;
}

/**
 * Extrai os campos de empresa relevantes para a busca a partir do dados_json.
 */
function extrairDadosEmpresa(dadosJson) {
  const dados = parseJson(dadosJson, {}) || {};
  return {
    razaoSocial: valorPorAliases(dados, ['razao', 'empresa']),
    nomeFantasia: valorPorAliases(dados, ['fantasia']),
    municipio: valorPorAliases(dados, ['municipio', 'cidade']),
    uf: valorPorAliases(dados, ['uf', 'estado'])
  };
}

function formatarDateTimeSQL(data = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${data.getUTCFullYear()}-${pad(data.getUTCMonth() + 1)}-${pad(data.getUTCDate())} `
    + `${pad(data.getUTCHours())}:${pad(data.getUTCMinutes())}:${pad(data.getUTCSeconds())}`;
}

/**
 * Enfileira linhas para enriquecimento (idempotente: linhas ja enfileiradas sao
 * ignoradas pela unicidade de lead_linha_id). Deve ser chamada dentro da mesma
 * transacao da divisao para manter consistencia.
 *
 * @param {number[]} linhaIds
 * @param {object} [trx] transacao knex opcional
 * @returns {Promise<number>} quantidade efetivamente enfileirada
 */
async function enfileirarLinhas(linhaIds, trx = db) {
  const ids = Array.from(new Set((linhaIds || []).map(Number).filter(Boolean)));
  if (!ids.length) return 0;

  const agora = formatarDateTimeSQL();
  const registros = ids.map(id => ({
    lead_linha_id: id,
    status: 'pendente',
    tentativas: 0,
    created_at: agora,
    updated_at: agora
  }));

  let total = 0;
  for (let i = 0; i < registros.length; i += 500) {
    const lote = registros.slice(i, i + 500);
    // onConflict().ignore() vira INSERT IGNORE no MySQL: nao duplica nem falha
    // quando a linha ja possui enriquecimento.
    const resultado = await trx(TABELA).insert(lote).onConflict('lead_linha_id').ignore();
    total += Array.isArray(resultado) ? resultado.length : (resultado?.rowCount || 0);
  }
  return total;
}

/**
 * Constroi o array de contatos consolidados a partir do candidato do Google.
 */
function montarContatos(candidato) {
  const contatos = [];
  if (candidato?.telefone) {
    contatos.push({ tipo: 'telefone', valor: candidato.telefone, fonte: 'google_places', confianca: candidato.confianca });
  }
  if (candidato?.site) {
    contatos.push({ tipo: 'site', valor: candidato.site, fonte: 'google_places', confianca: candidato.confianca });
  }
  return contatos;
}

/**
 * Traduz o retorno do Google Places em um patch para a tabela de enriquecimento.
 * Retorna { patch } terminal, ou { adiar: true } quando for questao de cota
 * (a linha continua pendente), ou { erroTransitorio: true } para tentar de novo.
 */
function interpretarResultadoGoogle(resultado) {
  if (resultado?.encontrado && resultado.telefone) {
    const place = resultado.place || {};
    return {
      patch: {
        status: 'concluido',
        telefone: resultado.telefone,
        site: place.site || null,
        nome_encontrado: place.nome || null,
        endereco: place.endereco || null,
        confianca: place.confianca ?? null,
        confianca_pct: place.confianca_pct ?? null,
        confianca_nivel: place.confianca_nivel || null,
        recomenda_apify: Boolean(place.recomenda_apify),
        apify_motivo: place.apify_motivo || null,
        contatos_json: JSON.stringify(montarContatos(place)),
        fonte: 'google_places',
        query_google: resultado.query || null,
        erro: null
      }
    };
  }

  const motivo = resultado?.motivo || 'erro';
  if (MOTIVOS_COTA.has(motivo)) return { adiar: true };
  if (motivo === 'erro') return { erroTransitorio: true, mensagem: resultado?.message || 'Erro na consulta ao Google.' };

  // sem_match / sem_telefone / sem_query: resultado terminal sem telefone util.
  const place = resultado?.place || (Array.isArray(resultado?.candidatos) ? resultado.candidatos[0] : null) || {};
  return {
    patch: {
      status: 'sem_resultado',
      telefone: null,
      site: place.site || null,
      nome_encontrado: place.nome || null,
      endereco: place.endereco || null,
      confianca: place.confianca ?? null,
      confianca_pct: place.confianca_pct ?? null,
      confianca_nivel: place.confianca_nivel || null,
      recomenda_apify: true,
      apify_motivo: place.apify_motivo
        || 'O Google nao retornou telefone confiavel para esta empresa. Uma busca extra (Apify) no site/redes pode encontrar o contato.',
      contatos_json: JSON.stringify(montarContatos(place)),
      fonte: 'google_places',
      query_google: resultado?.query || null,
      erro: null
    }
  };
}

/**
 * Processa uma unica linha pendente. Retorna:
 *  - 'processado' quando teve um desfecho terminal (com ou sem telefone);
 *  - 'adiado' quando faltou cota (linha continua pendente, worker deve parar);
 *  - 'ignorado' quando nao havia dados para buscar.
 */
async function processarLinha(registro) {
  const linha = await db('lead_linhas').where('id', registro.lead_linha_id).first('id', 'dados_json');
  if (!linha) {
    await db(TABELA).where('id', registro.id).update({ status: 'erro', erro: 'Linha inexistente.', updated_at: formatarDateTimeSQL() });
    return 'processado';
  }

  const empresa = extrairDadosEmpresa(linha.dados_json);
  const nomeBusca = empresa.nomeFantasia || empresa.razaoSocial;
  if (!nomeBusca) {
    await db(TABELA).where('id', registro.id).update({
      status: 'sem_resultado',
      recomenda_apify: true,
      apify_motivo: 'Linha sem nome/razao social para buscar. Uma busca extra (Apify) por CNPJ poderia ajudar.',
      processado_em: formatarDateTimeSQL(),
      updated_at: formatarDateTimeSQL()
    });
    return 'ignorado';
  }

  await db(TABELA).where('id', registro.id).update({ status: 'processando', updated_at: formatarDateTimeSQL() });

  const resultado = await googlePlacesService.buscarTelefoneEmpresa(empresa);
  const interpretado = interpretarResultadoGoogle(resultado);

  if (interpretado.adiar) {
    // Cota esgotada: devolve a linha para a fila sem gastar tentativa.
    await db(TABELA).where('id', registro.id).update({ status: 'pendente', updated_at: formatarDateTimeSQL() });
    return 'adiado';
  }

  if (interpretado.erroTransitorio) {
    const tentativas = Number(registro.tentativas || 0) + 1;
    await db(TABELA).where('id', registro.id).update({
      status: tentativas >= MAX_TENTATIVAS ? 'erro' : 'pendente',
      tentativas,
      erro: String(interpretado.mensagem || '').slice(0, 255),
      updated_at: formatarDateTimeSQL()
    });
    return 'processado';
  }

  // Seam do Apify: quando o Google nao acha telefone confiavel, esta e a hora
  // de acionar a 2a fonte. Inerte por padrao (APIFY_ATIVO=false e apify.service
  // ainda e stub) — deixa a arquitetura pronta sem mudar o comportamento atual.
  const patch = await talvezEnriquecerComApify(interpretado.patch, empresa);

  await db(TABELA).where('id', registro.id).update({
    ...patch,
    processado_em: formatarDateTimeSQL(),
    updated_at: formatarDateTimeSQL()
  });
  return 'processado';
}

/**
 * Ponto de extensao do Apify. Se ligado e configurado, tenta a 2a fonte quando
 * o Google nao trouxe telefone confiavel e devolve um patch enriquecido; caso
 * contrario devolve o patch original inalterado.
 *
 * @param {object} patch    patch vindo de interpretarResultadoGoogle
 * @param {object} empresa  dados da empresa ({ razaoSocial, nomeFantasia, ... })
 * @returns {Promise<object>} patch (possivelmente com dados do Apify)
 */
async function talvezEnriquecerComApify(patch, empresa) {
  const precisaFallback = patch?.status === 'sem_resultado' && patch?.recomenda_apify;
  if (!precisaFallback || !APIFY_ATIVO || !apifyService.APIFY_DISPONIVEL) {
    return patch;
  }

  try {
    const r = await apifyService.buscarContatoEmpresa(empresa);
    if (!r?.encontrado || !r.telefone) return patch;

    const contatos = [];
    if (r.telefone) contatos.push({ tipo: 'telefone', valor: r.telefone, fonte: 'apify', confianca: r.confianca });
    if (r.contato?.site) contatos.push({ tipo: 'site', valor: r.contato.site, fonte: 'apify', confianca: r.confianca });
    if (r.contato?.instagram) contatos.push({ tipo: 'instagram', valor: r.contato.instagram, fonte: 'apify', confianca: r.confianca });

    return {
      ...patch,
      status: 'concluido',
      telefone: r.telefone,
      site: r.contato?.site || patch.site || null,
      nome_encontrado: r.contato?.nome || patch.nome_encontrado || null,
      confianca: r.confianca ?? patch.confianca,
      confianca_pct: r.confianca_pct ?? patch.confianca_pct,
      confianca_nivel: r.confianca_nivel || patch.confianca_nivel,
      recomenda_apify: false,
      apify_motivo: null,
      contatos_json: JSON.stringify(contatos),
      fonte: 'apify'
    };
  } catch (error) {
    // Fallback nunca deve derrubar o processamento da fila.
    console.error('Fallback Apify falhou:', error.message);
    return patch;
  }
}

/**
 * Quantas linhas foram processadas (chamaram o Google) desde `desde`.
 * Serve para respeitar os tetos de custo diario e mensal.
 */
async function processadosDesde(desde) {
  const row = await db(TABELA)
    .whereIn('status', ['concluido', 'sem_resultado', 'erro'])
    .where('processado_em', '>=', formatarDateTimeSQL(desde))
    .count({ total: 'id' })
    .first();
  return Number(row?.total || 0);
}

function inicioDoDiaUTC() {
  return new Date(new Date().setUTCHours(0, 0, 0, 0));
}

function inicioDoMesUTC() {
  const agora = new Date();
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1, 0, 0, 0));
}

let processando = false;

/**
 * Consome um ciclo da fila de enriquecimento. Idempotente e seguro para ser
 * chamado por setInterval: ignora reentrancia e para o ciclo assim que a cota
 * do Google se esgota ou o teto diario e atingido.
 *
 * @returns {Promise<{processados:number, adiados:number, ignorados:number}>}
 */
async function processarFila() {
  if (processando) return { processados: 0, adiados: 0, ignorados: 0, ocupado: true };
  processando = true;
  const resumo = { processados: 0, adiados: 0, ignorados: 0 };

  try {
    // Interruptor geral: nenhuma chamada ao Google enquanto desligado.
    if (!ATIVO) return { ...resumo, desativado: true };

    // Teto MENSAL: barra o gasto ao longo do mes (a franquia gratuita do Google
    // e por mes). E a trava mais importante contra surpresa no cartao.
    if (TETO_MENSAL > 0 && await processadosDesde(inicioDoMesUTC()) >= TETO_MENSAL) {
      return { ...resumo, teto_mensal_atingido: true };
    }

    // Teto DIARIO: distribui o consumo e evita esvaziar a cota de uma vez.
    let restanteDia = Infinity;
    if (TETO_DIARIO > 0) {
      restanteDia = TETO_DIARIO - await processadosDesde(inicioDoDiaUTC());
      if (restanteDia <= 0) return { ...resumo, teto_atingido: true };
    }

    const limite = Math.max(0, Math.min(LOTE, restanteDia));
    const pendentes = limite > 0
      ? await db(TABELA)
        .where('status', 'pendente')
        .orderBy('id', 'asc')
        .limit(limite)
      : [];

    for (const registro of pendentes) {
      const desfecho = await processarLinha(registro);
      if (desfecho === 'adiado') {
        resumo.adiados += 1;
        break; // cota esgotada: nao adianta continuar neste ciclo
      }
      if (desfecho === 'ignorado') resumo.ignorados += 1;
      else resumo.processados += 1;
      if (INTERVALO_MS > 0) await sleep(INTERVALO_MS);
    }

    return resumo;
  } finally {
    processando = false;
  }
}

module.exports = {
  enfileirarLinhas,
  processarFila,
  extrairDadosEmpresa,
  _internals: {
    valorPorAliases,
    interpretarResultadoGoogle,
    montarContatos
  }
};
