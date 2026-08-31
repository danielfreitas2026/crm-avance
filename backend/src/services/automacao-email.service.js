const crypto = require('crypto');
const axios = require('axios');
const { simpleParser } = require('mailparser');
const db = require('../database/connection');
const AutomacaoEmail = require('../models/AutomacaoEmail');
const FunilEtapa = require('../models/FunilEtapa');
const Notificacao = require('../models/Notificacao');
const NotificacaoDestinatario = require('../models/NotificacaoDestinatario');
const Usuario = require('../models/Usuario');
const Venda = require('../models/Venda');
const VendaProblema = require('../models/VendaProblema');
const VendaProblemaDestinatario = require('../models/VendaProblemaDestinatario');
const VendaProblemaEvento = require('../models/VendaProblemaEvento');
const vendaService = require('./venda.service');
const { chamarApiComToken } = require('./telegram.service');
const { usuarioTemPermissaoLocal } = require('../utils/permissoes');
const { interpretarEmail } = require('./vivo-email-parser.service');

const PERMISSAO_RESPONSAVEL = 'problemas_pos_venda_responsavel';

function formatarSQL(data = new Date()) { return data.toISOString().slice(0, 19).replace('T', ' '); }
function json(valor, fallback = {}) { if (!valor) return fallback; if (typeof valor === 'object') return valor; try { return JSON.parse(valor); } catch { return fallback; } }
function documento(valor) { return String(valor || '').replace(/\D/g, ''); }
function centavos(valor) { return Math.round(Number(valor) * 100); }
function remetentesPermitidos() { return new Set(String(process.env.GMAIL_VIVO_ALLOWED_SENDERS || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean)); }
function emailRemetente(valor) { return String(valor || '').match(/<([^>]+)>/)?.[1]?.toLowerCase() || String(valor || '').trim().toLowerCase(); }
function configurado() { return String(process.env.GMAIL_VIVO_AUTOMATION_ENABLED || '').toLowerCase() === 'true'; }
function tokenTelegramProblemas() { return String(process.env.TELEGRAM_APROVACOES_BOT_TOKEN || '').trim(); }

async function tokenAcesso() {
  const parametros = new URLSearchParams({
    client_id: process.env.GMAIL_VIVO_CLIENT_ID || '', client_secret: process.env.GMAIL_VIVO_CLIENT_SECRET || '',
    refresh_token: process.env.GMAIL_VIVO_REFRESH_TOKEN || '', grant_type: 'refresh_token'
  });
  const resposta = await axios.post('https://oauth2.googleapis.com/token', parametros, { timeout: 10000 });
  return resposta.data.access_token;
}

async function gmailGet(caminho, token, params = {}) {
  return axios.get(`https://gmail.googleapis.com/gmail/v1/users/me/${caminho}`, { headers: { Authorization: `Bearer ${token}` }, params, timeout: 15000 });
}

async function registrarMensagem(remota, token) {
  if (await AutomacaoEmail.query().findOne({ gmail_message_id: remota.id })) return false;
  const resposta = await gmailGet(`messages/${remota.id}`, token, { format: 'raw' });
  const mensagem = resposta.data;
  const mime = await simpleParser(Buffer.from(mensagem.raw, 'base64url'), { skipImageLinks: true });
  const remetente = mime.from?.text || '';
  const autorizado = remetentesPermitidos().has(emailRemetente(remetente));
  const corpo = autorizado ? String(mime.text || '').trim() : null;
  await AutomacaoEmail.query().insert({
    gmail_message_id: mensagem.id, gmail_thread_id: mensagem.threadId || null,
    remetente, assunto: mime.subject || null, corpo_texto: corpo,
    corpo_hash: corpo ? crypto.createHash('sha256').update(corpo).digest('hex') : null,
    recebido_em: formatarSQL(new Date(Number(mensagem.internalDate))),
    status: autorizado ? 'pendente' : 'rejeitado',
    erro: autorizado ? null : 'Remetente não autorizado.'
  }).onConflict('gmail_message_id').ignore();
  return true;
}

