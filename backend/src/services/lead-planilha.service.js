const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Busboy = require('busboy');
const ExcelJS = require('exceljs');
/**
 * Servico de importacao, distribuicao e acompanhamento de planilhas de leads.
 */
const LeadPlanilha = require('../models/LeadPlanilha');
const LeadLinha = require('../models/LeadLinha');
const LeadEnvio = require('../models/LeadEnvio');
const LeadEnvioUsuario = require('../models/LeadEnvioUsuario');
const LeadAtribuicao = require('../models/LeadAtribuicao');
const LeadSondagem = require('../models/LeadSondagem');
const db = require('../database/connection');
const { parseUtcDateTime } = require('../utils/datetime');
const clienteAntigoService = require('./cliente-antigo.service');
const { restaurarZerosCnpj } = require('./cnpj.service');
const telegramService = require('./telegram.service');
const leadDistribuicaoService = require('./lead-distribuicao.service');
const leadEnriquecimentoService = require('./lead-enriquecimento.service');
const leadTelegramPublicacaoService = require('./lead-telegram-publicacao.service');

const IMPORT_DIR = process.env.LEAD_IMPORT_DIR
  ? path.resolve(process.env.LEAD_IMPORT_DIR)
  : path.resolve(__dirname, '../../storage/lead-imports');
const INSERT_BATCH_SIZE = 1000;
const INSERT_BATCH_MAX_BYTES = Number(process.env.LEAD_IMPORT_BATCH_MAX_BYTES || 350000);
const SINGLE_ROW_MAX_BYTES = Number(process.env.LEAD_IMPORT_ROW_MAX_BYTES || 300000);
const SELECT_BATCH_SIZE = 2000;
const DB_RETRY_ATTEMPTS = 2;
const USAR_LOAD_INFILE = process.env.LEAD_IMPORT_USE_LOAD_INFILE === 'true';
const UPDATED_COLUMN_SUFFIX = ' (atualizado)';
const EXCEL_IMPORT_BATCH_SIZE = 5000;
const PALAVRAS_COLUNA_DOCUMENTO = ['cnpj', 'cpf', 'documento'];
const EXCEL_IMPORT_MAX_BYTES = Number(process.env.LEAD_EXCEL_IMPORT_MAX_BYTES || 50 * 1024 * 1024);
const TERMOS_CABECALHO_MAILING = [
  'cnpj',
  'cpf/cnpj',
  'documento',
  'razao social',
  'empresa',
  'nome fantasia',
  'acessos',
  'consultor',
  'data de ativacao',
  'terminal',
  'status',
  'operadora',
  'telefone',
  'whatsapp',
  'contato',
  'responsavel',
  'quantidade de chips',
  'qtd chips',
  'chips',
  'data da venda',
  'data venda',
  'email',
  'e-mail',
  'cidade',
  'uf'
];

const TRANSIENT_DB_ERRORS = [
  'closed state',
  'PROTOCOL_CONNECTION_LOST',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'Cannot enqueue',
  'Connection lost',
  'Lock wait timeout exceeded',
  'Deadlock found'
];

/**
 * Aguarda o intervalo informado antes de continuar.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Verifica se transient db error atende a condicao esperada.
 */
function isTransientDbError(error) {
  const texto = [
    error?.message,
    error?.code,
    error?.errno,
    error?.sqlState
  ].filter(Boolean).join(' ');

  return TRANSIENT_DB_ERRORS.some(pattern => texto.includes(pattern));
}

/**
 * Processa log processamento conforme as regras do dominio.
 */
function logProcessamento(planilhaId, etapa, dados = {}) {
  const partes = [`[lead-planilhas] planilha_id=${planilhaId}`, `etapa=${etapa}`];
  if (dados.linhas !== undefined) partes.push(`linhas=${dados.linhas}`);
  if (dados.bytes !== undefined) partes.push(`bytes=${dados.bytes}`);
  if (dados.arquivo) partes.push(`arquivo=${dados.arquivo}`);
  if (dados.tentativa !== undefined) partes.push(`tentativa=${dados.tentativa}`);

  const erro = dados.error;
  if (erro) {
    console.error(`${partes.join(' ')} erro=${erro.message || erro}`, {
      code: erro.code,
      errno: erro.errno,
      sqlState: erro.sqlState,
      stack: erro.stack
    });
    return;
  }

  console.log(partes.join(' '));
}

/**
 * Remove arquivo importacao da colecao ou estado atual.
 */
async function removerArquivoImportacao(planilhaId, arquivoPath, contexto) {
  if (!arquivoPath) return true;

  try {
    await fs.promises.unlink(arquivoPath);
    logProcessamento(planilhaId, `arquivo_removido.${contexto}`, { arquivo: arquivoPath });
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return true;
    }

    if (error.code !== 'ENOENT') {
      logProcessamento(planilhaId, `arquivo_removido.${contexto}.erro`, { arquivo: arquivoPath, error });
    }
    return false;
  }
}

/**
 * Executa a operacao de banco com tentativas em erros transitorios.
 */
async function withDbRetry(planilhaId, etapa, fn, opcoes = {}) {
  const tentativas = opcoes.tentativas ?? DB_RETRY_ATTEMPTS;

  for (let tentativa = 0; tentativa <= tentativas; tentativa += 1) {
    try {
      return await fn();
    } catch (error) {
      if (error?.code === 'ER_NET_PACKET_TOO_LARGE') {
        throw new Error('Um lote ou linha excedeu o max_allowed_packet do MySQL. Reduza LEAD_IMPORT_BATCH_MAX_BYTES/LEAD_IMPORT_ROW_MAX_BYTES ou aumente max_allowed_packet no MySQL.');
      }

      const podeTentarNovamente = tentativa < tentativas && isTransientDbError(error);
      logProcessamento(planilhaId, etapa, {
        linhas: opcoes.linhas,
        tentativa: tentativa + 1,
        error
      });

      if (!podeTentarNovamente) throw error;
      await sleep(300 * (tentativa + 1));
    }
  }

  return null;
}

/**
 * Processa inserir lead linhas conforme as regras do dominio.
 */
async function inserirLeadLinhas(planilhaId, linhas, etapa) {
  if (!linhas.length) return;

  if (USAR_LOAD_INFILE) {
    return inserirViaLoadInfile(planilhaId, linhas, etapa);
  }

  let lote = [];
  let loteBytes = 0;

  /**
   * Envia o lote acumulado e reinicia o buffer.
   */
  async function flush() {
    if (lote.length === 0) return;
    const loteAtual = lote;
    lote = [];
    loteBytes = 0;

    await withDbRetry(
      planilhaId,
      `${etapa}.insert`,
      () => LeadLinha.knex()('lead_linhas').insert(loteAtual),
      { linhas: loteAtual.length }
    );
  }

  for (const linha of linhas) {
    const tamanhoLinha = Buffer.byteLength(String(linha.dados_json || ''), 'utf8') + 256;

    if (tamanhoLinha > SINGLE_ROW_MAX_BYTES) {
      throw new Error(`Linha ${linha.row_index ?? '?'} excede o limite seguro de importacao (${tamanhoLinha} bytes). Revise a planilha ou aumente LEAD_IMPORT_ROW_MAX_BYTES.`);
    }

    if (lote.length > 0 && (lote.length >= INSERT_BATCH_SIZE || loteBytes + tamanhoLinha > INSERT_BATCH_MAX_BYTES)) {
      await flush();
    }

    lote.push(linha);
    loteBytes += tamanhoLinha;
  }

  await flush();
}

/**
 * Escapa escape load infile value para evitar quebra de formato.
 */
