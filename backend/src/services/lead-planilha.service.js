const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Busboy = require('busboy');
const ExcelJS = require('exceljs');
const { FORMATO_MOEDA_BR, FORMATO_PERCENTUAL_BR } = require('../utils/formato-planilha');
/**
 * Servico de importacao, distribuicao e acompanhamento de planilhas de leads.
 */
const LeadPlanilha = require('../models/LeadPlanilha');
const LeadLinha = require('../models/LeadLinha');
const LeadEnvio = require('../models/LeadEnvio');
const LeadEnvioUsuario = require('../models/LeadEnvioUsuario');
const LeadAtribuicao = require('../models/LeadAtribuicao');
const LeadSondagem = require('../models/LeadSondagem');
const Usuario = require('../models/Usuario');
const db = require('../database/connection');
const { parseUtcDateTime } = require('../utils/datetime');
const { usuarioTemPermissaoLocal } = require('../utils/permissoes');
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
const ACOES_PRIMEIRA_LIGACAO = [
  'lead_linha.futuro_cliente_marcado',
  'lead_linha.futuro_cliente_marcado_admin',
  'lead_linha.cliente_recusou',
  'lead_linha.cliente_recusou_admin',
  'lead_linha.chamada_nao_atendida',
  'lead_linha.chamada_nao_atendida_admin',
  'lead_linha.retorno_marcado',
  'lead_linha.retorno_marcado_admin'
];
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
      .whereRaw('LOWER(CAST(lead_linhas.dados_json AS CHAR)) LIKE ?', [`%${termo}%`])
      .orWhereRaw('LOWER(COALESCE(lead_linhas.futuro_cliente_notas, "")) LIKE ?', [`%${termo}%`])
      .orWhereExists(
        db('lead_envios as le_busca')
          .select(db.raw('1'))
          .whereRaw('le_busca.id = lead_linhas.envio_id')
          .whereRaw('LOWER(COALESCE(le_busca.nome, "")) LIKE ?', [`%${termo}%`])
      )
      .orWhereExists(
        db('usuarios as u_busca')
          .select(db.raw('1'))
          .whereRaw('u_busca.id IN (lead_linhas.atribuido_para_id, lead_linhas.futuro_cliente_marcado_por_id)')
          .whereRaw('LOWER(COALESCE(u_busca.nome, "")) LIKE ?', [`%${termo}%`])
      )
      .orWhereExists(
        db('lead_atribuicoes as la_busca')
          .join('usuarios as u_atribuicao_busca', 'u_atribuicao_busca.id', 'la_busca.usuario_id')
          .select(db.raw('1'))
          .whereRaw('la_busca.lead_linha_id = lead_linhas.id')
          .where('la_busca.etapa', 'venda')
          .whereRaw('LOWER(COALESCE(u_atribuicao_busca.nome, "")) LIKE ?', [`%${termo}%`])
      );
  });
}

const STATUS_DISTRIBUICAO_RESPONSAVEL = [
  leadDistribuicaoService.ACEITE_AGUARDANDO,
  leadDistribuicaoService.ACEITE_ACEITO
];

function aplicarCondicaoFuturoClienteFinal(query) {
  return query.where(builder => builder
    .whereNotNull('lead_linhas.venda_id')
    .orWhereIn('lead_linhas.status_operacional', ['vendido', 'perdido'])
    .orWhere('lead_linhas.cliente_recusou', true)
    .orWhereNotNull('lead_linhas.venda_recusada_em'));
}

function consultaUltimaDistribuicaoAtiva(usuarioId = null) {
  const consulta = db('lead_atribuicoes as la_responsavel')
    .select(db.raw('1'))
    .whereRaw('la_responsavel.lead_linha_id = lead_linhas.id')
    .where('la_responsavel.etapa', 'venda')
    .whereNotNull('la_responsavel.aceite_status')
    .whereIn('la_responsavel.aceite_status', STATUS_DISTRIBUICAO_RESPONSAVEL)
    .whereNotExists(
      db('lead_atribuicoes as la_responsavel_nova')
        .select(db.raw('1'))
        .whereRaw('la_responsavel_nova.lead_linha_id = la_responsavel.lead_linha_id')
        .where('la_responsavel_nova.etapa', 'venda')
        .whereNotNull('la_responsavel_nova.aceite_status')
        .whereRaw('la_responsavel_nova.id > la_responsavel.id')
    );
  if (usuarioId !== null) consulta.where('la_responsavel.usuario_id', Number(usuarioId));
  return consulta;
}

/** Filtra pelo mesmo responsavel exibido na coluna "Com quem esta". */
function aplicarFiltroResponsavelAtual(query, responsavelId) {
  const valor = String(responsavelId || '').trim();
  if (!valor) return query;

  const semResponsavel = valor === 'sem_responsavel';
  const usuarioId = Number(valor);
  if (!semResponsavel && (!Number.isInteger(usuarioId) || usuarioId <= 0)) return query;

  return query.where(escopo => {
    if (semResponsavel) {
      escopo
        .whereNot(subquery => aplicarCondicaoFuturoClienteFinal(subquery))
        .whereNotExists(consultaUltimaDistribuicaoAtiva())
        .where(builder => builder
          .where('lead_linhas.futuro_cliente_destino', DESTINO_FUTURO_CLIENTE_DISTRIBUICAO)
          .orWhereRaw('COALESCE(lead_linhas.atribuido_para_id, lead_linhas.futuro_cliente_marcado_por_id) IS NULL'));
      return;
    }

    escopo
      .where(builder => aplicarCondicaoFuturoClienteFinal(builder)
        .whereRaw('COALESCE(lead_linhas.atribuido_para_id, lead_linhas.futuro_cliente_marcado_por_id) = ?', [usuarioId]))
      .orWhere(builder => builder
        .whereNot(subquery => aplicarCondicaoFuturoClienteFinal(subquery))
        .whereExists(consultaUltimaDistribuicaoAtiva(usuarioId)))
      .orWhere(builder => builder
        .whereNot(subquery => aplicarCondicaoFuturoClienteFinal(subquery))
        .whereNotExists(consultaUltimaDistribuicaoAtiva())
        .where(builderDestino => builderDestino
          .whereNull('lead_linhas.futuro_cliente_destino')
          .orWhereNot('lead_linhas.futuro_cliente_destino', DESTINO_FUTURO_CLIENTE_DISTRIBUICAO))
        .whereRaw('COALESCE(lead_linhas.atribuido_para_id, lead_linhas.futuro_cliente_marcado_por_id) = ?', [usuarioId]));
  });
}

/**
 * Expressao canonica de "quem fez a primeira ligacao".
 * `primeira_ligacao_usuario_id` so e preenchido no reenvio, entao as colunas
 * seguintes cobrem as linhas que nunca passaram por esse fluxo.
 */
function expressaoPrimeiraLigacao(alias = 'lead_linhas') {
  return `COALESCE(${alias}.primeira_ligacao_usuario_id, ${alias}.futuro_cliente_marcado_por_id, ${alias}.retorno_agendado_por_id, ${alias}.cliente_recusou_por_id, ${alias}.chamada_nao_atendida_por_id)`;
}

/** Filtra pelo consultor que realizou a primeira ligacao (mesma regra das metricas). */
function aplicarFiltroPrimeiraLigacao(query, primeiraLigacaoId) {
  const valor = String(primeiraLigacaoId || '').trim();
  if (!valor) return query;

  if (valor === 'sem_primeira_ligacao') {
    return query.whereRaw(`${expressaoPrimeiraLigacao('lead_linhas')} IS NULL`);
  }

  const usuarioId = Number(valor);
  if (!Number.isInteger(usuarioId) || usuarioId <= 0) return query;

  return query.whereRaw(`${expressaoPrimeiraLigacao('lead_linhas')} = ?`, [usuarioId]);
}

/**
 * Applies filters specific to the future-clients list.
 */
function aplicarFiltrosFuturosClientes(query, filtros = {}) {
  const situacao = String(filtros.situacao || '').trim();
  const retorno = String(filtros.retorno || '').trim();
  const destino = String(filtros.destino || '').trim();

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
    query.where(builder => builder
      .where(subquery => subquery
        .whereNotNull('retorno_agendado_em')
        .whereNull('retorno_agendado_realizado_em'))
      .orWhere(subquery => subquery
        .whereNotNull('futuro_cliente_retorno')
        .whereNull('futuro_cliente_retorno_realizado_em')));
  } else if (retorno === 'sem_retorno') {
    query.whereNull('retorno_agendado_em')
      .whereNull('futuro_cliente_retorno');
  } else if (retorno === 'vencido') {
    const agora = formatarDateTimeSQL();
    query.where(builder => builder
      .where(subquery => subquery
        .whereNotNull('retorno_agendado_em')
        .whereNull('retorno_agendado_realizado_em')
        .where('retorno_agendado_em', '<', agora))
      .orWhere(subquery => subquery
        .whereNotNull('futuro_cliente_retorno')
        .whereNull('futuro_cliente_retorno_realizado_em')
        .where('futuro_cliente_retorno', '<', agora)));
  } else if (retorno === 'realizado') {
    query.where(builder => builder
      .where(subquery => subquery
        .whereNotNull('retorno_agendado_em')
        .whereNotNull('retorno_agendado_realizado_em'))
      .orWhere(subquery => subquery
        .whereNotNull('futuro_cliente_retorno')
        .whereNotNull('futuro_cliente_retorno_realizado_em')));
  } else if (retorno === 'futuro') {
    const agora = formatarDateTimeSQL();
    query.where(builder => builder
      .where(subquery => subquery
        .whereNotNull('retorno_agendado_em')
        .whereNull('retorno_agendado_realizado_em')
        .where('retorno_agendado_em', '>=', agora))
      .orWhere(subquery => subquery
        .whereNotNull('futuro_cliente_retorno')
        .whereNull('futuro_cliente_retorno_realizado_em')
        .where('futuro_cliente_retorno', '>=', agora)));
  }

  if (destino === DESTINO_FUTURO_CLIENTE_CARTEIRA) {
    query.where(builder => builder
      .whereNull('futuro_cliente_destino')
      .orWhere('futuro_cliente_destino', DESTINO_FUTURO_CLIENTE_CARTEIRA));
  } else if (destino === DESTINO_FUTURO_CLIENTE_DISTRIBUICAO) {
    query.where('futuro_cliente_destino', DESTINO_FUTURO_CLIENTE_DISTRIBUICAO);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filtros.marcado_de || ''))) {
    query.where('futuro_cliente_marcado_em', '>=', `${filtros.marcado_de} 00:00:00`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filtros.marcado_ate || ''))) {
    query.where('futuro_cliente_marcado_em', '<', db.raw('DATE_ADD(?, INTERVAL 1 DAY)', [filtros.marcado_ate]));
  }

  aplicarFiltroResponsavelAtual(query, filtros.responsavel_id);
  aplicarFiltroPrimeiraLigacao(query, filtros.primeira_ligacao_id);

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

const GRUPOS_MAILING_PERMITIDOS = new Set([
  'nao_enviado',
  'enviado_sem_marcacao',
  'chamada_nao_atendida',
  'cliente_recusou',
  'retorno_agendado',
  'venda_registrada'
]);

/** Normaliza os estados que podem ser reabertos em um reenvio de sondagem. */
function normalizarStatusReenvio(valor) {
  const valores = Array.isArray(valor) ? valor : String(valor || '').split(',');
  return [...new Set(valores.map(item => String(item).trim()).filter(item => STATUS_REENVIO_PERMITIDOS.has(item)))];
}