async function coletarEmails() {
  if (!configurado()) return { habilitado: false, coletados: 0 };
  const inicio = new Date(process.env.GMAIL_VIVO_PROCESS_AFTER || '');
  if (Number.isNaN(inicio.getTime())) throw new Error('GMAIL_VIVO_PROCESS_AFTER inválido ou ausente.');
  const ultima = await AutomacaoEmail.query().max('recebido_em as valor').first();
  const referencia = ultima?.valor ? new Date(ultima.valor) : inicio;
  const depois = Math.max(Math.floor(referencia.getTime() / 1000) - 300, Math.floor(inicio.getTime() / 1000));
  const token = await tokenAcesso();
  let pageToken;
  let coletados = 0;
  do {
    const resposta = await gmailGet('messages', token, { q: `after:${depois}`, maxResults: 100, pageToken });
    for (const item of resposta.data.messages || []) if (await registrarMensagem(item, token)) coletados += 1;
    pageToken = resposta.data.nextPageToken;
  } while (pageToken);
  return { habilitado: true, coletados };
}

async function buscarCandidatas(campos) {
  const doc = documento(campos.documento);
  if (![11, 14].includes(doc.length)) return [];
  const exprVenda = "REPLACE(REPLACE(REPLACE(REPLACE(v.cnpj, '.', ''), '/', ''), '-', ''), ' ', '')";
  const exprCliente = "REPLACE(REPLACE(REPLACE(REPLACE(cliente.cnpj, '.', ''), '/', ''), '-', ''), ' ', '')";
  return Venda.query().alias('v').leftJoinRelated('cliente').select('v.*')
    .where(builder => builder.whereRaw(`${exprVenda} = ?`, [doc]).orWhereRaw(`${exprCliente} = ?`, [doc]))
    .whereNull('v.excluido_em').withGraphFetched('[cliente, operadora]');
}

function validarCandidata(venda, campos) {
  const falhas = [];
  if (venda.cancelada_em) falhas.push('venda cancelada');
  if (campos.data_venda && String(venda.data_venda || '').slice(0, 10) !== campos.data_venda) falhas.push('data da venda divergente');
  if (campos.quantidade !== null && Number(venda.quantidade_linhas) !== Number(campos.quantidade)) falhas.push('quantidade divergente');
  if (campos.valor_mensal !== null && centavos(venda.valor_total) !== centavos(campos.valor_mensal)) falhas.push('valor mensal divergente');
  return falhas;
}

async function resolverVenda(registro, campos) {
  if (registro.revisado_por_id && registro.venda_id) {
    const escolhida = await Venda.query().findById(registro.venda_id).withGraphFetched('[cliente, operadora]');
    return escolhida ? { venda: escolhida, candidatas: [{ id: escolhida.id, falhas: [], manual: true }] } : { venda: null, candidatas: [] };
  }
  const candidatas = await buscarCandidatas(campos);
  const avaliadas = candidatas.map(venda => ({ id: venda.id, nome: venda.nome, falhas: validarCandidata(venda, campos) }));
  const validas = candidatas.filter((venda, indice) => avaliadas[indice].falhas.length === 0);
  return { venda: validas.length === 1 ? validas[0] : null, candidatas: avaliadas };
}

async function etapaDestino(alvo) {
  if (alvo === 'aceite_biometria') {
    const etapas = await FunilEtapa.query().where({ ativo: true, aceite_biometria: true });
    return etapas.length === 1 ? etapas[0] : null;
  }
  return FunilEtapa.query().findOne({ codigo: alvo, ativo: true });
}

async function responsaveisProblemas(trx) {
  const usuarios = await Usuario.query(trx).where('ativo', true).withGraphFetched('role');
  return usuarios.filter(usuario => usuarioTemPermissaoLocal(usuario, PERMISSAO_RESPONSAVEL));
}