function escapeLoadInfileValue(valor) {
  return String(valor)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Processa inserir via load infile conforme as regras do dominio.
 */
async function inserirViaLoadInfile(planilhaId, linhas, etapa) {
  const tmpDir = os.tmpdir();
  const arquivoTsv = path.join(tmpDir, `lead-load-${planilhaId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.tsv`);

  let escritas = 0;
  const stream = fs.createWriteStream(arquivoTsv, { encoding: 'utf8' });
  try {
    for (const linha of linhas) {
      const dadosJson = String(linha.dados_json || '');
      const tamanhoLinha = Buffer.byteLength(dadosJson, 'utf8') + 256;
      if (tamanhoLinha > SINGLE_ROW_MAX_BYTES) {
        throw new Error(`Linha ${linha.row_index ?? '?'} excede o limite seguro de importacao (${tamanhoLinha} bytes).`);
      }

      const fileLine = `${linha.planilha_id}\t${linha.row_index}\t${escapeLoadInfileValue(dadosJson)}\n`;
      if (!stream.write(fileLine)) {
        await new Promise(resolve => stream.once('drain', resolve));
      }
      escritas += 1;
    }
    await new Promise((resolve, reject) => {
      stream.end(err => (err ? reject(err) : resolve()));
    });

    const sql = `LOAD DATA LOCAL INFILE ? INTO TABLE lead_linhas
      CHARACTER SET utf8mb4
      FIELDS TERMINATED BY '\\t' ESCAPED BY '\\\\'
      LINES TERMINATED BY '\\n'
      (planilha_id, row_index, dados_json)`;

    await withDbRetry(
      planilhaId,
      `${etapa}.load_infile`,
      () => LeadLinha.knex().raw(sql, [arquivoTsv]),
      { linhas: escritas }
    );
  } finally {
    fs.promises.unlink(arquivoTsv).catch(() => {});
  }
}

/**
 * Cria http error com os dados informados.
 */
function criarHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * Formata date time sql para exibicao ou envio.
 */
function formatarDateTimeSQL(data = new Date()) {
  /**
   * Preenche valores numericos com zero a esquerda.
   */
  const pad = value => String(value).padStart(2, '0');

  return [
    data.getUTCFullYear(),
    pad(data.getUTCMonth() + 1),
    pad(data.getUTCDate())
  ].join('-') + ' ' + [
    pad(data.getUTCHours()),
    pad(data.getUTCMinutes()),
    pad(data.getUTCSeconds())
  ].join(':');
}

/**
 * Converte data hora retorno para o formato interno esperado.
 */
function parseDataHoraRetorno(valor) {
  if (!valor) return null;

  // Datas sem sufixo de fuso tambem representam UTC no banco. Usar o parser
  // central evita que a configuracao de fuso do servidor altere o horario.
  const data = parseUtcDateTime(valor);

  if (!data) {
    throw criarHttpError(400, 'Data de retorno invalida.');
  }

  if (data <= new Date()) {
    throw criarHttpError(400, 'A data e hora do retorno deve estar no futuro.');
  }

  return formatarDateTimeSQL(data);
}

/**
 * Adiciona dias ao conjunto atual.
 */
function adicionarDias(data, dias) {
  const resultado = new Date(data);
  resultado.setDate(resultado.getDate() + dias);
  return resultado;
}

/**
 * Aplica busca futuros clientes sobre a consulta ou conjunto informado.
 */
function aplicarBuscaFuturosClientes(query, busca) {
  const termo = String(busca || '').trim().toLowerCase();
  if (!termo) return query;

  return query.where(builder => {
    builder
      .whereRaw('LOWER(dados_json) LIKE ?', [`%${termo}%`])
      .orWhereRaw('LOWER(COALESCE(futuro_cliente_notas, "")) LIKE ?', [`%${termo}%`]);
  });
}
/**
 * Applies filters specific to the future-clients list.
 */
function aplicarFiltrosFuturosClientes(query, filtros = {}) {
  const situacao = String(filtros.situacao || '').trim();
  const retorno = String(filtros.retorno || '').trim();

  if (situacao === 'em_negociacao') {
    query.whereNull('venda_id')
      .where(builder => builder
        .whereNull('status_operacional')
        .orWhereNotIn('status_operacional', ['vendido', 'perdido']));
  } else if (situacao === 'venda_concluida') {
    query.where(builder => builder
      .where('status_operacional', 'vendido')
      .orWhereNotNull('venda_id'));
  } else if (situacao === 'venda_recusada') {
    query.where('status_operacional', 'perdido');
  }

  if (retorno === 'com_retorno') {
    query.whereNotNull('futuro_cliente_retorno')
      .whereNull('futuro_cliente_retorno_realizado_em');
  } else if (retorno === 'sem_retorno') {
    query.whereNull('futuro_cliente_retorno');
  } else if (retorno === 'vencido') {
    query.whereNotNull('futuro_cliente_retorno')
      .whereNull('futuro_cliente_retorno_realizado_em')
      .where('futuro_cliente_retorno', '<', formatarDateTimeSQL());
  } else if (retorno === 'realizado') {
    query.whereNotNull('futuro_cliente_retorno')
      .whereNotNull('futuro_cliente_retorno_realizado_em');
  }

  return query;
}

/**
 * Converte json para o formato interno esperado.
 */
function parseJson(valor, fallback) {
  if (valor === null || valor === undefined) return fallback;
  if (typeof valor !== 'string') return valor;

  try {
    return JSON.parse(valor);
  } catch {
    return fallback;
  }
}

/**
 * Formata planilha para exibicao ou envio.
 */
function formatarPlanilha(planilha) {
  const json = typeof planilha?.toJSON === 'function' ? planilha.toJSON() : planilha;
  if (!json) return json;

  return {
    ...json,
    colunas: parseJson(json.colunas, []),
    schema_colunas: parseJson(json.schema_colunas, {}),
    total_linhas: Number(json.total_linhas || 0),
    linhas_processadas: Number(json.linhas_processadas || json.total_linhas || 0),
    progresso_percentual: Number(json.progresso_percentual ?? 100),
    tamanho_bytes: Number(json.tamanho_bytes || 0)
  };
}

const PROCESSAMENTO_TRAVADO_MS = Number(process.env.LEAD_IMPORT_STALE_MS || 5 * 60 * 1000);

/**
 * Reconcilia planilha processando com o estado persistido.
 */
async function reconciliarPlanilhaProcessando(planilha) {
  const json = typeof planilha?.toJSON === 'function' ? planilha.toJSON() : planilha;
  if (!json || json.status !== 'processando') return planilha;

  const arquivoSumiu = json.arquivo_temporario && !fs.existsSync(json.arquivo_temporario);
  const semProgresso = Number(json.linhas_processadas || 0) === 0 && Number(json.progresso_percentual || 0) === 0;

  const ultimaAtualizacao = parseUtcDateTime(json.updated_at || json.created_at)?.getTime() ?? NaN;
  const tempoOcioso = Date.now() - ultimaAtualizacao;
  const travado = Number.isFinite(ultimaAtualizacao) && tempoOcioso > PROCESSAMENTO_TRAVADO_MS;

  let motivo = null;
  if (arquivoSumiu && semProgresso) {
    motivo = 'Arquivo temporÃ¡rio nÃ£o encontrado; o processamento pode ter sido interrompido por reinÃ­cio do servidor ou falha antes de registrar o erro.';
  } else if (travado) {
    motivo = `Processamento sem atualizaÃ§Ã£o hÃ¡ ${Math.round(tempoOcioso / 1000)}s; provavelmente o processo foi encerrado (reinicio do servidor, falta de memoria ou falha silenciosa).`;
  }

  if (!motivo) return planilha;

  try {
    const patch = {
      status: 'erro',
      erro_processamento: motivo,
      updated_at: new Date()
    };
    if (arquivoSumiu) patch.arquivo_temporario = null;

    const atualizada = await withDbRetry(json.id, 'reconciliarProcessamento', () => (
      LeadPlanilha.query().patchAndFetchById(json.id, patch)
    ));
    return atualizada || planilha;
  } catch (error) {
    logProcessamento(json.id, 'reconciliarProcessamento.erro', { error });
    return planilha;
  }
}

/**
 * Formata envio para exibicao ou envio.
 */
function formatarEnvio(envio) {
  const json = typeof envio?.toJSON === 'function' ? envio.toJSON() : envio;
  if (!json) return json;

  return {
    ...json,
    colunas_visiveis: parseJson(json.colunas_visiveis, []),
    usuarios: (json.usuarios || []).map(item => ({
      ...item,
      usuario: item.usuario
    }))
  };
}

/**
 * Formata linha para exibicao ou envio.
 */
function formatarLinha(linha) {
  const json = typeof linha?.toJSON === 'function' ? linha.toJSON() : linha;
  if (!json) return json;

  const sondagem = json.sondagem ? {
    ...json.sondagem,
    chips_itens: parseJson(json.sondagem.chips_itens, [])
  } : json.sondagem;
  const retornoLinhaValido = json.futuro_cliente_retorno
    && !String(json.futuro_cliente_retorno).startsWith('0000-00-00');
  const marcadoLinhaValido = json.futuro_cliente_marcado_em
    && !String(json.futuro_cliente_marcado_em).startsWith('0000-00-00');
  return {
    ...json,
    dados_json: parseJson(json.dados_json, {}),
    sondagem,
    enriquecimento: formatarEnriquecimento(json.enriquecimento),
    futuro_cliente_retorno: retornoLinhaValido ? json.futuro_cliente_retorno : (sondagem?.retorno_em || null),
    futuro_cliente_retorno_status: !(retornoLinhaValido ? json.futuro_cliente_retorno : sondagem?.retorno_em)
      ? 'sem_retorno'
      : json.futuro_cliente_retorno_realizado_em ? 'realizado' : 'agendado',
    retorno_agendado_status: !json.retorno_agendado_em
      ? 'sem_retorno'
      : json.retorno_agendado_realizado_em ? 'realizado' : 'agendado',
    futuro_cliente_marcado_em: marcadoLinhaValido ? json.futuro_cliente_marcado_em : (sondagem?.respondido_em || null),
    planilha: formatarPlanilha(json.planilha),
    envio: formatarEnvio(json.envio)
  };
}

/**
 * Normaliza o registro de enriquecimento para a interface, desserializando os
 * contatos e expondo apenas o essencial do resultado da busca automatica.
 */
function formatarEnriquecimento(enriquecimento) {
  if (!enriquecimento) return null;
  const json = typeof enriquecimento?.toJSON === 'function' ? enriquecimento.toJSON() : enriquecimento;
  if (!json) return null;

  return {
    status: json.status,
    telefone: json.telefone || null,
    site: json.site || null,
    nome_encontrado: json.nome_encontrado || null,
    endereco: json.endereco || null,
    confianca_pct: json.confianca_pct ?? null,
    confianca_nivel: json.confianca_nivel || null,
    recomenda_apify: Boolean(json.recomenda_apify),
    apify_motivo: json.apify_motivo || null,
    contatos: parseJson(json.contatos_json, []),
    processado_em: json.processado_em || null
  };
}

/**
 * Lista planilhas conforme os filtros e parametros informados.
 */
async function listarPlanilhas() {
  const planilhas = await LeadPlanilha.query()
    .withGraphFetched('criador')
    .modifyGraph('criador', builder => builder.select('id', 'nome', 'email'))
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc');

  const planilhaIds = planilhas.map(planilha => Number(planilha.id)).filter(Boolean);
  const enviadosPorPlanilha = new Map();
  const metricasPorPlanilha = new Map();
  if (planilhaIds.length > 0) {
    const totais = await LeadLinha.query()
      .select('planilha_id')
      .count('id as total_enviados')
      .whereIn('planilha_id', planilhaIds)
      .whereNotNull('envio_id')
      .groupBy('planilha_id');
    totais.forEach(item => enviadosPorPlanilha.set(Number(item.planilha_id), Number(item.total_enviados || 0)));

    const metricas = await LeadLinha.query()
      .select('planilha_id')
      .select(db.raw('SUM(CASE WHEN cliente_recusou = 1 THEN 1 ELSE 0 END) as total_recusados'))
      .select(db.raw('SUM(CASE WHEN chamada_nao_atendida = 1 THEN 1 ELSE 0 END) as total_nao_atendidos'))
      .select(db.raw(
        'SUM(CASE WHEN futuro_cliente = 1 AND futuro_cliente_excluido_em IS NULL '
        + 'THEN 1 ELSE 0 END) as total_futuros'
      ))
      .whereIn('planilha_id', planilhaIds)
      .groupBy('planilha_id');
    metricas.forEach(item => metricasPorPlanilha.set(Number(item.planilha_id), {
      totalRecusados: Number(item.total_recusados || 0),
      totalNaoAtendidos: Number(item.total_nao_atendidos || 0),
      totalFuturos: Number(item.total_futuros || 0)
    }));
  }

  const reconciliadas = [];
  for (const planilha of planilhas) {
    reconciliadas.push(await reconciliarPlanilhaProcessando(planilha));
  }

  return reconciliadas.map(planilha => {
    const formatada = formatarPlanilha(planilha);
    const totalEnviados = enviadosPorPlanilha.get(Number(formatada.id)) || 0;
    const metricas = metricasPorPlanilha.get(Number(formatada.id))
      || { totalRecusados: 0, totalFuturos: 0 };
    return {
      ...formatada,
      total_enviados: totalEnviados,
      total_pendentes: Math.max(0, formatada.total_linhas - totalEnviados),
      total_recusados: metricas.totalRecusados,
      total_nao_atendidos: metricas.totalNaoAtendidos,
      total_futuros: metricas.totalFuturos
    };
  });
}

/**
 * Busca status conforme os parametros informados.
 */
async function buscarStatus(planilhaId) {
  const planilha = await LeadPlanilha.query().findById(planilhaId);
  return formatarPlanilha(await reconciliarPlanilhaProcessando(planilha));
}

/**
 * Cria planilha com os dados informados.
 */
async function criarPlanilha(dados, usuarioId) {
  const colunas = Array.isArray(dados.colunas) ? dados.colunas : [];
  const schemaColunas = dados.schema_colunas && typeof dados.schema_colunas === 'object'
    ? dados.schema_colunas
    : {};

  if (!String(dados.nome || '').trim()) {
    throw new Error('Informe o nome da planilha.');
  }

  const modoStreaming = dados.streaming === true;
  const status = modoStreaming ? 'processando' : 'concluida';
  const totalInicial = Number(dados.total_linhas || 0);

  const planilha = await LeadPlanilha.query().insertAndFetch({
    nome: String(dados.nome).trim(),
    colunas: JSON.stringify(colunas),
    schema_colunas: JSON.stringify(schemaColunas),
    total_linhas: totalInicial,
    linhas_processadas: totalInicial,
    progresso_percentual: modoStreaming ? 0 : 100,
    status,
    criado_por_id: usuarioId
  });

  return formatarPlanilha(planilha);
}

/**
 * Salva linhas lote com os dados informados.
 */
async function salvarLinhasLote(planilhaId, linhas = []) {
  const planilha = await LeadPlanilha.query().findById(planilhaId);
  if (!planilha) throw new Error('Planilha nÃ£o encontrada.');

  const payload = linhas.map((linha, index) => ({
    planilha_id: Number(planilhaId),
    row_index: Number(linha.row_index ?? index),
    dados_json: JSON.stringify(linha.dados_json || linha.dados || {})
  }));

  if (payload.length > 0) {
    await inserirLeadLinhas(planilhaId, payload, 'salvarLinhasLote');
  }

  const total = Number(planilha.total_linhas || 0) + payload.length;
  const ehStreaming = planilha.status === 'processando';

  const patch = {
    total_linhas: total,
    linhas_processadas: total,
    updated_at: new Date()
  };
  if (!ehStreaming) {
    patch.progresso_percentual = 100;
    patch.status = 'concluida';
  }

  await withDbRetry(planilhaId, 'salvarLinhasLote.progresso', () => (
    LeadPlanilha.query().patchAndFetchById(planilhaId, patch)
  ));

  return { total_linhas: total };
}

/**
 * Executa a acao de finalizar planilha mantendo o estado da tela consistente.
 */
async function finalizarPlanilha(planilhaId, dados = {}) {
  const planilha = await LeadPlanilha.query().findById(planilhaId);
  if (!planilha) throw criarHttpError(404, 'Planilha nÃ£o encontrada.');

  const colunas = Array.isArray(dados.colunas) ? dados.colunas : null;
  const schemaColunas = dados.schema_colunas && typeof dados.schema_colunas === 'object'
    ? dados.schema_colunas
    : null;

  const patch = {
    status: 'concluida',
    progresso_percentual: 100,
    arquivo_temporario: null,
    erro_processamento: null,
    updated_at: new Date()
  };
  if (colunas) patch.colunas = JSON.stringify(colunas);
  if (schemaColunas) patch.schema_colunas = JSON.stringify(schemaColunas);

  const atualizada = await withDbRetry(planilhaId, 'finalizarPlanilha', () => (
    LeadPlanilha.query().patchAndFetchById(planilhaId, patch)
  ));
  return formatarPlanilha(atualizada || planilha);
}

/**
 * Marca erro planilha conforme a acao solicitada.
 */
async function marcarErroPlanilha(planilhaId, mensagem) {
  const planilha = await LeadPlanilha.query().findById(planilhaId);
  if (!planilha) throw criarHttpError(404, 'Planilha nÃ£o encontrada.');

  const atualizada = await withDbRetry(planilhaId, 'marcarErroPlanilha', () => (
    LeadPlanilha.query().patchAndFetchById(planilhaId, {
      status: 'erro',
      erro_processamento: String(mensagem || 'Erro reportado pelo cliente.').slice(0, 1000),
      updated_at: new Date()
    })
  ));
  return formatarPlanilha(atualizada || planilha);
}

/**
 * Atualiza schema com os dados informados.
 */
async function atualizarSchema(planilhaId, schemaColunas) {
  const planilha = await LeadPlanilha.query().patchAndFetchById(planilhaId, {
    schema_colunas: JSON.stringify(schemaColunas || {}),
    updated_at: new Date()
  });

  return planilha ? formatarPlanilha(planilha) : null;
}

/**
 * Exclui planilha conforme a regra de negocio.
 */
async function excluirPlanilha(planilhaId) {
  let planilha = await LeadPlanilha.query().findById(planilhaId);

  if (!planilha) {
    throw criarHttpError(404, 'Planilha nÃ£o encontrada.');
  }

  if (planilha.status === 'processando') {
    planilha = await reconciliarPlanilhaProcessando(planilha);

    if (planilha.status === 'processando') {
      throw criarHttpError(409, 'Aguarde o processamento terminar antes de excluir esta planilha.');
    }
  }

  const enviosAfetados = await LeadLinha.query()
    .distinct('envio_id')
    .where('planilha_id', planilhaId)
    .whereNotNull('envio_id');

  await withDbRetry(planilhaId, 'excluirPlanilha.delete', () => (
    LeadPlanilha.query().deleteById(planilhaId)
  ));

  const envioIds = enviosAfetados.map(item => item.envio_id).filter(Boolean);
  for (const envioId of envioIds) {
    const linhasRestantes = await LeadLinha.query()
      .where('envio_id', envioId)
      .resultSize();

    if (linhasRestantes === 0) {
      await withDbRetry(planilhaId, 'excluirPlanilha.envio_orfao', () => (
        LeadEnvio.query().deleteById(envioId)
      ));
    }
  }

  if (planilha.arquivo_temporario) {
    removerArquivoImportacao(planilhaId, planilha.arquivo_temporario, 'exclusao').catch(() => {});
  }

  return true;
}

/**
 * Extrai ids numericos da query recebida.
 */
function idsFromQuery(valor) {
  if (!valor) return [];
  if (Array.isArray(valor)) return valor.map(Number).filter(Boolean);
  return String(valor)
    .split(',')
    .map(item => Number(item.trim()))
    .filter(Boolean);
}

/**
 * Retorna json value expr a partir dos dados informados.
 */
const STATUS_REENVIO_PERMITIDOS = new Set([
  'cliente_recusou',
  'chamada_nao_atendida',
  'retorno_agendado'
]);

/** Normaliza os estados que podem ser reabertos em um reenvio de sondagem. */
function normalizarStatusReenvio(valor) {
  const valores = Array.isArray(valor) ? valor : String(valor || '').split(',');
  return [...new Set(valores.map(item => String(item).trim()).filter(item => STATUS_REENVIO_PERMITIDOS.has(item)))];
}

/** Limita a consulta aos leads que possuem ao menos um dos estados escolhidos. */
function aplicarStatusReenvio(query, statusReenvio, excluir = false) {
  if (!statusReenvio.length) return;
  const aplicar = excluir ? 'whereNot' : 'where';
  query[aplicar](builder => {
    statusReenvio.forEach((status, index) => {
      const metodo = index === 0 ? 'where' : 'orWhere';
      if (status === 'cliente_recusou') builder[metodo]('cliente_recusou', true);
      if (status === 'chamada_nao_atendida') builder[metodo]('chamada_nao_atendida', true);
      if (status === 'retorno_agendado') builder[metodo](subquery => subquery.whereNotNull('retorno_agendado_em'));
    });
  });
}

/** Preserva o resultado original para as métricas mesmo depois de reabrir o lead. */
function montarHistoricoPrimeiraLigacao(statusReenvio) {
  const camposPorStatus = {
    chamada_nao_atendida: ['chamada_nao_atendida = 1', 'chamada_nao_atendida_em', 'chamada_nao_atendida_por_id'],
    cliente_recusou: ['cliente_recusou = 1', 'cliente_recusou_em', 'cliente_recusou_por_id'],
    retorno_agendado: ['retorno_agendado_em IS NOT NULL', 'updated_at', 'retorno_agendado_por_id']
  };
  const selecionados = statusReenvio.map(status => [status, camposPorStatus[status]]).filter(([, campos]) => campos);
  if (!selecionados.length) return {};

  const caso = indice => selecionados.map(([status, campos]) => `WHEN ${campos[0]} THEN '${status}'`).join(' ');
  const campo = indice => selecionados.map(([, campos]) => `WHEN ${campos[0]} THEN ${campos[indice]}`).join(' ');
  return {
    primeira_ligacao_status: db.raw(`COALESCE(primeira_ligacao_status, CASE ${caso(0)} ELSE NULL END)`),
    primeira_ligacao_em: db.raw(`COALESCE(primeira_ligacao_em, CASE ${campo(1)} ELSE NULL END)`),
    primeira_ligacao_usuario_id: db.raw(`COALESCE(primeira_ligacao_usuario_id, CASE ${campo(2)} ELSE NULL END)`)
  };
}

/** Campos que voltam ao estado pendente quando o administrador reabre um status. */
function montarLimpezaStatusReenvio(statusReenvio) {
  const limpeza = {};
  if (statusReenvio.includes('cliente_recusou')) Object.assign(limpeza, { cliente_recusou: false, cliente_recusou_motivo: null, cliente_recusou_em: null, cliente_recusou_por_id: null });
  if (statusReenvio.includes('chamada_nao_atendida')) Object.assign(limpeza, { chamada_nao_atendida: false, chamada_nao_atendida_motivo: null, chamada_nao_atendida_em: null, chamada_nao_atendida_por_id: null });
  if (statusReenvio.includes('retorno_agendado')) Object.assign(limpeza, {
    retorno_agendado_em: null,
    retorno_agendado_observacao: null,
    retorno_agendado_por_id: null
  });
  return limpeza;
}

function getJsonValueExpr(coluna) {
  const pathSeguro = String(coluna || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `JSON_UNQUOTE(JSON_EXTRACT(dados_json, '$."${pathSeguro}"'))`;
}

/**
 * Retorna coluna nome a partir dos dados informados.
 */
function getColunaNome(coluna) {
  return coluna?.nome || coluna?.label || coluna;
}

/**
 * Cria coluna atualizada com os dados informados.
 */
function criarColunaAtualizada(coluna) {
  if (typeof coluna === 'string') return `${coluna}${UPDATED_COLUMN_SUFFIX}`;

  const nome = coluna.nome || coluna.label || '';
  const label = coluna.label || nome;

  return {
    ...coluna,
    id: `${coluna.id || nome}::updated`,
    nome: `${nome}${UPDATED_COLUMN_SUFFIX}`,
    label: `${label}${UPDATED_COLUMN_SUFFIX}`,
    sources: Array.isArray(coluna.sources)
      ? coluna.sources.map(source => ({
        ...source,
        nome: `${source.nome}${UPDATED_COLUMN_SUFFIX}`
      }))
      : coluna.sources
  };
}

/**
 * Retorna coluna atualizada existe no formato esperado pelo fluxo.
 */
function colunaAtualizadaExiste(coluna, chavesAtualizadas) {
  if (!coluna || String(getColunaNome(coluna)).endsWith(UPDATED_COLUMN_SUFFIX)) return false;

  if (Array.isArray(coluna.sources) && coluna.sources.length > 0) {
    return coluna.sources.some(source => chavesAtualizadas.has(`${source.nome}${UPDATED_COLUMN_SUFFIX}`));
  }

  return chavesAtualizadas.has(`${getColunaNome(coluna)}${UPDATED_COLUMN_SUFFIX}`);
}

/**
 * Processa coletar chaves atualizadas conforme as regras do dominio.
 */
async function coletarChavesAtualizadas(query) {
  const chaves = new Set();
  let offset = 0;

  while (true) {
    const linhas = await query.clone()
      .select('dados_json')
      .orderBy('planilha_id', 'asc')
      .orderBy('row_index', 'asc')
      .offset(offset)
      .limit(SELECT_BATCH_SIZE);
    if (linhas.length === 0) break;

    linhas.forEach(linha => {
      Object.keys(parseJson(linha.dados_json, {}))
        .filter(chave => chave.endsWith(UPDATED_COLUMN_SUFFIX))
        .forEach(chave => chaves.add(chave));
    });

    offset += linhas.length;
  }

  return chaves;
}

/**
 * Expande colunas exportacao em linhas ou colunas detalhadas.
 */
async function expandirColunasExportacao(colunas, query) {
  const chavesAtualizadas = await coletarChavesAtualizadas(query);
  if (chavesAtualizadas.size === 0) return colunas;

  const resultado = [];
  const incluidas = new Set();

  colunas.forEach(coluna => {
    const nome = getColunaNome(coluna);
    if (!incluidas.has(nome)) {
      resultado.push(coluna);
      incluidas.add(nome);
    }

    const nomeAtualizado = `${nome}${UPDATED_COLUMN_SUFFIX}`;
    if (!String(nome).endsWith(UPDATED_COLUMN_SUFFIX) && colunaAtualizadaExiste(coluna, chavesAtualizadas) && !incluidas.has(nomeAtualizado)) {
      resultado.push(criarColunaAtualizada(coluna));
      incluidas.add(nomeAtualizado);
    }
  });

  return resultado;
}

/**
 * Aplica filtros query sobre a consulta ou conjunto informado.
 */
function aplicarFiltrosQuery(query, filtros = {}, opcoes = {}) {
  const planilhaIds = idsFromQuery(filtros.planilha_ids);
  const envioIds = idsFromQuery(filtros.envio_ids);

  if (planilhaIds.length > 0) query.whereIn('planilha_id', planilhaIds);
  if (envioIds.length > 0) query.whereIn('envio_id', envioIds);
  const linhaId = Number(filtros.linha_id || 0);
  if (Number.isInteger(linhaId) && linhaId > 0) query.where('id', linhaId);
  if (opcoes.usuarioId) query.where('atribuido_para_id', Number(opcoes.usuarioId));
  if (filtros.somente_enviados === true || filtros.somente_enviados === 'true') query.where(builder => builder.whereNotNull('envio_id').orWhereNotNull('atribuido_para_id'));
  aplicarStatusReenvio(query, normalizarStatusReenvio(filtros.status_reenvio), filtros.status_reenvio_modo === 'excluir');
  if (filtros.etapa) query.where('etapa_atual', String(filtros.etapa));
  if (filtros.somente_qualificados === true || filtros.somente_qualificados === 'true') {
    query.where('futuro_cliente', true).whereNull('futuro_cliente_excluido_em');
  }
  if (filtros.disponivel_venda === true || filtros.disponivel_venda === 'true') {
    query.where('status_operacional', 'qualificado');
  }

  const status = String(filtros.status || '').trim();
  if (status === 'futuro_cliente') {
    query.where('futuro_cliente', true).whereNull('futuro_cliente_excluido_em');
  } else if (status === 'cliente_recusou') {
    query.where('cliente_recusou', true);
  } else if (status === 'retorno_agendado') {
    query.whereNotNull('retorno_agendado_em').where('futuro_cliente', false);
  } else if (status === 'chamada_nao_atendida') {
    query.where('chamada_nao_atendida', true).where('futuro_cliente', false);
  } else if (status === 'venda_registrada') {
    query.where('futuro_cliente', true).whereNull('futuro_cliente_excluido_em')
      .where(builder => builder.whereNotNull('venda_id').orWhere('status_operacional', 'vendido'));
  } else if (status === 'venda_recusada') {
    aplicarFiltroVendaRecusada(query);
  } else if (status === 'lixeira') {
    query.where('futuro_cliente', true).whereNotNull('futuro_cliente_excluido_em');
  } else if (status === 'pendente') {
    query.where('futuro_cliente', false)
      .where(builder => builder.whereNull('cliente_recusou').orWhere('cliente_recusou', false))
      .where(builder => builder.whereNull('chamada_nao_atendida').orWhere('chamada_nao_atendida', false))
      .whereNull('venda_recusada_em')
      .whereNull('venda_recusada_motivo')
      .whereNot('status_operacional', 'perdido')
      .whereNull('retorno_agendado_em');
  }
  if (filtros.busca) {
    query.whereRaw('LOWER(CAST(dados_json AS CHAR)) LIKE ?', [`%${String(filtros.busca).toLowerCase()}%`]);
  }

  const filtrosColuna = parseJson(filtros.filters, Array.isArray(filtros.filters) ? filtros.filters : []);
  filtrosColuna.forEach(filtro => {
    if (!filtro?.coluna || (!filtro.valor && filtro.op !== 'between')) return;
    const expr = getJsonValueExpr(filtro.coluna);
    const valor = String(filtro.valor || '');

    if (filtro.planilha_id) {
      query.where('planilha_id', Number(filtro.planilha_id));
    }

    if (filtro.tipo === 'date') {
      if (filtro.op === 'between') {
        if (filtro.valor) query.whereRaw(`${expr} >= ?`, [filtro.valor]);
        if (filtro.valor2) query.whereRaw(`${expr} <= ?`, [filtro.valor2]);
      } else {
        query.whereRaw(`${expr} = ?`, [valor]);
      }
      return;
    }

    if (filtro.op === 'exact') query.whereRaw(`${expr} = ?`, [valor]);
    else if (filtro.op === 'starts') query.whereRaw(`${expr} LIKE ?`, [`${valor}%`]);
    else if (filtro.op === 'ends') query.whereRaw(`${expr} LIKE ?`, [`%${valor}`]);
    else query.whereRaw(`${expr} LIKE ?`, [`%${valor}%`]);
  });
}

/** Venda recusada e um desfecho proprio, independente de futuro_cliente. */
function aplicarFiltroVendaRecusada(query) {
  return query.where(builder => builder
    .whereNotNull('venda_recusada_em')
    .orWhereNotNull('venda_recusada_motivo')
    .orWhere(legado => legado
      .where('status_operacional', 'perdido')
      .where(cliente => cliente.whereNull('cliente_recusou').orWhere('cliente_recusou', false))));
}

/**
 * Lista linhas conforme os filtros e parametros informados.
 */
function filtrosPermitemIndicacaoPendente(filtros = {}) {
  const status = String(filtros.status || '').trim();
  return !String(filtros.busca || '').trim()
    && (!status || status === 'futuro_cliente');
}

function queryIndicacoesPendentes(filtros = {}, usuarioId) {
  if (!usuarioId || !filtrosPermitemIndicacaoPendente(filtros)) return null;

  const query = db('lead_atribuicoes as la')
    .join('lead_linhas as ll', 'll.id', 'la.lead_linha_id')
    .leftJoin('lead_envios as le', 'le.id', 'la.envio_id')
    .where({
      'la.usuario_id': Number(usuarioId),
      'la.etapa': 'venda',
      'la.aceite_status': leadDistribuicaoService.ACEITE_AGUARDANDO,
      'll.futuro_cliente': true
    })
    .whereNull('ll.futuro_cliente_excluido_em');

  const envioIds = idsFromQuery(filtros.envio_ids);
  const planilhaIds = idsFromQuery(filtros.planilha_ids);
  const linhaId = Number(filtros.linha_id || 0);
  if (envioIds.length > 0) query.whereIn('la.envio_id', envioIds);
  if (planilhaIds.length > 0) query.whereIn('ll.planilha_id', planilhaIds);
  if (Number.isInteger(linhaId) && linhaId > 0) query.where('ll.id', linhaId);
  if (filtros.etapa) query.where('ll.etapa_atual', String(filtros.etapa));

  return query;
}

async function carregarIndicacoesPendentes(query, offset, limit) {
  if (!query || limit <= 0) return [];

  const atribuicoes = await query.clone()
    .select(
      'la.id',
      'la.lead_linha_id',
      'la.envio_id',
      'la.aceite_status',
      'la.aceite_em',
      'la.prazo_acao_em',
      'la.acao_registrada_em',
      'la.acao_registrada_tipo',
      'le.nome as envio_nome'
    )
    .orderBy('la.id', 'desc')
    .offset(offset)
    .limit(limit);
  if (!atribuicoes.length) return [];

  const linhas = await LeadLinha.query()
    .findByIds(atribuicoes.map(item => Number(item.lead_linha_id)))
    .withGraphFetched('planilha');
  const linhasPorId = new Map(linhas.map(linha => [Number(linha.id), linha]));

  return atribuicoes.flatMap(atribuicao => {
    const linha = linhasPorId.get(Number(atribuicao.lead_linha_id));
    if (!linha) return [];

    const protegida = leadDistribuicaoService.ocultarDetalhesAntesDoAceite(
      formatarLinha(linha),
      atribuicao
    );
    return [{
      ...protegida,
      envio: {
        id: Number(atribuicao.envio_id),
        nome: atribuicao.envio_nome || 'Indicacao aguardando aceite'
      }
    }];
  });
}

async function listarLinhas(filtros = {}, opcoes = {}) {
  const page = Math.max(1, Number(filtros.page || 1));
  const pageSize = Math.min(500, Math.max(1, Number(filtros.page_size || filtros.pageSize || 200)));
  const baseQuery = LeadLinha.query();
  aplicarFiltrosQuery(baseQuery, filtros, opcoes);

  const totalVinculadas = await baseQuery.clone().resultSize();
  const enviadosVinculados = await baseQuery.clone()
    .where(builder => {
      builder.whereNotNull('envio_id').orWhereNotNull('atribuido_para_id');
    })
    .resultSize();
  const qualificadosVinculados = await baseQuery.clone()
    .where('futuro_cliente', true)
    .whereNull('futuro_cliente_excluido_em')
    .resultSize();
  const pendentesQuery = queryIndicacoesPendentes(filtros, opcoes.usuarioId);
  const totalPendentesResultado = pendentesQuery
    ? await pendentesQuery.clone().countDistinct({ total: 'la.lead_linha_id' }).first()
    : null;
  const totalPendentes = Number(totalPendentesResultado?.total || 0);
  const total = totalPendentes + totalVinculadas;
  const offsetPagina = (page - 1) * pageSize;
  const offsetPendentes = Math.min(offsetPagina, totalPendentes);
  const limitePendentes = Math.max(0, Math.min(pageSize, totalPendentes - offsetPendentes));
  const pendentes = await carregarIndicacoesPendentes(
    pendentesQuery,
    offsetPendentes,
    limitePendentes
  );
  const limiteVinculadas = Math.max(0, pageSize - pendentes.length);
  const offsetVinculadas = Math.max(0, offsetPagina - totalPendentes);
  const linhasVinculadas = limiteVinculadas > 0
    ? await baseQuery
      .withGraphFetched('[planilha, envio, atribuidoPara, sondagem.[operadoraAtual, operadoraInteresse, usuario], enriquecimento]')
      .modifyGraph('atribuidoPara', builder => builder.select('id', 'nome', 'email'))
      .orderBy('planilha_id', 'asc')
      .orderBy('row_index', 'asc')
      .offset(offsetVinculadas)
      .limit(limiteVinculadas)
    : [];

  const cnpjsPagina = new Set();
  linhasVinculadas.forEach(linha => extrairCnpjsLinha(linha).forEach(cnpj => cnpjsPagina.add(cnpj)));
  const clientesPorCnpj = cnpjsPagina.size
    ? await db('clientes').whereIn('cnpj_digitos', Array.from(cnpjsPagina)).select('id', 'cnpj_digitos')
    : [];
  const clienteIds = clientesPorCnpj.map(cliente => Number(cliente.id));
  const clientesComVenda = clienteIds.length
    ? await db('vendas').whereIn('cliente_id', clienteIds).whereNull('excluido_em').distinct('cliente_id')
    : [];
  const idsComVenda = new Set(clientesComVenda.map(item => Number(item.cliente_id)));
  const cnpjsComVenda = new Set(clientesPorCnpj
    .filter(cliente => idsComVenda.has(Number(cliente.id)))
    .map(cliente => cliente.cnpj_digitos));

  return {
    data: [
      ...pendentes,
      ...linhasVinculadas.map(linha => ({
        ...formatarLinha(linha),
        possui_venda_cliente: Array.from(extrairCnpjsLinha(linha)).some(cnpj => cnpjsComVenda.has(cnpj))
      }))
    ],
    total,
    resumo: {
      total,
      enviados: enviadosVinculados + totalPendentes,
      qualificados: qualificadosVinculados + totalPendentes,
      nao_enviados: Math.max(0, total - enviadosVinculados - totalPendentes)
    },
    page,
    page_size: pageSize
  };
}

/**
 * Atualiza campo linha recebida com os dados informados.
 */
async function atualizarCampoLinhaRecebida(linhaId, usuarioId, dados = {}, opcoes = {}) {
  const linha = await LeadLinha.query().findById(linhaId);
  if (!linha) throw criarHttpError(404, 'Lead nÃ£o encontrado.');

  if (!opcoes.comoAdmin && Number(linha.atribuido_para_id) !== Number(usuarioId)) {
    throw criarHttpError(403, 'VocÃª nÃ£o pode atualizar este lead.');
  }

  const coluna = String(dados.coluna || '').trim();
  const valor = String(dados.valor || '').trim();
  if (!coluna) throw criarHttpError(400, 'Informe a coluna que sera atualizada.');
  if (coluna.endsWith(UPDATED_COLUMN_SUFFIX)) throw criarHttpError(400, 'Atualize a coluna original, nÃ£o a coluna atualizada.');
  if (!valor) throw criarHttpError(400, 'Informe a informacao atualizada.');

  const dadosJson = parseJson(linha.dados_json, {});
  if (!Object.prototype.hasOwnProperty.call(dadosJson, coluna)) {
    throw criarHttpError(400, 'Coluna nÃ£o encontrada neste lead.');
  }

  const colunaAtualizada = `${coluna}${UPDATED_COLUMN_SUFFIX}`;
  dadosJson[colunaAtualizada] = valor;

  await LeadLinha.query().patchAndFetchById(linha.id, {
    dados_json: JSON.stringify(dadosJson)
  });
  const atualizada = await LeadLinha.query()
    .findById(linha.id)
    .withGraphFetched('[planilha, envio, atribuidoPara]')
    .modifyGraph('atribuidoPara', builder => builder.select('id', 'nome', 'email'));

  return {
    linha: formatarLinha(atualizada),
    coluna,
    coluna_atualizada: colunaAtualizada,
    valor
  };
}

/**
 * Registra a avaliacao da primeira ligacao feita pela consultora que recebeu
 * o futuro cliente na etapa de venda.
 */
async function avaliarPrimeiraLigacao(linhaId, usuarioId, dados = {}) {
  const linha = await LeadLinha.query().findById(Number(linhaId));
  if (!linha) throw criarHttpError(404, 'Lead nao encontrado.');
  if (!linha.futuro_cliente || linha.futuro_cliente_excluido_em) {
    throw criarHttpError(409, 'Somente futuros clientes ativos podem ser avaliados.');
  }
  if (Number(linha.atribuido_para_id) !== Number(usuarioId) || linha.etapa_atual !== 'venda') {
    throw criarHttpError(403, 'Somente a consultora que recebeu este futuro cliente pode avaliar a primeira ligacao.');
  }
  if (Number(linha.futuro_cliente_marcado_por_id) === Number(usuarioId)) {
    throw criarHttpError(409, 'A consultora da primeira ligacao nao pode avaliar o proprio atendimento.');
  }
  if (linha.primeira_ligacao_avaliada_por_id
    && Number(linha.primeira_ligacao_avaliada_por_id) !== Number(usuarioId)) {
    throw criarHttpError(409, 'A primeira ligacao ja foi avaliada pela consultora que recebeu este cliente.');
  }

  const avaliacao = String(dados.avaliacao || '').trim().toLowerCase();
  if (!['bom', 'mais_ou_menos', 'ruim'].includes(avaliacao)) {
    throw criarHttpError(400, 'Selecione uma avaliacao: Bom, Mais ou menos ou Ruim.');
  }

  await LeadLinha.query().patchAndFetchById(linha.id, {
    primeira_ligacao_avaliacao: avaliacao,
    primeira_ligacao_avaliada_por_id: Number(usuarioId),
    primeira_ligacao_avaliada_em: formatarDateTimeSQL(),
    updated_at: new Date()
  });

  const atualizada = await LeadLinha.query()
    .findById(linha.id)
    .withGraphFetched('[planilha, envio, atribuidoPara, sondagem.[operadoraAtual, operadoraInteresse, usuario], enriquecimento]')
    .modifyGraph('atribuidoPara', builder => builder.select('id', 'nome', 'email'));

  return { linha: formatarLinha(atualizada) };
}

/**
 * Lista envios do usuario conforme os filtros e parametros informados.
 */
function combinarMetricasEnvio(metricas = {}, totalPendentesAceite = 0) {
  const totalLinhas = Number(metricas.totalLinhas || 0) + Number(totalPendentesAceite || 0);
  const totalTrabalhados = Number(metricas.totalTrabalhados || 0);
  return {
    totalLinhas,
    totalTrabalhados,
    totalRecusados: Number(metricas.totalRecusados || 0),
    totalNaoAtendidos: Number(metricas.totalNaoAtendidos || 0),
    totalFuturos: Number(metricas.totalFuturos || 0),
    totalATrabalhar: Math.max(0, totalLinhas - totalTrabalhados)
  };
}

function deduplicarIndicacoesEnvio(envios = []) {
  const indicacoesExibidas = new Set();
  return envios.filter(envio => {
    const nome = String(envio?.nome || '').trim();
    const chaveIndicacao = nome.match(/^indicacao\s*#\s*(\d+)$/i)?.[1];
    if (!chaveIndicacao) return true;
    if (indicacoesExibidas.has(chaveIndicacao)) return false;
    indicacoesExibidas.add(chaveIndicacao);
    return true;
  });
}

async function listarEnviosDoUsuario(usuarioId) {
  const enviosEncontrados = await LeadEnvio.query()
    .whereNull('cancelado_em')
    .whereExists(
      LeadEnvioUsuario.query()
        .select(1)
        .whereRaw('lead_envio_usuarios.envio_id = lead_envios.id')
        .where('lead_envio_usuarios.usuario_id', usuarioId)
    )
    .withGraphFetched('usuarios.usuario')
    .modifyGraph('usuarios.usuario', builder => builder.select('id', 'nome', 'email'))
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc');

  // Uma indicacao pode ter registros duplicados de versoes antigas. Exibe apenas
  // o encaminhamento mais recente enquanto eles ainda usam o nome temporario.
  const envios = deduplicarIndicacoesEnvio(enviosEncontrados);

  // O envio pode ter sido dividido entre varios vendedores: as metricas do card
  // sao pessoais, contando apenas as linhas atribuidas a este usuario.
  const envioIds = envios.map(envio => Number(envio.id)).filter(Boolean);
  const metricasPorEnvio = new Map();
  const pendentesAceitePorEnvio = new Map();
  if (envioIds.length > 0) {
    const totais = await LeadLinha.query()
      .select('envio_id')
      .count('id as total_linhas')
      .select(db.raw(
        'SUM(CASE WHEN (futuro_cliente = 1 AND futuro_cliente_excluido_em IS NULL) '
        + 'OR venda_recusada_em IS NOT NULL OR cliente_recusou = 1 OR chamada_nao_atendida = 1 THEN 1 ELSE 0 END) as total_trabalhados'
      ))
      .select(db.raw('SUM(CASE WHEN cliente_recusou = 1 THEN 1 ELSE 0 END) as total_recusados'))
      .select(db.raw('SUM(CASE WHEN chamada_nao_atendida = 1 THEN 1 ELSE 0 END) as total_nao_atendidos'))
      .select(db.raw(
        'SUM(CASE WHEN futuro_cliente = 1 AND futuro_cliente_excluido_em IS NULL '
        + 'THEN 1 ELSE 0 END) as total_futuros'
      ))
      .whereIn('envio_id', envioIds)
      .where('atribuido_para_id', usuarioId)
      .groupBy('envio_id');

    totais.forEach(item => metricasPorEnvio.set(Number(item.envio_id), {
      totalLinhas: Number(item.total_linhas || 0),
      totalTrabalhados: Number(item.total_trabalhados || 0),
      totalRecusados: Number(item.total_recusados || 0),
      totalNaoAtendidos: Number(item.total_nao_atendidos || 0),
      totalFuturos: Number(item.total_futuros || 0)
    }));

    const pendentesAceite = await LeadAtribuicao.query()
      .select('envio_id')
      .count('id as total_pendentes')
      .whereIn('envio_id', envioIds)
      .where({
        usuario_id: Number(usuarioId),
        etapa: 'venda',
        aceite_status: leadDistribuicaoService.ACEITE_AGUARDANDO
      })
      .groupBy('envio_id');
    pendentesAceite.forEach(item => {
      pendentesAceitePorEnvio.set(Number(item.envio_id), Number(item.total_pendentes || 0));
    });
  }

  return envios.map(envio => {
    const formatado = formatarEnvio(envio);
    const metricas = metricasPorEnvio.get(Number(formatado.id))
      || { totalLinhas: 0, totalTrabalhados: 0, totalRecusados: 0, totalNaoAtendidos: 0, totalFuturos: 0 };
    const totalPendentesAceite = pendentesAceitePorEnvio.get(Number(formatado.id)) || 0;
    const totais = combinarMetricasEnvio(metricas, totalPendentesAceite);
    return {
      ...formatado,
      total_linhas: totais.totalLinhas,
      total_trabalhados: totais.totalTrabalhados,
      total_recusados: totais.totalRecusados,
      total_nao_atendidos: totais.totalNaoAtendidos,
      total_futuros: totais.totalFuturos,
      total_a_trabalhar: totais.totalATrabalhar
    };
  });
}

/**
 * Lista todos envios conforme os filtros e parametros informados.
 */
async function listarTodosEnvios() {
  const envios = await LeadEnvio.query()
    .withGraphFetched('usuarios.usuario')
    .modifyGraph('usuarios.usuario', builder => builder.select('id', 'nome', 'email'))
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc');

  return envios.map(formatarEnvio);
}

/**
 * Atualiza somente o nome de um envio, preservando suas distribuicoes e linhas.
 */
async function atualizarNomeEnvio(envioId, nome) {
  const nomeNormalizado = String(nome || '').trim();
  if (!nomeNormalizado) throw new Error('Informe um nome para o envio.');
  if (nomeNormalizado.length > 240) throw new Error('O nome do envio deve ter no mÃ¡ximo 240 caracteres.');

  const envio = await LeadEnvio.query().findById(envioId);
  if (!envio) {
    const error = new Error('Envio nÃ£o encontrado.');
    error.statusCode = 404;
    throw error;
  }

  const atualizado = await LeadEnvio.query()
    .patchAndFetchById(envio.id, { nome: nomeNormalizado, updated_at: new Date() });

  return formatarEnvio(atualizado);
}

/**
 * Monta alocacoes a partir dos dados informados.
 */
function montarAlocacoes(usuarioIds, quantidadeTotal, alocacaoManual = {}) {
  const base = Math.floor(quantidadeTotal / usuarioIds.length);
  const sobra = quantidadeTotal % usuarioIds.length;

  if (sobra > 0) {
    const totalManual = Object.values(alocacaoManual)
      .reduce((acc, valor) => acc + Number(valor || 0), 0);
    if (totalManual !== sobra) {
      return {
        pendente: true,
        sobra,
        base,
        alocacoes: usuarioIds.reduce((acc, id) => ({ ...acc, [id]: base }), {})
      };
    }
  }

  return {
    pendente: false,
    sobra,
    base,
    alocacoes: usuarioIds.reduce((acc, id) => ({
      ...acc,
      [id]: base + Number(alocacaoManual[id] || 0)
    }), {})
  };
}

/**
 * Busca ids por criterios conforme os parametros informados.
 */
async function buscarIdsPorCriterios(dados, quantidadeTotal) {
  if (Array.isArray(dados.linha_ids) && dados.linha_ids.length > 0) {
    const ids = dados.linha_ids.map(Number).filter(Boolean).slice(0, quantidadeTotal);
    if (dados.etapa !== 'venda') return ids;
    const qualificados = await LeadLinha.query()
      .whereIn('id', ids)
      .where('futuro_cliente', true)
      .whereNull('futuro_cliente_excluido_em')
      .where('status_operacional', 'qualificado')
      .select('id');
    const permitidos = new Set(qualificados.map(item => Number(item.id)));
    return ids.filter(id => permitidos.has(Number(id)));
  }

  const incluirEnviados = dados.incluir_enviados === true;
  const statusReenvio = normalizarStatusReenvio(dados.status_reenvio);
  const excluirStatusReenvio = dados.status_reenvio_modo === 'excluir';
  const query = LeadLinha.query().select('id');
  aplicarFiltrosQuery(query, dados.filtros || {});

  if (!incluirEnviados) {
    query.whereNull('envio_id');
  }
  if (statusReenvio.length) {
    if (!excluirStatusReenvio) query.where(builder => builder.whereNotNull('envio_id').orWhereNotNull('atribuido_para_id'));
    aplicarStatusReenvio(query, statusReenvio, excluirStatusReenvio);
  }

  const rows = await query
    .orderBy('planilha_id', 'asc')
    .orderBy('row_index', 'asc')
    .limit(quantidadeTotal);
  return rows.map(row => row.id);
}

/**
 * Processa dividir leads conforme as regras do dominio.
 */
async function listarDestinatariosEnviosPlanilha(planilhaId) {
  return LeadLinha.query().where('planilha_id', Number(planilhaId)).whereNotNull('envio_id').whereNotNull('atribuido_para_id').joinRelated('atribuidoPara').select('atribuido_para_id as usuario_id', 'atribuidoPara.nome as usuario_nome', 'atribuidoPara.email as usuario_email').count('lead_linhas.id as total_linhas').groupBy('atribuido_para_id', 'atribuidoPara.nome', 'atribuidoPara.email').orderBy('atribuidoPara.nome', 'asc');
}
async function cancelarEnviosPlanilha(planilhaId, usuarioAlvoId, canceladoPorId) {
  const planilha = await LeadPlanilha.query().findById(Number(planilhaId));
  if (!planilha) throw criarHttpError(404, 'Planilha nao encontrada.');
  return LeadEnvio.transaction(async trx => {
    const query = LeadLinha.query(trx).where('planilha_id', planilha.id).whereNotNull('envio_id').whereNotNull('atribuido_para_id'); if (usuarioAlvoId) query.where('atribuido_para_id', Number(usuarioAlvoId));
    const linhas = await query.select('id', 'envio_id'); if (!linhas.length) throw criarHttpError(400, 'Nao ha envios ativos para cancelar nesta selecao.');
    const linhaIds = linhas.map(linha => Number(linha.id)); const envioIds = [...new Set(linhas.map(linha => Number(linha.envio_id)).filter(Boolean))]; const agora = new Date();
    for (let i = 0; i < linhaIds.length; i += SELECT_BATCH_SIZE) await LeadLinha.query(trx).whereIn('id', linhaIds.slice(i, i + SELECT_BATCH_SIZE)).patch({ atribuido_para_id: null, envio_id: null, updated_at: agora });
    await trx('lead_atribuicoes').whereIn('lead_linha_id', linhaIds).whereIn('envio_id', envioIds).where('status', 'atribuido').update({ status: 'cancelado', finalizado_em: agora, updated_at: agora });
    for (const envioId of envioIds) { const distribuicao = await LeadLinha.query(trx).where('envio_id', envioId).whereNotNull('atribuido_para_id').select('atribuido_para_id as usuario_id').count('id as quantidade').groupBy('atribuido_para_id'); await LeadEnvioUsuario.query(trx).where('envio_id', envioId).delete(); if (distribuicao.length) await LeadEnvioUsuario.query(trx).insert(distribuicao.map(item => ({ envio_id: envioId, usuario_id: Number(item.usuario_id), quantidade: Number(item.quantidade || 0) }))); else await LeadEnvio.query(trx).patchAndFetchById(envioId, { cancelado_em: agora, cancelado_por_id: canceladoPorId, updated_at: agora }); }
    return { total_cancelado: linhaIds.length, usuario_id: usuarioAlvoId ? Number(usuarioAlvoId) : null };
  });
}
async function dividirLeads(dados, usuarioId) {
  const usuarioIds = Array.isArray(dados.usuario_ids)
    ? dados.usuario_ids.map(Number).filter(Boolean)
    : [];
  const quantidadeTotal = Number(dados.quantidade_total || 0);
  const etapa = dados.etapa === 'venda' ? 'venda' : 'sondagem';
  const statusReenvio = normalizarStatusReenvio(dados.status_reenvio);
  const excluirStatusReenvio = dados.status_reenvio_modo === 'excluir';

  if (!String(dados.nome || '').trim()) throw new Error('Informe um nome para o envio.');
  if (usuarioIds.length === 0) throw new Error('Selecione ao menos um vendedor.');
  if (quantidadeTotal <= 0) throw new Error('Quantidade de clientes invalida.');
  if (statusReenvio.length && (!dados.incluir_enviados || etapa !== 'sondagem')) throw new Error('A selecao de status e permitida somente ao reenviar mailing de sondagem ja enviado.');

  const linhaIds = await buscarIdsPorCriterios(dados, quantidadeTotal);
  if (linhaIds.length < quantidadeTotal) {
    if (etapa === 'venda') {
      throw new Error(`Ha somente ${linhaIds.length} futuro(s) cliente(s) qualificado(s) e disponivel(is) para venda.`);
    }
    if (dados.incluir_enviados === true) {
      throw new Error('NÃ£o hÃ¡ mailing suficiente para a quantidade solicitada.');
    }
    throw new Error('NÃ£o hÃ¡ mailing nÃ£o enviado suficiente. Ative incluir mailing jÃ¡ enviado para transferir linhas distribuÃ­das.');
  }

  const totalJaEnviados = dados.incluir_enviados === true
    ? await LeadLinha.query()
      .whereIn('id', linhaIds)
      .where(builder => {
        builder.whereNotNull('envio_id').orWhereNotNull('atribuido_para_id');
      })
      .resultSize()
    : 0;

  const alocacao = montarAlocacoes(usuarioIds, quantidadeTotal, dados.alocacao_manual || {});
  if (alocacao.pendente) {
    return {
      requires_manual_allocation: true,
      sobra: alocacao.sobra,
      base: alocacao.base,
      alocacoes: alocacao.alocacoes
    };
  }

  return LeadEnvio.transaction(async trx => {
    const envio = await LeadEnvio.query(trx).insertAndFetch({
      nome: String(dados.nome).trim(),
      total_linhas: quantidadeTotal,
      colunas_visiveis: JSON.stringify(dados.colunas_visiveis || []),
      criado_por_id: usuarioId
    });

    let cursor = 0;
    const statusParaLimpar = excluirStatusReenvio ? [] : statusReenvio;
    const limpezaStatus = montarLimpezaStatusReenvio(statusParaLimpar);
    const historicoPrimeiraLigacao = montarHistoricoPrimeiraLigacao(statusParaLimpar);
    for (const usuarioAlvoId of usuarioIds) {
      const quantidade = Number(alocacao.alocacoes[usuarioAlvoId] || 0);
      const idsUsuario = linhaIds.slice(cursor, cursor + quantidade);
      cursor += quantidade;

      await LeadEnvioUsuario.query(trx).insert({
        envio_id: envio.id,
        usuario_id: usuarioAlvoId,
        quantidade
      });

      for (let i = 0; i < idsUsuario.length; i += SELECT_BATCH_SIZE) {
        await LeadLinha.query(trx)
          .whereIn('id', idsUsuario.slice(i, i + SELECT_BATCH_SIZE))
          .patch({
            atribuido_para_id: usuarioAlvoId,
            envio_id: envio.id,
            etapa_atual: etapa,
            status_operacional: etapa === 'venda' ? 'distribuido_venda' : 'pendente',
            ...historicoPrimeiraLigacao,
            ...limpezaStatus,
            updated_at: new Date()
          });
      }

      if (idsUsuario.length) {
        const atribuicoes = idsUsuario.map(leadLinhaId => ({
          lead_linha_id: leadLinhaId,
          envio_id: envio.id,
          usuario_id: usuarioAlvoId,
          etapa,
          status: 'atribuido',
          criado_por_id: usuarioId
        }));
        for (let i = 0; i < atribuicoes.length; i += 500) {
          await trx('lead_atribuicoes').insert(atribuicoes.slice(i, i + 500));
        }
      }
    }

    // Enriquecimento automatico de contatos: so na sondagem (quando as
    // consultoras vao ligar). Apenas enfileira; o worker em background consome
    // a fila sem bloquear a divisao. Idempotente por lead_linha_id.
    if (etapa === 'sondagem') {
      try {
        await leadEnriquecimentoService.enfileirarLinhas(linhaIds, trx);
      } catch (error) {
        // Nunca deixar o enriquecimento derrubar a divisao do mailing.
        console.error('Erro ao enfileirar linhas para enriquecimento:', error.message);
      }
    }

    const envioCompleto = await LeadEnvio.query(trx)
      .findById(envio.id)
      .withGraphFetched('usuarios.usuario')
      .modifyGraph('usuarios.usuario', builder => builder.select('id', 'nome', 'email'));

    return {
      requires_manual_allocation: false,
      total_reenviados: totalJaEnviados,
      envio: formatarEnvio(envioCompleto)
    };
  });
}

/**
 * Processa processar removido ini conforme as regras do dominio.
 */
async function __PROCESSAR_REMOVIDO_INI__(planilhaId, arquivoPath, tamanhoBytes) {
  let colunas = null;
  let delimitador = ';';
  let sobra = '';
  let rowIndex = 0;
  let bytesLidos = 0;
  let ultimoProgresso = -1;
  let lote = [];
  let loteBytes = 0;
  const amostra = [];

  /**
   * Atualiza progresso por bytes com os dados informados.
   */
  async function atualizarProgressoPorBytes() {
    if (tamanhoBytes <= 0) return;
    const progresso = Math.min(99, Math.floor((bytesLidos / tamanhoBytes) * 100));
    if (progresso <= ultimoProgresso) return;
    ultimoProgresso = progresso;
    await atualizarProgresso(planilhaId, {
      linhas_processadas: rowIndex,
      total_linhas: rowIndex,
      progresso_percentual: progresso
    });
  }

  /**
   * Envia o lote acumulado e reinicia o buffer.
   */
  async function flush() {
    if (lote.length === 0) return;
    await inserirLeadLinhas(planilhaId, lote, 'processarArquivoCsv');
    rowIndex += lote.length;
    lote = [];
    loteBytes = 0;
    const progresso = tamanhoBytes > 0 ? Math.min(99, Math.floor((bytesLidos / tamanhoBytes) * 100)) : 0;
    ultimoProgresso = Math.max(ultimoProgresso, progresso);
    await atualizarProgresso(planilhaId, {
      linhas_processadas: rowIndex,
      total_linhas: rowIndex,
      progresso_percentual: progresso
    });
  }

  try {
    logProcessamento(planilhaId, 'inicio', { linhas: 0, bytes: tamanhoBytes, arquivo: arquivoPath });
    const stream = fs.createReadStream(arquivoPath, { encoding: 'utf8', highWaterMark: 1024 * 1024 });

    for await (const chunk of stream) {
      bytesLidos += Buffer.byteLength(chunk, 'utf8');
      await atualizarProgressoPorBytes();
      const partes = (sobra + chunk).split(/\r?\n/);
      sobra = partes.pop() || '';

      for (const linha of partes) {
        if (!linha.trim()) continue;
        if (!colunas) {
          delimitador = detectarDelimitador(linha.replace(/^\uFEFF/, ''));
          colunas = normalizarColunasDuplicadas(parseCsvLine(linha.replace(/^\uFEFF/, ''), delimitador));
          await atualizarProgresso(planilhaId, { colunas: JSON.stringify(colunas) });
          continue;
        }

        const valores = parseCsvLine(linha, delimitador);
        const dados = {};
        colunas.forEach((coluna, index) => {
          dados[coluna] = valores[index] ?? '';
        });

        if (amostra.length < 200) amostra.push(dados);
        const dadosJson = JSON.stringify(dados);
        lote.push({
          planilha_id: Number(planilhaId),
          row_index: rowIndex + lote.length,
          dados_json: dadosJson
        });
        loteBytes += Buffer.byteLength(dadosJson, 'utf8') + 256;

        if (lote.length >= INSERT_BATCH_SIZE || loteBytes >= INSERT_BATCH_MAX_BYTES) await flush();
      }
    }

    if (sobra.trim()) {
      if (!colunas) {
        delimitador = detectarDelimitador(sobra.replace(/^\uFEFF/, ''));
        colunas = normalizarColunasDuplicadas(parseCsvLine(sobra.replace(/^\uFEFF/, ''), delimitador));
      } else {
        const valores = parseCsvLine(sobra, delimitador);
        const dados = {};
        colunas.forEach((coluna, index) => {
          dados[coluna] = valores[index] ?? '';
        });
        if (amostra.length < 200) amostra.push(dados);
        const dadosJson = JSON.stringify(dados);
        lote.push({
          planilha_id: Number(planilhaId),
          row_index: rowIndex + lote.length,
          dados_json: dadosJson
        });
        loteBytes += Buffer.byteLength(dadosJson, 'utf8') + 256;
      }
    }

    await flush();

    if (!colunas || colunas.length === 0) {
      throw new Error('CSV sem cabeÃ§alho vÃ¡lido.');
    }

    await atualizarProgresso(planilhaId, {
      colunas: JSON.stringify(colunas),
      schema_colunas: JSON.stringify(inferirSchema(colunas, amostra)),
      status: 'concluida',
      progresso_percentual: 100,
      linhas_processadas: rowIndex,
      total_linhas: rowIndex,
      arquivo_temporario: null
    });
    logProcessamento(planilhaId, 'concluida', { linhas: rowIndex, bytes: bytesLidos, arquivo: arquivoPath });
    await removerArquivoImportacao(planilhaId, arquivoPath, 'sucesso');
  } catch (error) {
    logProcessamento(planilhaId, 'erro', { linhas: rowIndex, bytes: bytesLidos, arquivo: arquivoPath, error });
    let erroSalvo = false;
    try {
      await atualizarProgresso(planilhaId, {
        status: 'erro',
        erro_processamento: error.message || 'Erro ao processar arquivo.',
        progresso_percentual: tamanhoBytes > 0 ? Math.min(99, Math.floor((bytesLidos / tamanhoBytes) * 100)) : 0,
        linhas_processadas: rowIndex,
        total_linhas: rowIndex,
        arquivo_temporario: arquivoPath
      });
      erroSalvo = true;
    } catch (statusError) {
      logProcessamento(planilhaId, 'erro_status', { linhas: rowIndex, bytes: bytesLidos, arquivo: arquivoPath, error: statusError });
    }

    if (erroSalvo) {
      const arquivoRemovido = await removerArquivoImportacao(planilhaId, arquivoPath, 'erro_salvo');
      if (arquivoRemovido) {
        try {
          await atualizarProgresso(planilhaId, { arquivo_temporario: null });
        } catch (limpezaStatusError) {
          logProcessamento(planilhaId, 'erro_limpeza_status', { linhas: rowIndex, bytes: bytesLidos, arquivo: arquivoPath, error: limpezaStatusError });
        }
      }
    }
  }
}

/**
 * Normaliza colunas duplicadas para manter compatibilidade com o importador CSV.
 */
function normalizarColunasDuplicadas(colunas) {
  const contadores = {};
  return colunas.map((coluna, index) => {
    const base = String(coluna || '').trim() || `Coluna ${index + 1}`;
    const chave = base.toLowerCase();
    contadores[chave] = (contadores[chave] || 0) + 1;
    return contadores[chave] === 1 ? base : `${base} (${contadores[chave]})`;
  });
}

/**
 * Converte valores de celula do Excel para texto simples importavel.
 */
function valorCelulaExcel(celula) {
  const valor = celula?.value;
  if (valor === null || valor === undefined) return '';
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? '' : valor.toISOString().slice(0, 10);
  if (Array.isArray(valor?.richText)) return valor.richText.map(item => item.text || '').join('');
  if (valor && typeof valor === 'object') {
    if (valor.result !== undefined) return String(valor.result ?? '').trim();
    if (valor.text !== undefined) return String(valor.text ?? '').trim();
    if (valor.hyperlink !== undefined) return String(valor.hyperlink ?? '').trim();
  }
  return String(valor ?? '').trim();
}

/**
 * Le a celula da coluna de documento sem perder zeros a esquerda: o Excel guarda
 * o cnpj como numero e `01.234.567/0001-89` chegaria como 1234567000189. O texto
 * formatado da celula ja traz os zeros quando a planilha usa formato customizado;
 * so quando ele nao ajuda reconstruimos os zeros pelos digitos.
 */
function valorCelulaDocumento(celula) {
  const bruto = valorCelulaExcel(celula);
  if (contarDigitos(bruto) === 14) return bruto;

  const formatado = String(celula?.text ?? '');
  if (contarDigitos(formatado) === 14) return formatado.trim();

  return restaurarZerosCnpj(bruto) || bruto;
}

/**
 * Completa os zeros a esquerda de um documento vindo como texto (csv). Valores
 * que ja tem os 14 digitos ficam como estao, inclusive a mascara.
 */
function textoDocumentoLead(valor) {
  if (contarDigitos(valor) === 14) return valor;
  return restaurarZerosCnpj(valor) || valor;
}

function contarDigitos(valor) {
  return String(valor ?? '').replace(/\D/g, '').length;
}

/**
 * Indices (base 0) das colunas que carregam cnpj/cpf, seja pelo mapeamento
 * escolhido na tela ou pelo nome do cabecalho.
 */
function indicesColunasDocumento(colunasNomes, colunaMapeada = null) {
  const indices = new Set();
  colunasNomes.forEach((nome, index) => {
    const normalizado = normalizarBuscaColunaLead(nome);
    const ehDocumento = PALAVRAS_COLUNA_DOCUMENTO.some(palavra => normalizado.includes(palavra));
    const ehMapeada = colunaMapeada && nome === colunaMapeada;
    if (ehDocumento || ehMapeada) indices.add(index);
  });
  return indices;
}

function normalizarBuscaColunaLead(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function tokensBuscaColunaLead(valor) {
  return normalizarBuscaColunaLead(valor)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function colunaCombinaBuscaLead(nomeColuna, busca) {
  const termo = normalizarBuscaColunaLead(busca);
  const nome = normalizarBuscaColunaLead(nomeColuna);
  if (!termo || !nome) return false;
  if (nome === termo || nome.includes(termo)) return true;

  const tokens = tokensBuscaColunaLead(busca);
  return tokens.length > 0 && tokens.every(token => nome.includes(token));
}

function linhaContemColunaLead(valores, busca) {
  if (!busca) return false;
  return valores.some(valor => colunaCombinaBuscaLead(valor, busca));
}

function colunaPareceCabecalhoLead(nomeColuna, busca) {
  const termo = normalizarBuscaColunaLead(busca);
  const nome = normalizarBuscaColunaLead(nomeColuna);
  if (!termo || !nome) return false;
  if (nome === termo) return true;
  return nome.includes(termo) && nome.length <= 40;
}

function linhaContemCabecalhoLead(valores, busca) {
  if (!busca) return false;
  return valores.some(valor => colunaPareceCabecalhoLead(valor, busca));
}

function pontuarLinhaCabecalhoMailing(valores, buscaCnpj = null) {
  const preenchidos = valores.filter(valor => String(valor || '').trim());
  if (preenchidos.length < 2) return 0;

  const termosEncontrados = new Set();
  for (const valor of preenchidos) {
    TERMOS_CABECALHO_MAILING.forEach(termo => {
      if (colunaPareceCabecalhoLead(valor, termo)) termosEncontrados.add(termo);
    });
  }

  let score = termosEncontrados.size;
  if (buscaCnpj && linhaContemCabecalhoLead(preenchidos, buscaCnpj)) score += 3;
  if (linhaContemCabecalhoLead(preenchidos, 'cnpj') || linhaContemCabecalhoLead(preenchidos, 'cpf/cnpj')) score += 2;
  if (preenchidos.length >= 4) score += 1;

  return score;
}

function escolherLinhaCabecalhoMailing(linhasCandidatas, opcoes = {}) {
  if (!linhasCandidatas.length) return null;

  if (opcoes.cnpj) {
    const linhaMapeada = linhasCandidatas.find(candidata => linhaContemCabecalhoLead(candidata.valores, opcoes.cnpj));
    if (linhaMapeada) return linhaMapeada;
  }

  let melhor = null;
  for (const candidata of linhasCandidatas) {
    const score = pontuarLinhaCabecalhoMailing(candidata.valores, opcoes.cnpj);
    if (!melhor || score > melhor.score) melhor = { ...candidata, score };
  }

  return melhor?.score >= 3 ? melhor : linhasCandidatas[0];
}
function parseNumeroLead(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return null;
  const limpo = texto.replace(/\s/g, '').replace(/^R\$/i, '');
  const temVirgula = limpo.includes(',');
  const temPonto = limpo.includes('.');
  let normalizado = limpo;

  if (temVirgula && temPonto) {
    normalizado = limpo.lastIndexOf(',') > limpo.lastIndexOf('.')
      ? limpo.replace(/\./g, '').replace(',', '.')
      : limpo.replace(/,/g, '');
  } else if (temVirgula) {
    normalizado = limpo.replace(',', '.');
  }

  if (!/^-?\d+(\.\d+)?$/.test(normalizado)) return null;
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}

function parseDataLead(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return null;
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!br) return null;
  const [, dia, mes, ano] = br;
  const anoCompleto = ano.length === 2 ? `20${ano}` : ano;
  return `${anoCompleto}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
}

function inferirSchemaLead(colunas, amostra) {
  return colunas.reduce((acc, coluna) => {
    const valores = amostra.map(linha => linha[coluna]).filter(valor => String(valor || '').trim() !== '');
    const total = valores.length || 1;
    const numeros = valores.filter(valor => parseNumeroLead(valor) !== null).length;
    const datas = valores.filter(valor => parseDataLead(valor) !== null).length;
    acc[coluna] = datas / total >= 0.75 ? 'date' : (numeros / total >= 0.75 ? 'number' : 'string');
    return acc;
  }, {});
}

function parseBooleanCampo(valor) {
  return valor === true || valor === 'true' || valor === '1' || valor === 1 || valor === 'sim';
}

function normalizarNomeAbaLead(valor) {
  return String(valor || '').trim().toLowerCase();
}

function parseJsonArrayCampo(valor) {
  if (!valor) return null;
  const parsed = JSON.parse(valor);
  return Array.isArray(parsed) ? parsed.map(item => String(item || '').trim()).filter(Boolean) : null;
}

function parseJsonObjectCampo(valor) {
  if (!valor) return null;
  const parsed = JSON.parse(valor);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

function parseCsvLineLead(line, delimiter) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

function detectDelimiterLead(line) {
  return [';', ',', '\t'].reduce((best, delimiter) => (
    parseCsvLineLead(line, delimiter).length > parseCsvLineLead(line, best).length ? delimiter : best
  ), ';');
}

function detectDelimiterLinhasLead(linhasTexto) {
  const amostra = linhasTexto.slice(0, 20);
  return [';', ',', '\t'].reduce((best, delimiter) => {
    const melhorAtual = Math.max(...amostra.map(linha => parseCsvLineLead(linha, best).length));
    const melhorCandidato = Math.max(...amostra.map(linha => parseCsvLineLead(linha, delimiter).length));
    return melhorCandidato > melhorAtual ? delimiter : best;
  }, ';');
}

function lerUploadPlanilhaMailing(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: EXCEL_IMPORT_MAX_BYTES } });
    const campos = {};
    let chunks = [];
    let nomeOriginal = '';
    let recebeuArquivo = false;
    let erroLimite = null;

    busboy.on('field', (name, value) => {
      campos[name] = value;
    });

    busboy.on('file', (field, file, info) => {
      recebeuArquivo = true;
      nomeOriginal = info.filename || 'leads.xlsx';
      const filename = String(nomeOriginal).toLowerCase();
      if (!filename.endsWith('.xlsx') && !filename.endsWith('.csv')) {
        erroLimite = new Error('Envie um arquivo .csv ou .xlsx.');
        file.resume();
        return;
      }

      file.on('data', chunk => chunks.push(chunk));
      file.on('limit', () => {
        erroLimite = new Error('Arquivo excede o limite permitido.');
        chunks = [];
      });
      file.on('error', reject);
    });

    busboy.on('finish', () => {
      if (erroLimite) return reject(erroLimite);
      if (!recebeuArquivo) return reject(new Error('Arquivo nao enviado.'));
      return resolve({ nomeOriginal, buffer: Buffer.concat(chunks), campos });
    });
    busboy.on('error', reject);
    req.pipe(busboy);
  });
}

function montarColecaoCsv(nomeOriginal, buffer) {
  const texto = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const linhasTexto = texto.split(/\r?\n/).filter(linha => linha.trim());
  if (!linhasTexto.length) throw new Error('CSV sem cabecalho valido.');

  const delimiter = detectDelimiterLinhasLead(linhasTexto);
  const linhasCandidatas = linhasTexto.slice(0, 20).map((linha, index) => ({
    rowNumber: index + 1,
    valores: parseCsvLineLead(linha.replace(/^\uFEFF/, ''), delimiter)
  }));
  const cabecalho = escolherLinhaCabecalhoMailing(linhasCandidatas);
  const headerIndex = Math.max((cabecalho?.rowNumber || 1) - 1, 0);
  const colunasNomes = normalizarColunasDuplicadas(cabecalho?.valores || parseCsvLineLead(linhasTexto[0], delimiter));
  const colunas = colunasNomes.map((nome, index) => ({ nome, index: index + 1 }));
  const colunasDocumento = indicesColunasDocumento(colunasNomes);
  const linhas = [];

  for (let i = headerIndex + 1; i < linhasTexto.length; i += 1) {
    const values = parseCsvLineLead(linhasTexto[i], delimiter);
    const dados = { __rowIndex: i + 1 };
    let vazia = true;
    colunasNomes.forEach((coluna, index) => {
      const bruto = values[index] ?? '';
      const valor = colunasDocumento.has(index) ? textoDocumentoLead(bruto) : bruto;
      if (String(valor || '').trim()) vazia = false;
      dados[coluna] = valor;
    });
    if (!vazia) linhas.push(dados);
  }

  return [{ nome: nomeOriginal, colunas, linhas }];
}
function montarColecoesExcel(nomeOriginal, workbook, abasSelecionadas = null, opcoes = {}) {
  const selecionadas = Array.isArray(abasSelecionadas) && abasSelecionadas.length > 0
    ? new Set(abasSelecionadas.map(normalizarNomeAbaLead))
    : null;

  return workbook.worksheets
    .filter(worksheet => !selecionadas || selecionadas.has(normalizarNomeAbaLead(worksheet.name)))
    .map(worksheet => {
    const linhasCandidatas = [];
    for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const valores = [];
      for (let colNumber = 1; colNumber <= row.cellCount; colNumber += 1) {
        valores.push(valorCelulaExcel(row.getCell(colNumber)));
      }
      if (!valores.some(valor => String(valor || '').trim() !== '')) continue;

      linhasCandidatas.push({ rowNumber, valores });
    }

    const cabecalho = escolherLinhaCabecalhoMailing(linhasCandidatas, opcoes);
    const headerRowNumber = cabecalho?.rowNumber || 0;
    const colunasNomes = cabecalho ? normalizarColunasDuplicadas(cabecalho.valores) : [];
    if (!headerRowNumber || colunasNomes.length === 0) {
      return null;
    }

    const colunasDocumento = indicesColunasDocumento(colunasNomes, opcoes.cnpj);
    const linhas = [];
    for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const dados = { __rowIndex: rowNumber };
      let vazia = true;

      colunasNomes.forEach((coluna, index) => {
        const celula = row.getCell(index + 1);
        const valor = colunasDocumento.has(index) ? valorCelulaDocumento(celula) : valorCelulaExcel(celula);
        if (String(valor || '').trim() !== '') vazia = false;
        dados[coluna] = valor;
      });

      if (!vazia) linhas.push(dados);
    }

    return {
      nome: worksheet.name,
      nomePlanilha: String(worksheet.name || '').trim() || nomeOriginal,
      colunas: colunasNomes.map((nome, index) => ({ nome, index: index + 1 })),
      linhas
    };
  }).filter(Boolean);
}

async function salvarColecaoMailing(colecao, usuarioId) {
  const colunas = colecao.colunas.map(coluna => coluna.nome);
  const planilha = await criarPlanilha({
    nome: colecao.nomePlanilha || colecao.nome,
    colunas: [],
    schema_colunas: {},
    total_linhas: 0,
    streaming: true
  }, usuarioId);

  let lote = [];
  const amostra = [];

  async function flush() {
    if (!lote.length) return;
    await salvarLinhasLote(planilha.id, lote);
    lote = [];
  }

  try {
    for (let index = 0; index < colecao.linhas.length; index += 1) {
      const linha = colecao.linhas[index];
      const dados = {};
      colunas.forEach(coluna => {
        dados[coluna] = linha[coluna] ?? '';
      });
      if (amostra.length < 200) amostra.push(dados);
      lote.push({ row_index: index, dados_json: dados });
      if (lote.length >= EXCEL_IMPORT_BATCH_SIZE) await flush();
    }

    await flush();
    return finalizarPlanilha(planilha.id, {
      colunas,
      schema_colunas: inferirSchemaLead(colunas, amostra)
    });
  } catch (error) {
    await marcarErroPlanilha(planilha.id, error.message || 'Erro ao importar planilha.').catch(() => {});
    throw error;
  }
}

async function importarColecoesMailing(nomeOriginal, colecoes, usuarioId, opcoes = {}) {
  if (!colecoes.length) throw new Error('Planilha sem cabecalho valido.');

  const planilhas = [];
  for (const colecao of colecoes) {
    planilhas.push(await salvarColecaoMailing(colecao, usuarioId));
  }

  let baseAntiga = null;
  if (opcoes.baseAntiga) {
    baseAntiga = await clienteAntigoService.importarColecaoPlanilhas(colecoes, {
      usuarioId,
      arquivoNome: nomeOriginal,
      mapeamento: opcoes.mapeamento || null
    });
  }

  return { planilhas, base_antiga: baseAntiga };
}

/**
 * Importa uma planilha Excel de mailing preservando o formato de linhas do CSV.
 */
async function importarExcel(req, usuarioId) {
  const { nomeOriginal, buffer, campos } = await lerUploadPlanilhaMailing(req);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  if (!workbook.worksheets.length) throw new Error('A planilha XLSX nao possui abas.');
  const abas = parseJsonArrayCampo(campos.abas);
  const mapeamento = parseJsonObjectCampo(campos.mapeamento);
  const colecoes = montarColecoesExcel(nomeOriginal, workbook, abas, { cnpj: mapeamento?.cnpj });
  return importarColecoesMailing(nomeOriginal, colecoes, usuarioId, {
    baseAntiga: parseBooleanCampo(campos.base_antiga),
    mapeamento
  });
}

async function importarBaseAntigaArquivo(req, usuarioId) {
  const { nomeOriginal, buffer, campos } = await lerUploadPlanilhaMailing(req);
  const lower = String(nomeOriginal || '').toLowerCase();
  let colecoes;

  if (lower.endsWith('.csv')) {
    colecoes = montarColecaoCsv(nomeOriginal, buffer);
  } else {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    colecoes = montarColecoesExcel(nomeOriginal, workbook, parseJsonArrayCampo(campos.abas), { cnpj: campos.mapeamento ? JSON.parse(campos.mapeamento)?.cnpj : null });
  }

  return clienteAntigoService.importarColecaoPlanilhas(colecoes, {
    usuarioId,
    arquivoNome: nomeOriginal,
    mapeamento: campos.mapeamento ? JSON.parse(campos.mapeamento) : null
  });
}
/**
 * Executa a acao de iniciar upload mantendo o estado da tela consistente.
 */
function iniciarUpload(req, usuarioId) {
  ensureImportDir();

  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers, limits: { files: 1 } });
    let uploadPromise = null;
    let resolvido = false;

    busboy.on('file', (field, file, info) => {
      const nomeOriginal = info.filename || 'leads.csv';
      const nomeSeguro = `${Date.now()}-${Math.random().toString(16).slice(2)}.csv`;
      const arquivoPath = path.join(IMPORT_DIR, nomeSeguro);
      let tamanhoBytes = 0;
      const output = fs.createWriteStream(arquivoPath);

      logProcessamento('novo', 'upload_inicio', { arquivo: arquivoPath });

      file.on('data', chunk => {
        tamanhoBytes += chunk.length;
      });

      uploadPromise = new Promise((resolveUpload, rejectUpload) => {
        output.on('finish', async () => {
          logProcessamento('novo', 'upload_finalizado', { bytes: tamanhoBytes, arquivo: arquivoPath });
          try {
            const planilha = await LeadPlanilha.query().insertAndFetch({
              nome: nomeOriginal,
              colunas: JSON.stringify([]),
              schema_colunas: JSON.stringify({}),
              total_linhas: 0,
              linhas_processadas: 0,
              progresso_percentual: 0,
              status: 'processando',
              arquivo_temporario: arquivoPath,
              tamanho_bytes: tamanhoBytes,
              criado_por_id: usuarioId
            });

            logProcessamento(planilha.id, 'upload_registrado', { bytes: tamanhoBytes, arquivo: arquivoPath });
            setImmediate(() => {
              processarArquivoCsv(planilha.id, arquivoPath, tamanhoBytes).catch(error => {
                logProcessamento(planilha.id, 'erro_nao_tratado', { error });
              });
            });
            resolveUpload(formatarPlanilha(planilha));
          } catch (error) {
            logProcessamento('novo', 'upload_registro_erro', { bytes: tamanhoBytes, arquivo: arquivoPath, error });
            removerArquivoImportacao('novo', arquivoPath, 'falha_registro').catch(() => {});
            rejectUpload(error);
          }
        });
        output.on('error', error => {
          logProcessamento('novo', 'upload_write_erro', { bytes: tamanhoBytes, arquivo: arquivoPath, error });
          rejectUpload(error);
        });
        file.on('error', error => {
          logProcessamento('novo', 'upload_stream_erro', { bytes: tamanhoBytes, arquivo: arquivoPath, error });
          rejectUpload(error);
        });
      });

      file.pipe(output);
    });

    busboy.on('finish', async () => {
      try {
        if (!uploadPromise) throw new Error('Arquivo CSV nÃ£o enviado.');
        const planilha = await uploadPromise;
        resolvido = true;
        resolve(planilha);
      } catch (error) {
        reject(error);
      }
    });

    busboy.on('error', error => {
      if (!resolvido) reject(error);
    });

    req.on('aborted', () => {
      const error = new Error('Upload interrompido pelo cliente.');
      if (!resolvido) reject(error);
    });

    req.pipe(busboy);
  });
}

/**
 * Escapa csv escape para evitar quebra de formato.
 */
function csvEscape(valor) {
  const texto = String(valor ?? '');
  return /[",;\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** Retorna os estados exibidos na coluna Status da tela de mailing. */
function obterStatusExportacao(linha) {
  const status = [linha.atribuido_para_id || linha.envio_id ? 'Enviado' : 'N\u00e3o enviado'];

  if (linha.futuro_cliente && linha.futuro_cliente_excluido_em) status.push('Na lixeira');
  if (linha.futuro_cliente && !linha.futuro_cliente_excluido_em) status.push('Futuro cliente');
  if (linha.venda_id || linha.status_operacional === 'vendido' || linha.possui_venda_cliente) status.push('Venda registrada');
  if (linha.status_operacional === 'perdido' || linha.venda_recusada_em || linha.venda_recusada_motivo) status.push('Venda recusada');
  if (linha.cliente_recusou) status.push('Cliente recusou');
  if (linha.chamada_nao_atendida) status.push('Chamada n\u00e3o atendida');
  if (linha.retorno_agendado_em) status.push('Retorno marcado');

  return status.join(' | ');
}

/**
 * Exporta csv no formato esperado.
 */
async function exportarCsv(filtros, res, opcoes = {}) {
  const colunasOriginais = Array.isArray(filtros.colunas) ? filtros.colunas : [];
  const query = LeadLinha.query();
  aplicarFiltrosQuery(query, filtros, opcoes);
  const colunas = await expandirColunasExportacao(colunasOriginais, query);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
  const incluirStatus = filtros.incluir_status !== false;
  const cabecalho = colunas.map(coluna => csvEscape(coluna.label || coluna.nome || coluna));
  if (incluirStatus) cabecalho.push(csvEscape('Status do mailing'));
  res.write(`${cabecalho.join(';')}\n`);

  let offset = 0;
  while (true) {
    const linhas = await query.clone()
      .orderBy('planilha_id', 'asc')
      .orderBy('row_index', 'asc')
      .offset(offset)
      .limit(SELECT_BATCH_SIZE);
    if (linhas.length === 0) break;

    linhas.forEach(linha => {
      const dados = parseJson(linha.dados_json, {});
      const valores = colunas.map(coluna => {
        const source = coluna.sources?.find(item => Number(item.planilhaId) === Number(linha.planilha_id));
        return csvEscape(dados[source?.nome || coluna.nome || coluna]);
      });
      if (incluirStatus) valores.push(csvEscape(obterStatusExportacao(linha)));
      res.write(`${valores.join(';')}\n`);
    });

    offset += linhas.length;
  }

  res.end();
}

/**
 * Gera uma planilha Excel individual, mantendo todos os campos como texto para
 * evitar que CNPJ, telefones e codigos sejam convertidos pelo Excel.
 */
async function gerarPlanilhaXlsx(planilhaId) {
  const planilha = await LeadPlanilha.query().findById(Number(planilhaId));
  if (!planilha) throw criarHttpError(404, 'Planilha n\u00e3o encontrada.');

  const colunas = parseJson(planilha.colunas, []);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Pos Venda';
  const worksheet = workbook.addWorksheet('Mailing', { views: [{ state: 'frozen', ySplit: 1 }] });
  const cabecalhos = [...colunas, 'Status do mailing'];
  const cabecalho = worksheet.addRow(cabecalhos);
  cabecalho.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cabecalho.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };

  let offset = 0;
  while (true) {
    const linhas = await LeadLinha.query()
      .where('planilha_id', planilha.id)
      .orderBy('row_index', 'asc')
      .offset(offset)
      .limit(SELECT_BATCH_SIZE);
    if (!linhas.length) break;

    linhas.forEach(linha => {
      const dados = parseJson(linha.dados_json, {});
      const valores = colunas.map(coluna => String(dados[coluna] ?? ''));
      valores.push(obterStatusExportacao(linha));
      const row = worksheet.addRow(valores);
      row.eachCell(cell => { cell.numFmt = '@'; });
    });
    offset += linhas.length;
  }

  worksheet.columns.forEach((column, index) => {
    const titulo = String(cabecalhos[index] || '');
    column.width = Math.min(50, Math.max(14, titulo.length + 2));
  });

  return workbook.xlsx.writeBuffer();
}
/**
 * Marca como futuro cliente conforme a acao solicitada.
 */
function deveNotificarNovoFuturoCliente(linha) {
  const jaEraFuturoCliente = linha?.futuro_cliente === true
    || linha?.futuro_cliente === 1
    || linha?.futuro_cliente === '1';

  // A data de marcacao tambem identifica qualificacoes antigas e protege contra
  // reenvio caso o booleano esteja inconsistente em algum registro legado.
  return !jaEraFuturoCliente && !linha?.futuro_cliente_marcado_em;
}

async function marcarComoFuturoCliente(linhaId, usuarioId, dados = {}, opcoes = {}) {
  const linha = await LeadLinha.query().findById(linhaId);
  if (!linha) throw criarHttpError(404, 'Lead nÃ£o encontrado.');
  const atribuicaoVendaAceita = !opcoes.comoAdmin && linha.futuro_cliente
    ? await db('lead_atribuicoes')
      .where({
        lead_linha_id: Number(linhaId),
        usuario_id: Number(usuarioId),
        etapa: 'venda',
        aceite_status: leadDistribuicaoService.ACEITE_ACEITO
      })
      .orderBy('id', 'desc')
      .first()
    : null;
  if (!opcoes.comoAdmin
    && linha.futuro_cliente
    && Number(linha.futuro_cliente_marcado_por_id) !== Number(usuarioId)
    && !atribuicaoVendaAceita) {
    throw criarHttpError(409, 'Este lead ja foi qualificado na primeira ligacao e nao pode ser qualificado novamente.');
  }

  if (!opcoes.comoAdmin && Number(linha.atribuido_para_id) !== Number(usuarioId)) {
    throw criarHttpError(403, 'VocÃª nÃ£o pode atualizar este lead.');
  }
  const donoId = opcoes.comoAdmin ? (Number(linha.atribuido_para_id) || Number(usuarioId)) : Number(usuarioId);
  const donoSondagemId = linha.futuro_cliente
    ? (Number(linha.futuro_cliente_marcado_por_id) || donoId)
    : donoId;

  const deveNotificarTelegram = deveNotificarNovoFuturoCliente(linha);
  const marcadoEm = linha.futuro_cliente_marcado_em || formatarDateTimeSQL();

  const razaoSocial = String(dados.razao_social || '').trim().slice(0, 240) || null;
  const cnpj = String(dados.cnpj || '').trim().slice(0, 20) || null;
  const contatoNome = String(dados.contato_nome || '').trim();
  const contatoTipo = String(dados.contato_tipo || '').trim().toLowerCase();
  const operadoraAtualId = Number(dados.operadora_atual_id || 0);
  const operadoraInteresseId = dados.operadora_interesse_id ? Number(dados.operadora_interesse_id) : null;
  const chipsRecebidos = Array.isArray(dados.chips_itens) ? dados.chips_itens : [];
  const chipsItens = (chipsRecebidos.length ? chipsRecebidos : [{
    quantidade: dados.quantidade_chips,
    preco_por_chip: dados.preco_por_chip
  }]).map(item => ({
    quantidade: Number(item.quantidade || 0),
    preco_por_chip: Number(String(item.preco_por_chip ?? '').replace(',', '.'))
  }));
  const telefoneDigitos = String(dados.whatsapp || `${dados.whatsapp_ddd || ''}${dados.whatsapp_numero || ''}`).replace(/\D/g, '');
  const whatsapp = telefoneDigitos.startsWith('55') && telefoneDigitos.length > 11 ? telefoneDigitos.slice(2) : telefoneDigitos;
  const whatsappDdd = whatsapp.slice(0, 2);
  const whatsappNumero = whatsapp.slice(2);
  const melhorNumeroContatoDigitos = String(dados.melhor_numero_contato || '').replace(/\D/g, '');
  const melhorNumeroContato = melhorNumeroContatoDigitos.startsWith('55') && melhorNumeroContatoDigitos.length > 11
    ? melhorNumeroContatoDigitos.slice(2)
    : melhorNumeroContatoDigitos;
  const normalizarTelefoneOpcional = valor => {
    const digitos = String(valor || '').replace(/\D/g, '');
    return digitos.startsWith('55') && digitos.length > 11 ? digitos.slice(2) : digitos;
  };
  const telefoneFixo = normalizarTelefoneOpcional(dados.telefone_fixo);
  const terminal = normalizarTelefoneOpcional(dados.terminal);
  const dataAtivacao = /^\d{4}-\d{2}-\d{2}$/.test(String(dados.data_ativacao || '')) ? dados.data_ativacao : null;

  if (!contatoNome) throw criarHttpError(400, 'Informe o nome de quem falou.');
  if (!['adm', 'rl'].includes(contatoTipo)) throw criarHttpError(400, 'Informe se o contato e ADM ou RL.');
  if (!Number.isInteger(operadoraAtualId) || operadoraAtualId <= 0) throw criarHttpError(400, 'Informe a operadora atual.');
  if (operadoraInteresseId !== null && (!Number.isInteger(operadoraInteresseId) || operadoraInteresseId <= 0)) {
    throw criarHttpError(400, 'Informe uma operadora de interesse valida.');
  }
  if (!chipsItens.length || chipsItens.some(item => !Number.isInteger(item.quantidade) || item.quantidade <= 0)) {
    throw criarHttpError(400, 'Informe quantidades de chips validas.');
  }
  if (chipsItens.some(item => !Number.isFinite(item.preco_por_chip) || item.preco_por_chip <= 0)) {
    throw criarHttpError(400, 'Informe precos por chip validos.');
  }
  if (whatsappDdd.length !== 2 || whatsappNumero.length < 8 || whatsappNumero.length > 9) {
    throw criarHttpError(400, 'Informe um WhatsApp com DDD valido.');
  }
  if (melhorNumeroContato.length < 10 || melhorNumeroContato.length > 11) {
    throw criarHttpError(400, 'Informe o melhor numero para contato com DDD valido.');
  }
  if (telefoneFixo && (telefoneFixo.length < 10 || telefoneFixo.length > 11)) throw criarHttpError(400, 'Informe um telefone fixo com DDD valido.');
  if (terminal && (terminal.length < 10 || terminal.length > 11)) throw criarHttpError(400, 'Informe um terminal com DDD valido.');

  const quantidadeChips = chipsItens.reduce((total, item) => total + item.quantidade, 0);
  const valorMensalEstimado = Math.round(chipsItens.reduce((total, item) => total + (item.quantidade * item.preco_por_chip), 0) * 100) / 100;
  const precoPorChip = Math.round((valorMensalEstimado / quantidadeChips) * 100) / 100;
  const notas = String(dados.notas || dados.observacoes || '').trim() || null;
  // Sem data no formulario, aproveita o retorno ja agendado no card do lead recebido.
  const retornoAgendado = linha.retorno_agendado_em
    ? formatarDateTimeSQL(parseUtcDateTime(linha.retorno_agendado_em))
    : null;
  const retorno = parseDataHoraRetorno(dados.retorno) || retornoAgendado;
  const retornoAnterior = linha.futuro_cliente_retorno
    ? formatarDateTimeSQL(parseUtcDateTime(linha.futuro_cliente_retorno))
    : null;
  const retornoFuturoAlterado = String(retorno || '') !== String(retornoAnterior || '');

  await LeadLinha.transaction(async trx => {
    let atribuicao = await LeadAtribuicao.query(trx)
      .where({ lead_linha_id: Number(linhaId), usuario_id: donoSondagemId, etapa: 'sondagem' })
      .orderBy('id', 'desc').first();
    if (!atribuicao) {
      atribuicao = await LeadAtribuicao.query(trx).insertAndFetch({
        lead_linha_id: Number(linhaId), envio_id: linha.envio_id, usuario_id: donoSondagemId,
        etapa: 'sondagem', status: 'atribuido', criado_por_id: usuarioId
      });
    }

    await LeadAtribuicao.query(trx).patchAndFetchById(atribuicao.id, {
      status: 'qualificado', finalizado_em: formatarDateTimeSQL()
    });

    const sondagem = {
      lead_linha_id: Number(linhaId), atribuicao_id: atribuicao.id, usuario_id: donoSondagemId,
      razao_social: razaoSocial, cnpj,
      contato_nome: contatoNome, contato_tipo: contatoTipo, operadora_atual_id: operadoraAtualId,
      operadora_interesse_id: operadoraInteresseId,
      quantidade_chips: quantidadeChips, chips_itens: JSON.stringify(chipsItens), preco_por_chip: precoPorChip,
      valor_mensal_estimado: valorMensalEstimado, whatsapp_ddd: whatsappDdd,
      whatsapp_numero: whatsappNumero, melhor_numero_contato: melhorNumeroContato, telefone_fixo: telefoneFixo,
      terminal, data_ativacao: dataAtivacao, observacoes: notas, retorno_em: retorno,
      respondido_em: formatarDateTimeSQL()
    };
    const existente = await LeadSondagem.query(trx).where('lead_linha_id', Number(linhaId)).first();
    if (existente) await LeadSondagem.query(trx).patchAndFetchById(existente.id, sondagem);
    else await LeadSondagem.query(trx).insert(sondagem);

    await trx('lead_linhas').where('id', Number(linhaId)).update({
      futuro_cliente: true, futuro_cliente_notas: notas, futuro_cliente_retorno: retorno,
      ...(retornoFuturoAlterado ? {
        futuro_cliente_retorno_realizado_em: null,
        futuro_cliente_retorno_realizado_por_id: null
      } : {}),
      futuro_cliente_marcado_em: marcadoEm, futuro_cliente_marcado_por_id: donoSondagemId,
      retorno_agendado_em: null, retorno_agendado_observacao: null, retorno_agendado_por_id: null,
      retorno_agendado_realizado_em: null, retorno_agendado_realizado_por_id: null,
      etapa_atual: atribuicaoVendaAceita ? 'venda' : 'sondagem',
      status_operacional: atribuicaoVendaAceita ? 'distribuido_venda' : 'qualificado',
      updated_at: new Date()
    });
    if (retorno) {
      await leadDistribuicaoService.registrarAcaoValida(
        linhaId,
        donoId,
        'retorno_agendado',
        trx
      );
    }
  });

  await sincronizarNotificacoesRetornoLeads();

  const atualizada = await LeadLinha.query()
    .findById(linhaId)
    .withGraphFetched('[planilha, envio, atribuidoPara, sondagem.[operadoraAtual, operadoraInteresse, usuario], enriquecimento]')
    .modifyGraph('atribuidoPara', builder => builder.select('id', 'nome', 'email'));

  const linhaFormatada = formatarLinha(atualizada);
  if (deveNotificarTelegram) {
    try {
      const publicacao = await telegramService.enviarFuturoCliente(linhaFormatada);
      if (publicacao.enviado && publicacao.message_id) {
        await leadTelegramPublicacaoService.registrar(linhaId, publicacao);
      }
    } catch (error) {
      // A indisponibilidade do Telegram nao pode desfazer o cadastro do lead.
      console.error('Erro ao notificar futuro cliente no Telegram:', {
        message: error.response?.data?.description || error.message,
        status: error.response?.status
      });
    }
  }

  return { linha: linhaFormatada };
}

/**
 * Desmarca um futuro cliente pelo fluxo administrativo sem apagar a sondagem.
 * Leads que ja chegaram a etapa de venda precisam ser tratados nesse fluxo antes.
 */
function obterErroReversaoFuturoCliente(linha, possuiVendaPorCnpj = false) {
  if (!linha?.futuro_cliente) {
    return { statusCode: 400, message: 'Este lead nao esta marcado como futuro cliente.' };
  }
  if (linha.futuro_cliente_excluido_em) {
    return { statusCode: 409, message: 'Restaure o futuro cliente da lixeira antes de alterar seu estado.' };
  }
  if (linha.venda_id || linha.cliente_id || linha.status_operacional === 'vendido' || possuiVendaPorCnpj) {
    return { statusCode: 409, message: 'Este futuro cliente ja possui venda registrada.' };
  }
  if (linha.etapa_atual === 'venda' || linha.status_operacional === 'distribuido_venda') {
    return { statusCode: 409, message: 'Este futuro cliente ja esta no fluxo de venda e nao pode ser revertido.' };
  }
  return null;
}

function montarPatchReversaoFuturoCliente(linha) {
  const possuiRecusaAtiva = Boolean(
    linha?.cliente_recusou
    || linha?.venda_recusada_em
    || linha?.venda_recusada_motivo
  );
  return {
    futuro_cliente: false,
    status_operacional: possuiRecusaAtiva ? 'perdido' : 'pendente'
  };
}

async function reverterFuturoClienteLead(linhaId, usuarioId, opcoes = {}) {
  const linha = await LeadLinha.query().findById(Number(linhaId));
  if (!linha) throw criarHttpError(404, 'Lead nao encontrado.');
  if (!opcoes.comoAdmin && Number(linha.atribuido_para_id) !== Number(usuarioId)) {
    throw criarHttpError(403, 'Lead nao encontrado ou atribuido a outro usuario.');
  }
  const bloqueioEstado = obterErroReversaoFuturoCliente(linha, false);
  if (bloqueioEstado) throw criarHttpError(bloqueioEstado.statusCode, bloqueioEstado.message);
  const possuiVendaPorCnpj = await linhaPossuiVendaPorCnpj(linha);
  if (possuiVendaPorCnpj) {
    throw criarHttpError(409, 'Este futuro cliente ja possui venda registrada.');
  }

  await LeadLinha.transaction(async trx => {
    await LeadLinha.query(trx).patchAndFetchById(linha.id, montarPatchReversaoFuturoCliente(linha));

    const atribuicao = await LeadAtribuicao.query(trx)
      .where({ lead_linha_id: linha.id, etapa: 'sondagem' })
      .orderBy('id', 'desc')
      .first();
    if (atribuicao && atribuicao.status === 'qualificado') {
      await LeadAtribuicao.query(trx).patchAndFetchById(atribuicao.id, {
        status: 'atribuido',
        motivo_resultado: null,
        finalizado_em: null
      });
    }
  });

  await desativarAlertasObrigatoriosDaLinha(linha.id);
  await sincronizarNotificacoesRetornoLeads();

  const resultado = await buscarLinhaFormatada(linha.id);
  try {
    await leadTelegramPublicacaoService.marcarRevertido(resultado.linha);
  } catch (error) {
    // A reversao no CRM permanece valida mesmo se o Telegram estiver indisponivel.
    console.error('Erro ao marcar futuro cliente revertido no Telegram:', error.message);
  }
  return resultado;
}

/**
 * Lista futuros clientes conforme os filtros e parametros informados.
 */
async function listarFuturosClientes(filtros = {}, usuarioId) {
  await limparFuturosClientesVencidosDaLixeira(usuarioId);

  const page = Math.max(1, Number(filtros.page || 1));
  const pageSize = Math.min(500, Math.max(1, Number(filtros.page_size || 50)));

  let query = LeadLinha.query()
    .where('futuro_cliente', true)
    .whereNull('futuro_cliente_excluido_em');

  const linhaId = Number(filtros.linha_id || 0);
  const filtrarPorLinhaDaNotificacao = Number.isInteger(linhaId) && linhaId > 0;

  if (filtrarPorLinhaDaNotificacao) {
    query.where('id', linhaId);
    if (usuarioId) {
      query.where(builder => builder
        .where('futuro_cliente_marcado_por_id', usuarioId)
        .orWhere('atribuido_para_id', usuarioId)
        .orWhereExists(
          db('lead_atribuicoes as la')
            .select(db.raw('1'))
            .whereRaw('la.lead_linha_id = lead_linhas.id')
            .where('la.usuario_id', Number(usuarioId))
            .where('la.etapa', 'venda')
            .whereIn('la.aceite_status', [
              leadDistribuicaoService.ACEITE_AGUARDANDO,
              leadDistribuicaoService.ACEITE_ACEITO
            ])
        ));
    }
  } else if (usuarioId) {
    query.where(builder => builder
      .where('futuro_cliente_marcado_por_id', usuarioId)
      .orWhere('atribuido_para_id', usuarioId));
  }

  // O indicador da navegacao deve considerar somente os encaminhamentos que
  // chegaram para o usuario e ainda dependem do seu aceite. Um futuro cliente
  // cadastrado pelo proprio usuario nao representa uma nova indicacao.
  if (filtros.aguardando_aceite && usuarioId) {
    query.whereExists(
      db('lead_atribuicoes as la')
        .select(db.raw('1'))
        .whereRaw('la.lead_linha_id = lead_linhas.id')
        .where('la.usuario_id', Number(usuarioId))
        .where('la.etapa', 'venda')
        .where('la.aceite_status', leadDistribuicaoService.ACEITE_AGUARDANDO)
    );
  }

  query = aplicarBuscaFuturosClientes(query, filtros.busca);
  query = aplicarFiltrosFuturosClientes(query, filtros);

  const total = await query.clone().resultSize();
  const linhas = await query
    .withGraphFetched('[planilha, envio, sondagem.[operadoraAtual, operadoraInteresse, usuario], enriquecimento]')
    .orderBy('futuro_cliente_marcado_em', 'desc')
    .orderBy('id', 'desc')
    .offset((page - 1) * pageSize)
    .limit(pageSize);

  const distribuicoes = await leadDistribuicaoService.obterDistribuicoesUsuario(
    linhas.map(linha => linha.id),
    usuarioId
  );

  return {
    data: linhas.map(linha => {
      const formatada = formatarLinha(linha);
      const distribuicao = distribuicoes.get(Number(linha.id));
      return usuarioId
        ? leadDistribuicaoService.ocultarDetalhesAntesDoAceite(formatada, distribuicao)
        : {
          ...formatada,
          distribuicao: leadDistribuicaoService.dadosDistribuicao(distribuicao),
          detalhes_bloqueados: false
        };
    }),
    total,
    page,
    page_size: pageSize
  };
}

async function obterMetricasFuturosClientes(filtros = {}) {
  const usuarioResponsavel = 'COALESCE(ll.primeira_ligacao_usuario_id, ll.futuro_cliente_marcado_por_id, ll.retorno_agendado_por_id, ll.cliente_recusou_por_id, ll.chamada_nao_atendida_por_id)';
  // O histórico é preenchido no reenvio para que a métrica continue refletindo a
  // primeira tentativa, mesmo que o status operacional da linha seja reaberto.
  const dataPrimeiroContato = 'COALESCE(ll.primeira_ligacao_em, ll.futuro_cliente_marcado_em, ll.cliente_recusou_em, ll.chamada_nao_atendida_em, ll.updated_at)';
  const query = db('lead_linhas as ll')
    .leftJoin('lead_sondagens as ls', 'ls.lead_linha_id', 'll.id')
    .leftJoin('usuarios as u', function juntarUsuarioResponsavel() {
      this.on('u.id', '=', db.raw(usuarioResponsavel));
    })
    .where(builder => builder
      .where(subquery => subquery.where('ll.futuro_cliente', true).whereNull('ll.futuro_cliente_excluido_em'))
      .orWhereNotNull('ll.retorno_agendado_em')
      .orWhere('ll.cliente_recusou', true)
      .orWhere('ll.chamada_nao_atendida', true)
      .orWhereNotNull('ll.primeira_ligacao_status'));
  if (filtros.usuario_id) query.whereRaw(`${usuarioResponsavel} = ?`, [Number(filtros.usuario_id)]);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filtros.data_inicio || ''))) {
    query.whereRaw(`${dataPrimeiroContato} >= ?`, [`${filtros.data_inicio} 00:00:00`]);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filtros.data_fim || ''))) {
    query.whereRaw(`${dataPrimeiroContato} < DATE_ADD(?, INTERVAL 1 DAY)`, [filtros.data_fim]);
  }

  query
    .groupByRaw(`${usuarioResponsavel}, u.nome`)
    .select(db.raw(`${usuarioResponsavel} as usuario_id`), 'u.nome as usuario_nome')
    .count({ ligacoes_realizadas: 'll.id' })
    .sum({ qualificados: db.raw('CASE WHEN ll.futuro_cliente = true THEN 1 ELSE 0 END') })
    .sum({ retornos_agendados: db.raw("CASE WHEN ll.retorno_agendado_em IS NOT NULL OR ll.primeira_ligacao_status = 'retorno_agendado' THEN 1 ELSE 0 END") })
    .sum({ clientes_recusaram: db.raw("CASE WHEN ll.cliente_recusou = true OR ll.primeira_ligacao_status = 'cliente_recusou' THEN 1 ELSE 0 END") })
    .sum({ chamadas_nao_atendidas: db.raw("CASE WHEN ll.chamada_nao_atendida = true OR ll.primeira_ligacao_status = 'chamada_nao_atendida' THEN 1 ELSE 0 END") })
    .sum({ potencial_mensal: db.raw('CASE WHEN ll.futuro_cliente = true THEN COALESCE(ls.valor_mensal_estimado, 0) ELSE 0 END') })
    .sum({ distribuidos_venda: db.raw("CASE WHEN ll.futuro_cliente = true AND ll.status_operacional IN ('distribuido_venda', 'vendido', 'perdido') THEN 1 ELSE 0 END") })
    .sum({ vendidos: db.raw("CASE WHEN ll.futuro_cliente = true AND (ll.status_operacional = 'vendido' OR ll.venda_id IS NOT NULL) THEN 1 ELSE 0 END") })
    .sum({ recusados: db.raw("CASE WHEN ll.futuro_cliente = true AND ll.status_operacional = 'perdido' THEN 1 ELSE 0 END") });

  if (filtros.agrupar_por === 'dia') {
    query
      .select(db.raw(`DATE(${dataPrimeiroContato}) as data`))
      .groupByRaw(`DATE(${dataPrimeiroContato})`)
      .orderBy('data', 'desc');
  }

  return query;
}
/** Aplica o estilo padrao das planilhas de produtividade. */
function estilizarPlanilhaProdutividade(worksheet, totalColunas) {
  worksheet.views = [{ state: 'frozen', ySplit: 4 }];
  worksheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: worksheet.rowCount, column: totalColunas } };
  worksheet.getRow(1).height = 28;
  worksheet.getRow(1).font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
  worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'left' };
  worksheet.getRow(2).font = { italic: true, color: { argb: 'FF475569' } };
  worksheet.getRow(4).height = 24;
  worksheet.getRow(4).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  worksheet.getRow(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
  worksheet.getRow(4).alignment = { vertical: 'middle', horizontal: 'center' };

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 4) return;
    row.alignment = { vertical: 'middle' };
    if (rowNumber % 2 === 1) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    }
    row.eachCell(cell => {
      cell.border = {
        bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } }
      };
    });
  });
}

function descricaoPeriodoProdutividade(filtros = {}) {
  if (filtros.data_inicio && filtros.data_fim) {
    return filtros.data_inicio === filtros.data_fim
      ? `Data: ${filtros.data_inicio.split('-').reverse().join('/')}`
      : `PerÃ­odo: ${filtros.data_inicio.split('-').reverse().join('/')} a ${filtros.data_fim.split('-').reverse().join('/')}`;
  }
  if (filtros.data_inicio) return `A partir de: ${filtros.data_inicio.split('-').reverse().join('/')}`;
  if (filtros.data_fim) return `AtÃ©: ${filtros.data_fim.split('-').reverse().join('/')}`;
  return 'PerÃ­odo: todos os registros';
}

async function gerarXlsxProdutividadePrimeiraLigacao(filtros = {}) {
  if (filtros.data_inicio && filtros.data_fim && filtros.data_inicio > filtros.data_fim) {
    throw criarHttpError(400, 'A data inicial deve ser anterior ou igual Ã  data final.');
  }

  const filtrosPeriodo = {
    data_inicio: filtros.data_inicio,
    data_fim: filtros.data_fim
  };
  const resumo = await obterMetricasFuturosClientes(filtrosPeriodo);
  const diario = await obterMetricasFuturosClientes({ ...filtrosPeriodo, agrupar_por: 'dia' });
  const ordenarConsultor = (a, b) => String(a.usuario_nome || '').localeCompare(String(b.usuario_nome || ''), 'pt-BR');
  const dataMetricaIso = valor => valor instanceof Date
    ? valor.toISOString().slice(0, 10)
    : String(valor || '').slice(0, 10);
  resumo.sort(ordenarConsultor);
  diario.sort((a, b) => dataMetricaIso(b.data).localeCompare(dataMetricaIso(a.data)) || ordenarConsultor(a, b));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sistema Pos Venda';
  workbook.created = new Date();
  const periodo = descricaoPeriodoProdutividade(filtrosPeriodo);

  const wsResumo = workbook.addWorksheet('Resumo por consultor');
  wsResumo.mergeCells('A1:J1');
  wsResumo.getCell('A1').value = 'Produtividade da primeira ligaÃ§Ã£o';
  wsResumo.mergeCells('A2:J2');
  wsResumo.getCell('A2').value = periodo;
  wsResumo.addRow([]);
  wsResumo.addRow(['CONSULTOR', 'LIGA\u00c7\u00d5ES FEITAS', 'RETORNOS AGENDADOS', 'CLIENTES RECUSARAM', 'CHAMADAS N\u00c3O ATENDIDAS', 'ENVIADOS PARA VENDA', 'VENDAS CONCLU\u00cdDAS', 'VENDAS RECUSADAS', 'CONVERS\u00c3O', 'POTENCIAL MENSAL']);
  resumo.forEach(item => {
    const ligacoes = Number(item.qualificados || 0);
    const vendas = Number(item.vendidos || 0);
    wsResumo.addRow([
      item.usuario_nome || 'UsuÃ¡rio removido',
      ligacoes,
      Number(item.retornos_agendados || 0),
      Number(item.clientes_recusaram || 0),
      Number(item.chamadas_nao_atendidas || 0),
      Number(item.distribuidos_venda || 0),
      vendas,
      Number(item.recusados || 0),
      ligacoes ? vendas / ligacoes : 0,
      Number(item.potencial_mensal || 0)
    ]);
  });
  const totais = resumo.reduce((acc, item) => ({
    ligacoes: acc.ligacoes + Number(item.qualificados || 0),
    retornos: acc.retornos + Number(item.retornos_agendados || 0),
    clientesRecusaram: acc.clientesRecusaram + Number(item.clientes_recusaram || 0),
    chamadasNaoAtendidas: acc.chamadasNaoAtendidas + Number(item.chamadas_nao_atendidas || 0),
    distribuidos: acc.distribuidos + Number(item.distribuidos_venda || 0),
    vendas: acc.vendas + Number(item.vendidos || 0),
    recusadas: acc.recusadas + Number(item.recusados || 0),
    potencial: acc.potencial + Number(item.potencial_mensal || 0)
  }), { ligacoes: 0, retornos: 0, clientesRecusaram: 0, chamadasNaoAtendidas: 0, distribuidos: 0, vendas: 0, recusadas: 0, potencial: 0 });
  const linhaTotal = wsResumo.addRow([
    'TOTAL',
    totais.ligacoes,
    totais.retornos,
    totais.clientesRecusaram,
    totais.chamadasNaoAtendidas,
    totais.distribuidos,
    totais.vendas,
    totais.recusadas,
    totais.ligacoes ? totais.vendas / totais.ligacoes : 0,
    totais.potencial
  ]);
  wsResumo.columns = [
    { width: 30 }, { width: 18 }, { width: 21 }, { width: 21 }, { width: 23 }, { width: 23 }, { width: 21 }, { width: 18 }, { width: 14 }, { width: 20 }
  ];
  wsResumo.getColumn(9).numFmt = '0.0%';
  wsResumo.getColumn(10).numFmt = 'R$ #,##0.00';
  estilizarPlanilhaProdutividade(wsResumo, 10);
  linhaTotal.font = { bold: true };
  linhaTotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };

  const wsDiario = workbook.addWorksheet('Detalhamento diÃ¡rio');
  wsDiario.mergeCells('A1:K1');
  wsDiario.getCell('A1').value = 'Detalhamento diÃ¡rio da primeira ligaÃ§Ã£o';
  wsDiario.mergeCells('A2:K2');
  wsDiario.getCell('A2').value = periodo;
  wsDiario.addRow([]);
  wsDiario.addRow(['DATA', 'CONSULTOR', 'LIGA\u00c7\u00d5ES FEITAS', 'RETORNOS AGENDADOS', 'CLIENTES RECUSARAM', 'CHAMADAS N\u00c3O ATENDIDAS', 'ENVIADOS PARA VENDA', 'VENDAS CONCLU\u00cdDAS', 'VENDAS RECUSADAS', 'CONVERS\u00c3O', 'POTENCIAL MENSAL']);
  diario.forEach(item => {
    const ligacoes = Number(item.qualificados || 0);
    const vendas = Number(item.vendidos || 0);
    const data = dataMetricaIso(item.data);
    wsDiario.addRow([
      /^\d{4}-\d{2}-\d{2}$/.test(data) ? data.split('-').reverse().join('/') : data,
      item.usuario_nome || 'UsuÃ¡rio removido',
      ligacoes,
      Number(item.retornos_agendados || 0),
      Number(item.clientes_recusaram || 0),
      Number(item.chamadas_nao_atendidas || 0),
      Number(item.distribuidos_venda || 0),
      vendas,
      Number(item.recusados || 0),
      ligacoes ? vendas / ligacoes : 0,
      Number(item.potencial_mensal || 0)
    ]);
  });
  wsDiario.columns = [
    { width: 14 }, { width: 30 }, { width: 18 }, { width: 21 }, { width: 21 }, { width: 23 }, { width: 23 }, { width: 21 }, { width: 18 }, { width: 14 }, { width: 20 }
  ];
  wsDiario.getColumn(10).numFmt = '0.0%';
  wsDiario.getColumn(11).numFmt = 'R$ #,##0.00';
  estilizarPlanilhaProdutividade(wsDiario, 11);
  const sufixo = filtros.data_inicio || filtros.data_fim
    ? `${filtros.data_inicio || 'inicio'}-a-${filtros.data_fim || 'hoje'}`
    : 'todo-periodo';
  return {
    buffer: await workbook.xlsx.writeBuffer(),
    nome: `produtividade-primeira-ligacao-${sufixo}.xlsx`
  };
}

function extrairCnpjsLinha(linha) {
  const dados = parseJson(linha?.dados_json, {});
  return Object.entries(dados).reduce((acc, [chave, valor]) => {
    const nome = String(chave || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (!nome.includes('cnpj') && !nome.includes('documento')) return acc;
    // Linhas importadas antes da correcao podem estar sem os zeros a esquerda.
    const digitos = restaurarZerosCnpj(valor);
    if (digitos) acc.add(digitos);
    return acc;
  }, new Set());
}

/** Verifica se algum CNPJ do mailing ja pertence a um cliente com venda ativa. */
async function linhaPossuiVendaPorCnpj(linha, trx = db) {
  const cnpjs = Array.from(extrairCnpjsLinha(linha));
  if (!cnpjs.length) return false;

  const venda = await trx('clientes as c')
    .join('vendas as v', 'v.cliente_id', 'c.id')
    .whereIn('c.cnpj_digitos', cnpjs)
    .whereNull('v.excluido_em')
    .first('v.id');

  return Boolean(venda);
}

async function marcarVendaRecusadaLead(linhaId, usuarioId, dados = {}, opcoes = {}) {
  const motivo = String(dados.motivo || dados.venda_recusada_motivo || '').trim();
  if (!motivo) throw criarHttpError(400, 'Informe o motivo da venda recusada.');
  if (motivo.length > 1000) throw criarHttpError(400, 'O motivo da venda recusada deve ter no maximo 1000 caracteres.');

  const linha = await LeadLinha.query().findById(Number(linhaId));
  if (!linha) throw criarHttpError(404, 'Lead nao encontrado.');
  if (!opcoes.comoAdmin && Number(linha.atribuido_para_id) !== Number(usuarioId)) {
    throw criarHttpError(403, 'Lead nao encontrado ou atribuido a outro usuario.');
  }
  if (!opcoes.comoAdmin && (!linha.futuro_cliente || linha.futuro_cliente_excluido_em)) {
    throw criarHttpError(400, 'Somente futuros clientes ativos podem ter venda recusada.');
  }
  if (linha.venda_id || linha.status_operacional === 'vendido') {
    throw criarHttpError(409, 'Este futuro cliente ja possui venda registrada.');
  }
  const donoId = opcoes.comoAdmin ? (Number(linha.atribuido_para_id) || Number(usuarioId)) : Number(usuarioId);

  await LeadLinha.transaction(async trx => {
    const recusadaEm = formatarDateTimeSQL();
    await LeadLinha.query(trx).patchAndFetchById(linha.id, {
      venda_recusada_motivo: motivo,
      venda_recusada_em: recusadaEm,
      venda_recusada_por_id: usuarioId,
      etapa_atual: 'venda',
      status_operacional: 'perdido'
    });

    let atribuicao = await LeadAtribuicao.query(trx)
      .where({ lead_linha_id: linha.id, usuario_id: donoId, etapa: 'venda' })
      .orderBy('id', 'desc').first();
    if (!atribuicao) {
      atribuicao = await LeadAtribuicao.query(trx).insertAndFetch({
        lead_linha_id: linha.id,
        envio_id: linha.envio_id,
        usuario_id: donoId,
        etapa: 'venda',
        status: 'atribuido',
        criado_por_id: usuarioId
      });
    }
    await LeadAtribuicao.query(trx).patchAndFetchById(atribuicao.id, {
      status: 'perdido', motivo_resultado: motivo, finalizado_em: recusadaEm
    });
    await leadDistribuicaoService.registrarAcaoValida(
      linha.id,
      donoId,
      'venda_recusada',
      trx
    );
  });

  const atualizada = await LeadLinha.query()
    .findById(linha.id)
    .withGraphFetched('[planilha, envio, atribuidoPara, sondagem.[operadoraAtual, operadoraInteresse, usuario], enriquecimento]')
    .modifyGraph('atribuidoPara', builder => builder.select('id', 'nome', 'email'));

  return { linha: formatarLinha(atualizada) };
}

/**
 * Reverte a "venda recusada" e devolve o lead para a etapa de venda como qualificado.
 */
async function reverterVendaRecusadaLead(linhaId, usuarioId, opcoes = {}) {
  const linha = await LeadLinha.query().findById(Number(linhaId));
  if (!linha) throw criarHttpError(404, 'Lead nao encontrado.');
  if (!opcoes.comoAdmin && Number(linha.atribuido_para_id) !== Number(usuarioId)) {
    throw criarHttpError(403, 'Lead nao encontrado ou atribuido a outro usuario.');
  }
  if (!linha.venda_recusada_em && linha.status_operacional !== 'perdido') {
    throw criarHttpError(400, 'Este lead nao esta marcado como venda recusada.');
  }
  const donoId = opcoes.comoAdmin ? (Number(linha.atribuido_para_id) || Number(usuarioId)) : Number(usuarioId);
  const futuroClienteAtivo = Boolean(linha.futuro_cliente && !linha.futuro_cliente_excluido_em);

  await LeadLinha.transaction(async trx => {
    await LeadLinha.query(trx).patchAndFetchById(linha.id, {
      venda_recusada_motivo: null,
      venda_recusada_em: null,
      venda_recusada_por_id: null,
      status_operacional: futuroClienteAtivo ? 'qualificado' : 'pendente'
    });

    const atribuicao = await LeadAtribuicao.query(trx)
      .where({ lead_linha_id: linha.id, usuario_id: donoId, etapa: 'venda' })
      .orderBy('id', 'desc').first();
    if (atribuicao && atribuicao.status === 'perdido') {
      await LeadAtribuicao.query(trx).patchAndFetchById(atribuicao.id, {
        status: futuroClienteAtivo ? 'qualificado' : 'atribuido',
        motivo_resultado: null,
        finalizado_em: null
      });
    }
  });

  return buscarLinhaFormatada(linha.id);
}

/**
 * Busca a linha e recarrega com os relacionamentos usados pelo frontend.
 */
async function buscarLinhaFormatada(linhaId) {
  const atualizada = await LeadLinha.query()
    .findById(Number(linhaId))
    .withGraphFetched('[planilha, envio, atribuidoPara, sondagem.[operadoraAtual, operadoraInteresse, usuario], enriquecimento]')
    .modifyGraph('atribuidoPara', builder => builder.select('id', 'nome', 'email'));

  return { linha: formatarLinha(atualizada) };
}

/**
 * Registra que o cliente recusou o contato na primeira ligacao.
 */
async function marcarClienteRecusouLead(linhaId, usuarioId, dados = {}, opcoes = {}) {
  const motivo = String(dados.motivo || dados.cliente_recusou_motivo || '').trim();
  if (motivo.length > 1000) throw criarHttpError(400, 'O motivo da recusa deve ter no maximo 1000 caracteres.');

  const linha = await LeadLinha.query().findById(Number(linhaId));
  if (!linha) throw criarHttpError(404, 'Lead nao encontrado.');
  if (!opcoes.comoAdmin && Number(linha.atribuido_para_id) !== Number(usuarioId)) {
    throw criarHttpError(403, 'Lead nao encontrado ou atribuido a outro usuario.');
  }
  if (linha.venda_id || linha.status_operacional === 'vendido') {
    throw criarHttpError(409, 'Este lead ja possui venda registrada.');
  }
  if (!opcoes.comoAdmin && linha.cliente_recusou) {
    throw criarHttpError(409, 'Este lead ja foi marcado como recusado pelo cliente.');
  }
  const donoId = opcoes.comoAdmin ? (Number(linha.atribuido_para_id) || Number(usuarioId)) : Number(usuarioId);

  const recusadoEm = formatarDateTimeSQL();

  await LeadLinha.transaction(async trx => {
    await LeadLinha.query(trx).patchAndFetchById(linha.id, {
      cliente_recusou: true,
      cliente_recusou_motivo: motivo || null,
      cliente_recusou_em: recusadoEm,
      cliente_recusou_por_id: usuarioId,
      retorno_agendado_em: null,
      retorno_agendado_observacao: null,
      retorno_agendado_por_id: null,
      status_operacional: 'perdido'
    });

    let atribuicao = await LeadAtribuicao.query(trx)
      .where({ lead_linha_id: linha.id, usuario_id: donoId, etapa: 'sondagem' })
      .orderBy('id', 'desc').first();
    if (!atribuicao) {
      atribuicao = await LeadAtribuicao.query(trx).insertAndFetch({
        lead_linha_id: linha.id,
        envio_id: linha.envio_id,
        usuario_id: donoId,
        etapa: 'sondagem',
        status: 'atribuido',
        criado_por_id: usuarioId
      });
    }
    await LeadAtribuicao.query(trx).patchAndFetchById(atribuicao.id, {
      status: 'perdido', motivo_resultado: motivo || null, finalizado_em: recusadoEm
    });
    await leadDistribuicaoService.registrarAcaoValida(
      linha.id,
      donoId,
      'cliente_recusou',
      trx
    );
  });

  await sincronizarNotificacoesRetornoLeads();

  return buscarLinhaFormatada(linha.id);
}

/**
 * Reverte a recusa do cliente e devolve o lead para a fila de trabalho.
 */
async function reverterClienteRecusouLead(linhaId, usuarioId, opcoes = {}) {
  const linha = await LeadLinha.query().findById(Number(linhaId));
  if (!linha) throw criarHttpError(404, 'Lead nao encontrado.');
  if (!opcoes.comoAdmin && Number(linha.atribuido_para_id) !== Number(usuarioId)) {
    throw criarHttpError(403, 'Lead nao encontrado ou atribuido a outro usuario.');
  }
  if (!linha.cliente_recusou) {
    throw criarHttpError(400, 'Este lead nao esta marcado como recusado pelo cliente.');
  }
  const donoId = opcoes.comoAdmin ? (Number(linha.atribuido_para_id) || Number(usuarioId)) : Number(usuarioId);

  await LeadLinha.transaction(async trx => {
    await LeadLinha.query(trx).patchAndFetchById(linha.id, {
      cliente_recusou: false,
      cliente_recusou_motivo: null,
      cliente_recusou_em: null,
      cliente_recusou_por_id: null,
      status_operacional: linha.futuro_cliente ? 'qualificado' : 'pendente'
    });

    const atribuicao = await LeadAtribuicao.query(trx)
      .where({ lead_linha_id: linha.id, usuario_id: donoId, etapa: 'sondagem' })
      .orderBy('id', 'desc').first();
    if (atribuicao && atribuicao.status === 'perdido') {
      await LeadAtribuicao.query(trx).patchAndFetchById(atribuicao.id, {
        status: linha.futuro_cliente ? 'qualificado' : 'atribuido',
        motivo_resultado: null,
        finalizado_em: null
      });
    }
  });

  return buscarLinhaFormatada(linha.id);
}

/**
 * Registra que a ligacao nao foi atendida (motivo opcional). Nao tira o lead da fila.
 */
async function marcarChamadaNaoAtendidaLead(linhaId, usuarioId, dados = {}, opcoes = {}) {
  const motivo = String(dados.motivo || dados.chamada_nao_atendida_motivo || '').trim();
  if (motivo.length > 1000) throw criarHttpError(400, 'O motivo deve ter no maximo 1000 caracteres.');
const linha = await LeadLinha.query().findById(Number(linhaId));
  if (!linha) throw criarHttpError(404, 'Lead nao encontrado.');
  if (!opcoes.comoAdmin && Number(linha.atribuido_para_id) !== Number(usuarioId)) {
    throw criarHttpError(403, 'Lead nao encontrado ou atribuido a outro usuario.');
  }
  if (!opcoes.comoAdmin && linha.chamada_nao_atendida) {
    throw criarHttpError(409, 'Este lead ja foi marcado como chamada nao atendida.');
  }

  await LeadLinha.transaction(async trx => {
    await LeadLinha.query(trx).patchAndFetchById(linha.id, {
      chamada_nao_atendida: true,
      chamada_nao_atendida_motivo: motivo || null,
      chamada_nao_atendida_em: formatarDateTimeSQL(),
      chamada_nao_atendida_por_id: usuarioId,
    });
    await leadDistribuicaoService.registrarAcaoValida(
      linha.id,
      usuarioId,
      'chamada_nao_atendida',
      trx
    );
  });

  await desativarAlertasObrigatoriosDaLinha(linha.id);
  await sincronizarNotificacoesRetornoLeads();

  return buscarLinhaFormatada(linha.id);
}

/**
 * Reverte a marcacao de chamada nao atendida.
 */
async function reverterChamadaNaoAtendidaLead(linhaId, usuarioId, opcoes = {}) {
  const linha = await LeadLinha.query().findById(Number(linhaId));
  if (!linha) throw criarHttpError(404, 'Lead nao encontrado.');
  if (!opcoes.comoAdmin && Number(linha.atribuido_para_id) !== Number(usuarioId)) {
    throw criarHttpError(403, 'Lead nao encontrado ou atribuido a outro usuario.');
  }
  if (!linha.chamada_nao_atendida) {
    throw criarHttpError(400, 'Este lead nao esta marcado como chamada nao atendida.');
  }

  await LeadLinha.query().patchAndFetchById(linha.id, {
    chamada_nao_atendida: false,
    chamada_nao_atendida_motivo: null,
    chamada_nao_atendida_em: null,
    chamada_nao_atendida_por_id: null
  });

  return buscarLinhaFormatada(linha.id);
}

/**
 * Agenda (ou limpa) a data e hora de retorno de um lead recebido.
 */
async function marcarRetornoLead(linhaId, usuarioId, dados = {}, opcoes = {}) {
  const linha = await LeadLinha.query().findById(Number(linhaId));
  if (!linha) throw criarHttpError(404, 'Lead nao encontrado.');
  if (!opcoes.comoAdmin && Number(linha.atribuido_para_id) !== Number(usuarioId)) {
    throw criarHttpError(403, 'Lead nao encontrado ou atribuido a outro usuario.');
  }
  if (!opcoes.comoAdmin && linha.cliente_recusou) {
    throw criarHttpError(409, 'Este lead foi recusado pelo cliente e nao pode ter retorno marcado.');
  }
  const donoId = opcoes.comoAdmin ? (Number(linha.atribuido_para_id) || Number(usuarioId)) : Number(usuarioId);

  const retorno = parseDataHoraRetorno(dados.retorno);
  const retornoAnterior = linha.retorno_agendado_em
    ? formatarDateTimeSQL(parseUtcDateTime(linha.retorno_agendado_em))
    : null;
  const retornoAlterado = String(retorno || '') !== String(retornoAnterior || '');
  const observacaoInformada = String(dados.observacao || '').trim();
  if (observacaoInformada.length > 2000) {
    throw criarHttpError(400, 'A observacao do retorno deve ter no maximo 2000 caracteres.');
  }

  await desativarAlertasObrigatoriosDaLinha(linha.id);

  await LeadLinha.transaction(async trx => {
    await LeadLinha.query(trx).patchAndFetchById(linha.id, {
      retorno_agendado_em: retorno,
      retorno_agendado_observacao: retorno ? (observacaoInformada || null) : null,
      retorno_agendado_por_id: retorno ? donoId : null,
      ...(retornoAlterado ? {
        retorno_agendado_realizado_em: null,
        retorno_agendado_realizado_por_id: null
      } : {})
    });

    if (retorno) {
      await leadDistribuicaoService.registrarAcaoValida(
        linha.id,
        donoId,
        'retorno_agendado',
        trx
      );
    }
  });

  await sincronizarNotificacaoRetornoLead(linha.id);

  return buscarLinhaFormatada(linha.id);
}

/**
 * Marca como realizado um retorno direto do lead ou o retorno do futuro cliente.
 */
async function realizarRetornoLead(linhaId, usuarioId, dados = {}, opcoes = {}) {
  const linha = await LeadLinha.query().findById(Number(linhaId));
  if (!linha) throw criarHttpError(404, 'Lead nao encontrado.');

  const origem = String(dados.origem || '').trim();
  if (!['lead', 'futuro_cliente'].includes(origem)) {
    throw criarHttpError(400, 'Origem do retorno invalida.');
  }

  const podeAcessar = Number(linha.atribuido_para_id) === Number(usuarioId)
    || Number(linha.futuro_cliente_marcado_por_id) === Number(usuarioId);
  if (!opcoes.comoAdmin && !opcoes.ignorarResponsavel && !podeAcessar) {
    throw criarHttpError(403, 'Lead nao encontrado ou atribuido a outro usuario.');
  }

  const configuracao = origem === 'lead'
    ? {
      data: linha.retorno_agendado_em,
      realizadoEm: linha.retorno_agendado_realizado_em,
      campoEm: 'retorno_agendado_realizado_em',
      campoPor: 'retorno_agendado_realizado_por_id'
    }
    : {
      data: linha.futuro_cliente_retorno,
      realizadoEm: linha.futuro_cliente_retorno_realizado_em,
      campoEm: 'futuro_cliente_retorno_realizado_em',
      campoPor: 'futuro_cliente_retorno_realizado_por_id'
    };

  if (!configuracao.data) throw criarHttpError(409, 'Este lead nao possui retorno agendado.');

  if (!configuracao.realizadoEm) {
    await LeadLinha.query().patchAndFetchById(linha.id, {
      [configuracao.campoEm]: formatarDateTimeSQL(),
      [configuracao.campoPor]: Number(usuarioId)
    });
  }

  await desativarAlertasObrigatoriosDaLinha(linha.id);
  return buscarLinhaFormatada(linha.id);
}

/**
 * Atualiza as notificacoes de "ligacoes marcadas" sem derrubar a requisicao em caso de falha.
 */
async function sincronizarNotificacoesRetornoLeads() {
  try {
    await require('./notificacao.service').sincronizarRetornosLeads();
  } catch (error) {
    console.error('Erro ao sincronizar notificacoes de retorno de leads:', error);
  }
}

/**
 * Atualiza apenas o retorno do lead alterado, sem percorrer todo o mailing.
 */
async function sincronizarNotificacaoRetornoLead(linhaId) {
  try {
    await require('./notificacao.service').sincronizarRetornoLead(linhaId);
  } catch (error) {
    console.error('Erro ao sincronizar notificacao de retorno do lead:', error);
  }
}
/** Encerra alertas obrigatorios somente depois de uma alteracao real da linha. */
async function desativarAlertasObrigatoriosDaLinha(linhaId) {
  await require('./notificacao.service').desativarAlertasObrigatoriosDaLinha(linhaId);
}

/**
 * Limpa futuros clientes vencidos da lixeira e restaura o estado inicial.
 */
async function limparFuturosClientesVencidosDaLixeira(usuarioId = null) {
  const query = db('lead_linhas')
    .where('futuro_cliente', true)
    .whereNotNull('futuro_cliente_excluido_em')
    .where('futuro_cliente_excluir_definitivo_em', '<=', formatarDateTimeSQL());

  if (usuarioId) {
    query.where('atribuido_para_id', Number(usuarioId));
  }

  return query.update({
    futuro_cliente: false,
    futuro_cliente_notas: null,
    futuro_cliente_retorno: null,
    futuro_cliente_marcado_em: null,
    futuro_cliente_marcado_por_id: null,
    futuro_cliente_excluido_em: null,
    futuro_cliente_excluir_definitivo_em: null,
    futuro_cliente_excluido_por_id: null,
    updated_at: formatarDateTimeSQL()
  });
}

/**
 * Lista futuros clientes lixeira conforme os filtros e parametros informados.
 */
async function listarFuturosClientesLixeira(filtros = {}, usuarioId) {
  await limparFuturosClientesVencidosDaLixeira(usuarioId);

  const page = Math.max(1, Number(filtros.page || 1));
  const pageSize = Math.min(500, Math.max(1, Number(filtros.page_size || 50)));

  let query = LeadLinha.query()
    .withGraphFetched('[planilha, envio, futuroClienteExcluidoPor]')
    .modifyGraph('futuroClienteExcluidoPor', builder => builder.select('id', 'nome', 'email'))
    .where('atribuido_para_id', usuarioId)
    .where('futuro_cliente', true)
    .whereNotNull('futuro_cliente_excluido_em');

  query = aplicarBuscaFuturosClientes(query, filtros.busca);
  query = aplicarFiltrosFuturosClientes(query, filtros);

  const total = await query.clone().resultSize();
  const linhas = await query
    .orderBy('futuro_cliente_excluido_em', 'desc')
    .orderBy('id', 'desc')
    .offset((page - 1) * pageSize)
    .limit(pageSize);

  return {
    data: linhas.map(formatarLinha),
    total,
    page,
    page_size: pageSize
  };
}

/**
 * Envia futuro cliente para lixeira para processamento.
 */
async function enviarFuturoClienteParaLixeira(linhaId, usuarioId) {
  const agora = new Date();

  return db('lead_linhas')
    .where('id', Number(linhaId))
    .where('atribuido_para_id', Number(usuarioId))
    .where('futuro_cliente', true)
    .whereNull('futuro_cliente_excluido_em')
    .update({
      futuro_cliente_excluido_em: formatarDateTimeSQL(agora),
      futuro_cliente_excluir_definitivo_em: formatarDateTimeSQL(adicionarDias(agora, 30)),
      futuro_cliente_excluido_por_id: usuarioId,
      updated_at: formatarDateTimeSQL(agora)
    });
}

/**
 * Restaura futuro cliente quando a regra de negocio permite.
 */
async function restaurarFuturoCliente(linhaId, usuarioId) {
  const atualizados = await db('lead_linhas')
    .where('id', Number(linhaId))
    .where('atribuido_para_id', Number(usuarioId))
    .where('futuro_cliente', true)
    .whereNotNull('futuro_cliente_excluido_em')
    .update({
      futuro_cliente_excluido_em: null,
      futuro_cliente_excluir_definitivo_em: null,
      futuro_cliente_excluido_por_id: null,
      updated_at: formatarDateTimeSQL()
    });

  if (!atualizados) return null;

  const atualizada = await LeadLinha.query()
    .findById(linhaId)
    .withGraphFetched('[planilha, envio]');

  return formatarLinha(atualizada);
}

/**
 * Exclui futuro cliente definitivo conforme a regra de negocio.
 */
async function excluirFuturoClienteDefinitivo(linhaId, usuarioId) {
  return db('lead_linhas')
    .where('id', Number(linhaId))
    .where('atribuido_para_id', Number(usuarioId))
    .where('futuro_cliente', true)
    .whereNotNull('futuro_cliente_excluido_em')
    .update({
      futuro_cliente: false,
      futuro_cliente_notas: null,
      futuro_cliente_retorno: null,
      futuro_cliente_marcado_em: null,
      futuro_cliente_marcado_por_id: null,
      futuro_cliente_excluido_em: null,
      futuro_cliente_excluir_definitivo_em: null,
      futuro_cliente_excluido_por_id: null,
      updated_at: formatarDateTimeSQL()
    });
}

module.exports = {
  listarPlanilhas,
  buscarStatus,
  iniciarUpload,
  importarExcel,
  importarBaseAntigaArquivo,
  criarPlanilha,
  salvarLinhasLote,
  finalizarPlanilha,
  marcarErroPlanilha,
  atualizarSchema,
  excluirPlanilha,
  listarLinhas,
  atualizarCampoLinhaRecebida,
  avaliarPrimeiraLigacao,
  listarEnviosDoUsuario,
  listarTodosEnvios,
  atualizarNomeEnvio,
  listarDestinatariosEnviosPlanilha,
  cancelarEnviosPlanilha,
  dividirLeads,
  exportarCsv,
  gerarPlanilhaXlsx,
  marcarComoFuturoCliente,
  reverterFuturoClienteLead,
  listarFuturosClientes,
  obterMetricasFuturosClientes,
  gerarXlsxProdutividadePrimeiraLigacao,
  marcarVendaRecusadaLead,
  reverterVendaRecusadaLead,
  marcarClienteRecusouLead,
  reverterClienteRecusouLead,
  marcarChamadaNaoAtendidaLead,
  reverterChamadaNaoAtendidaLead,
  marcarRetornoLead,
  realizarRetornoLead,
  buscarLinhaFormatada,
  listarFuturosClientesLixeira,
  enviarFuturoClienteParaLixeira,
  restaurarFuturoCliente,
  excluirFuturoClienteDefinitivo,
  _internals: {
    aplicarFiltrosFuturosClientes,
    aplicarFiltrosQuery,
    aplicarFiltroVendaRecusada,
    combinarMetricasEnvio,
    deduplicarIndicacoesEnvio,
    filtrosPermitemIndicacaoPendente,
    montarColecoesExcel,
    montarColecaoCsv,
    extrairCnpjsLinha,
    linhaPossuiVendaPorCnpj,
    obterErroReversaoFuturoCliente,
    montarPatchReversaoFuturoCliente,
    deveNotificarNovoFuturoCliente
  }
};