/** Normaliza os grupos elegiveis para uma nova divisao de mailing. */
function normalizarGruposMailing(valor) {
  const valores = Array.isArray(valor) ? valor : String(valor || '').split(',');
  return [...new Set(valores.map(item => String(item).trim()).filter(item => GRUPOS_MAILING_PERMITIDOS.has(item)))];
}

function obterGruposMailingInformados(valor) {
  const valores = Array.isArray(valor) ? valor : String(valor || '').split(',');
  return [...new Set(valores.map(item => String(item).trim()).filter(Boolean))];
}

function gruposMailingForamInformados(dados = {}) {
  return Object.prototype.hasOwnProperty.call(dados, 'grupos_mailing');
}

function aplicarCondicaoEnviado(query) {
  query.where(builder => builder.whereNotNull('envio_id').orWhereNotNull('atribuido_para_id'));
}

function aplicarCondicaoSemMarcacao(query) {
  query
    .where(builder => builder.whereNull('cliente_recusou').orWhere('cliente_recusou', false))
    .where(builder => builder.whereNull('chamada_nao_atendida').orWhere('chamada_nao_atendida', false))
    .whereNull('retorno_agendado_em');
}

function aplicarCondicaoSondagemReenviavel(query) {
  query
    .where(builder => builder.whereNull('etapa_atual').orWhere('etapa_atual', 'sondagem'))
    .where(builder => builder.whereNull('futuro_cliente').orWhere('futuro_cliente', false))
    .whereNull('venda_id')
    .whereNull('venda_recusada_em')
    .whereNull('venda_recusada_motivo');
}

function aplicarCondicaoVendaRegistrada(query) {
  query
    .where(builder => builder.whereNotNull('venda_id').orWhere('status_operacional', 'vendido'))
    .where(builder => builder.whereNull('venda_registrada_oculta').orWhere('venda_registrada_oculta', false));
}