async function enviarTelegram(registro, venda, mensagem) {
  const chatId = String(process.env.TELEGRAM_PROBLEMAS_CHAT_ID || '').trim();
  const token = tokenTelegramProblemas();
  if (!chatId || !token) {
    await AutomacaoEmail.query().patchAndFetchById(registro.id, { telegram_status: 'nao_configurado' });
    return;
  }
  try {
    const resultado = await chamarApiComToken(token, 'sendMessage', {
      chat_id: chatId,
      text: `⚠️ PROBLEMA PÓS-VENDA\n\nVenda #${venda.id} - ${venda.nome || venda.razao_social}\nCNPJ/CPF: ${venda.cnpj || 'não informado'}\n\nMensagem da operadora: ${mensagem}\n\nConsulte o Painel de Problemas no CRM.`,
      disable_web_page_preview: true
    });
    await AutomacaoEmail.query().patchAndFetchById(registro.id, { telegram_status: 'enviado', telegram_message_id: resultado?.message_id || null, telegram_erro: null });
  } catch (error) {
    await AutomacaoEmail.query().patchAndFetchById(registro.id, { telegram_status: 'erro', telegram_erro: String(error.message).slice(0, 1000) });
  }
}

async function abrirProblemaAutomatico(registro, venda, mensagem) {
  if (registro.problema_id) return VendaProblema.query().findById(registro.problema_id);
  const agora = formatarSQL();
  const resultado = await VendaProblema.transaction(async trx => {
    const responsaveis = await responsaveisProblemas(trx);
    if (!responsaveis.length) throw new Error('Nenhum responsável por problemas pós-venda está configurado.');
    const problema = await VendaProblema.query(trx).insertAndFetch({ venda_id: venda.id, solicitante_id: null, status: 'aberto', aberto_em: agora });
    for (const usuario of responsaveis) await VendaProblemaDestinatario.query(trx).insert({ problema_id: problema.id, usuario_id: usuario.id });
    const evento = await VendaProblemaEvento.query(trx).insertAndFetch({ problema_id: problema.id, usuario_id: null, tipo: 'abertura_automatica', mensagem, dados: JSON.stringify({ automacao_email_id: registro.id }) });
    const notificacao = await Notificacao.query(trx).insertAndFetch({
      tipo: 'venda_problema_automatico', titulo: 'Problema automático de venda', mensagem: `${venda.nome || venda.razao_social || `Venda #${venda.id}`}: ${mensagem}`,
      nivel: 'danger', entidade: 'vendas', entidade_id: venda.id, source_key: `automacao_email:${registro.id}`,
      dados: JSON.stringify({ venda_id: venda.id, problema_id: problema.id, automacao_email_id: registro.id, mensagem }), ativa: true, updated_at: new Date()
    });
    for (const usuario of responsaveis) await NotificacaoDestinatario.query(trx).insert({ notificacao_id: notificacao.id, usuario_id: usuario.id });
    await AutomacaoEmail.query(trx).patchAndFetchById(registro.id, { problema_id: problema.id });
    return { problema, evento };
  });
  await enviarTelegram({ ...registro, problema_id: resultado.problema.id }, venda, mensagem);
  return resultado.problema;
}

