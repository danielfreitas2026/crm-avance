const crypto = require('crypto');
const axios = require('axios');
const { htmlToText } = require('html-to-text');
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
const { validarCnpj } = require('./cnpj.service');
const { chamarApiComToken } = require('./telegram.service');
const { usuarioTemPermissaoLocal } = require('../utils/permissoes');
const { interpretarEmail, textoCanonico } = require('./vivo-email-parser.service');

const PERMISSAO_RESPONSAVEL = 'problemas_pos_venda_responsavel';

function formatarSQL(data = new Date()) { return data.toISOString().slice(0, 19).replace('T', ' '); }
function json(valor, fallback = {}) { if (!valor) return fallback; if (typeof valor === 'object') return valor; try { return JSON.parse(valor); } catch { return fallback; } }
function documento(valor) { return String(valor || '').replace(/\D/g, ''); }
function centavos(valor) { return Math.round(Number(valor) * 100); }
function remetentesPermitidos() { return new Set(String(process.env.GMAIL_VIVO_ALLOWED_SENDERS || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean)); }
function emailRemetente(valor) { return String(valor || '').match(/<([^>]+)>/)?.[1]?.toLowerCase() || String(valor || '').trim().toLowerCase(); }
function configurado() { return String(process.env.GMAIL_VIVO_AUTOMATION_ENABLED || '').toLowerCase() === 'true'; }
function tokenTelegramProblemas() { return String(process.env.TELEGRAM_APROVACOES_BOT_TOKEN || '').trim(); }

function pontuarCorpoEmail(corpo) {
  const campos = interpretarEmail(corpo);
  return [
    campos.documento,
    campos.data_venda,
    campos.quantidade !== null ? campos.quantidade : null,
    campos.valor_mensal !== null ? campos.valor_mensal : null,
    campos.destino
  ].filter(valor => valor !== null && valor !== undefined && valor !== '').length;
}

function extrairCorpoMensagem(mime) {
  const texto = String(mime?.text || '').trim();
  let textoHtml = '';
  if (typeof mime?.html === 'string' && mime.html.trim()) {
    try { textoHtml = htmlToText(mime.html, { wordwrap: false }).trim(); } catch { textoHtml = ''; }
  }
  const candidatos = [...new Set([texto, textoHtml].filter(Boolean))];
  return candidatos.reduce((melhor, candidato) => (
    pontuarCorpoEmail(candidato) > pontuarCorpoEmail(melhor) ? candidato : melhor
  ), '');
}

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

async function carregarCorpoGmail(gmailMessageId) {
  const token = await tokenAcesso();
  const resposta = await gmailGet(`messages/${gmailMessageId}`, token, { format: 'raw' });
  const mime = await simpleParser(Buffer.from(resposta.data.raw, 'base64url'), { skipImageLinks: true });
  return extrairCorpoMensagem(mime);
}