/** Aplica a uniao dos grupos escolhidos, mantendo cada linha no resultado uma unica vez. */
function aplicarGruposMailing(query, gruposMailing) {
  if (!gruposMailing.length) return;
  query.where(builder => {
    gruposMailing.forEach((grupo, index) => {
      const metodo = index === 0 ? 'where' : 'orWhere';
      builder[metodo](grupoQuery => {
        if (grupo === 'venda_registrada') {
          aplicarCondicaoEnviado(grupoQuery);
          aplicarCondicaoVendaRegistrada(grupoQuery);
          return;
        }

        aplicarCondicaoSondagemReenviavel(grupoQuery);
        if (grupo === 'nao_enviado') {
          grupoQuery.whereNull('envio_id').whereNull('atribuido_para_id');
          return;
        }

        aplicarCondicaoEnviado(grupoQuery);
        if (grupo === 'enviado_sem_marcacao') aplicarCondicaoSemMarcacao(grupoQuery);
        if (grupo === 'cliente_recusou') grupoQuery.where('cliente_recusou', true);
        if (grupo === 'chamada_nao_atendida') grupoQuery.where('chamada_nao_atendida', true);
        if (grupo === 'retorno_agendado') grupoQuery.whereNotNull('retorno_agendado_em');
      });
    });
  });
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

function montarPatchDivisao(usuarioAlvoId, envioId, etapa, historicoPrimeiraLigacao = {}, limpezaStatus = {}, opcoes = {}) {
  const patch = {
    atribuido_para_id: usuarioAlvoId,
    envio_id: envioId,
    etapa_atual: etapa,
    ...historicoPrimeiraLigacao,
    ...limpezaStatus,
    updated_at: new Date()
  };
  if (!opcoes.preservarStatusOperacional) {
    patch.status_operacional = etapa === 'venda' ? 'distribuido_venda' : 'pendente';
  }
  return patch;
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
  if (gruposMailingForamInformados(filtros)) {
    aplicarGruposMailing(query, normalizarGruposMailing(filtros.grupos_mailing));
  } else {
    aplicarStatusReenvio(query, normalizarStatusReenvio(filtros.status_reenvio), filtros.status_reenvio_modo === 'excluir');
  }
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
  } else if (status === 'venda_registrada' || status === 'venda_futuro_cliente') {
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
  if (filtros.busca) aplicarBuscaDadosJson(query, filtros.busca);
  if (filtros.busca_global) {
    const buscaGlobal = String(filtros.busca_global).trim().toLowerCase();
    query.where(builder => {
      aplicarBuscaDadosJson(builder, buscaGlobal);
      builder.orWhereExists(
        db('lead_envios as le_busca')
          .select(db.raw('1'))
          .whereRaw('le_busca.id = lead_linhas.envio_id')
          .whereRaw('LOWER(COALESCE(le_busca.nome, "")) LIKE ?', [`%${buscaGlobal}%`])
      );
    });
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
    && !String(filtros.busca_global || '').trim()
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
  if (String(filtros.status || '') === 'venda_antiga_registrada') {
    const queryClassificacao = LeadLinha.query();
    aplicarFiltrosQuery(queryClassificacao, { ...filtros, status: '' }, opcoes);
    const candidatas = await queryClassificacao
      .withGraphFetched('[planilha, envio, atribuidoPara, sondagem.[operadoraAtual, operadoraInteresse, usuario], enriquecimento]')
      .modifyGraph('atribuidoPara', builder => builder.select('id', 'nome', 'email'))
      .orderBy('planilha_id', 'asc')
      .orderBy('row_index', 'asc');
    const classificadas = (await adicionarClassificacaoVendas(candidatas.map(formatarLinha)))
      .filter(linha => linha.venda_classificacao?.tipo === 'venda_antiga_registrada');
    const data = classificadas.slice((page - 1) * pageSize, page * pageSize);
    return {
      data,
      total: classificadas.length,
      resumo: { total: classificadas.length, enviados: classificadas.length, qualificados: 0, nao_enviados: 0 },
      page,
      page_size: pageSize
    };
  }
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

  const linhasFormatadas = [
    ...pendentes,
    ...linhasVinculadas.map(linha => ({
      ...formatarLinha(linha),
      possui_venda_cliente: Array.from(extrairCnpjsLinha(linha)).some(cnpj => cnpjsComVenda.has(cnpj))
    }))
  ];
  const data = await adicionarClassificacaoVendas(linhasFormatadas);

  return {
    data,
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

  const usaGruposMailing = gruposMailingForamInformados(dados);
  const gruposMailing = normalizarGruposMailing(dados.grupos_mailing);
  const incluirEnviados = dados.incluir_enviados === true;
  const statusReenvio = normalizarStatusReenvio(dados.status_reenvio);
  const excluirStatusReenvio = dados.status_reenvio_modo === 'excluir';
  const query = LeadLinha.query().select('id');
  aplicarFiltrosQuery(query, dados.filtros || {});

  if (usaGruposMailing) {
    aplicarGruposMailing(query, gruposMailing);
  } else if (!incluirEnviados) {
    query.whereNull('envio_id');
  }
  if (!usaGruposMailing && statusReenvio.length) {
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

function situacaoEnvioHistorico(quantidadeRecebida, quantidadeAtual) {
  if (quantidadeAtual <= 0) return 'encerrado';
  if (quantidadeAtual < quantidadeRecebida) return 'parcial';
  return 'atual';
}

/** Agrupa os lotes do banco por destinatario sem carregar as linhas no frontend. */
function chavePessoaHistorico(item = {}) {
  const usuarioId = Number(item.usuario_id_historico || item.usuario_id || 0) || null;
  return usuarioId ? `usuario:${usuarioId}` : `nome:${item.usuario_nome || 'excluido'}`;
}

function montarHistoricoDestinatariosPlanilha(planilha, lotes = [], totais = {}, totaisPessoas = []) {
  const pessoasPorId = new Map();
  const totaisPessoasPorId = new Map(totaisPessoas.map(item => [chavePessoaHistorico(item), item]));

  lotes.forEach(lote => {
    const usuarioId = Number(lote.usuario_id_historico || lote.usuario_id || 0) || null;
    const chave = chavePessoaHistorico(lote);
    const quantidadeRecebida = Number(lote.quantidade_recebida || 0);
    const clientesUnicos = Number(lote.clientes_unicos || 0);
    const quantidadeAtual = Number(lote.quantidade_atual || 0);
    const enviadoEm = lote.envio_created_at || lote.primeiro_atribuido_em || null;
    const ultimoAtribuidoEm = lote.ultimo_atribuido_em || enviadoEm;
    let pessoa = pessoasPorId.get(chave);

    if (!pessoa) {
      pessoa = {
        usuario_id: usuarioId,
        usuario_nome: lote.usuario_nome || 'Usuario excluido',
        usuario_excluido: !lote.usuario_id,
        total_recebido: 0,
        clientes_unicos: 0,
        quantidade_atual: 0,
        ultimo_envio_em: ultimoAtribuidoEm,
        envios: []
      };
      pessoasPorId.set(chave, pessoa);
    }

    pessoa.total_recebido += quantidadeRecebida;
    pessoa.clientes_unicos += clientesUnicos;
    pessoa.quantidade_atual += quantidadeAtual;
    if (!pessoa.ultimo_envio_em || String(ultimoAtribuidoEm) > String(pessoa.ultimo_envio_em)) {
      pessoa.ultimo_envio_em = ultimoAtribuidoEm;
    }
    pessoa.envios.push({
      envio_id: Number(lote.envio_id || 0) || null,
      envio_nome: lote.envio_nome || 'Envio removido',
      etapa: lote.etapa,
      enviado_em: enviadoEm,
      quantidade_recebida: quantidadeRecebida,
      clientes_unicos: clientesUnicos,
      quantidade_atual: quantidadeAtual,
      situacao: situacaoEnvioHistorico(quantidadeRecebida, quantidadeAtual)
    });
  });

  const pessoas = [...pessoasPorId.values()]
    .map(pessoa => ({
      ...pessoa,
      clientes_unicos: Number(totaisPessoasPorId.get(chavePessoaHistorico(pessoa))?.clientes_unicos ?? pessoa.clientes_unicos),
      quantidade_atual: Number(totaisPessoasPorId.get(chavePessoaHistorico(pessoa))?.quantidade_atual ?? pessoa.quantidade_atual),
      envios: pessoa.envios.sort((a, b) => String(b.enviado_em || '').localeCompare(String(a.enviado_em || '')))
    }))
    .sort((a, b) => String(b.ultimo_envio_em || '').localeCompare(String(a.ultimo_envio_em || '')));

  return {
    planilha: { id: Number(planilha.id), nome: planilha.nome },
    resumo: {
      pessoas: pessoas.length,
      atribuicoes: pessoas.reduce((total, pessoa) => total + pessoa.total_recebido, 0),
      clientes_unicos: Number(totais.clientes_unicos ?? lotes.reduce((total, lote) => total + Number(lote.clientes_unicos || 0), 0)),
      atualmente_atribuidos: Number(totais.atualmente_atribuidos ?? pessoas.reduce((total, pessoa) => total + pessoa.quantidade_atual, 0))
    },
    pessoas,
    cobertura_historica: {
      completa_desde: '2026-07-11',
      aviso: 'Destinatarios anteriores a 11/07/2026 que ja haviam perdido o mailing podem nao estar registrados.'
    }
  };
}

/** Lista todas as atribuicoes historicas pertencentes a uma planilha. */
async function listarHistoricoDestinatariosPlanilha(planilhaId) {
  const planilha = await LeadPlanilha.query().findById(Number(planilhaId)).select('id', 'nome');
  if (!planilha) throw criarHttpError(404, 'Planilha nao encontrada.');

  const identidadeUsuario = db.raw('COALESCE(la.usuario_id, la.usuario_id_historico)');
  const nomeUsuario = db.raw("COALESCE(u.nome, la.usuario_nome_historico, 'Usuario excluido')");
  const lotesQuery = db('lead_atribuicoes as la')
    .join('lead_linhas as ll', 'll.id', 'la.lead_linha_id')
    .leftJoin('lead_envios as le', 'le.id', 'la.envio_id')
    .leftJoin('usuarios as u', 'u.id', 'la.usuario_id')
    .where('ll.planilha_id', planilha.id)
    .select(
      'la.usuario_id',
      'la.usuario_id_historico',
      'la.envio_id',
      'la.etapa',
      'le.nome as envio_nome',
      'le.created_at as envio_created_at',
      { usuario_nome: nomeUsuario }
    )
    .count('la.id as quantidade_recebida')
    .countDistinct('la.lead_linha_id as clientes_unicos')
    .countDistinct({
      quantidade_atual: db.raw('CASE WHEN ll.atribuido_para_id = la.usuario_id AND ll.envio_id = la.envio_id THEN la.lead_linha_id ELSE NULL END')
    })
    .min('la.atribuido_em as primeiro_atribuido_em')
    .max('la.atribuido_em as ultimo_atribuido_em')
    .groupBy([
      identidadeUsuario,
      nomeUsuario,
      'la.usuario_id',
      'la.usuario_id_historico',
      'la.envio_id',
      'la.etapa',
      'le.nome',
      'le.created_at'
    ]);

  const totaisQuery = db('lead_atribuicoes as la')
    .join('lead_linhas as ll', 'll.id', 'la.lead_linha_id')
    .where('ll.planilha_id', planilha.id)
    .countDistinct('la.lead_linha_id as clientes_unicos')
    .countDistinct({
      atualmente_atribuidos: db.raw('CASE WHEN ll.atribuido_para_id = la.usuario_id AND ll.envio_id = la.envio_id THEN la.lead_linha_id ELSE NULL END')
    })
    .first();

  const totaisPessoasQuery = db('lead_atribuicoes as la')
    .join('lead_linhas as ll', 'll.id', 'la.lead_linha_id')
    .leftJoin('usuarios as u', 'u.id', 'la.usuario_id')
    .where('ll.planilha_id', planilha.id)
    .select(
      'la.usuario_id',
      'la.usuario_id_historico',
      { usuario_nome: nomeUsuario }
    )
    .countDistinct('la.lead_linha_id as clientes_unicos')
    .countDistinct({
      quantidade_atual: db.raw('CASE WHEN ll.atribuido_para_id = la.usuario_id AND ll.envio_id = la.envio_id THEN la.lead_linha_id ELSE NULL END')
    })
    .groupBy([identidadeUsuario, nomeUsuario, 'la.usuario_id', 'la.usuario_id_historico']);

  const [lotes, totais, totaisPessoas] = await Promise.all([lotesQuery, totaisQuery, totaisPessoasQuery]);

  return montarHistoricoDestinatariosPlanilha(planilha, lotes, totais, totaisPessoas);
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
  const usaGruposMailing = gruposMailingForamInformados(dados);
  const gruposMailingInformados = obterGruposMailingInformados(dados.grupos_mailing);
  const gruposMailing = normalizarGruposMailing(dados.grupos_mailing);
  const statusReenvio = normalizarStatusReenvio(dados.status_reenvio);
  const excluirStatusReenvio = dados.status_reenvio_modo === 'excluir';

  if (!String(dados.nome || '').trim()) throw new Error('Informe um nome para o envio.');
  if (usuarioIds.length === 0) throw new Error('Selecione ao menos um vendedor.');
  if (quantidadeTotal <= 0) throw new Error('Quantidade de clientes invalida.');
  if (usaGruposMailing && etapa !== 'sondagem') throw new Error('A selecao de grupos de mailing e permitida somente em envios de sondagem.');
  if (usaGruposMailing && gruposMailing.length === 0) throw new Error('Selecione ao menos um grupo de mailing.');
  if (usaGruposMailing && gruposMailing.length !== gruposMailingInformados.length) throw new Error('A selecao contem um grupo de mailing invalido.');
  if (!usaGruposMailing && statusReenvio.length && (!dados.incluir_enviados || etapa !== 'sondagem')) throw new Error('A selecao de status e permitida somente ao reenviar mailing de sondagem ja enviado.');

  const linhaIds = await buscarIdsPorCriterios(dados, quantidadeTotal);
  if (linhaIds.length < quantidadeTotal) {
    if (etapa === 'venda') {
      throw new Error(`Ha somente ${linhaIds.length} futuro(s) cliente(s) qualificado(s) e disponivel(is) para venda.`);
    }
    if (usaGruposMailing || dados.incluir_enviados === true) {
      throw new Error('NÃ£o hÃ¡ mailing suficiente para a quantidade solicitada.');
    }
    throw new Error('NÃ£o hÃ¡ mailing nÃ£o enviado suficiente. Ative incluir mailing jÃ¡ enviado para transferir linhas distribuÃ­das.');
  }

  const totalJaEnviados = (usaGruposMailing || dados.incluir_enviados === true)
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
      origem: 'mailing',
      total_linhas: quantidadeTotal,
      colunas_visiveis: JSON.stringify(dados.colunas_visiveis || []),
      criado_por_id: usuarioId
    });

    let cursor = 0;
    const statusParaLimpar = usaGruposMailing
      ? gruposMailing.filter(grupo => STATUS_REENVIO_PERMITIDOS.has(grupo))
      : (excluirStatusReenvio ? [] : statusReenvio);
    const ocultarVendaRegistrada = usaGruposMailing && gruposMailing.includes('venda_registrada');
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
        const idsLote = idsUsuario.slice(i, i + SELECT_BATCH_SIZE);
        let idsVendaRegistrada = [];
        if (ocultarVendaRegistrada) {
          const linhasVendaRegistrada = await LeadLinha.query(trx)
            .whereIn('id', idsLote)
            .where(builder => builder.whereNotNull('venda_id').orWhere('status_operacional', 'vendido'))
            .select('id');
          idsVendaRegistrada = linhasVendaRegistrada.map(linha => Number(linha.id));
          if (idsVendaRegistrada.length) {
            await LeadLinha.query(trx)
              .whereIn('id', idsVendaRegistrada)
              .patch({ venda_registrada_oculta: true });
            await LeadLinha.query(trx)
              .whereIn('id', idsVendaRegistrada)
              .patch(montarPatchDivisao(
                usuarioAlvoId,
                envio.id,
                etapa,
                historicoPrimeiraLigacao,
                limpezaStatus,
                { preservarStatusOperacional: true }
              ));
          }
        }

        const idsVendaRegistradaSet = new Set(idsVendaRegistrada);
        const idsRegulares = idsVendaRegistrada.length
          ? idsLote.filter(id => !idsVendaRegistradaSet.has(Number(id)))
          : idsLote;
        if (idsRegulares.length) {
          await LeadLinha.query(trx)
            .whereIn('id', idsRegulares)
            .patch(montarPatchDivisao(
              usuarioAlvoId,
              envio.id,
              etapa,
              historicoPrimeiraLigacao,
              limpezaStatus
            ));
        }
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
  if (!linha.venda_registrada_oculta) {
    if (linha.venda_classificacao?.tipo === 'venda_futuro_cliente' || linha.venda_id || linha.status_operacional === 'vendido') {
      status.push('Venda registrada por futuro cliente');
    } else if (linha.venda_classificacao?.tipo === 'venda_antiga_registrada' || linha.possui_venda_cliente) {
      status.push('Venda antiga registrada');
    }
  }
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

function aplicarEscopoCarteiraFuturosClientes(query, usuarioId) {
  return query.where('futuro_cliente_marcado_por_id', Number(usuarioId))
    .where(builder => builder
      .whereNull('futuro_cliente_destino')
      .orWhereNot('futuro_cliente_destino', DESTINO_FUTURO_CLIENTE_DISTRIBUICAO));
}

const DESTINO_FUTURO_CLIENTE_CARTEIRA = 'carteira';
const DESTINO_FUTURO_CLIENTE_DISTRIBUICAO = 'distribuicao';

function resolverDestinoNovoFuturoCliente(linha, dados = {}) {
  if (linha?.futuro_cliente) return linha.futuro_cliente_destino || null;
  if (dados.destino === undefined || dados.destino === null || dados.destino === '') {
    return DESTINO_FUTURO_CLIENTE_DISTRIBUICAO;
  }
  const destino = String(dados.destino).trim().toLowerCase();
  if (![DESTINO_FUTURO_CLIENTE_CARTEIRA, DESTINO_FUTURO_CLIENTE_DISTRIBUICAO].includes(destino)) {
    throw criarHttpError(400, 'Destino do futuro cliente invalido.');
  }
  return destino;
}

async function publicarFuturoClienteTelegram(linhaFormatada, usuarioId = null) {
  try {
    const linhaPublicacao = await leadTelegramPublicacaoService.prepararLinhaPublicacao(linhaFormatada);
    const publicacao = await telegramService.enviarFuturoCliente(linhaPublicacao);
    if (publicacao.enviado && publicacao.message_id) {
      await leadTelegramPublicacaoService.registrar(linhaFormatada.id, {
        ...publicacao, usuario_id: usuarioId,
        contexto_publicacao_telegram: linhaPublicacao.contexto_publicacao_telegram
      });
    } else {
      await leadTelegramPublicacaoService.registrarFalha(linhaFormatada.id);
    }
    return publicacao;
  } catch (error) {
    // A indisponibilidade do Telegram nao pode desfazer o cadastro ou a decisao de distribuicao.
    console.error('Erro ao notificar futuro cliente no Telegram:', {
      message: error.response?.data?.description || error.message,
      status: error.response?.status
    });
    try {
      await leadTelegramPublicacaoService.registrarFalha(linhaFormatada.id);
    } catch (registroError) {
      console.error('Erro ao registrar falha de publicacao do futuro cliente:', registroError.message);
    }
    return { enviado: false, motivo: error.message };
  }
}

async function marcarComoFuturoCliente(linhaId, usuarioId, dados = {}, opcoes = {}) {
  const linha = await LeadLinha.query().findById(linhaId);
  if (!linha) throw criarHttpError(404, 'Lead nÃ£o encontrado.');
  if (opcoes.exigirFuturoClienteAtivo && (!linha.futuro_cliente || linha.futuro_cliente_excluido_em)) {
    throw criarHttpError(404, 'Futuro cliente ativo nÃ£o encontrado.');
  }
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

  const novoFuturoCliente = deveNotificarNovoFuturoCliente(linha);
  const destinoFuturoCliente = resolverDestinoNovoFuturoCliente(linha, dados);
  const deveNotificarTelegram = novoFuturoCliente
    && destinoFuturoCliente === DESTINO_FUTURO_CLIENTE_DISTRIBUICAO;
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
  const ocorridoEm = formatarDateTimeSQL();
  const marcadoEm = linha.futuro_cliente_marcado_em || ocorridoEm;

  let prazoRetornoDistribuicaoAtualizado = false;
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
      ...(novoFuturoCliente ? { futuro_cliente_destino: destinoFuturoCliente } : {}),
      retorno_agendado_em: null, retorno_agendado_observacao: null, retorno_agendado_por_id: null,
      retorno_agendado_realizado_em: null, retorno_agendado_realizado_por_id: null,
      etapa_atual: atribuicaoVendaAceita ? 'venda' : 'sondagem',
      status_operacional: atribuicaoVendaAceita ? 'distribuido_venda' : 'qualificado',
      updated_at: new Date()
    });
    prazoRetornoDistribuicaoAtualizado = Boolean(await leadDistribuicaoService.atualizarPrazoRetorno(
      linhaId,
      donoId,
      retorno,
      trx
    ));
  });

  await sincronizarNotificacoesRetornoLeads();

  const atualizada = await LeadLinha.query()
    .findById(linhaId)
    .withGraphFetched('[planilha, envio, atribuidoPara, sondagem.[operadoraAtual, operadoraInteresse, usuario], enriquecimento]')
    .modifyGraph('atribuidoPara', builder => builder.select('id', 'nome', 'email'));

  const linhaFormatada = formatarLinha(atualizada);
  if (prazoRetornoDistribuicaoAtualizado && retorno && retornoFuturoAlterado) {
    await leadDistribuicaoService.notificarRetornoAgendadoTelegram(linhaId, retorno);
  }
  if (deveNotificarTelegram) {
    await publicarFuturoClienteTelegram(linhaFormatada, usuarioId);
  }

  return {
    linha: linhaFormatada,
    contexto_auditoria: {
      operacao: novoFuturoCliente ? 'registro' : 'atualizacao',
      ocorrido_em: novoFuturoCliente ? marcadoEm : ocorridoEm
    }
  };
}