async function processarRegistro(registro) {
  const camposBase = interpretarEmail(registro.corpo_texto);
  const override = json(registro.dados_extraidos)._override || {};
  const campos = { ...camposBase, ...override };
  const resolucao = await resolverVenda(registro, campos);
  const dadosExtraidos = { ...campos, candidatas: resolucao.candidatas };
  const revisaoManual = Boolean(registro.revisado_por_id && registro.venda_id);
  if ((!revisaoManual && !campos.documento) || (!revisaoManual && !campos.destino) || campos.classificacao === 'desconhecido') return { status: 'revisao', erro: 'E-mail não reconhecido ou sem campos obrigatórios.', dados_extraidos: JSON.stringify(dadosExtraidos) };
  if (!resolucao.venda) return { status: 'revisao', erro: 'Não foi possível identificar uma única venda com validação estrita.', dados_extraidos: JSON.stringify(dadosExtraidos) };
  const venda = resolucao.venda;
  if (campos.classificacao === 'tipo_2') {
    if (!campos.mensagem_operador) return { status: 'revisao', erro: 'Mensagem ao operador não encontrada.', dados_extraidos: JSON.stringify(dadosExtraidos), venda_id: venda.id };
    const problema = await abrirProblemaAutomatico(registro, venda, campos.mensagem_operador);
    return { status: 'concluido', classificacao: 'tipo_2', venda_id: venda.id, problema_id: problema.id, dados_extraidos: JSON.stringify(dadosExtraidos), erro: null, processado_em: formatarSQL() };
  }
  const etapa = await etapaDestino(campos.alvo);
  if (!etapa) return { status: 'revisao', erro: 'Etapa de destino não encontrada ou ambígua.', venda_id: venda.id, dados_extraidos: JSON.stringify(dadosExtraidos) };
  const atual = await FunilEtapa.query().findOne({ codigo: venda.status_funil });
  if (atual && Number(etapa.ordem) < Number(atual.ordem)) return { status: 'revisao', erro: 'O e-mail tentaria regredir o funil.', venda_id: venda.id, etapa_destino: etapa.codigo, dados_extraidos: JSON.stringify(dadosExtraidos) };
  if (venda.status_funil !== etapa.codigo) {
    const movimento = await vendaService.atualizarStatusVenda(venda.id, { status_funil: etapa.codigo, observacao: `Atualização automática pelo Gmail: ${campos.destino}` }, null, { sistema: true });
    if (movimento.status !== 'ok') return { status: 'revisao', erro: movimento.message || 'Movimentação bloqueada pelas regras do funil.', venda_id: venda.id, etapa_destino: etapa.codigo, dados_extraidos: JSON.stringify(dadosExtraidos) };
  }
  return { status: 'concluido', classificacao: 'tipo_1', venda_id: venda.id, etapa_destino: etapa.codigo, dados_extraidos: JSON.stringify(dadosExtraidos), erro: null, processado_em: formatarSQL() };
}

async function processarPendentes(limite = 20) {
  const limiteTravado = new Date(Date.now() - 10 * 60 * 1000);
  await AutomacaoEmail.query().where('status', 'processando').where('updated_at', '<', formatarSQL(limiteTravado)).patch({ status: 'pendente', erro: 'Processamento anterior interrompido; item recuperado.', updated_at: new Date() });
  const pendentes = await AutomacaoEmail.query().where('status', 'pendente').orderBy('recebido_em').limit(limite);
  let processados = 0;
  for (const item of pendentes) {
    const reclamado = await AutomacaoEmail.query().where({ id: item.id, status: 'pendente' }).patch({ status: 'processando', tentativas: Number(item.tentativas || 0) + 1, updated_at: new Date() });
    if (!reclamado) continue;
    try { await AutomacaoEmail.query().patchAndFetchById(item.id, await processarRegistro(item)); }
    catch (error) { await AutomacaoEmail.query().patchAndFetchById(item.id, { status: 'erro', erro: String(error.message || error).slice(0, 2000) }); }
    processados += 1;
  }
  return processados;
}

async function repetirTelegrams() {
  const itens = await AutomacaoEmail.query().where('classificacao', 'tipo_2').whereNotNull('problema_id').where(builder => builder.whereNull('telegram_status').orWhereIn('telegram_status', ['erro', 'nao_configurado'])).limit(20);
  for (const item of itens) {
    const venda = await Venda.query().findById(item.venda_id);
    const mensagem = json(item.dados_extraidos).mensagem_operador;
    if (venda && mensagem) await enviarTelegram(item, venda, mensagem);
  }
}

async function ciclo() { const coleta = await coletarEmails(); if (coleta.habilitado) { await processarPendentes(); await repetirTelegrams(); } return coleta; }

async function listar(filtros = {}) {
  const pagina = Math.max(1, Number(filtros.page) || 1); const porPagina = Math.min(100, Math.max(10, Number(filtros.per_page) || 25));
  const query = AutomacaoEmail.query().orderBy('recebido_em', 'desc');
  if (filtros.status) query.where('status', filtros.status);
  const resultado = await query.page(pagina - 1, porPagina);
  return { data: resultado.results.map(item => ({ ...item, dados_extraidos: json(item.dados_extraidos) })), total: resultado.total, page: pagina, per_page: porPagina };
}

async function resumo() {
  const linhas = await db('automacao_emails').select('status').count('* as total').groupBy('status');
  const ultima = await db('automacao_emails').max('recebido_em as recebido_em').first();
  return { habilitada: configurado(), ultima_mensagem_em: ultima?.recebido_em || null, contadores: Object.fromEntries(linhas.map(item => [item.status, Number(item.total)])) };
}

