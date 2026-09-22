const crypto = require('crypto');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { htmlToText } = require('html-to-text');
const db = require('../database/connection');
const AutomacaoEmail = require('../models/AutomacaoEmail');
const { interpretarEmailClaro, autenticarRemetente } = require('./claro-email-parser.service');

const ORIGEM = 'imap_claro';
const OPERADORA = 'Claro';
const LIMITE_PADRAO = 100;

function habilitado() {
  return String(process.env.CLARO_IMAP_AUTOMATION_ENABLED || '').toLowerCase() === 'true';
}

function acoesAutomaticasHabilitadas() {
  return String(process.env.CLARO_IMAP_AUTO_ACTIONS_ENABLED || '').toLowerCase() === 'true';
}

function remetentesPermitidos() {
  return new Set(String(process.env.CLARO_IMAP_ALLOWED_SENDERS || '')
    .split(',').map(item => item.trim().toLowerCase()).filter(Boolean));
}

function configImap() {
  const port = Number(process.env.CLARO_IMAP_PORT || 993);
  return {
    host: String(process.env.CLARO_IMAP_HOST || 'imap.uhserver.com').trim(),
    port,
    secure: String(process.env.CLARO_IMAP_SECURE || 'true').toLowerCase() !== 'false',
    auth: {
      user: String(process.env.CLARO_IMAP_USER || '').trim(),
      pass: String(process.env.CLARO_IMAP_PASSWORD || '')
    },
    logger: false
  };
}

function validarConfiguracao(config = configImap()) {
  const processAfter = new Date(process.env.CLARO_IMAP_PROCESS_AFTER || '');
  if (!config.host || !Number.isInteger(config.port) || config.port <= 0 || !config.auth.user || !config.auth.pass) {
    throw new Error('Configuração IMAP da Claro incompleta.');
  }
  if (Number.isNaN(processAfter.getTime())) throw new Error('CLARO_IMAP_PROCESS_AFTER inválido ou ausente.');
  if (!remetentesPermitidos().size) throw new Error('CLARO_IMAP_ALLOWED_SENDERS inválido ou ausente.');
  return processAfter;
}

function remetenteEnvelope(envelope) {
  return String(envelope?.from?.[0]?.address || '').trim().toLowerCase();
}

function remetenteMime(mime) {
  return String(mime?.from?.value?.[0]?.address || '').trim().toLowerCase();
}

function formatarSQL(data = new Date()) {
  return data.toISOString().slice(0, 19).replace('T', ' ');
}

function chaveDeduplicacao(mime, source, recebidoEm) {
  const messageId = String(mime.messageId || '').trim().toLowerCase();
  const material = messageId
    ? `message-id:${messageId}`
    : `fallback:${remetenteMime(mime)}:${String(mime.subject || '')}:${recebidoEm.toISOString()}:${crypto.createHash('sha256').update(source).digest('hex')}`;
  return crypto.createHash('sha256').update(`${ORIGEM}:${material}`).digest('hex');
}

function extrairCorpo(mime) {
  const texto = String(mime?.text || '').trim();
  if (texto) return texto;
  if (typeof mime?.html !== 'string' || !mime.html.trim()) return '';
  try { return htmlToText(mime.html, { wordwrap: false }).trim(); } catch { return ''; }
}

async function obterEstado(database = db) {
  return database('automacao_email_estado').where({ origem: ORIGEM }).first();
}

async function salvarCursor(uidvalidity, ultimoUid, database = db) {
  await database('automacao_email_estado').where({ origem: ORIGEM }).update({
    uidvalidity: String(uidvalidity),
    ultimo_uid: Number(ultimoUid),
    updated_at: new Date()
  });
}