async function enviarFuturoClienteParaDistribuicao(linhaId, usuarioId) {
  const id = Number(linhaId);
  const usuario = Number(usuarioId);
  const usuarioSolicitante = await Usuario.query()
    .findById(usuario)
    .withGraphFetched('role');
  const podeReencaminharTodos = usuarioTemPermissaoLocal(usuarioSolicitante, 'futuros_clientes_ver_todos');

  const validacao = await LeadLinha.transaction(async trx => {
    const linha = await LeadLinha.query(trx).findById(id).forUpdate();
    const ultimaAtribuicao = linha ? await trx('lead_atribuicoes')
      .where({ lead_linha_id: id, etapa: 'venda' })
      .forUpdate()
      .orderBy('id', 'desc')
      .first('id', 'aceite_status') : null;
    const possuiAtribuicaoAtiva = [
      leadDistribuicaoService.ACEITE_AGUARDANDO,
      leadDistribuicaoService.ACEITE_ACEITO
    ].includes(ultimaAtribuicao?.aceite_status);
    const erro = obterErroEnvioFuturoClienteDistribuicao(linha, usuario, {
      podeReencaminharTodos,
      possuiAtribuicaoAtiva,
      possuiHistoricoDistribuicao: Boolean(ultimaAtribuicao)
    });
    if (erro) throw criarHttpError(erro.statusCode, erro.message);
    if (linha.futuro_cliente_destino !== DESTINO_FUTURO_CLIENTE_DISTRIBUICAO) {
      await LeadLinha.query(trx).patchAndFetchById(id, {
        futuro_cliente_destino: DESTINO_FUTURO_CLIENTE_DISTRIBUICAO,
        updated_at: new Date()
      });
    }
    return { possuiAtribuicaoAtiva };
  });

  const finalizacao = validacao.possuiAtribuicaoAtiva && podeReencaminharTodos
    ? await leadDistribuicaoService.finalizarAtribuicao(id, {
      aceiteStatus: leadDistribuicaoService.ACEITE_CANCELADO,
      motivo: 'Retornado ao Telegram pela visao de todos os futuros clientes',
      canceladoPorId: usuario,
      ignorarAcaoRegistrada: true,
      validarFuturoClienteAtivo: true,
      republicar: true
    })
    : null;

  const atualizada = await LeadLinha.query()
    .findById(id)
    .withGraphFetched('[planilha, envio, atribuidoPara, sondagem.[operadoraAtual, operadoraInteresse, usuario], enriquecimento]')
    .modifyGraph('atribuidoPara', builder => builder.select('id', 'nome', 'email'));
  const linhaFormatada = formatarLinha(atualizada);
  const publicacao = finalizacao
    ? finalizacao.publicacao
    : await publicarFuturoClienteTelegram(linhaFormatada, usuarioId);
  return { linha: linhaFormatada, publicacao };
}

function obterErroEnvioFuturoClienteDistribuicao(linha, usuarioId, opcoes = {}) {
  if (!linha || !linha.futuro_cliente || linha.futuro_cliente_excluido_em) {
    return { statusCode: 404, message: 'Futuro cliente nao encontrado.' };
  }
  const ehDono = Number(linha.futuro_cliente_marcado_por_id) === Number(usuarioId);
  const jaFoiEnviado = linha.futuro_cliente_destino === DESTINO_FUTURO_CLIENTE_DISTRIBUICAO
    || opcoes.possuiHistoricoDistribuicao;
  if ((!ehDono || jaFoiEnviado) && !opcoes.podeReencaminharTodos) {
    return { statusCode: 403, message: 'Voce nao pode distribuir este futuro cliente.' };
  }
  if (![DESTINO_FUTURO_CLIENTE_CARTEIRA, DESTINO_FUTURO_CLIENTE_DISTRIBUICAO].includes(linha.futuro_cliente_destino)
    && !opcoes.possuiHistoricoDistribuicao
    && !opcoes.podeReencaminharTodos) {
    return { statusCode: 409, message: 'Futuros clientes antigos permanecem na carteira e nao podem ser republicados por esta acao.' };
  }
  const devolucaoAdministrativaAtiva = opcoes.podeReencaminharTodos && opcoes.possuiAtribuicaoAtiva;
  const estadoAdministrativoDisponivel = opcoes.podeReencaminharTodos
    && !linha.status_operacional
    && linha.etapa_atual !== 'venda';
  if (linha.venda_id || linha.venda_recusada_em || linha.cliente_recusou
    || ['vendido', 'perdido'].includes(linha.status_operacional)
    || (!devolucaoAdministrativaAtiva && (
      linha.etapa_atual === 'venda'
      || (linha.status_operacional !== 'qualificado' && !estadoAdministrativoDisponivel)
      || opcoes.possuiAtribuicaoAtiva
    ))) {
    return { statusCode: 409, message: 'Este futuro cliente nao esta disponivel para distribuicao.' };
  }
  return null;
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
      aplicarEscopoCarteiraFuturosClientes(query, usuarioId);
    }
  } else if (usuarioId) {
    aplicarEscopoCarteiraFuturosClientes(query, usuarioId);
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
    .withGraphFetched('[planilha, envio, atribuidoPara, futuroClienteMarcadoPor, sondagem.[operadoraAtual, operadoraInteresse, usuario], enriquecimento]')
    .orderBy('futuro_cliente_marcado_em', 'desc')
    .orderBy('id', 'desc')
    .offset((page - 1) * pageSize)
    .limit(pageSize);

  const distribuicoes = await leadDistribuicaoService.obterDistribuicoesUsuario(
    linhas.map(linha => linha.id),
    usuarioId
  );

  const formatadas = linhas.map(linha => {
      const formatada = formatarLinha(linha);
      const distribuicao = distribuicoes.get(Number(linha.id));
      return usuarioId
        ? leadDistribuicaoService.ocultarDetalhesAntesDoAceite(formatada, distribuicao)
        : {
          ...formatada,
          distribuicao: leadDistribuicaoService.dadosDistribuicao(distribuicao),
          detalhes_bloqueados: false
        };
    });
  const classificadas = await adicionarClassificacaoVendas(formatadas);
  const data = usuarioId ? classificadas : classificadas.map(linha => ({
    ...linha,
    estado_atual: resolverEstadoAtualFuturoCliente(linha, linha.distribuicao)
  }));

  return {
    data,
    total,
    page,
    page_size: pageSize
  };
}