async function revisar(id, dados, usuarioId) {
  const registro = await AutomacaoEmail.query().findById(id); if (!registro) return null;
  const justificativa = String(dados.justificativa || '').trim(); if (!justificativa) throw Object.assign(new Error('Informe a justificativa.'), { statusCode: 400 });
  const atuais = json(registro.dados_extraidos);
  const override = { classificacao: dados.classificacao, alvo: dados.etapa_destino || null, mensagem_operador: dados.mensagem_operador || atuais.mensagem_operador, destino: dados.destino || atuais.destino, documento: atuais.documento };
  await AutomacaoEmail.query().patchAndFetchById(id, { venda_id: dados.venda_id || registro.venda_id, dados_extraidos: JSON.stringify({ ...atuais, _override: override }), revisado_por_id: usuarioId, justificativa_revisao: justificativa, status: 'pendente', erro: null });
  await processarPendentes(); return AutomacaoEmail.query().findById(id);
}

async function repetir(id) { const item = await AutomacaoEmail.query().findById(id); if (!item) return null; await AutomacaoEmail.query().patchAndFetchById(id, { status: 'pendente', erro: null }); await processarPendentes(); return AutomacaoEmail.query().findById(id); }
async function descartar(id, justificativa, usuarioId) { if (!String(justificativa || '').trim()) throw Object.assign(new Error('Informe a justificativa.'), { statusCode: 400 }); return AutomacaoEmail.query().patchAndFetchById(id, { status: 'descartado', justificativa_revisao: String(justificativa).trim(), revisado_por_id: usuarioId, processado_em: formatarSQL() }); }

async function limparCorposExpirados() { const limite = new Date(); limite.setUTCFullYear(limite.getUTCFullYear() - 1); return AutomacaoEmail.query().whereNotNull('corpo_texto').where('recebido_em', '<', formatarSQL(limite)).patch({ corpo_texto: null, corpo_expirado_em: formatarSQL(), updated_at: new Date() }); }

async function listarProblemas() {
  const registros = await AutomacaoEmail.query().alias('a').join('venda_problemas as p', 'p.id', 'a.problema_id').join('vendas as v', 'v.id', 'a.venda_id')
    .whereIn('p.status', ['aberto', 'resolvido', 'correcao_solicitada']).select('a.*', 'p.status as problema_status', 'p.aberto_em', 'v.nome as venda_nome', 'v.razao_social', 'v.cnpj').orderBy('p.aberto_em', 'desc');
  for (const item of registros) item.eventos = await VendaProblemaEvento.query().where('problema_id', item.problema_id).orderBy('created_at');
  return registros.map(item => ({ ...item, dados_extraidos: json(item.dados_extraidos) }));
}

async function resolverProblemaAutomatico(problemaId, mensagem, usuarioId) {
  const texto = String(mensagem || '').trim(); if (!texto) throw Object.assign(new Error('Informe a resolução.'), { statusCode: 400 });
  const registro = await AutomacaoEmail.query().findOne({ problema_id: problemaId }); if (!registro) return null;
  const agora = formatarSQL();
  await VendaProblema.transaction(async trx => {
    await VendaProblema.query(trx).patchAndFetchById(problemaId, { status: 'verificado', resolvido_em: agora, verificado_em: agora, updated_at: agora });
    await VendaProblemaDestinatario.query(trx).where({ problema_id: problemaId, usuario_id: usuarioId }).patch({ resolvido_em: agora, updated_at: agora });
    await VendaProblemaEvento.query(trx).insert({ problema_id: problemaId, usuario_id: usuarioId, tipo: 'resolucao_automatica', mensagem: texto });
    await Notificacao.query(trx).where('source_key', `automacao_email:${registro.id}`).patch({ ativa: false, updated_at: new Date() });
  });
  return { ok: true };
}

module.exports = { ciclo, coletarEmails, processarPendentes, listar, resumo, revisar, repetir, descartar, limparCorposExpirados, listarProblemas, resolverProblemaAutomatico, _internals: { validarCandidata, emailRemetente, documento, centavos, tokenTelegramProblemas, processarRegistro } };