async function registrarMensagem(remota, token) {
  if (await AutomacaoEmail.query().findOne({ gmail_message_id: remota.id })) return false;
  const resposta = await gmailGet(`messages/${remota.id}`, token, { format: 'raw' });
  const mensagem = resposta.data;
  const mime = await simpleParser(Buffer.from(mensagem.raw, 'base64url'), { skipImageLinks: true });
  const remetente = mime.from?.text || '';
  const autorizado = remetentesPermitidos().has(emailRemetente(remetente));
  const corpo = autorizado ? extrairCorpoMensagem(mime) : null;
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

function calcularDepois(inicio, ultima, desdeInicio = false) {
  if (desdeInicio || !ultima) return Math.floor(inicio.getTime() / 1000);
  return Math.max(Math.floor(new Date(ultima).getTime() / 1000) - 300, Math.floor(inicio.getTime() / 1000));
}

async function coletarEmails({ desdeInicio = false } = {}) {
  if (!configurado()) return { habilitado: false, coletados: 0 };
  const inicio = new Date(process.env.GMAIL_VIVO_PROCESS_AFTER || '');
  if (Number.isNaN(inicio.getTime())) throw new Error('GMAIL_VIVO_PROCESS_AFTER inválido ou ausente.');
  const ultima = await AutomacaoEmail.query().max('recebido_em as valor').first();
  const depois = calcularDepois(inicio, ultima?.valor, desdeInicio);
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

async function coletarHistorico() {
  const coleta = await coletarEmails({ desdeInicio: true });
  if (!coleta.habilitado) throw Object.assign(new Error('A automação Gmail está desabilitada.'), { statusCode: 409 });
  const processados = await processarPendentes();
  return { ...coleta, processados };
}

async function buscarCandidatas(campos) {
  const doc = documento(campos.documento);
  if (![11, 14].includes(doc.length)) return [];
  const exprVenda = "REPLACE(REPLACE(REPLACE(REPLACE(v.cnpj, '.', ''), '/', ''), '-', ''), ' ', '')";
  const exprCliente = "REPLACE(REPLACE(REPLACE(REPLACE(cliente.cnpj, '.', ''), '/', ''), '-', ''), ' ', '')";
  return Venda.query().alias('v')
    .leftJoinRelated('cliente')
    .leftJoin('funil_etapas as etapa_atual', 'etapa_atual.codigo', 'v.status_funil')
    .select('v.*', 'etapa_atual.nome as status_funil_nome')
    .where(builder => builder.whereRaw(`${exprVenda} = ?`, [doc]).orWhereRaw(`${exprCliente} = ?`, [doc]))
    .whereNull('v.excluido_em').withGraphFetched('[cliente, operadora, vendedora, vendedoras, criador]');
}

function cnpjValido(valor) {
  try {
    return validarCnpj(valor);
  } catch (error) {
    throw Object.assign(new Error(error.message || 'Informe um CNPJ válido.'), { statusCode: 422 });
  }
}

async function codigosEtapasFinais() {
  try {
    const etapas = await FunilEtapa.query().where({ ativo: true, etapa_final: true });
    return etapas.length ? etapas.map(etapa => etapa.codigo) : ['concluido'];
  } catch {
    return ['concluido'];
  }
}

function divergenciasSecundarias(venda, campos) {
  const divergencias = [];
  if (campos.data_venda && String(venda.data_venda || '').slice(0, 10) !== campos.data_venda) divergencias.push('data da venda divergente');
  if (campos.quantidade !== null && campos.quantidade !== undefined && Number(venda.quantidade_linhas) !== Number(campos.quantidade)) divergencias.push('quantidade divergente');
  if (campos.valor_mensal !== null && campos.valor_mensal !== undefined && centavos(venda.valor_total) !== centavos(campos.valor_mensal)) divergencias.push('valor mensal divergente');
  return divergencias;
}

function motivosInelegibilidade(venda, etapasFinais, { cancelamento = false } = {}) {
  const motivos = [];
  if (venda.excluido_em) motivos.push('venda excluída');
  if (venda.cancelada_em && !cancelamento) motivos.push('venda cancelada');
  if (etapasFinais.includes(venda.status_funil) && !(cancelamento && venda.cancelada_em)) motivos.push('venda concluída');
  return motivos;
}

function selecionarCandidataUnica(avaliadas) {
  if (avaliadas.length === 1) return avaliadas[0].venda;
  if (avaliadas.length > 1) {
    const compativeis = avaliadas.filter(item => item.auditoria.divergencias.length === 0);
    if (compativeis.length === 1) return compativeis[0].venda;
  }
  return null;
}

function avaliarCandidatas(candidatas, campos, etapasFinais, { cancelamento = false } = {}) {
  const avaliadas = candidatas.map(venda => {
    const inelegibilidades = motivosInelegibilidade(venda, etapasFinais, { cancelamento });
    const vendedores = [venda.vendedora, ...(Array.isArray(venda.vendedoras) ? venda.vendedoras : [])]
      .filter(Boolean)
      .filter((item, indice, lista) => lista.findIndex(outro => Number(outro.id) === Number(item.id)) === indice)
      .map(item => ({ id: Number(item.id), nome: item.nome || 'Não informado' }));
    return {
      venda,
      auditoria: {
        id: venda.id,
        nome: venda.nome,
        razao_social: venda.razao_social || venda.nome || '',
        data_venda: venda.data_venda || null,
        valor_total: venda.valor_total ?? null,
        quantidade_linhas: venda.quantidade_linhas ?? null,
        status_funil: venda.status_funil || null,
        status_funil_nome: venda.status_funil_nome || venda.status_funil || 'Sem etapa',
        vendedores,
        criador: venda.criador ? { id: Number(venda.criador.id), nome: venda.criador.nome || 'Não informado' } : null,
        elegivel: inelegibilidades.length === 0,
        inelegibilidades,
        motivo_bloqueio: inelegibilidades.join(', ') || null,
        divergencias: divergenciasSecundarias(venda, campos)
      }
    };
  });
  const elegiveis = avaliadas.filter(item => item.auditoria.elegivel);
  const ativas = elegiveis.filter(item => !item.venda.cancelada_em);
  const canceladas = elegiveis.filter(item => item.venda.cancelada_em);
  let selecionada = selecionarCandidataUnica(ativas);
  if (!selecionada && ativas.length === 0 && cancelamento) selecionada = selecionarCandidataUnica(canceladas);
  let erro = null;
  if (!selecionada && avaliadas.length > 0 && elegiveis.length === 0) {
    erro = 'Todas as vendas encontradas para o documento estão concluídas, canceladas ou excluídas.';
  } else if (!selecionada) {
    erro = 'Não foi possível identificar uma única venda ativa para o documento.';
  }
  return { venda: selecionada, candidatas: avaliadas.map(item => item.auditoria), erro };
}

async function validarVendaSelecionada(registro, dados, dependencias = {}) {
  const atuais = json(registro.dados_extraidos);
  const vendaId = Number(dados.venda_id || registro.venda_id);
  if (!Number.isInteger(vendaId) || vendaId <= 0) {
    throw Object.assign(new Error('Selecione uma venda válida.'), { statusCode: 400 });
  }

  const cnpj = cnpjValido(dados.cnpj_venda || atuais.documento);
  const campos = {
    ...atuais,
    documento: cnpj,
    classificacao: dados.classificacao || registro.classificacao || atuais.classificacao,
    alvo: dados.etapa_destino || atuais.alvo
  };
  const buscar = dependencias.buscar || buscarCandidatas;
  const obterEtapas = dependencias.etapasFinais || codigosEtapasFinais;
  const candidatas = await buscar(campos);
  const venda = candidatas.find(item => Number(item.id) === vendaId);
  if (!venda) {
    throw Object.assign(new Error('A venda selecionada não pertence ao CNPJ pesquisado.'), { statusCode: 400 });
  }

  const cancelamento = campos.classificacao === 'cancelamento' || campos.alvo === 'cancelar_venda';
  const avaliacao = avaliarCandidatas([venda], campos, await obterEtapas(), { cancelamento });
  if (!avaliacao.candidatas[0]?.elegivel) {
    throw Object.assign(new Error('A venda selecionada não está ativa para vinculação.'), { statusCode: 400 });
  }
  return { venda, cnpj };
}

async function listarVendasCandidatas(id, cnpjInformado, dependencias = {}) {
  const registro = await AutomacaoEmail.query().findById(id);
  if (!registro) return null;
  const atuais = json(registro.dados_extraidos);
  const original = documento(atuais.documento);
  const cnpj = cnpjValido(cnpjInformado || original);
  const campos = { ...atuais, documento: cnpj };
  const cancelamento = (registro.classificacao || atuais.classificacao) === 'cancelamento' || atuais.alvo === 'cancelar_venda';
  const buscar = dependencias.buscar || buscarCandidatas;
  const obterEtapas = dependencias.etapasFinais || codigosEtapasFinais;
  const resultado = avaliarCandidatas(await buscar(campos), campos, await obterEtapas(), { cancelamento });
  return {
    automacao_id: Number(registro.id),
    cnpj,
    cnpj_original: original.length === 14 ? original : null,
    vendas: resultado.candidatas
  };
}

async function resolverVenda(registro, campos) {
  const etapasFinais = await codigosEtapasFinais();
  const cancelamento = campos.classificacao === 'cancelamento' || campos.alvo === 'cancelar_venda';
  if (registro.revisado_por_id && registro.venda_id) {
    const escolhida = await Venda.query().findById(registro.venda_id).withGraphFetched('[cliente, operadora]');
    if (!escolhida) return { venda: null, candidatas: [], erro: 'A venda selecionada manualmente não foi encontrada.' };
    const resultado = avaliarCandidatas([escolhida], campos, etapasFinais, { cancelamento });
    resultado.candidatas[0].manual = true;
    if (!resultado.venda) resultado.erro = cancelamento
      ? 'A venda selecionada manualmente está concluída ou excluída e não pode ser cancelada automaticamente.'
      : 'A venda selecionada manualmente está concluída, cancelada ou excluída e não pode receber atualizações.';
    return resultado;
  }
  const candidatas = await buscarCandidatas(campos);
  return avaliarCandidatas(candidatas, campos, etapasFinais, { cancelamento });
}

async function resolverEtapaDestino(alvo) {
  if (alvo === 'apos_aceite_biometria') {
    const etapas = await FunilEtapa.query()
      .where({ ativo: true })
      .orderBy('ordem', 'asc')
      .orderBy('nome', 'asc');
    const etapasAceite = etapas.filter(etapa => Boolean(etapa.aceite_biometria));
    if (etapasAceite.length !== 1) {
      return { etapa: null, erro: 'Não foi encontrada uma única etapa ativa configurada como Aceite/Biometria.' };
    }
    const aceite = etapasAceite[0];
    const etapa = etapas.find(item => Number(item.ordem) > Number(aceite.ordem)) || null;
    return etapa
      ? { etapa, erro: null }
      : { etapa: null, erro: 'Não há etapa ativa após Aceite/Biometria.' };
  }
  if (alvo === 'aceite_biometria') {
    const etapas = await FunilEtapa.query().where({ ativo: true, aceite_biometria: true });
    return {
      etapa: etapas.length === 1 ? etapas[0] : null,
      erro: etapas.length === 1 ? null : 'Não foi encontrada uma única etapa ativa configurada como Aceite/Biometria.'
    };
  }
  if (alvo === 'etapa_final') {
    const etapas = await FunilEtapa.query().where({ ativo: true, etapa_final: true });
    return {
      etapa: etapas.length === 1 ? etapas[0] : null,
      erro: etapas.length === 1 ? null : 'Não foi encontrada uma única etapa final ativa configurada no funil.'
    };
  }
  if (alvo === 'confirmacao_sms_portabilidade') {
    const etapas = await FunilEtapa.query().where({ ativo: true });
    const correspondentes = etapas.filter(etapa => textoCanonico(etapa.nome) === 'confirmacao sms portabilidade');
    return {
      etapa: correspondentes.length === 1 ? correspondentes[0] : null,
      erro: correspondentes.length === 1 ? null : 'Não foi encontrada uma única etapa ativa chamada Confirmação SMS Portabilidade.'
    };
  }
  const etapa = await FunilEtapa.query().findOne({ codigo: alvo, ativo: true });
  return { etapa, erro: etapa ? null : 'Etapa de destino não encontrada.' };
}

function valorPreenchido(valor) {
  if (Array.isArray(valor)) return valor.length > 0;
  if (valor && typeof valor === 'object') return Object.keys(valor).length > 0;
  const texto = String(valor || '').trim().toLowerCase();
  return Boolean(texto && !['[]', '{}', 'null'].includes(texto));
}

function vendaTemPortabilidade(venda) {
  const itens = json(venda?.valores_unitarios_chips, []);
  const temItemPortado = Array.isArray(itens) && itens.some(item => {
    const tipo = String(item?.tipo_linha || item?.tipo || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return tipo.includes('porta') && Number(item?.quantidade ?? 1) > 0;
  });
  return temItemPortado || valorPreenchido(json(venda?.numeros_portados, venda?.numeros_portados));
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
  const dadosExtraidos = {
    ...campos,
    candidatas: resolucao.candidatas,
    ...(Object.keys(override).length ? { _override: override } : {})
  };
  const revisaoManual = Boolean(registro.revisado_por_id && registro.venda_id);
  const destinoDispensavel = campos.alvo === 'apos_aceite_biometria';
  if ((!revisaoManual && !campos.documento) || (!revisaoManual && !campos.destino && !destinoDispensavel)) return { status: 'revisao', erro: 'E-mail sem campos obrigatórios.', dados_extraidos: JSON.stringify(dadosExtraidos) };
  if (campos.classificacao === 'desconhecido') return { status: 'revisao', erro: 'Destino do e-mail não reconhecido.', dados_extraidos: JSON.stringify(dadosExtraidos) };
  if (!resolucao.venda) return { status: 'revisao', erro: resolucao.erro || 'Não foi possível identificar uma única venda ativa para o documento.', dados_extraidos: JSON.stringify(dadosExtraidos) };
  const venda = resolucao.venda;
  if (campos.classificacao === 'tipo_2') {
    if (!campos.mensagem_operador) return { status: 'revisao', erro: 'Mensagem ao operador não encontrada.', dados_extraidos: JSON.stringify(dadosExtraidos), venda_id: venda.id };
    const problema = await abrirProblemaAutomatico(registro, venda, campos.mensagem_operador);
    return { status: 'concluido', classificacao: 'tipo_2', venda_id: venda.id, problema_id: problema.id, dados_extraidos: JSON.stringify(dadosExtraidos), erro: null, processado_em: formatarSQL() };
  }
  if (campos.classificacao === 'sem_acao') {
    return { status: 'concluido', classificacao: 'sem_acao', venda_id: venda.id, etapa_destino: null, dados_extraidos: JSON.stringify(dadosExtraidos), erro: null, processado_em: formatarSQL() };
  }
  if (campos.classificacao === 'cancelamento') {
    const motivoPadrao = /pedido\s+cancelado\s+pelo\s+cliente/.test(textoCanonico(campos.destino))
      ? 'Pedido cancelado pelo cliente'
      : 'Pedido cancelado pelo consultor';
    const motivo = String(campos.mensagem_operador || '').trim() || motivoPadrao;
    const cancelamento = await vendaService.cancelarVenda(venda.id, {
      motivo,
      usuarioId: null,
      sistema: true,
      origemMovimentacao: 'automacao_gmail',
      automacaoEmailId: registro.id,
      statusFunilEsperado: venda.status_funil || null
    });
    if (cancelamento.status !== 'ok') {
      return { status: 'revisao', erro: cancelamento.message || 'Cancelamento bloqueado pelas regras da venda.', venda_id: venda.id, dados_extraidos: JSON.stringify(dadosExtraidos) };
    }
    return { status: 'concluido', classificacao: 'cancelamento', venda_id: venda.id, etapa_destino: null, dados_extraidos: JSON.stringify(dadosExtraidos), erro: null, processado_em: formatarSQL() };
  }
  const alvoEfetivo = campos.alvo === 'etapa_final' && vendaTemPortabilidade(venda)
    ? 'confirmacao_sms_portabilidade'
    : campos.alvo;
  const destinoResolvido = await resolverEtapaDestino(alvoEfetivo);
  const etapa = destinoResolvido.etapa;
  if (!etapa) return { status: 'revisao', erro: destinoResolvido.erro, venda_id: venda.id, dados_extraidos: JSON.stringify(dadosExtraidos) };
  const atual = await FunilEtapa.query().findOne({ codigo: venda.status_funil });
  if (atual && Number(etapa.ordem) < Number(atual.ordem)) return { status: 'revisao', erro: 'O e-mail tentaria regredir o funil.', venda_id: venda.id, etapa_destino: etapa.codigo, dados_extraidos: JSON.stringify(dadosExtraidos) };
  if (venda.status_funil !== etapa.codigo) {
    const movimento = await vendaService.atualizarStatusVenda(
      venda.id,
      {
        status_funil: etapa.codigo,
        observacao: `Atualização automática pelo Gmail: ${campos.destino || campos.mensagem_operador}`
      },
      null,
      {
        sistema: true,
        origemMovimentacao: 'automacao_gmail',
        automacaoEmailId: registro.id
      }
    );
    if (movimento.status !== 'ok') return { status: 'revisao', erro: movimento.message || 'Movimentação bloqueada pelas regras do funil.', venda_id: venda.id, etapa_destino: etapa.codigo, dados_extraidos: JSON.stringify(dadosExtraidos) };
  }
  return { status: 'concluido', classificacao: 'tipo_1', venda_id: venda.id, etapa_destino: etapa.codigo, dados_extraidos: JSON.stringify(dadosExtraidos), erro: null, processado_em: formatarSQL() };
}

async function processarPendente(item) {
  const tentativas = Number(item.tentativas || 0) + 1;
  const reclamado = await AutomacaoEmail.query()
    .where({ id: item.id, status: 'pendente' })
    .patch({ status: 'processando', tentativas, updated_at: new Date() });
  if (!reclamado) return false;
  const registro = { ...item, status: 'processando', tentativas };
  try { await AutomacaoEmail.query().patchAndFetchById(item.id, await processarRegistro(registro)); }
  catch (error) { await AutomacaoEmail.query().patchAndFetchById(item.id, { status: 'erro', erro: String(error.message || error).slice(0, 2000) }); }
  return true;
}

async function processarPendentes(limite = 20) {
  const limiteTravado = new Date(Date.now() - 10 * 60 * 1000);
  await AutomacaoEmail.query().where('status', 'processando').where('updated_at', '<', formatarSQL(limiteTravado)).patch({ status: 'pendente', erro: 'Processamento anterior interrompido; item recuperado.', updated_at: new Date() });
  const pendentes = await AutomacaoEmail.query().where('status', 'pendente').orderBy('recebido_em').limit(limite);
  let processados = 0;
  for (const item of pendentes) {
    if (await processarPendente(item)) processados += 1;
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

async function enriquecerEtapasCandidatas(itens) {
  const codigos = [...new Set(itens.flatMap(item => (
    Array.isArray(item.dados_extraidos?.candidatas)
      ? item.dados_extraidos.candidatas.map(candidata => candidata.status_funil).filter(Boolean)
      : []
  )))];
  if (!codigos.length) return itens;
  const etapas = await FunilEtapa.query().whereIn('codigo', codigos).select('codigo', 'nome');
  const nomes = new Map(etapas.map(etapa => [etapa.codigo, etapa.nome]));
  return itens.map(item => ({
    ...item,
    dados_extraidos: {
      ...item.dados_extraidos,
      candidatas: Array.isArray(item.dados_extraidos?.candidatas)
        ? item.dados_extraidos.candidatas.map(candidata => ({
          ...candidata,
          status_funil_nome: candidata.status_funil_nome || nomes.get(candidata.status_funil) || candidata.status_funil || 'Sem etapa'
        }))
        : item.dados_extraidos?.candidatas
    }
  }));
}

async function listar(filtros = {}) {
  const pagina = Math.max(1, Number(filtros.page) || 1); const porPagina = Math.min(100, Math.max(10, Number(filtros.per_page) || 25));
  const query = AutomacaoEmail.query().orderBy('recebido_em', 'desc').orderBy('id', 'desc');
  if (filtros.status) query.where('status', filtros.status);
  const resultado = await query.page(pagina - 1, porPagina);
  const data = await enriquecerEtapasCandidatas(resultado.results.map(item => ({ ...item, dados_extraidos: json(item.dados_extraidos) })));
  return { data, total: resultado.total, page: pagina, per_page: porPagina };
}

async function resumo() {
  const linhas = await db('automacao_emails').select('status').count('* as total').groupBy('status');
  const ultima = await db('automacao_emails').max('recebido_em as recebido_em').first();
  return { habilitada: configurado(), ultima_mensagem_em: ultima?.recebido_em || null, contadores: Object.fromEntries(linhas.map(item => [item.status, Number(item.total)])) };
}

async function revisar(id, dados, usuarioId, dependencias = {}) {
  const registro = await AutomacaoEmail.query().findById(id); if (!registro) return null;
  const justificativa = String(dados.justificativa || '').trim(); if (!justificativa) throw Object.assign(new Error('Informe a justificativa.'), { statusCode: 400 });
  const atuais = json(registro.dados_extraidos);
  const { venda, cnpj } = await validarVendaSelecionada(registro, dados, dependencias);
  const vendaId = Number(venda.id);
  const override = { classificacao: dados.classificacao, alvo: dados.etapa_destino || null, mensagem_operador: dados.mensagem_operador || atuais.mensagem_operador, destino: dados.destino || atuais.destino, documento: atuais.documento };
  await AutomacaoEmail.query().patchAndFetchById(id, { venda_id: vendaId, dados_extraidos: JSON.stringify({ ...atuais, cnpj_venda_manual: cnpj, _override: override }), revisado_por_id: usuarioId, justificativa_revisao: justificativa, status: 'pendente', erro: null });
  await processarPendentes(); return AutomacaoEmail.query().findById(id);
}

async function prepararRepeticao(item, carregarCorpo = carregarCorpoGmail) {
  const atualizacao = { status: 'pendente', erro: null };
  if (pontuarCorpoEmail(item.corpo_texto) === 0 && item.gmail_message_id) {
    const corpo = await carregarCorpo(item.gmail_message_id);
    atualizacao.corpo_texto = corpo;
    atualizacao.corpo_hash = corpo ? crypto.createHash('sha256').update(corpo).digest('hex') : null;
  }
  return atualizacao;
}

async function repetir(id) {
  const item = await AutomacaoEmail.query().findById(id);
  if (!item) return null;
  await AutomacaoEmail.query().patchAndFetchById(id, await prepararRepeticao(item));
  await processarPendentes();
  return AutomacaoEmail.query().findById(id);
}

async function repetirRevisoes(carregarCorpo = carregarCorpoGmail) {
  const itens = await AutomacaoEmail.query().where('status', 'revisao').orderBy('recebido_em').orderBy('id');
  const resultado = { selecionados: itens.length, repetidos: 0, falhas: 0 };
  for (const item of itens) {
    try {
      const atualizacao = await prepararRepeticao(item, carregarCorpo);
      const preparado = await AutomacaoEmail.query()
        .where({ id: item.id, status: 'revisao' })
        .patch({ ...atualizacao, updated_at: new Date() });
      if (!preparado) continue;
      resultado.repetidos += 1;
      await processarPendente({ ...item, ...atualizacao, status: 'pendente' });
    } catch (error) {
      resultado.falhas += 1;
      try {
        await AutomacaoEmail.query()
          .where({ id: item.id, status: 'revisao' })
          .patch({ erro: `Falha ao preparar repetição: ${String(error.message || error).slice(0, 1960)}`, updated_at: new Date() });
      } catch {}
    }
  }
  return resultado;
}
async function descartar(id, justificativa, usuarioId) { if (!String(justificativa || '').trim()) throw Object.assign(new Error('Informe a justificativa.'), { statusCode: 400 }); return AutomacaoEmail.query().patchAndFetchById(id, { status: 'descartado', justificativa_revisao: String(justificativa).trim(), revisado_por_id: usuarioId, processado_em: formatarSQL() }); }

async function limparCorposExpirados() { const limite = new Date(); limite.setUTCFullYear(limite.getUTCFullYear() - 1); return AutomacaoEmail.query().whereNotNull('corpo_texto').where('recebido_em', '<', formatarSQL(limite)).patch({ corpo_texto: null, corpo_expirado_em: formatarSQL(), updated_at: new Date() }); }

const STATUS_PROBLEMAS_ABERTOS = ['aberto', 'resolvido', 'correcao_solicitada'];

function filtroProblemas(valor) {
  const status = String(valor || 'abertos').toLowerCase();
  if (!['abertos', 'resolvidos'].includes(status)) {
    throw Object.assign(new Error('Status de problemas inválido.'), { statusCode: 400 });
  }
  return status;
}

function porPaginaProblemas(valor) {
  const numero = Number(valor) || 20;
  return [20, 50, 100].includes(numero) ? numero : 20;
}

function consultaProblemasPorStatus(status) {
  const query = AutomacaoEmail.query().alias('a')
    .join('venda_problemas as p', 'p.id', 'a.problema_id')
    .join('vendas as v', 'v.id', 'a.venda_id');
  return status === 'resolvidos'
    ? query.where('p.status', 'verificado')
    : query.whereIn('p.status', STATUS_PROBLEMAS_ABERTOS);
}

async function contarProblemasPorStatus(status) {
  const resultado = await consultaProblemasPorStatus(status).count('a.id as total').first();
  return Number(resultado?.total || 0);
}

async function resumirVendasProblemas(vendaIds) {
  if (!vendaIds.length) return new Map();
  const vendas = await Venda.query()
    .whereIn('id', vendaIds)
    .select('id', 'vendedora_id', 'operadora_id', 'operadora_atual_id', 'data_venda', 'created_at', 'valores_unitarios_chips')
    .withGraphFetched('[vendedora, vendedoras, operadora, operadoraAtual]')
    .modifyGraph('vendedora', builder => builder.select('id', 'nome'))
    .modifyGraph('vendedoras', builder => builder.select('usuarios.id', 'usuarios.nome').orderBy('venda_vendedoras.ordem', 'asc'))
    .modifyGraph('operadora', builder => builder.select('id', 'nome'))
    .modifyGraph('operadoraAtual', builder => builder.select('id', 'nome'));
  return new Map(vendas.map(venda => {
    const vendedoras = Array.isArray(venda.vendedoras) && venda.vendedoras.length
      ? venda.vendedoras
      : (venda.vendedora ? [venda.vendedora] : []);
    const vendedorasPorId = new Map(vendedoras.map(item => [Number(item.id), item.nome]));
    const chips = json(venda.valores_unitarios_chips, []);
    return [Number(venda.id), {
      vendedoras: vendedoras.map(item => ({ id: item.id, nome: item.nome })),
      data_venda: venda.data_venda || venda.created_at || null,
      data_venda_origem: venda.data_venda ? 'comercial' : 'cadastro',
      chips: (Array.isArray(chips) ? chips : []).map(item => {
        const quantidade = Number(item.quantidade || 0);
        const valorUnitario = Number(String(item.valor_unitario || 0).replace(',', '.')) || 0;
        return {
          quantidade,
          gb: item.gb || null,
          tipo_linha: item.tipo_linha || item.tipo || item.categoria || null,
          operadora_atual: item.operadora_atual_nome || (Number(item.operadora_atual_id) === Number(venda.operadoraAtual?.id) ? venda.operadoraAtual.nome : null),
          operadora_destino: item.operadora_nome || (Number(item.operadora_id) === Number(venda.operadora?.id) ? venda.operadora.nome : null),
          vendedora: item.vendedora_nome || vendedorasPorId.get(Number(item.vendedora_id)) || (vendedoras.length === 1 ? vendedoras[0].nome : null),
          valor_unitario: valorUnitario,
          subtotal: quantidade * valorUnitario
        };
      }).filter(item => item.quantidade > 0)
    }];
  }));
}

async function listarProblemas(filtros = {}) {
  const status = filtroProblemas(filtros.status);
  const pagina = Math.max(1, Number(filtros.page) || 1);
  const porPagina = porPaginaProblemas(filtros.per_page);
  const colunaOrdenacao = status === 'resolvidos' ? 'p.resolvido_em' : 'p.aberto_em';
  const query = consultaProblemasPorStatus(status)
    .select(
      'a.*',
      'p.status as problema_status',
      'p.aberto_em',
      'p.resolvido_em',
      'p.resolvido_por_id',
      'p.resolvido_por_nome',
      'v.nome as venda_nome',
      'v.razao_social',
      'v.cnpj'
    )
    .orderBy(colunaOrdenacao, 'desc')
    .orderBy('p.id', 'desc');
  const [resultado, abertos, resolvidos] = await Promise.all([
    query.page(pagina - 1, porPagina),
    contarProblemasPorStatus('abertos'),
    contarProblemasPorStatus('resolvidos')
  ]);
  const ids = resultado.results.map(item => Number(item.problema_id)).filter(Boolean);
  const vendaIds = [...new Set(resultado.results.map(item => Number(item.venda_id)).filter(Boolean))];
  const [eventos, resumosVendas] = await Promise.all([
    ids.length ? VendaProblemaEvento.query()
      .whereIn('problema_id', ids)
      .withGraphFetched('usuario')
      .modifyGraph('usuario', builder => builder.select('id', 'nome'))
      .orderBy('created_at')
      .orderBy('id') : [],
    resumirVendasProblemas(vendaIds)
  ]);
  const eventosPorProblema = new Map();
  eventos.forEach(evento => {
    const chave = Number(evento.problema_id);
    if (!eventosPorProblema.has(chave)) eventosPorProblema.set(chave, []);
    eventosPorProblema.get(chave).push(evento);
  });
  const data = resultado.results.map(item => {
    const eventosItem = eventosPorProblema.get(Number(item.problema_id)) || [];
    const eventoResolucao = [...eventosItem].reverse().find(evento => evento.tipo === 'resolucao_automatica');
    const resolucao = item.problema_status === 'verificado' ? {
      mensagem: eventoResolucao?.mensagem || '',
      resolvido_em: item.resolvido_em || eventoResolucao?.created_at || null,
      usuario: item.resolvido_por_id || item.resolvido_por_nome || eventoResolucao?.usuario
        ? {
          id: item.resolvido_por_id || eventoResolucao?.usuario?.id || null,
          nome: item.resolvido_por_nome || eventoResolucao?.usuario?.nome || 'Usuário removido'
        }
        : null
    } : null;
    return {
      ...item,
      dados_extraidos: json(item.dados_extraidos),
      eventos: eventosItem,
      resolucao,
      venda_resumo: resumosVendas.get(Number(item.venda_id)) || { vendedoras: [], data_venda: null, data_venda_origem: 'cadastro', chips: [] }
    };
  });
  return { data, total: resultado.total, page: pagina, per_page: porPagina, totals: { abertos, resolvidos } };
}

async function resolverProblemaAutomatico(problemaId, mensagem, usuarioId) {
  const texto = String(mensagem || '').trim(); if (!texto) throw Object.assign(new Error('Informe a resolução.'), { statusCode: 400 });
  const registro = await AutomacaoEmail.query().findOne({ problema_id: problemaId }); if (!registro) return null;
  const agora = formatarSQL();
  await VendaProblema.transaction(async trx => {
    const problema = await VendaProblema.query(trx).findById(problemaId).forUpdate();
    if (!problema) throw Object.assign(new Error('Problema automático não encontrado.'), { statusCode: 404 });
    if (problema.status === 'verificado') throw Object.assign(new Error('Este problema já foi resolvido.'), { statusCode: 409 });
    const usuario = await Usuario.query(trx).findById(usuarioId).select('id', 'nome');
    await VendaProblema.query(trx).patchAndFetchById(problemaId, {
      status: 'verificado', resolvido_em: agora, verificado_em: agora,
      resolvido_por_id: usuario?.id || usuarioId, resolvido_por_nome: usuario?.nome || 'Usuário removido', updated_at: agora
    });
    await VendaProblemaDestinatario.query(trx).where({ problema_id: problemaId, usuario_id: usuarioId }).patch({ resolvido_em: agora, updated_at: agora });
    await VendaProblemaEvento.query(trx).insert({ problema_id: problemaId, usuario_id: usuarioId, tipo: 'resolucao_automatica', mensagem: texto });
    await Notificacao.query(trx).where('source_key', `automacao_email:${registro.id}`).patch({ ativa: false, updated_at: new Date() });
  });
  return { ok: true };
}

async function obterVendaProblemaAutomatico(problemaId) {
  const registro = await AutomacaoEmail.query().findOne({ problema_id: problemaId });
  if (!registro?.venda_id) return null;
  return vendaService.buscarVendaPorId(registro.venda_id);
}

module.exports = { ciclo, coletarEmails, coletarHistorico, processarPendentes, listar, listarVendasCandidatas, resumo, revisar, repetir, repetirRevisoes, descartar, limparCorposExpirados, listarProblemas, resolverProblemaAutomatico, obterVendaProblemaAutomatico, _internals: { calcularDepois, extrairCorpoMensagem, prepararRepeticao, processarPendente, divergenciasSecundarias, motivosInelegibilidade, avaliarCandidatas, validarVendaSelecionada, resolverVenda, resolverEtapaDestino, vendaTemPortabilidade, emailRemetente, documento, centavos, tokenTelegramProblemas, processarRegistro, filtroProblemas, porPaginaProblemas, resumirVendasProblemas, enriquecerEtapasCandidatas } };