function normalizarCampoAcompanhamento(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function obterValorDadosAcompanhamento(dadosJson, termos = []) {
  const dados = parseJson(dadosJson, {});
  const entradas = Object.entries(dados || {});
  for (const termo of termos) {
    const encontrado = entradas.find(([chave, valor]) => valor && normalizarCampoAcompanhamento(chave).includes(termo));
    if (encontrado) return String(encontrado[1]).trim();
  }
  return '';
}

function montarQueryFuturosClientesComConsultoras(filtros = {}, usuarioId = null) {
  const query = db('lead_atribuicoes as la')
    .join('lead_linhas as ll', 'll.id', 'la.lead_linha_id')
    .leftJoin('lead_sondagens as ls', 'ls.lead_linha_id', 'll.id')
    .leftJoin('usuarios as u', 'u.id', 'la.usuario_id')
    .where('ll.futuro_cliente', true)
    .whereNull('ll.futuro_cliente_excluido_em')
    .where('la.etapa', 'venda')
    .whereIn('la.aceite_status', STATUS_DISTRIBUICAO_RESPONSAVEL)
    .whereNotExists(
      db('lead_atribuicoes as la_nova')
        .select(db.raw('1'))
        .whereRaw('la_nova.lead_linha_id = la.lead_linha_id')
        .where('la_nova.etapa', 'venda')
        .whereNotNull('la_nova.aceite_status')
        .whereRaw('la_nova.id > la.id')
    )
    .whereNull('ll.venda_id')
    .whereNull('ll.venda_recusada_em')
    .whereNull('ll.venda_recusada_motivo')
    .where(builder => builder.whereNull('ll.status_operacional').orWhereNotIn('ll.status_operacional', ['vendido', 'perdido']))
    .where(builder => builder.whereNull('ll.cliente_recusou').orWhere('ll.cliente_recusou', false))
    .where(builder => builder
      .whereNull('la.acao_registrada_em')
      .orWhere('la.acao_registrada_tipo', 'retorno_agendado'));

  if (usuarioId !== null && usuarioId !== undefined) {
    query.where('la.usuario_id', Number(usuarioId));
  }

  const busca = String(filtros.busca || '').trim().toLowerCase();
  if (busca) {
    const digitos = normalizarBuscaDocumento(busca);
    query.where(builder => {
      builder
        .whereRaw('LOWER(COALESCE(ls.razao_social, "")) LIKE ?', [`%${busca}%`])
        .orWhereRaw('LOWER(COALESCE(ls.cnpj, "")) LIKE ?', [`%${busca}%`])
        .orWhereRaw('LOWER(COALESCE(u.nome, "")) LIKE ?', [`%${busca}%`])
        .orWhereRaw('LOWER(CAST(ll.dados_json AS CHAR)) LIKE ?', [`%${busca}%`]);
      if (digitos) {
        builder.orWhereRaw(
          'REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(ls.cnpj, ""), ".", ""), "/", ""), "-", ""), " ", "") LIKE ?',
          [`%${digitos}%`]
        ).orWhereRaw(
          'REPLACE(REPLACE(REPLACE(REPLACE(CAST(ll.dados_json AS CHAR), ".", ""), "/", ""), "-", ""), " ", "") LIKE ?',
          [`%${digitos}%`]
        );
      }
    });
  }
  return query;
}

function formatarFuturoClienteComConsultora(item) {
  const atribuidoEm = parseUtcDateTime(item.atribuido_em);
  const retornoPrevisto = item.prazo_acao_em
    || (atribuidoEm ? leadDistribuicaoService.calcularPrazoAcao(atribuidoEm) : null);
  const retornoMarcado = item.acao_registrada_tipo === 'retorno_agendado';
  const situacao = item.aceite_status === leadDistribuicaoService.ACEITE_AGUARDANDO
    ? 'aguardando_aceite'
    : retornoMarcado ? 'retorno_marcado' : 'em_atendimento';

  return {
    id: Number(item.id),
    razao_social: String(item.razao_social || '').trim()
      || obterValorDadosAcompanhamento(item.dados_json, ['razao social', 'empresa', 'nome fantasia', 'nome'])
      || `Futuro cliente #${item.id}`,
    cnpj: String(item.cnpj || '').trim()
      || obterValorDadosAcompanhamento(item.dados_json, ['cnpj'])
      || 'Não informado',
    consultora: {
      id: Number(item.consultora_id) || null,
      nome: item.consultora_nome || 'Usuário removido'
    },
    situacao,
    retorno_previsto_em: retornoPrevisto
  };
}

/** Lista futuros clientes ainda sob responsabilidade de uma consultora. */
async function listarFuturosClientesComConsultoras(filtros = {}, usuarioId = null) {
  const page = Math.max(1, Number(filtros.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(filtros.page_size || 30)));
  const prazoMinutos = leadDistribuicaoService.prazoAcaoMinutos();
  const base = montarQueryFuturosClientesComConsultoras(filtros, usuarioId);
  const totalResultado = await base.clone().countDistinct({ total: 'la.id' }).first();
  const itens = await base.clone()
    .select(
      'll.id',
      'll.dados_json',
      'ls.razao_social',
      'ls.cnpj',
      'la.aceite_status',
      'la.atribuido_em',
      'la.prazo_acao_em',
      'la.acao_registrada_tipo',
      'u.id as consultora_id',
      'u.nome as consultora_nome'
    )
    .orderByRaw('COALESCE(la.prazo_acao_em, DATE_ADD(la.atribuido_em, INTERVAL ? MINUTE)) ASC', [prazoMinutos])
    .orderBy('la.id', 'asc')
    .offset((page - 1) * pageSize)
    .limit(pageSize);

  return {
    data: itens.map(formatarFuturoClienteComConsultora),
    total: Number(totalResultado?.total || 0),
    page,
    page_size: pageSize
  };
}

async function obterMetricasFuturosClientes(filtros = {}) {
  const usuarioResponsavel = expressaoPrimeiraLigacao('ll');
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
  wsResumo.getColumn(9).numFmt = FORMATO_PERCENTUAL_BR;
  wsResumo.getColumn(10).numFmt = FORMATO_MOEDA_BR;
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
  wsDiario.getColumn(10).numFmt = FORMATO_PERCENTUAL_BR;
  wsDiario.getColumn(11).numFmt = FORMATO_MOEDA_BR;
  estilizarPlanilhaProdutividade(wsDiario, 11);
  const sufixo = filtros.data_inicio || filtros.data_fim
    ? `${filtros.data_inicio || 'inicio'}-a-${filtros.data_fim || 'hoje'}`
    : 'todo-periodo';
  return {
    buffer: await workbook.xlsx.writeBuffer(),
    nome: `produtividade-primeira-ligacao-${sufixo}.xlsx`
  };
}

/** Retorna apenas os digitos quando o termo informado pode representar um documento. */
function normalizarBuscaDocumento(valor) {
  const busca = String(valor || '').trim();
  if (!busca || !/^[\d\s./-]+$/.test(busca)) return '';
  const digitos = busca.replace(/\D/g, '');
  return digitos.length >= 3 ? digitos : '';
}

/** Aplica busca textual no JSON e, para documentos, tambem ignora mascara e espacos. */
function aplicarBuscaDadosJson(query, busca, coluna = 'dados_json') {
  const termo = String(busca || '').trim().toLowerCase();
  if (!termo) return query;

  const digitos = normalizarBuscaDocumento(termo);
  return query.where(builder => {
    builder.whereRaw(`LOWER(CAST(${coluna} AS CHAR)) LIKE ?`, [`%${termo}%`]);
    if (digitos) {
      builder.orWhereRaw(
        `REPLACE(REPLACE(REPLACE(REPLACE(CAST(${coluna} AS CHAR), '.', ''), '/', ''), '-', ''), ' ', '') LIKE ?`,
        [`%${digitos}%`]
      );
    }
  });
}

/** Filtra mailings por nome ou por uma linha pertencente ao usuario autenticado. */
function aplicarBuscaMailingsUsuario(query, busca, usuarioId) {
  const termo = String(busca || '').trim().toLowerCase();
  if (!termo) return query;

  return query.where(builder => builder
    .whereRaw('LOWER(lead_envios.nome) LIKE ?', [`%${termo}%`])
    .orWhereExists(
      aplicarBuscaDadosJson(
        db('lead_linhas as ll_busca')
          .select(db.raw('1'))
          .whereRaw('ll_busca.envio_id = lead_envios.id')
          .where('ll_busca.atribuido_para_id', Number(usuarioId)),
        termo,
        'll_busca.dados_json'
      )
    ));
}

/** Lista somente mailings grandes recebidos pelo usuario, com busca e paginacao. */
async function listarMailingsDoUsuario(filtros = {}, usuarioId) {
  const page = Math.max(1, Number(filtros.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(filtros.page_size || 24)));
  const busca = String(filtros.busca || '').trim();
  const base = LeadEnvio.query()
    .whereNull('cancelado_em')
    .where('origem', 'mailing')
    .whereExists(
      LeadEnvioUsuario.query()
        .select(1)
        .whereRaw('lead_envio_usuarios.envio_id = lead_envios.id')
        .where('lead_envio_usuarios.usuario_id', usuarioId)
    );
  if (busca) aplicarBuscaMailingsUsuario(base, busca, usuarioId);
  const total = await base.clone().resultSize();
  const encontrados = await base
    .withGraphFetched('usuarios.usuario')
    .modifyGraph('usuarios.usuario', builder => builder.select('id', 'nome', 'email'))
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .offset((page - 1) * pageSize)
    .limit(pageSize);
  const ids = encontrados.map(item => Number(item.id));
  const metricas = ids.length ? await LeadLinha.query()
    .select('envio_id')
    .count('id as total_linhas')
    .select(db.raw('SUM(CASE WHEN (futuro_cliente = 1 AND futuro_cliente_excluido_em IS NULL) OR venda_recusada_em IS NOT NULL OR cliente_recusou = 1 OR chamada_nao_atendida = 1 THEN 1 ELSE 0 END) as total_trabalhados'))
    .select(db.raw('SUM(CASE WHEN cliente_recusou = 1 THEN 1 ELSE 0 END) as total_recusados'))
    .select(db.raw('SUM(CASE WHEN chamada_nao_atendida = 1 THEN 1 ELSE 0 END) as total_nao_atendidos'))
    .select(db.raw('SUM(CASE WHEN futuro_cliente = 1 AND futuro_cliente_excluido_em IS NULL THEN 1 ELSE 0 END) as total_futuros'))
    .whereIn('envio_id', ids)
    .where('atribuido_para_id', usuarioId)
    .groupBy('envio_id') : [];
  const porEnvio = new Map(metricas.map(item => [Number(item.envio_id), combinarMetricasEnvio({
    totalLinhas: item.total_linhas,
    totalTrabalhados: item.total_trabalhados,
    totalRecusados: item.total_recusados,
    totalNaoAtendidos: item.total_nao_atendidos,
    totalFuturos: item.total_futuros
  })]));
  const envios = encontrados.map(envio => {
    const formatado = formatarEnvio(envio);
    const resumo = porEnvio.get(Number(envio.id)) || combinarMetricasEnvio();
    return { ...formatado, total_linhas: resumo.totalLinhas, total_trabalhados: resumo.totalTrabalhados, total_recusados: resumo.totalRecusados, total_nao_atendidos: resumo.totalNaoAtendidos, total_futuros: resumo.totalFuturos, total_a_trabalhar: resumo.totalATrabalhar };
  });
  return {
    data: envios,
    total,
    page,
    page_size: pageSize
  };
}

function aplicarFiltroAceiteRecebidos(query, status) {
  const valor = String(status || 'acao').trim();
  if (valor === 'acao') {
    query.where(builder => builder
      .where('la.aceite_status', leadDistribuicaoService.ACEITE_AGUARDANDO)
      .orWhere(subquery => subquery
        .where('la.aceite_status', leadDistribuicaoService.ACEITE_ACEITO)
        .where(acao => acao
          .whereNull('la.acao_registrada_em')
          .orWhere('la.acao_registrada_tipo', 'retorno_agendado'))));
  } else if (valor === 'encerrado') {
    query.whereNotNull('la.acao_registrada_em')
      .where(builder => builder
        .whereNull('la.acao_registrada_tipo')
        .orWhereNot('la.acao_registrada_tipo', 'retorno_agendado'));
  } else if (valor && valor !== 'todos') {
    query.where('la.aceite_status', valor);
  }
  return query;
}

/** Lista cada encaminhamento de futuro cliente recebido pelo Telegram. */
async function listarFuturosClientesRecebidos(filtros = {}, usuarioId) {
  const page = Math.max(1, Number(filtros.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(filtros.page_size || 30)));
  const base = db('lead_atribuicoes as la')
    .leftJoin('lead_envios as le', 'le.id', 'la.envio_id')
    .where('la.usuario_id', Number(usuarioId))
    .where('la.etapa', 'venda')
    .whereNotNull('la.aceite_status');
  aplicarFiltroAceiteRecebidos(base, filtros.status);
  const linhaId = Number(filtros.linha_id || 0);
  if (linhaId > 0) base.where('la.lead_linha_id', linhaId);

  const busca = String(filtros.busca || '').trim().toLowerCase();
  if (busca) {
    base.where(builder => builder
      .whereRaw('LOWER(COALESCE(le.nome, "")) LIKE ?', [`%${busca}%`])
      .orWhereExists(
        db('lead_linhas as ll_busca')
          .select(db.raw('1'))
          .whereRaw('ll_busca.id = la.lead_linha_id')
          .whereRaw('LOWER(CAST(ll_busca.dados_json AS CHAR)) LIKE ?', [`%${busca}%`])
      ));
  }

  const totalResultado = await base.clone().count({ total: 'la.id' }).first();
  const atribuicoes = await base.clone()
    .select('la.*', 'le.nome as envio_nome', 'le.created_at as envio_created_at')
    .orderBy('la.atribuido_em', 'desc')
    .orderBy('la.id', 'desc')
    .offset((page - 1) * pageSize)
    .limit(pageSize);
  const linhas = atribuicoes.length
    ? await LeadLinha.query().findByIds(atribuicoes.map(item => Number(item.lead_linha_id)))
      .withGraphFetched('[planilha, envio, atribuidoPara, sondagem.[operadoraAtual, operadoraInteresse, usuario], enriquecimento]')
    : [];
  const linhasPorId = new Map(linhas.map(linha => [Number(linha.id), linha]));
  const formatadas = atribuicoes.flatMap(atribuicao => {
    const linha = linhasPorId.get(Number(atribuicao.lead_linha_id));
    if (!linha) return [];
    const distribuicao = leadDistribuicaoService.dadosDistribuicao(atribuicao);
    const aceita = Boolean(atribuicao.aceite_em);
    if (!aceita) {
      return [{
        id: linha.id,
        atribuicao_id: Number(atribuicao.id),
        futuro_cliente: true,
        futuro_cliente_marcado_em: linha.futuro_cliente_marcado_em,
        recebido_em: atribuicao.atribuido_em,
        status_operacional: linha.status_operacional,
        dados_json: {},
        sondagem: null,
        envio: { id: atribuicao.envio_id, nome: atribuicao.envio_nome || 'Indicacao recebida' },
        distribuicao,
        detalhes_bloqueados: true
      }];
    }
    return [{
      ...formatarLinha(linha),
      atribuicao_id: Number(atribuicao.id),
      recebido_em: atribuicao.atribuido_em,
      distribuicao,
      detalhes_bloqueados: false
    }];
  });
  return {
    data: await adicionarClassificacaoVendas(formatadas),
    total: Number(totalResultado?.total || 0),
    page,
    page_size: pageSize
  };
}

const STATUS_ATRIBUICAO_ATIVOS = new Set([
  leadDistribuicaoService.ACEITE_AGUARDANDO,
  leadDistribuicaoService.ACEITE_ACEITO
]);

function usuarioResumo(id, nome, fallback = null) {
  const usuarioId = Number(id) || null;
  if (!usuarioId && !nome) return fallback;
  return { id: nome ? usuarioId : null, nome: nome || 'Usuário removido' };
}

function motivoDevolucao(distribuicao) {
  return distribuicao?.cancelamento_motivo || distribuicao?.motivo_resultado || null;
}

function resolverEstadoAtualFuturoCliente(linha, distribuicao = null) {
  const responsavelCarteira = usuarioResumo(
    linha?.atribuidoPara?.id || linha?.atribuido_para_id || linha?.futuroClienteMarcadoPor?.id || linha?.futuro_cliente_marcado_por_id,
    linha?.atribuidoPara?.nome || linha?.futuroClienteMarcadoPor?.nome || linha?.sondagem?.usuario?.nome
  );
  const responsavelDistribuicao = usuarioResumo(distribuicao?.usuario_id, distribuicao?.usuario_nome);
  const ultimoRetorno = distribuicao && !STATUS_ATRIBUICAO_ATIVOS.has(distribuicao.status) ? {
    codigo: distribuicao.status,
    motivo: motivoDevolucao(distribuicao),
    em: distribuicao.finalizado_em || distribuicao.recusado_em || null,
    responsavel: responsavelDistribuicao
  } : null;
  const base = {
    responsavel: null,
    desde_em: null,
    prazo_em: null,
    retorno_em: linha?.retorno_agendado_em || linha?.futuro_cliente_retorno || null,
    ultimo_retorno: ultimoRetorno,
    final: false
  };

  if (linha?.venda_id || linha?.status_operacional === 'vendido' || linha?.venda_classificacao?.tipo === 'venda_futuro_cliente') {
    return { ...base, codigo: 'venda_registrada', rotulo: 'Venda registrada', etapa: 'Finalizado', responsavel: responsavelCarteira, final: true };
  }
  if (linha?.cliente_recusou) {
    return { ...base, codigo: 'cliente_recusou', rotulo: 'Cliente recusou', etapa: 'Finalizado', responsavel: responsavelCarteira, final: true };
  }
  if (linha?.venda_recusada_em || linha?.status_operacional === 'perdido') {
    return { ...base, codigo: 'venda_recusada', rotulo: 'Venda recusada', etapa: 'Finalizado', responsavel: responsavelCarteira, final: true };
  }
  if (distribuicao?.status === leadDistribuicaoService.ACEITE_AGUARDANDO) {
    return { ...base, codigo: 'aguardando_aceite', rotulo: 'Aguardando aceite', etapa: 'Telegram', responsavel: responsavelDistribuicao, desde_em: distribuicao.atribuido_em, prazo_em: distribuicao.prazo_acao_em };
  }
  if (distribuicao?.status === leadDistribuicaoService.ACEITE_ACEITO) {
    const retorno = base.retorno_em && !linha?.retorno_agendado_realizado_em && !linha?.futuro_cliente_retorno_realizado_em;
    return { ...base, codigo: retorno ? 'retorno_marcado' : 'em_atendimento', rotulo: retorno ? 'Retorno marcado' : 'Em atendimento', etapa: 'Negociação', responsavel: responsavelDistribuicao, desde_em: distribuicao.aceite_em || distribuicao.atribuido_em, prazo_em: distribuicao.prazo_acao_em };
  }
  if (base.retorno_em && !linha?.retorno_agendado_realizado_em && !linha?.futuro_cliente_retorno_realizado_em) {
    return { ...base, codigo: 'retorno_marcado', rotulo: 'Retorno marcado', etapa: 'Acompanhamento', responsavel: responsavelCarteira };
  }
  if (linha?.futuro_cliente_destino === 'distribuicao') {
    return { ...base, codigo: ultimoRetorno ? 'devolvido' : 'disponivel_distribuicao', rotulo: ultimoRetorno ? 'Devolvido' : 'Disponível para distribuição', etapa: 'Telegram' };
  }
  return { ...base, codigo: 'na_carteira', rotulo: 'Na carteira', etapa: 'Qualificação', responsavel: responsavelCarteira, desde_em: linha?.futuro_cliente_marcado_em || null };
}

const AUDITORIAS_JORNADA = new Map([
  ['lead_linha.futuro_cliente_marcado', null],
  ['lead_linha.futuro_cliente_marcado_admin', null],
  ['lead_linha.futuro_cliente_atualizado', ['atualizacao', 'Dados do futuro cliente atualizados']],
  ['lead_linha.futuro_cliente_atualizado_admin', ['atualizacao', 'Dados do futuro cliente atualizados']],
  ['lead_linha.futuro_cliente_enviado_distribuicao', ['reencaminhamento', 'Encaminhado ao Telegram']],
  ['lead_linha.retorno_marcado', ['retorno_marcado', 'Retorno marcado']],
  ['lead_linha.retorno_marcado_admin', ['retorno_marcado', 'Retorno marcado']],
  ['lead_linha.chamada_nao_atendida', ['chamada_nao_atendida', 'Chamada não atendida']],
  ['lead_linha.chamada_nao_atendida_admin', ['chamada_nao_atendida', 'Chamada não atendida']],
  ['lead_linha.chamada_nao_atendida_revertida', ['reversao', 'Chamada não atendida revertida']],
  ['lead_linha.chamada_nao_atendida_revertida_admin', ['reversao', 'Chamada não atendida revertida']],
  ['lead_linha.cliente_recusou', ['cliente_recusou', 'Cliente recusou']],
  ['lead_linha.cliente_recusou_admin', ['cliente_recusou', 'Cliente recusou']],
  ['lead_linha.cliente_recusou_revertido', ['reversao', 'Recusa do cliente revertida']],
  ['lead_linha.cliente_recusou_revertido_admin', ['reversao', 'Recusa do cliente revertida']],
  ['lead_linha.venda_recusada', ['venda_recusada', 'Venda recusada']],
  ['lead_linha.venda_recusada_admin', ['venda_recusada', 'Venda recusada']],
  ['lead_linha.venda_recusada_revertida', ['reversao', 'Recusa da venda revertida']],
  ['lead_linha.venda_recusada_revertida_admin', ['reversao', 'Recusa da venda revertida']],
  ['lead_linha.venda_vinculada_manual', ['venda_registrada', 'Venda registrada']],
  ['lead_linha.venda_desvinculada_manual', ['reversao', 'Vínculo da venda removido']]
]);

const AUDITORIAS_REGISTRO_FUTURO_CLIENTE = new Set([
  'lead_linha.futuro_cliente_marcado',
  'lead_linha.futuro_cliente_marcado_admin'
]);

function nomeUsuarioRegistro(registro, prefixo = 'usuario') {
  const id = registro?.[`${prefixo}_id`];
  const nome = registro?.[`${prefixo}_nome`];
  if (!id && !nome) return null;
  return usuarioResumo(id, nome);
}

function montarEventosHistoricoFuturoCliente(linha, atribuicoes = [], auditorias = [], venda = null) {
  const eventos = [];
  const tiposAuditoria = new Set();
  let encontrouAuditoriaRegistro = false;
  for (const audit of auditorias) {
    const dados = parseJson(audit.dados, {});
    let configuracao = AUDITORIAS_JORNADA.get(audit.acao);
    if (AUDITORIAS_REGISTRO_FUTURO_CLIENTE.has(audit.acao)) {
      if (!encontrouAuditoriaRegistro) {
        encontrouAuditoriaRegistro = true;
        continue;
      }
      configuracao = ['atualizacao', 'Dados do futuro cliente atualizados'];
    }
    if (!configuracao) continue;
    const [tipo, titulo] = configuracao;
    tiposAuditoria.add(tipo);
    eventos.push({
      tipo,
      data: dados.ocorrido_em || audit.created_at,
      titulo,
      detalhe: dados.observacao || dados.detalhe || null,
      motivo: dados.motivo || null,
      usuario: nomeUsuarioRegistro(audit),
      destinatario: null
    });
  }

  for (const atribuicao of atribuicoes) {
    const destinatario = nomeUsuarioRegistro(atribuicao);
    const criador = nomeUsuarioRegistro(atribuicao, 'criador');
    eventos.push({
      tipo: 'atribuicao', data: atribuicao.atribuido_em || atribuicao.created_at,
      titulo: atribuicao.etapa === 'sondagem' ? 'Recebido para qualificação' : 'Encaminhado para atendimento',
      detalhe: atribuicao.etapa === 'venda' && !destinatario ? 'Distribuição gerenciada pelo Telegram' : null,
      motivo: null, usuario: criador, destinatario: destinatario || (atribuicao.etapa === 'venda' ? { id: null, nome: 'Gerência via Telegram' } : null)
    });
    if (atribuicao.etapa === 'venda' && atribuicao.aceite_em) {
      eventos.push({ tipo: 'aceite', data: atribuicao.aceite_em, titulo: 'Atendimento aceito', detalhe: null, motivo: null, usuario: destinatario, destinatario: null });
    }
    if (atribuicao.etapa === 'venda' && !STATUS_ATRIBUICAO_ATIVOS.has(atribuicao.aceite_status) && atribuicao.finalizado_em) {
      eventos.push({
        tipo: 'devolucao', data: atribuicao.finalizado_em, titulo: 'Devolvido para novo encaminhamento',
        detalhe: null, motivo: motivoDevolucao(atribuicao), usuario: destinatario, destinatario: null
      });
    }
  }

  eventos.push({
    tipo: 'registro',
    data: linha.futuro_cliente_marcado_em || linha.created_at,
    titulo: 'Futuro cliente registrado',
    detalhe: encontrouAuditoriaRegistro ? null : 'Registro recuperado de dados anteriores ao histórico.',
    motivo: null,
    usuario: usuarioResumo(linha.futuro_cliente_marcado_por_id, linha.futuroClienteMarcadoPor?.nome),
    destinatario: null
  });
  const retornoMarcado = linha.retorno_agendado_em || linha.futuro_cliente_retorno;
  if (retornoMarcado && !tiposAuditoria.has('retorno_marcado')) {
    eventos.push({
      tipo: 'retorno_marcado', data: linha.updated_at || linha.futuro_cliente_marcado_em,
      titulo: 'Retorno marcado', detalhe: 'Retorno recuperado de um registro anterior ao histórico.',
      motivo: linha.retorno_agendado_observacao || null,
      usuario: usuarioResumo(linha.retorno_agendado_por_id || linha.futuro_cliente_marcado_por_id, null), destinatario: null
    });
  }
  const retornoRealizadoEm = linha.retorno_agendado_realizado_em || linha.futuro_cliente_retorno_realizado_em;
  if (retornoRealizadoEm) {
    eventos.push({
      tipo: 'retorno_realizado', data: retornoRealizadoEm, titulo: 'Retorno realizado', detalhe: null, motivo: null,
      usuario: usuarioResumo(linha.retorno_agendado_realizado_por_id || linha.futuro_cliente_retorno_realizado_por_id, null), destinatario: null
    });
  }
  if (linha.cliente_recusou && !tiposAuditoria.has('cliente_recusou')) {
    eventos.push({ tipo: 'cliente_recusou', data: linha.cliente_recusou_em || linha.updated_at, titulo: 'Cliente recusou', detalhe: null, motivo: linha.cliente_recusou_motivo || null, usuario: usuarioResumo(linha.cliente_recusou_por_id, null), destinatario: null });
  }
  if ((linha.venda_recusada_em || linha.status_operacional === 'perdido') && !tiposAuditoria.has('venda_recusada')) {
    eventos.push({ tipo: 'venda_recusada', data: linha.venda_recusada_em || linha.updated_at, titulo: 'Venda recusada', detalhe: null, motivo: linha.venda_recusada_motivo || null, usuario: usuarioResumo(linha.venda_recusada_por_id, null), destinatario: null });
  }
  if ((venda || linha.venda_id || linha.status_operacional === 'vendido') && !tiposAuditoria.has('venda_registrada')) {
    eventos.push({ tipo: 'venda_registrada', data: venda?.created_at || venda?.data_venda || linha.updated_at, titulo: 'Venda registrada', detalhe: null, motivo: null, usuario: usuarioResumo(venda?.criado_por_id, venda?.usuario_nome), destinatario: null });
  }
  return eventos
    .filter(evento => evento.data)
    .sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime());
}