async function registrarMensagem({ uid, uidvalidity, envelope, internalDate, source }, dependencias = {}) {
  const permitidos = dependencias.remetentes || remetentesPermitidos();
  const remetentePreliminar = remetenteEnvelope(envelope);
  if (!permitidos.has(remetentePreliminar)) return { ignorada: true, persistida: false };

  const mime = await (dependencias.parse || simpleParser)(source, { skipImageLinks: true });
  const remetente = remetenteMime(mime);
  if (!permitidos.has(remetente)) return { ignorada: true, persistida: false };
  const recebidoEm = mime.date || internalDate || new Date();
  const corpo = extrairCorpo(mime);
  const autenticacaoValida = autenticarRemetente(mime.headers, remetente);
  const resultadoAutenticacao = mime.headers?.get?.('authentication-results') || mime.headers?.get?.('arc-authentication-results') || null;
  const campos = {
    ...interpretarEmailClaro(mime.subject || '', corpo),
    autenticacao_email: {
      dkim_dmarc_alinhados: autenticacaoValida,
      resultado: resultadoAutenticacao ? String(Array.isArray(resultadoAutenticacao) ? resultadoAutenticacao.join(' ') : resultadoAutenticacao).slice(0, 2000) : null
    }
  };
  const dedup = chaveDeduplicacao(mime, source, recebidoEm);
  const localizar = dependencias.localizar || (chave => AutomacaoEmail.query().findOne({ chave_deduplicacao: chave }));
  if (await localizar(dedup)) return { ignorada: false, persistida: false };
  const identificador = mime.messageId || `${uidvalidity}:${uid}`;
  const registro = {
    origem: ORIGEM,
    operadora: OPERADORA,
    identificador_remoto: String(identificador).slice(0, 512),
    chave_deduplicacao: dedup,
    autenticacao_valida: autenticacaoValida,
    gmail_message_id: `imap:${dedup}`,
    gmail_thread_id: null,
    remetente: mime.from?.text || remetente,
    assunto: mime.subject || null,
    corpo_texto: corpo || null,
    corpo_hash: corpo ? crypto.createHash('sha256').update(corpo).digest('hex') : null,
    recebido_em: formatarSQL(recebidoEm),
    dados_extraidos: JSON.stringify(campos),
    status: 'pendente',
    erro: null
  };
  const inserir = dependencias.inserir || (dados => AutomacaoEmail.query().insert(dados).onConflict('chave_deduplicacao').ignore());
  const inserido = await inserir(registro);
  return { ignorada: false, persistida: Boolean(inserido?.id), registro };
}

async function coletarEmailsClaro({ desdeInicio = false } = {}, dependencias = {}) {
  if (!habilitado()) return { habilitado: false, coletados: 0, ignorados: 0 };
  const config = dependencias.config || configImap();
  const processAfter = validarConfiguracao(config);
  const database = dependencias.database || db;
  const permitidos = dependencias.remetentes || remetentesPermitidos();
  const estado = await (dependencias.obterEstado || obterEstado)(database) || {};
  const criarCliente = dependencias.criarCliente || (opcoes => new ImapFlow(opcoes));
  const client = criarCliente(config);
  let lock;
  let coletados = 0;
  let ignorados = 0;
  try {
    await client.connect();
    lock = await client.getMailboxLock('INBOX', { readOnly: true });
    const uidvalidity = String(client.mailbox?.uidValidity || '');
    if (!uidvalidity) throw new Error('Servidor IMAP não informou UIDVALIDITY.');
    const mesmoMailbox = String(estado.uidvalidity || '') === uidvalidity;
    const cursor = desdeInicio || !mesmoMailbox ? 0 : Number(estado.ultimo_uid || 0);
    const uids = (await client.search({ since: processAfter }, { uid: true }))
      .map(Number).filter(uid => uid > cursor).sort((a, b) => a - b)
      .slice(0, LIMITE_PADRAO);
    if (!mesmoMailbox) await (dependencias.salvarCursor || salvarCursor)(uidvalidity, 0, database);

    for (const uid of uids) {
      const cabecalho = await client.fetchOne(uid, { envelope: true, internalDate: true }, { uid: true });
      if (!cabecalho) {
        await (dependencias.salvarCursor || salvarCursor)(uidvalidity, uid, database);
        continue;
      }
      const preliminar = remetenteEnvelope(cabecalho.envelope);
      if (!permitidos.has(preliminar)) {
        ignorados += 1;
        await (dependencias.salvarCursor || salvarCursor)(uidvalidity, uid, database);
        continue;
      }
      // `source: true` é traduzido pelo ImapFlow para BODY.PEEK[], sem marcar a mensagem como lida.
      const mensagem = await client.fetchOne(uid, { source: true, envelope: true, internalDate: true }, { uid: true });
      const resultado = await registrarMensagem({ uid, uidvalidity, ...mensagem }, { ...dependencias, remetentes: permitidos });
      if (resultado.ignorada) ignorados += 1;
      if (resultado.persistida) coletados += 1;
      await (dependencias.salvarCursor || salvarCursor)(uidvalidity, uid, database);
    }
    return { habilitado: true, coletados, ignorados, uidvalidity, ultimo_uid: uids.at(-1) || cursor };
  } finally {
    if (lock) lock.release();
    if (client?.usable !== false) await client.logout().catch(() => client.close?.());
  }
}

module.exports = {
  ORIGEM,
  OPERADORA,
  habilitado,
  acoesAutomaticasHabilitadas,
  coletarEmailsClaro,
  registrarMensagem,
  _internals: { configImap, validarConfiguracao, remetentesPermitidos, remetenteEnvelope, remetenteMime, chaveDeduplicacao, extrairCorpo, obterEstado, salvarCursor }
};