async function obterHistoricoFuturoCliente(linhaId) {
  const id = Number(linhaId);
  const linha = Number.isInteger(id) && id > 0 ? await LeadLinha.query()
    .findById(id)
    .where('futuro_cliente', true)
    .whereNull('futuro_cliente_excluido_em')
    .withGraphFetched('[atribuidoPara, futuroClienteMarcadoPor, sondagem.usuario]') : null;
  if (!linha) {
    const error = new Error('Futuro cliente não encontrado.');
    error.statusCode = 404;
    throw error;
  }
  const atribuicoes = await db('lead_atribuicoes as la')
    .leftJoin('usuarios as u', 'u.id', 'la.usuario_id')
    .leftJoin('usuarios as uc', 'uc.id', 'la.criado_por_id')
    .where('la.lead_linha_id', id)
    .select('la.*', 'u.nome as usuario_nome', 'uc.nome as criador_nome')
    .orderBy('la.id', 'asc');
  const auditorias = await db('audit_logs as al')
    .leftJoin('usuarios as u', 'u.id', 'al.usuario_id')
    .where('al.entidade', 'lead_linhas')
    .where('al.entidade_id', String(id))
    .whereIn('al.acao', [...AUDITORIAS_JORNADA.keys()])
    .select('al.*', 'u.nome as usuario_nome')
    .orderBy('al.id', 'asc');
  const venda = await db('vendas as v')
    .leftJoin('usuarios as u', 'u.id', 'v.criado_por_id')
    .where(builder => builder.where('v.id', Number(linha.venda_id) || 0).orWhere('v.origem_lead_linha_id', id))
    .select('v.id', 'v.created_at', 'v.data_venda', 'v.criado_por_id', 'u.nome as usuario_nome')
    .orderBy('v.id', 'desc').first();
  const ultimaDistribuicao = atribuicoes.filter(item => item.etapa === 'venda').at(-1) || null;
  const formatada = (await adicionarClassificacaoVendas([formatarLinha(linha)]))[0];
  return {
    linha_id: id,
    estado_atual: resolverEstadoAtualFuturoCliente(formatada, ultimaDistribuicao),
    eventos: montarEventosHistoricoFuturoCliente(formatada, atribuicoes, auditorias, venda)
  };
}

/** Lista usuarios que podem aparecer como responsaveis atuais ou historicos. */
async function listarResponsaveisFuturosClientes() {
  return Usuario.query()
    .select('usuarios.id', 'usuarios.nome', 'usuarios.ativo')
    .where(builder => builder
      .whereExists(
        LeadLinha.query()
          .select(1)
          .whereRaw('lead_linhas.futuro_cliente = true')
          .whereRaw(`(lead_linhas.atribuido_para_id = usuarios.id OR lead_linhas.futuro_cliente_marcado_por_id = usuarios.id OR ${expressaoPrimeiraLigacao('lead_linhas')} = usuarios.id)`)
      )
      .orWhereExists(
        db('lead_atribuicoes as la_responsaveis')
          .join('lead_linhas as ll_responsaveis', 'll_responsaveis.id', 'la_responsaveis.lead_linha_id')
          .select(db.raw('1'))
          .whereRaw('la_responsaveis.usuario_id = usuarios.id')
          .where('la_responsaveis.etapa', 'venda')
          .where('ll_responsaveis.futuro_cliente', true)
      ))
    .orderBy('usuarios.ativo', 'desc')
    .orderBy('usuarios.nome', 'asc');
}

const { obterEstatisticasResumo, obterEstatisticasMailings, obterEstatisticasLinhas, gerarXlsxEstatisticasFuturosClientes } = require('./lead-estatisticas.service');

function subtrairMesesUtc(valor, meses) {
  const data = parseUtcDateTime(valor);
  if (!data) return null;
  const resultado = new Date(data);
  const dia = resultado.getUTCDate();
  resultado.setUTCDate(1);
  resultado.setUTCMonth(resultado.getUTCMonth() - Number(meses || 0));
  const ultimoDia = new Date(Date.UTC(
    resultado.getUTCFullYear(),
    resultado.getUTCMonth() + 1,
    0
  )).getUTCDate();
  resultado.setUTCDate(Math.min(dia, ultimoDia));
  return resultado;
}

function selecionarVendaAntiga(linha, anterioresPorCnpj) {
  const recebidoEm = linha.mailing_recebido_em || linha.recebido_em || linha.envio?.created_at || linha.created_at;
  const limite = subtrairMesesUtc(recebidoEm, 24);
  const recebido = parseUtcDateTime(recebidoEm);
  let anterior = null;
  if (!limite || !recebido) return null;
  for (const cnpj of extrairCnpjsLinha(linha)) {
    const candidata = (anterioresPorCnpj.get(cnpj) || [])
      .filter(venda => {
        const concluida = parseUtcDateTime(venda.entrada_etapa_final_em);
        return concluida && concluida > limite && concluida < recebido;
      })
      .sort((a, b) => new Date(b.entrada_etapa_final_em) - new Date(a.entrada_etapa_final_em))[0];
    if (candidata && (!anterior || new Date(candidata.entrada_etapa_final_em) > new Date(anterior.entrada_etapa_final_em))) anterior = candidata;
  }
  return anterior;
}

function sqlEntradaEtapaFinal(aliasVenda) {
  const alias = aliasVenda === 'v' ? 'v' : 'vendas';
  return `(
    SELECT MAX(vh.created_at)
    FROM venda_historicos vh
    WHERE vh.venda_id = ${alias}.id AND vh.status_novo = ?
  )`;
}

/**
 * Adiciona a classificacao canonica da venda a linhas ja formatadas.
 * A venda originada pelo futuro cliente sempre prevalece sobre uma venda
 * anterior do mesmo CNPJ.
 */
async function adicionarClassificacaoVendas(linhas = []) {
  if (!linhas.length) return linhas;

  const linhaIds = [...new Set(linhas.map(linha => Number(linha.id)).filter(Boolean))];
  const vendaIds = [...new Set(linhas.map(linha => Number(linha.venda_id)).filter(Boolean))];
  const cnpjs = new Set();
  linhas.forEach(linha => extrairCnpjsLinha(linha).forEach(cnpj => cnpjs.add(cnpj)));
  const recebimentosMailing = linhaIds.length ? await db('lead_atribuicoes')
    .whereIn('lead_linha_id', linhaIds)
    .where('etapa', 'sondagem')
    .select('lead_linha_id')
    .min({ recebido_em: 'atribuido_em' })
    .groupBy('lead_linha_id') : [];
  const recebimentoPorLinha = new Map(recebimentosMailing.map(item => [Number(item.lead_linha_id), item.recebido_em]));
  const etapaFinal = await db('funil_etapas')
    .where('etapa_final', true)
    .orderBy('ativo', 'desc')
    .orderBy('ordem', 'asc')
    .first('codigo');
  const codigoEtapaFinal = etapaFinal?.codigo || 'concluido';

  const vendasVinculadas = vendaIds.length || linhaIds.length
    ? await db('vendas').where(builder => {
      if (vendaIds.length) builder.whereIn('id', vendaIds);
      if (linhaIds.length) {
        const metodo = vendaIds.length ? 'orWhereIn' : 'whereIn';
        builder[metodo]('origem_lead_linha_id', linhaIds);
      }
    })
      .select('id', 'origem_lead_linha_id', 'data_venda', 'valor_total')
      .select(db.raw(`${sqlEntradaEtapaFinal('vendas')} AS entrada_etapa_final_em`, [codigoEtapaFinal]))
    : [];
  const vinculadasPorId = new Map(vendasVinculadas.map(venda => [Number(venda.id), venda]));
  const vinculadasPorLinha = new Map(vendasVinculadas
    .filter(venda => Number(venda.origem_lead_linha_id))
    .map(venda => [Number(venda.origem_lead_linha_id), venda]));

  const vendasAnteriores = cnpjs.size
    ? await db('clientes as c')
      .join('vendas as v', 'v.cliente_id', 'c.id')
      .whereIn('c.cnpj_digitos', [...cnpjs])
      .whereNull('v.excluido_em')
      .whereNull('v.cancelada_em')
      .where('v.status_funil', codigoEtapaFinal)
      .whereExists(
        db('venda_historicos as vh')
          .select(db.raw('1'))
          .whereRaw('vh.venda_id = v.id')
          .where('vh.status_novo', codigoEtapaFinal)
      )
      .select(
        'c.cnpj_digitos',
        'v.id',
        'v.data_venda',
        'v.valor_total'
      )
      .select(db.raw(`${sqlEntradaEtapaFinal('v')} AS entrada_etapa_final_em`, [codigoEtapaFinal]))
    : [];
  const anterioresPorCnpj = new Map();
  vendasAnteriores.forEach(venda => {
    const chave = String(venda.cnpj_digitos || '');
    if (!anterioresPorCnpj.has(chave)) anterioresPorCnpj.set(chave, []);
    anterioresPorCnpj.get(chave).push(venda);
  });

  return linhas.map(linha => {
    const linhaClassificada = {
      ...linha,
      mailing_recebido_em: linha.mailing_recebido_em || recebimentoPorLinha.get(Number(linha.id)) || linha.envio?.created_at || null
    };
    const vendaId = Number(linha.venda_id || 0);
    const venda = vinculadasPorLinha.get(Number(linha.id)) || vinculadasPorId.get(vendaId);
    if (venda || vendaId || linha.status_operacional === 'vendido') {
      return {
        ...linhaClassificada,
        venda_classificacao: {
          tipo: 'venda_futuro_cliente',
          venda_id: Number(venda?.id || vendaId) || null,
          concluida_em: venda?.entrada_etapa_final_em || venda?.data_venda || null,
          valor_total: venda?.valor_total == null ? null : Number(venda.valor_total)
        }
      };
    }

    const anterior = selecionarVendaAntiga(linhaClassificada, anterioresPorCnpj);

    return {
      ...linhaClassificada,
      venda_classificacao: anterior ? {
        tipo: 'venda_antiga_registrada',
        venda_id: Number(anterior.id),
        concluida_em: anterior.entrada_etapa_final_em,
        valor_total: anterior.valor_total == null ? null : Number(anterior.valor_total)
      } : null
    };
  });
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
    await desativarAlertasObrigatoriosDaLinha(linha.id, trx);
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
    await LeadLinha.query(trx).patchAndFetchById(linha.id, montarPatchReversaoVendaRecusada(linha));

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

function montarPatchReversaoVendaRecusada(linha) {
  const futuroClienteAtivo = Boolean(linha?.futuro_cliente && !linha?.futuro_cliente_excluido_em);
  return {
    venda_recusada_motivo: null,
    venda_recusada_em: null,
    venda_recusada_por_id: null,
    status_operacional: futuroClienteAtivo ? 'qualificado' : 'pendente'
  };
}

/** Busca o detalhe de um futuro cliente dentro do escopo de acompanhamento permitido. */
async function buscarFuturoClienteEmAcompanhamento(linhaId, usuarioId = null) {
  const item = await montarQueryFuturosClientesComConsultoras({}, usuarioId)
    .where('ll.id', Number(linhaId))
    .select('ll.id')
    .first();

  if (!item) throw criarHttpError(404, 'Futuro cliente não encontrado em acompanhamento.');

  if (usuarioId === null || usuarioId === undefined) {
    return buscarLinhaFormatada(item.id, { incluirEstadoAtual: true });
  }

  const resultado = await buscarLinhaFormatada(item.id);
  const distribuicoes = await leadDistribuicaoService.obterDistribuicoesUsuario([item.id], usuarioId);
  return {
    linha: leadDistribuicaoService.ocultarDetalhesAntesDoAceite(
      resultado.linha,
      distribuicoes.get(Number(item.id))
    )
  };
}

/**
 * Busca a linha e recarrega com os relacionamentos usados pelo frontend.
 */
async function buscarLinhaFormatada(linhaId, opcoes = {}) {
  const atualizada = await LeadLinha.query()
    .findById(Number(linhaId))
    .withGraphFetched('[planilha, envio, atribuidoPara, sondagem.[operadoraAtual, operadoraInteresse, usuario], enriquecimento]')
    .modifyGraph('atribuidoPara', builder => builder.select('id', 'nome', 'email'));

  const formatada = formatarLinha(atualizada);
  if (!opcoes.incluirEstadoAtual || !formatada?.futuro_cliente) {
    return { linha: formatada };
  }

  const [classificada] = await adicionarClassificacaoVendas([formatada]);
  const distribuicoes = await leadDistribuicaoService.obterDistribuicoesUsuario([classificada.id], null);
  const distribuicao = leadDistribuicaoService.dadosDistribuicao(distribuicoes.get(Number(classificada.id)));
  const linha = {
    ...classificada,
    distribuicao,
    detalhes_bloqueados: false
  };

  return {
    linha: {
      ...linha,
      estado_atual: resolverEstadoAtualFuturoCliente(linha, distribuicao)
    }
  };
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

  let prazoRetornoDistribuicaoAtualizado = false;
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

    prazoRetornoDistribuicaoAtualizado = Boolean(await leadDistribuicaoService.atualizarPrazoRetorno(
      linha.id,
      donoId,
      retorno,
      trx
    ));
  });

  await sincronizarNotificacaoRetornoLead(linha.id);

  if (prazoRetornoDistribuicaoAtualizado && retorno && retornoAlterado) {
    await leadDistribuicaoService.notificarRetornoAgendadoTelegram(linha.id, retorno);
  }

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
    await LeadLinha.transaction(async trx => {
      const atual = await LeadLinha.query(trx).findById(linha.id).forUpdate();
      if (atual[configuracao.campoEm]) return;
      const ocorridoEm = formatarDateTimeSQL();
      await LeadLinha.query(trx).patchAndFetchById(linha.id, {
        [configuracao.campoEm]: ocorridoEm,
        [configuracao.campoPor]: Number(usuarioId)
      });
      await require('./audit-log.service').registrar(null, {
        usuario_id: Number(usuarioId), acao: 'lead_linha.retorno_realizado',
        entidade: 'lead_linhas', entidade_id: String(linha.id),
        dados: { origem, ocorrido_em: ocorridoEm }
      }, trx);
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
async function desativarAlertasObrigatoriosDaLinha(linhaId, trx = null) {
  await require('./notificacao.service').desativarAlertasObrigatoriosDaLinha(linhaId, trx);
}

/**
 * Limpa futuros clientes vencidos da lixeira e restaura o estado inicial.
 */
function montarPatchExclusaoFuturoCliente(agora = new Date()) {
  return {
    futuro_cliente: false,
    futuro_cliente_notas: null,
    futuro_cliente_retorno: null,
    futuro_cliente_retorno_realizado_em: null,
    futuro_cliente_retorno_realizado_por_id: null,
    futuro_cliente_marcado_em: null,
    futuro_cliente_marcado_por_id: null,
    futuro_cliente_destino: null,
    futuro_cliente_excluido_em: null,
    futuro_cliente_excluir_definitivo_em: null,
    futuro_cliente_excluido_por_id: null,
    updated_at: formatarDateTimeSQL(agora)
  };
}

function obterResponsavelEscopoLixeira(usuarioId, { todos = false } = {}) {
  return todos ? null : Number(usuarioId);
}

function calcularVencimentoLixeiraFuturoCliente(agora) {
  return adicionarDias(agora, 30);
}

async function limparFuturosClientesVencidosDaLixeira(usuarioId = null) {
  const query = db('lead_linhas')
    .where('futuro_cliente', true)
    .whereNotNull('futuro_cliente_excluido_em')
    .where('futuro_cliente_excluir_definitivo_em', '<=', formatarDateTimeSQL());

  if (usuarioId) {
    query.where('futuro_cliente_marcado_por_id', Number(usuarioId));
  }

  return query.update(montarPatchExclusaoFuturoCliente());
}

/**
 * Lista futuros clientes lixeira conforme os filtros e parametros informados.
 */
async function listarFuturosClientesLixeira(filtros = {}, usuarioId, { todos = false } = {}) {
  const responsavelId = obterResponsavelEscopoLixeira(usuarioId, { todos });
  await limparFuturosClientesVencidosDaLixeira(responsavelId);

  const page = Math.max(1, Number(filtros.page || 1));
  const pageSize = Math.min(500, Math.max(1, Number(filtros.page_size || 50)));

  let query = LeadLinha.query()
    .withGraphFetched('[planilha, envio, atribuidoPara, futuroClienteMarcadoPor, sondagem.usuario, futuroClienteExcluidoPor]')
    .modifyGraph('futuroClienteExcluidoPor', builder => builder.select('id', 'nome', 'email'))
    .where('futuro_cliente', true)
    .whereNotNull('futuro_cliente_excluido_em');

  if (responsavelId !== null) query.where('futuro_cliente_marcado_por_id', responsavelId);

  query = aplicarBuscaFuturosClientes(query, filtros.busca);
  query = aplicarFiltrosFuturosClientes(query, filtros);

  const total = await query.clone().resultSize();
  const linhas = await query
    .orderBy('futuro_cliente_excluido_em', 'desc')
    .orderBy('id', 'desc')
    .offset((page - 1) * pageSize)
    .limit(pageSize);

  let data = linhas.map(formatarLinha);
  if (todos) {
    const distribuicoes = await leadDistribuicaoService.obterDistribuicoesUsuario(
      linhas.map(linha => linha.id),
      null
    );
    data = data.map(linha => ({
      ...linha,
      estado_atual: resolverEstadoAtualFuturoCliente(
        linha,
        leadDistribuicaoService.dadosDistribuicao(distribuicoes.get(Number(linha.id)))
      )
    }));
  }

  return {
    data,
    total,
    page,
    page_size: pageSize
  };
}

/**
 * Envia futuro cliente para lixeira para processamento.
 */
async function enviarFuturoClienteParaLixeira(linhaId, usuarioId, { todos = false } = {}) {
  const agora = new Date();
  const responsavelId = obterResponsavelEscopoLixeira(usuarioId, { todos });

  const query = db('lead_linhas')
    .where('id', Number(linhaId))
    .where('futuro_cliente', true)
    .whereNull('futuro_cliente_excluido_em');

  if (responsavelId !== null) query.where('futuro_cliente_marcado_por_id', responsavelId);

  return query.update({
      futuro_cliente_excluido_em: formatarDateTimeSQL(agora),
      futuro_cliente_excluir_definitivo_em: formatarDateTimeSQL(calcularVencimentoLixeiraFuturoCliente(agora)),
      futuro_cliente_excluido_por_id: usuarioId,
      updated_at: formatarDateTimeSQL(agora)
    });
}

/**
 * Restaura futuro cliente quando a regra de negocio permite.
 */
async function restaurarFuturoCliente(linhaId, usuarioId, { todos = false } = {}) {
  const responsavelId = obterResponsavelEscopoLixeira(usuarioId, { todos });
  const query = db('lead_linhas')
    .where('id', Number(linhaId))
    .where('futuro_cliente', true)
    .whereNotNull('futuro_cliente_excluido_em');

  if (responsavelId !== null) query.where('futuro_cliente_marcado_por_id', responsavelId);

  const atualizados = await query.update({
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
async function excluirFuturoClienteDefinitivo(linhaId, usuarioId, { todos = false } = {}) {
  const responsavelId = obterResponsavelEscopoLixeira(usuarioId, { todos });
  const query = db('lead_linhas')
    .where('id', Number(linhaId))
    .where('futuro_cliente', true)
    .whereNotNull('futuro_cliente_excluido_em');

  if (responsavelId !== null) query.where('futuro_cliente_marcado_por_id', responsavelId);

  return query.update(montarPatchExclusaoFuturoCliente());
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
  listarMailingsDoUsuario,
  listarTodosEnvios,
  atualizarNomeEnvio,
  listarDestinatariosEnviosPlanilha,
  listarHistoricoDestinatariosPlanilha,
  cancelarEnviosPlanilha,
  dividirLeads,
  exportarCsv,
  gerarPlanilhaXlsx,
  marcarComoFuturoCliente,
  enviarFuturoClienteParaDistribuicao,
  reverterFuturoClienteLead,
  listarFuturosClientes,
  listarFuturosClientesComConsultoras,
  buscarFuturoClienteEmAcompanhamento,
  listarResponsaveisFuturosClientes,
  obterHistoricoFuturoCliente,
  listarFuturosClientesRecebidos,
  obterEstatisticasResumo,
  obterEstatisticasMailings,
  obterEstatisticasLinhas,
  obterMetricasFuturosClientes,
  gerarXlsxProdutividadePrimeiraLigacao,
  gerarXlsxEstatisticasFuturosClientes,
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
    montarHistoricoDestinatariosPlanilha,
    chavePessoaHistorico,
    situacaoEnvioHistorico,
    aplicarGruposMailing,
    aplicarBuscaDadosJson,
    aplicarBuscaFuturosClientes,
    aplicarBuscaMailingsUsuario,
    aplicarFiltrosFuturosClientes,
    montarQueryFuturosClientesComConsultoras,
    formatarFuturoClienteComConsultora,
    aplicarFiltroResponsavelAtual,
    aplicarFiltroAceiteRecebidos,
    aplicarEscopoCarteiraFuturosClientes,
    aplicarFiltrosQuery,
    aplicarFiltroVendaRecusada,
    combinarMetricasEnvio,
    deduplicarIndicacoesEnvio,
    filtrosPermitemIndicacaoPendente,
    montarColecoesExcel,
    montarColecaoCsv,
    normalizarBuscaDocumento,
    extrairCnpjsLinha,
    linhaPossuiVendaPorCnpj,
    obterErroReversaoFuturoCliente,
    montarPatchDivisao,
    montarLimpezaStatusReenvio,
    montarPatchReversaoFuturoCliente,
    montarPatchReversaoVendaRecusada,
    montarPatchExclusaoFuturoCliente,
    obterResponsavelEscopoLixeira,
    calcularVencimentoLixeiraFuturoCliente,
    deveNotificarNovoFuturoCliente,
    resolverDestinoNovoFuturoCliente,
    obterErroEnvioFuturoClienteDistribuicao,
    resolverEstadoAtualFuturoCliente,
    montarEventosHistoricoFuturoCliente,
    adicionarClassificacaoVendas,
    selecionarVendaAntiga,
    subtrairMesesUtc,
    sqlEntradaEtapaFinal
  }
};
