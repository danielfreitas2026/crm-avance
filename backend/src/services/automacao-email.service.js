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
const VendaFunilAutomacao = require('../models/VendaFunilAutomacao');
const VendaHistorico = require('../models/VendaHistorico');
const VendaProblema = require('../models/VendaProblema');
const VendaProblemaDestinatario = require('../models/VendaProblemaDestinatario');
const VendaProblemaEvento = require('../models/VendaProblemaEvento');
const vendaService = require('./venda.service');
const vendaFunilAutomacaoService = require('./venda-funil-automacao.service');
const auditLogService = require('./audit-log.service');
const { validarCnpj } = require('./cnpj.service');
const { chamarApiComToken } = require('./telegram.service');
const { usuarioTemPermissaoLocal } = require('../utils/permissoes');
const { parseUtcDateTime } = require('../utils/datetime');
const { interpretarEmail, textoCanonico } = require('./vivo-email-parser.service');
const { interpretarEmailClaro, normalizarNome } = require('./claro-email-parser.service');
const claroImapService = require('./claro-imap.service');
const imapDiagnosticoService = require('./imap-diagnostico.service');

const PERMISSAO_RESPONSAVEL = 'problemas_pos_venda_responsavel';
const TABELA_ESTADO = 'automacao_email_estado';
const ESTADO_ID = 1;
const ORIGEM_VIVO = 'gmail_vivo';
const ORIGEM_CLARO = 'imap_claro';

function formatarSQL(data = new Date()) { return data.toISOString().slice(0, 19).replace('T', ' '); }
function json(valor, fallback = {}) { if (!valor) return fallback; if (typeof valor === 'object') return valor; try { return JSON.parse(valor); } catch { return fallback; } }
function documento(valor) { return String(valor || '').replace(/\D/g, ''); }
function centavos(valor) { return Math.round(Number(valor) * 100); }
function remetentesPermitidos() { return new Set(String(process.env.GMAIL_VIVO_ALLOWED_SENDERS || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean)); }
function emailRemetente(valor) { return String(valor || '').match(/<([^>]+)>/)?.[1]?.toLowerCase() || String(valor || '').trim().toLowerCase(); }
function configurado() { return String(process.env.GMAIL_VIVO_AUTOMATION_ENABLED || '').toLowerCase() === 'true'; }
function tokenTelegramProblemas() { return String(process.env.TELEGRAM_APROVACOES_BOT_TOKEN || '').trim(); }

function aplicarEstadoFunilAutomacao(venda, estado = null) {
  if (!venda) return venda;
  const statusAutomacao = estado?.status_funil ?? venda.status_funil_automacao ?? venda.status_funil ?? null;
  return {
    ...venda,
    status_funil_real: venda.status_funil_real ?? venda.status_funil ?? null,
    cancelada_em_real: venda.cancelada_em_real ?? venda.cancelada_em ?? null,
    status_funil: statusAutomacao,
    prioridade_funil: estado?.prioridade_funil || venda.prioridade_funil_automacao || venda.prioridade_funil || 'media',
    cancelada_em: estado?.cancelada_em || venda.cancelada_automacao_em || null,
    motivo_cancelamento: estado?.motivo_cancelamento || venda.motivo_cancelamento_automacao || null
  };
}

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

async function validarContaGmail(token, buscar = gmailGet) {
  const configurada = String(process.env.GMAIL_VIVO_ACCOUNT || '').trim().toLowerCase();
  if (!configurada) return { verificada: false };
  const resposta = await buscar('profile', token);
  const encontrada = String(resposta.data?.emailAddress || '').trim().toLowerCase();
  if (!encontrada || encontrada !== configurada) {
    const erro = new Error('A credencial OAuth pertence a outra conta Gmail.');
    erro.code = 'GMAIL_ACCOUNT_MISMATCH';
    throw erro;
  }
  return { verificada: true };
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
    origem: ORIGEM_VIVO, operadora: 'Vivo', identificador_remoto: mensagem.id,
    chave_deduplicacao: crypto.createHash('sha256').update(`${ORIGEM_VIVO}:${mensagem.id}`).digest('hex'),
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
  const ultimaUtc = parseUtcDateTime(ultima);
  return Math.max(Math.floor((ultimaUtc || inicio).getTime() / 1000) - 300, Math.floor(inicio.getTime() / 1000));
}

async function coletarEmails({ desdeInicio = false } = {}, dependencias = {}) {
  if (!configurado()) return { habilitado: false, coletados: 0 };
  const inicio = new Date(process.env.GMAIL_VIVO_PROCESS_AFTER || '');
  if (Number.isNaN(inicio.getTime())) throw new Error('GMAIL_VIVO_PROCESS_AFTER inválido ou ausente.');
  const ultima = await AutomacaoEmail.query().max('recebido_em as valor').first();
  const depois = calcularDepois(inicio, ultima?.valor, desdeInicio);
  const obterToken = dependencias.tokenAcesso || tokenAcesso;
  const buscarGmail = dependencias.gmailGet || gmailGet;
  const registrar = dependencias.registrarMensagem || registrarMensagem;
  const token = await obterToken();
  await validarContaGmail(token, buscarGmail);
  let pageToken;
  let coletados = 0;
  do {
    const resposta = await buscarGmail('messages', token, { q: `after:${depois}`, maxResults: 100, pageToken });
    for (const item of resposta.data.messages || []) if (await registrar(item, token)) coletados += 1;
    pageToken = resposta.data.nextPageToken;
  } while (pageToken);
  return { habilitado: true, coletados };
}

async function coletarHistorico(origem = ORIGEM_VIVO) {
  const claro = origem === ORIGEM_CLARO;
  if (![ORIGEM_VIVO, ORIGEM_CLARO].includes(origem)) throw Object.assign(new Error('Origem de automação inválida.'), { statusCode: 400 });
  const coleta = claro ? await claroImapService.coletarEmailsClaro({ desdeInicio: true }) : await coletarEmails({ desdeInicio: true });
  if (!coleta.habilitado) throw Object.assign(new Error(`A automação ${claro ? 'IMAP Claro' : 'Gmail'} está desabilitada.`), { statusCode: 409 });
  const processados = claro ? await processarPendentesOrigem(ORIGEM_CLARO) : await processarPendentesOrigem(ORIGEM_VIVO);
  return { ...coleta, processados };
}

async function diagnosticarImap() {
  return imapDiagnosticoService.executarDiagnostico();
}

async function buscarCandidatas(campos) {
  const doc = documento(campos.documento);
  if (![11, 14].includes(doc.length)) return [];
  const exprVenda = "REPLACE(REPLACE(REPLACE(REPLACE(v.cnpj, '.', ''), '/', ''), '-', ''), ' ', '')";
  const exprCliente = "REPLACE(REPLACE(REPLACE(REPLACE(cliente.cnpj, '.', ''), '/', ''), '-', ''), ' ', '')";
  const vendas = await Venda.query().alias('v')
    .leftJoinRelated('cliente')
    .leftJoin('venda_funil_automacoes as vfa', 'vfa.venda_id', 'v.id')
    .leftJoin('funil_etapas as etapa_atual', 'etapa_atual.codigo', 'vfa.status_funil')
    .select(
      'v.*',
      'vfa.status_funil as status_funil_automacao',
      'vfa.prioridade_funil as prioridade_funil_automacao',
      'vfa.cancelada_em as cancelada_automacao_em',
      'vfa.motivo_cancelamento as motivo_cancelamento_automacao',
      'etapa_atual.nome as status_funil_nome'
    )
    .where(builder => builder.whereRaw(`${exprVenda} = ?`, [doc]).orWhereRaw(`${exprCliente} = ?`, [doc]))
    .whereNull('v.excluido_em').withGraphFetched('[cliente, operadora, tipoVenda, vendedora, vendedoras, criador]');
  return vendas.map(venda => aplicarEstadoFunilAutomacao(venda));
}

async function carregarVendasClaro() {
  return Venda.query().alias('v')
    .join('operadoras as op', 'op.id', 'v.operadora_id')
    .leftJoin('venda_funil_automacoes as vfa', 'vfa.venda_id', 'v.id')
    .leftJoin('funil_etapas as etapa_atual', 'etapa_atual.codigo', 'vfa.status_funil')
    .select(
      'v.*', 'op.nome as operadora_nome', 'vfa.status_funil as status_funil_automacao',
      'vfa.prioridade_funil as prioridade_funil_automacao',
      'vfa.cancelada_em as cancelada_automacao_em',
      'vfa.motivo_cancelamento as motivo_cancelamento_automacao',
      'etapa_atual.nome as status_funil_nome'
    )
    .withGraphFetched('[cliente, operadora, tipoVenda]');
}

async function buscarCandidatasClaro(campos, recebidoEm = null, vendasCarregadas = null) {
  const nome = normalizarNome(campos.empresa);
  if (!nome) return [];
  const vendas = vendasCarregadas || await carregarVendasClaro();
  const exatas = vendas.filter(venda => razoesClaro(venda).includes(nome));
  if (exatas.length) return exatas.map(venda => aplicarEstadoFunilAutomacao(venda));
  const pontuadas = vendas.map(venda => ({ venda, pontuacao: Math.max(0, ...razoesClaro(venda).map(outro => similaridadeClaro(nome, outro))) }))
    .sort((a, b) => b.pontuacao - a.pontuacao);
  if (!pontuadas.length || pontuadas[0].pontuacao < 0.94
    || (pontuadas[1] && pontuadas[0].pontuacao - pontuadas[1].pontuacao < 0.08)) return [];
  return [aplicarEstadoFunilAutomacao(pontuadas[0].venda)];
}

function razoesClaro(venda) {
  const legais = [venda.razao_social, venda.cliente?.razao_social].map(normalizarNome).filter(Boolean);
  const nomes = [venda.nome, venda.cliente?.nome].map(normalizarNome).filter(Boolean);
  for (const nome of nomes) {
    if (legais.some(razao => razao === nome || (razao.startsWith(`${nome} `)
      && /^(?:ltda|s a|sa|eireli|me)$/.test(razao.slice(nome.length + 1))))) legais.push(nome);
  }
  return [...new Set(legais)];
}

function similaridadeClaro(a, b) {
  const palavrasA = new Set(a.split(' '));
  const palavrasB = new Set(b.split(' '));
  const comuns = [...palavrasA].filter(palavra => palavrasB.has(palavra)).length;
  if (comuns / palavrasA.size < 0.8 || comuns / palavrasB.size < 0.8) return 0;
  const anterior = Array.from({ length: b.length + 1 }, (_, indice) => indice);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = anterior[0];
    anterior[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const acima = anterior[j];
      anterior[j] = Math.min(anterior[j] + 1, anterior[j - 1] + 1, diagonal + Number(a[i - 1] !== b[j - 1]));
      diagonal = acima;
    }
  }
  return 1 - anterior[b.length] / Math.max(a.length, b.length);
}

function motivosExclusaoClaro(venda, recebidoEm, finais) {
  const motivos = [];
  if (String(venda.operadora?.nome || venda.operadora_nome || '').trim().toLowerCase() !== 'claro') motivos.push('operadora diferente de Claro');
  if (venda.excluido_em) motivos.push('venda excluída');
  if (!venda.enviada_pos_venda_em) motivos.push('venda não enviada ao pós-venda');
  const recebido = instanteUtc(recebidoEm);
  const criada = instanteUtc(venda.criado_em || venda.created_at);
  if (recebido !== null && criada !== null && criada > recebido) {
    const dataVenda = venda.data_venda instanceof Date && !Number.isNaN(venda.data_venda.getTime())
      ? venda.data_venda.toISOString().slice(0, 10) : String(venda.data_venda || '').slice(0, 10);
    const instanteVenda = instanteUtc(dataVenda);
    const dataValida = /^\d{4}-\d{2}-\d{2}$/.test(dataVenda)
      && instanteVenda !== null && new Date(instanteVenda).toISOString().slice(0, 10) === dataVenda;
    if (!dataValida || instanteVenda > recebido) motivos.push('venda cadastrada após o email sem data da venda anterior válida');
  }
  if (venda.cancelada_em) motivos.push('venda cancelada no Funil de Automações');
  if (finais.includes(venda.status_funil)) motivos.push('venda concluída no Funil de Automações');
  return motivos;
}

async function resolverVendaClaro(registro, campos, contexto = {}) {
  const candidatas = await buscarCandidatasClaro(campos, registro.recebido_em, contexto.vendas);
  const finais = contexto.finais || await codigosEtapasFinais();
  const motivos = new Map(candidatas.map(venda => [venda.id, motivosExclusaoClaro(venda, registro.recebido_em, finais)]));
  const ativas = candidatas.filter(venda => !motivos.get(venda.id).length);
  const duplicadas = candidatas.length > 1 && candidatas.every(venda =>
    razoesClaro(venda).includes(normalizarNome(campos.empresa)));
  const auditoria = candidatas.map(venda => ({
    id: venda.id,
    nome: venda.nome,
    razao_social: venda.razao_social || venda.nome || '',
    status_funil: venda.status_funil || null,
    status_funil_nome: venda.status_funil_nome || venda.status_funil || 'Sem etapa',
    elegivel: ativas.includes(venda),
    automaticamente_compativel: ativas.includes(venda),
    inelegibilidades: motivos.get(venda.id),
    divergencias: [],
    vendedores: []
  }));
  if (registro.revisado_por_id && registro.venda_id) {
    const selecionada = ativas.find(venda => Number(venda.id) === Number(registro.venda_id));
    return selecionada
      ? { venda: selecionada, candidatas: auditoria.map(item => ({ ...item, manual: Number(item.id) === Number(selecionada.id) })), erro: null }
      : { venda: null, candidatas: auditoria, erro: 'A venda Claro selecionada manualmente não está ativa ou não corresponde ao nome do e-mail.' };
  }
  if (duplicadas) return { venda: null, candidatas: auditoria, erro: 'Mais de uma venda distinta possui a mesma razão social; revisão manual obrigatória.' };
  if (ativas.length === 1) return { venda: ativas[0], candidatas: auditoria, erro: null };
  if (ativas.length > 1) return { venda: null, candidatas: auditoria, erro: 'Mais de uma venda Claro ativa possui o mesmo nome/razão social.' };
  if (candidatas.length) return { venda: null, candidatas: auditoria, erro: `Venda encontrada, mas inelegível: ${[...new Set(auditoria.flatMap(item => item.inelegibilidades))].join('; ')}.` };
  return { venda: null, candidatas: [], erro: 'Não foi encontrada uma venda Claro com razão social correspondente com segurança.' };
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

function instanteUtc(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor.getTime();
  const texto = String(valor).trim();
  const data = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(texto) ? texto : `${texto.replace(' ', 'T')}Z`);
  return Number.isNaN(data.getTime()) ? null : data.getTime();
}

function divergenciasSecundarias(venda, campos, recebidoEm = null) {
  const divergencias = [];
  if (campos.data_venda && String(venda.data_venda || '').slice(0, 10) !== campos.data_venda) divergencias.push('data da venda divergente');
  if (campos.quantidade !== null && campos.quantidade !== undefined && Number(venda.quantidade_linhas) !== Number(campos.quantidade)) divergencias.push('quantidade divergente');
  if (campos.valor_mensal !== null && campos.valor_mensal !== undefined && centavos(venda.valor_total) !== centavos(campos.valor_mensal)) divergencias.push('valor mensal divergente');
  const recebido = instanteUtc(recebidoEm);
  const criada = instanteUtc(venda.criado_em || venda.created_at);
  if (recebido !== null && criada !== null && recebido < criada) divergencias.push('e-mail recebido antes da criação da venda');
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
  const compativeis = avaliadas.filter(item => item.auditoria.automaticamente_compativel);
  return compativeis.length === 1 ? compativeis[0].venda : null;
}

function detalhesChipsVenda(venda) {
  const chips = vendaService.normalizarItensChips(venda.valores_unitarios_chips)
    .map(item => ({
      quantidade: item.quantidade,
      tipo_linha: item.tipo_linha,
      valor_unitario: item.valor_unitario
    }));
  const labels = { novo: 'Novo', portabilidade: 'Portabilidade' };
  const tipos = Array.from(new Set(chips.map(item => labels[item.tipo_linha]).filter(Boolean)));
  return {
    tipo_venda: tipos.join(' e ') || venda.tipoVenda?.nome || null,
    chips
  };
}

function avaliarCandidatas(candidatas, campos, etapasFinais, { cancelamento = false, recebidoEm = null } = {}) {
  const avaliadas = candidatas.map(venda => {
    const inelegibilidades = motivosInelegibilidade(venda, etapasFinais, { cancelamento });
    const divergencias = divergenciasSecundarias(venda, campos, recebidoEm);
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
        automaticamente_compativel: inelegibilidades.length === 0 && divergencias.length === 0,
        inelegibilidades,
        motivo_bloqueio: inelegibilidades.join(', ') || null,
        divergencias
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
  } else if (!selecionada && elegiveis.some(item => item.auditoria.divergencias.length > 0)) {
    erro = 'As vendas encontradas possuem divergências e exigem revisão manual.';
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

  if (registro.origem === ORIGEM_CLARO) {
    const candidatas = await (dependencias.buscarClaro || buscarCandidatasClaro)(atuais, registro.recebido_em);
    const finais = await (dependencias.etapasFinais || codigosEtapasFinais)();
    const venda = candidatas.find(item => Number(item.id) === vendaId);
    if (!venda || motivosExclusaoClaro(venda, registro.recebido_em, finais).length) {
      throw Object.assign(new Error('A venda Claro selecionada não está ativa ou não corresponde ao nome do e-mail.'), { statusCode: 400 });
    }
    return { venda, cnpj: null };
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
  if (registro.origem === ORIGEM_CLARO) {
    const resultado = await resolverVendaClaro({ ...registro, revisado_por_id: null, venda_id: null }, atuais);
    return {
      automacao_id: Number(registro.id),
      empresa: atuais.empresa || null,
      cnpj: null,
      cnpj_original: null,
      vendas: resultado.candidatas
    };
  }
  const original = documento(atuais.documento);
  const cnpj = cnpjValido(cnpjInformado || original);
  const campos = { ...atuais, documento: cnpj };
  const cancelamento = (registro.classificacao || atuais.classificacao) === 'cancelamento' || atuais.alvo === 'cancelar_venda';
  const buscar = dependencias.buscar || buscarCandidatas;
  const obterEtapas = dependencias.etapasFinais || codigosEtapasFinais;
  const candidatas = await buscar(campos);
  const resultado = avaliarCandidatas(candidatas, campos, await obterEtapas(), { cancelamento, recebidoEm: registro.recebido_em });
  const vendasPorId = new Map(candidatas.map(venda => [Number(venda.id), venda]));
  return {
    automacao_id: Number(registro.id),
    cnpj,
    cnpj_original: original.length === 14 ? original : null,
    vendas: resultado.candidatas.map(venda => ({
      ...venda,
      ...detalhesChipsVenda(vendasPorId.get(Number(venda.id)) || venda)
    }))
  };
}

async function resolverVenda(registro, campos) {
  if (registro.origem === ORIGEM_CLARO) return resolverVendaClaro(registro, campos);
  const etapasFinais = await codigosEtapasFinais();
  const cancelamento = campos.classificacao === 'cancelamento' || campos.alvo === 'cancelar_venda';
  if (registro.revisado_por_id && registro.venda_id) {
    const vendaReal = await Venda.query().findById(registro.venda_id).withGraphFetched('[cliente, operadora]');
    if (!vendaReal) return { venda: null, candidatas: [], erro: 'A venda selecionada manualmente não foi encontrada.' };
    const estado = await VendaFunilAutomacao.query().findById(registro.venda_id);
    const escolhida = aplicarEstadoFunilAutomacao(vendaReal, estado);
    const resultado = avaliarCandidatas([escolhida], campos, etapasFinais, { cancelamento, recebidoEm: registro.recebido_em });
    resultado.candidatas[0].manual = true;
    if (resultado.candidatas[0].elegivel) {
      resultado.venda = escolhida;
      resultado.erro = null;
    } else {
      resultado.venda = null;
      resultado.erro = cancelamento
        ? 'A venda selecionada manualmente está concluída ou excluída e não pode ser cancelada automaticamente.'
        : 'A venda selecionada manualmente está concluída, cancelada ou excluída e não pode receber atualizações.';
    }
    return resultado;
  }
  const candidatas = await buscarCandidatas(campos);
  return avaliarCandidatas(candidatas, campos, etapasFinais, { cancelamento, recebidoEm: registro.recebido_em });
}

async function revalidarResolucaoAutomatica(registro, campos, vendaId) {
  if (registro.revisado_por_id) return null;
  const resolucao = await resolverVenda(registro, campos);
  if (!resolucao.venda || Number(resolucao.venda.id) !== Number(vendaId)) {
    return resolucao.erro || 'A correspondência da venda mudou e exige revisão manual.';
  }
  return null;
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
  const claro = registro.origem === ORIGEM_CLARO;
  const camposBase = claro
    ? interpretarEmailClaro(registro.assunto, registro.corpo_texto)
    : interpretarEmail(registro.corpo_texto);
  const override = json(registro.dados_extraidos)._override || {};
  const campos = { ...camposBase, ...override, ...(claro ? { autenticacao_email: json(registro.dados_extraidos).autenticacao_email } : {}) };
  if (claro && !campos.estrutura_valida) return { status: 'revisao', classificacao: 'desconhecido', erro: 'Formato do e-mail Claro não reconhecido.', dados_extraidos: JSON.stringify(campos) };
  if (claro && (!registro.autenticacao_valida || json(registro.dados_extraidos).autenticacao_email?.metodo !== 'dkim_original')) return { status: 'revisao', erro: 'Origem não comprovada por assinatura DKIM do email original.', dados_extraidos: JSON.stringify(campos) };
  const resolucao = await resolverVenda(registro, campos);
  const dadosExtraidos = {
    ...campos,
    candidatas: resolucao.candidatas,
    ...(Object.keys(override).length ? { _override: override } : {})
  };
  const revisaoManual = Boolean(registro.revisado_por_id && registro.venda_id);
  const destinoDispensavel = campos.alvo === 'apos_aceite_biometria';
  if ((!claro && !revisaoManual && !campos.documento) || (!revisaoManual && !campos.destino && !destinoDispensavel)) return { status: 'revisao', erro: 'E-mail sem campos obrigatórios.', dados_extraidos: JSON.stringify(dadosExtraidos) };
  if (campos.classificacao === 'desconhecido') return { status: 'revisao', erro: 'Destino do e-mail não reconhecido.', dados_extraidos: JSON.stringify(dadosExtraidos) };
  if (!resolucao.venda) return { status: 'revisao', erro: resolucao.erro || 'Não foi possível identificar uma única venda ativa para o documento.', dados_extraidos: JSON.stringify(dadosExtraidos) };
  const venda = resolucao.venda;
  const erroRevalidacao = await revalidarResolucaoAutomatica(registro, campos, venda.id);
  if (erroRevalidacao) return { status: 'revisao', erro: erroRevalidacao, venda_id: venda.id, dados_extraidos: JSON.stringify(dadosExtraidos) };
  if (campos.classificacao === 'tipo_2') {
    if (!campos.mensagem_operador) return { status: 'revisao', erro: 'Mensagem ao operador não encontrada.', dados_extraidos: JSON.stringify(dadosExtraidos), venda_id: venda.id };
    const problema = await abrirProblemaAutomatico(registro, venda, campos.mensagem_operador);
    return { status: 'concluido', classificacao: 'tipo_2', venda_id: venda.id, problema_id: problema.id, dados_extraidos: JSON.stringify(dadosExtraidos), erro: null, processado_em: formatarSQL() };
  }
  if (campos.classificacao === 'sem_acao') {
    return { status: 'concluido', classificacao: 'sem_acao', venda_id: venda.id, etapa_destino: null, dados_extraidos: JSON.stringify(dadosExtraidos), erro: null, processado_em: formatarSQL() };
  }
  if (claro && !claroImapService.acoesAutomaticasHabilitadas()) {
    return { status: 'revisao', classificacao: campos.classificacao, venda_id: venda.id, erro: 'Ações automáticas da Claro aguardam homologação.', dados_extraidos: JSON.stringify(dadosExtraidos) };
  }
  if (campos.classificacao === 'cancelamento') {
    const motivoPadrao = /pedido\s+cancelado\s+pelo\s+cliente/.test(textoCanonico(campos.destino))
      ? 'Pedido cancelado pelo cliente'
      : 'Pedido cancelado pelo consultor';
    const motivo = String(campos.mensagem_operador || '').trim() || motivoPadrao;
    const cancelamento = await vendaFunilAutomacaoService.cancelar(venda.id, { motivo }, {
      origem: 'automacao_gmail',
      automacaoEmailId: registro.id,
      ...(registro.recebido_em ? { recebidoEm: registro.recebido_em } : {})
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
  if (atual && Number(etapa.ordem) < Number(atual.ordem)) return { status: 'regressao_funil', erro: 'O e-mail tentaria regredir o funil.', venda_id: venda.id, etapa_destino: etapa.codigo, dados_extraidos: JSON.stringify(dadosExtraidos) };
  const precisaAtualizarMarcadores = claro && (campos.marcar_aceite || campos.marcar_biometria);
  if (venda.status_funil !== etapa.codigo || precisaAtualizarMarcadores) {
    const movimento = await vendaFunilAutomacaoService.movimentar(
      venda.id,
      {
        status_funil: etapa.codigo,
        observacao: `Atualização automática por e-mail ${claro ? 'Claro' : 'Gmail'}: ${campos.destino || campos.mensagem_operador}`
      },
      {
        origem: claro ? 'automacao_imap_claro' : 'automacao_gmail',
        automacaoEmailId: registro.id,
        ...(claro ? { marcadores: { aceite: campos.marcar_aceite, biometria: campos.marcar_biometria } } : {}),
        ...(registro.recebido_em ? { recebidoEm: registro.recebido_em } : {})
      }
    );
    if (movimento.status !== 'ok') {
      const regressao = movimento.message === 'O e-mail tentaria regredir o funil.';
      return { status: regressao ? 'regressao_funil' : 'revisao', erro: movimento.message || 'Movimentação bloqueada pelas regras do funil.', venda_id: venda.id, etapa_destino: etapa.codigo, dados_extraidos: JSON.stringify(dadosExtraidos) };
    }
  }
  return { status: 'concluido', classificacao: 'tipo_1', venda_id: venda.id, etapa_destino: etapa.codigo, dados_extraidos: JSON.stringify(dadosExtraidos), erro: null, processado_em: formatarSQL() };
}

async function processarPendente(item) {
  const tentativas = Number(item.tentativas || 0) + 1;
  const reclamado = await AutomacaoEmail.query()
    .where({ id: item.id, status: 'pendente' })
    .patch({ status: 'processando', classificacao: null, tentativas, updated_at: new Date() });
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

async function processarPendentesOrigem(origem, limite = 20) {
  const limiteTravado = new Date(Date.now() - 10 * 60 * 1000);
  await AutomacaoEmail.query().where({ status: 'processando', origem }).where('updated_at', '<', formatarSQL(limiteTravado)).patch({ status: 'pendente', erro: 'Processamento anterior interrompido; item recuperado.', updated_at: new Date() });
  const pendentes = await AutomacaoEmail.query().where({ status: 'pendente', origem }).orderBy('recebido_em').limit(limite);
  let processados = 0;
  for (const item of pendentes) if (await processarPendente(item)) processados += 1;
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

function mensagemErroIntegracao(error) {
  const resposta = error?.response;
  const payload = resposta?.data;
  const erroGoogle = payload?.error;
  const codigo = typeof erroGoogle === 'string'
    ? erroGoogle
    : erroGoogle?.status || erroGoogle?.code || error?.code || null;
  const detalhe = payload?.error_description || erroGoogle?.message || error?.message || 'Falha desconhecida.';
  const prefixo = resposta?.status ? `Google ${resposta.status}` : null;
  const falhaImap = error?.authenticationFailed ? 'Falha de autenticação IMAP' : null;
  const statusImap = error?.responseStatus ? `IMAP ${error.responseStatus}` : null;
  const codigoImap = error?.serverResponseCode || null;
  const respostaImap = error?.responseText || null;
  const mensagemGenerica = error?.message === 'Command failed' && (falhaImap || statusImap || codigoImap || respostaImap)
    ? null
    : detalhe;
  return [...new Set([prefixo, codigo, falhaImap, statusImap, codigoImap, respostaImap, mensagemGenerica].filter(Boolean))]
    .join(' · ')
    .replace(/(bearer|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password|senha)\s*[:=]?\s*[^\s,;]+/gi, '$1 [removido]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

async function salvarEstadoIntegracao(patch, database = db) {
  const dados = { ...patch, updated_at: new Date() };
  const atualizados = await database(TABELA_ESTADO).where({ id: ESTADO_ID }).update(dados);
  if (!atualizados) {
    await database(TABELA_ESTADO).insert({ id: ESTADO_ID, ...dados }).onConflict('id').merge();
  }
}

async function registrarInicioCiclo(database = db) {
  await salvarEstadoIntegracao({ estado: 'processando', ultimo_inicio_em: formatarSQL() }, database);
}

async function registrarSucessoCiclo(coletados, database = db) {
  const agora = formatarSQL();
  await salvarEstadoIntegracao({
    estado: 'ok', fase_erro: null, ultimo_fim_em: agora, ultimo_sucesso_em: agora,
    ultimo_erro_em: null, ultimo_erro: null, falhas_consecutivas: 0,
    emails_ultimo_ciclo: Number(coletados || 0)
  }, database);
}

async function registrarFalhaCiclo(fase, error, database = db) {
  const atual = await database(TABELA_ESTADO).where({ id: ESTADO_ID }).first();
  await salvarEstadoIntegracao({
    estado: 'erro', fase_erro: fase, ultimo_fim_em: formatarSQL(), ultimo_erro_em: formatarSQL(),
    ultimo_erro: mensagemErroIntegracao(error),
    falhas_consecutivas: Number(atual?.falhas_consecutivas || 0) + 1
  }, database);
}

async function ciclo(dependencias = {}) {
  const database = dependencias.database || db;
  const coletar = dependencias.coletarEmails || coletarEmails;
  const processar = dependencias.processarPendentes || (() => processarPendentesOrigem(ORIGEM_VIVO));
  const enviarTelegrams = dependencias.repetirTelegrams || repetirTelegrams;
  await registrarInicioCiclo(database);
  let fase = 'coleta';
  try {
    const coleta = await coletar();
    if (!coleta.habilitado) {
      await salvarEstadoIntegracao({ estado: 'desabilitado', fase_erro: null, ultimo_fim_em: formatarSQL(), ultimo_erro: null, falhas_consecutivas: 0 }, database);
      return coleta;
    }
    fase = 'processamento';
    await processar();
    fase = 'telegram';
    await enviarTelegrams();
    await registrarSucessoCiclo(coleta.coletados, database);
    return coleta;
  } catch (error) {
    try { await registrarFalhaCiclo(fase, error, database); } catch { }
    throw error;
  }
}

async function salvarEstadoIntegracaoClaro(patch, database = db) {
  const dados = { ...patch, updated_at: new Date() };
  const atualizados = await database(TABELA_ESTADO).where({ origem: ORIGEM_CLARO }).update(dados);
  if (!atualizados) await database(TABELA_ESTADO).insert({ id: 2, origem: ORIGEM_CLARO, ...dados }).onConflict('id').merge();
}

async function cicloClaro(dependencias = {}) {
  const database = dependencias.database || db;
  const coletar = dependencias.coletarEmails || claroImapService.coletarEmailsClaro;
  const processar = dependencias.processarPendentes || (() => processarPendentesOrigem(ORIGEM_CLARO));
  await salvarEstadoIntegracaoClaro({ estado: 'processando', ultimo_inicio_em: formatarSQL() }, database);
  let fase = 'coleta';
  try {
    const coleta = await coletar();
    if (!coleta.habilitado) {
      await salvarEstadoIntegracaoClaro({ estado: 'desabilitado', fase_erro: null, ultimo_fim_em: formatarSQL(), ultimo_erro: null, falhas_consecutivas: 0 }, database);
      return coleta;
    }
    fase = 'processamento';
    await processar();
    const agora = formatarSQL();
    await salvarEstadoIntegracaoClaro({
      estado: 'ok', fase_erro: null, ultimo_fim_em: agora, ultimo_sucesso_em: agora,
      ultimo_erro_em: null, ultimo_erro: null, falhas_consecutivas: 0,
      emails_ultimo_ciclo: Number(coleta.coletados || 0)
    }, database);
    return coleta;
  } catch (error) {
    try {
      const atual = await database(TABELA_ESTADO).where({ origem: ORIGEM_CLARO }).first();
      await salvarEstadoIntegracaoClaro({
        estado: 'erro', fase_erro: fase, ultimo_fim_em: formatarSQL(), ultimo_erro_em: formatarSQL(),
        ultimo_erro: mensagemErroIntegracao(error), falhas_consecutivas: Number(atual?.falhas_consecutivas || 0) + 1
      }, database);
    } catch { }
    throw error;
  }
}

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
  const titulo = String(filtros.titulo || '').trim();
  const query = AutomacaoEmail.query().orderBy('recebido_em', 'desc').orderBy('id', 'desc');
  if (filtros.status) query.where('status', filtros.status);
  if (filtros.classificacao) query.where('classificacao', filtros.classificacao);
  if (filtros.operadora) query.where('operadora', filtros.operadora);
  if (titulo) query.whereRaw("LOCATE(LOWER(?), LOWER(COALESCE(assunto, ''))) > 0", [titulo]);
  const resultado = await query.page(pagina - 1, porPagina);
  const data = await enriquecerEtapasCandidatas(resultado.results.map(item => ({ ...item, dados_extraidos: json(item.dados_extraidos) })));
  return { data, total: resultado.total, page: pagina, per_page: porPagina };
}

function estadoPublicoIntegracao(registro, ativa, intervalo) {
  const ultimo = parseUtcDateTime(registro?.ultimo_inicio_em);
  const limite = Math.max(intervalo * 3, 5 * 60 * 1000);
  if (!ativa) return 'desabilitado';
  if (!ultimo || registro?.estado === 'desabilitado') return 'aguardando';
  if (registro?.estado === 'erro' || (registro?.estado === 'processando' && registro?.ultimo_erro)) return 'falha';
  if (Date.now() - ultimo.getTime() > limite) return 'sem_resposta';
  return 'ativo';
}

async function resumo(database = db) {
  const claroAtiva = claroImapService.habilitado();
  const [linhas, cancelamentos, ultima, estado, estadoClaro] = await Promise.all([
    database('automacao_emails').select('status').count('* as total').groupBy('status'),
    database('automacao_emails').where('classificacao', 'cancelamento').count('* as total').first(),
    database('automacao_emails').max('recebido_em as recebido_em').first(),
    database(TABELA_ESTADO).where({ id: ESTADO_ID }).first(),
    claroAtiva ? database(TABELA_ESTADO).where({ id: 2 }).first() : Promise.resolve(null)
  ]);
  const habilitada = configurado();
  const intervaloMs = Math.max(30000, Number(process.env.GMAIL_VIVO_POLL_INTERVAL_MS) || 60000);
  function dadosIntegracao(registro, ativa, intervalo) {
    return {
      estado: estadoPublicoIntegracao(registro, ativa, intervalo),
      fase_erro: registro?.fase_erro || null,
      ultimo_inicio_em: registro?.ultimo_inicio_em || null,
      ultimo_fim_em: registro?.ultimo_fim_em || null,
      ultimo_sucesso_em: registro?.ultimo_sucesso_em || null,
      ultimo_erro_em: registro?.ultimo_erro_em || null,
      ultimo_erro: registro?.ultimo_erro || null,
      falhas_consecutivas: Number(registro?.falhas_consecutivas || 0),
      emails_ultimo_ciclo: Number(registro?.emails_ultimo_ciclo || 0)
    };
  }
  const vivo = dadosIntegracao(estado, habilitada, intervaloMs);
  const estadoPublico = vivo.estado;
  const claroIntervalo = Math.max(30000, Number(process.env.CLARO_IMAP_POLL_INTERVAL_MS) || 60000);
  const claro = dadosIntegracao(estadoClaro, claroAtiva, claroIntervalo);
  return {
    habilitada,
    ultima_mensagem_em: ultima?.recebido_em || null,
    contadores: Object.fromEntries(linhas.map(item => [item.status, Number(item.total)])),
    contadores_classificacao: { cancelamento: Number(cancelamentos?.total || 0) },
    integracao: {
      estado: estadoPublico,
      fase_erro: estado?.fase_erro || null,
      ultimo_inicio_em: estado?.ultimo_inicio_em || null,
      ultimo_fim_em: estado?.ultimo_fim_em || null,
      ultimo_sucesso_em: estado?.ultimo_sucesso_em || null,
      ultimo_erro_em: estado?.ultimo_erro_em || null,
      ultimo_erro: estado?.ultimo_erro || null,
      falhas_consecutivas: Number(estado?.falhas_consecutivas || 0),
      emails_ultimo_ciclo: Number(estado?.emails_ultimo_ciclo || 0)
    },
    integracoes: { gmail_vivo: vivo, imap_claro: claro },
    habilitada_claro: claroAtiva
  };
}

async function revisar(id, dados, usuarioId, dependencias = {}) {
  const registro = await AutomacaoEmail.query().findById(id); if (!registro) return null;
  const justificativa = String(dados.justificativa || '').trim(); if (!justificativa) throw Object.assign(new Error('Informe a justificativa.'), { statusCode: 400 });
  const atuais = json(registro.dados_extraidos);
  const { venda, cnpj } = await validarVendaSelecionada(registro, dados, dependencias);
  const vendaId = Number(venda.id);
  const override = { classificacao: dados.classificacao, alvo: dados.etapa_destino || null, mensagem_operador: dados.mensagem_operador || atuais.mensagem_operador, destino: dados.destino || atuais.destino, documento: atuais.documento, ...(registro.origem === ORIGEM_CLARO ? { empresa: atuais.empresa, estrutura_valida: atuais.estrutura_valida } : {}) };
  await AutomacaoEmail.query().patchAndFetchById(id, { venda_id: vendaId, dados_extraidos: JSON.stringify({ ...atuais, cnpj_venda_manual: cnpj, _override: override }), revisado_por_id: usuarioId, justificativa_revisao: justificativa, status: 'pendente', erro: null });
  await processarPendentesOrigem(registro.origem || ORIGEM_VIVO); return AutomacaoEmail.query().findById(id);
}

async function prepararRepeticao(item, carregarCorpo = carregarCorpoGmail) {
  const atualizacao = { status: 'pendente', erro: null };
  if (item.origem !== ORIGEM_CLARO && pontuarCorpoEmail(item.corpo_texto) === 0 && item.gmail_message_id) {
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
  await processarPendentesOrigem(item.origem || ORIGEM_VIVO);
  return AutomacaoEmail.query().findById(id);
}

async function repetirRevisoes(carregarCorpo = carregarCorpoGmail) {
  const itens = await AutomacaoEmail.query().whereIn('status', ['revisao', 'regressao_funil']).orderBy('recebido_em').orderBy('id');
  const resultado = { selecionados: itens.length, repetidos: 0, falhas: 0 };
  for (const item of itens) {
    const statusOriginal = item.status;
    try {
      const atualizacao = await prepararRepeticao(item, carregarCorpo);
      const preparado = await AutomacaoEmail.query()
        .where({ id: item.id, status: statusOriginal })
        .patch({ ...atualizacao, updated_at: new Date() });
      if (!preparado) continue;
      resultado.repetidos += 1;
      await processarPendente({ ...item, ...atualizacao, status: 'pendente' });
    } catch (error) {
      resultado.falhas += 1;
      try {
        await AutomacaoEmail.query()
          .where({ id: item.id, status: statusOriginal })
          .patch({ erro: `Falha ao preparar repetição: ${String(error.message || error).slice(0, 1960)}`, updated_at: new Date() });
      } catch { }
    }
  }
  return resultado;
}

function elegivelReprocessamentoClaro(item) {
  return item.origem === ORIGEM_CLARO
    && item.status === 'revisao'
    && item.corpo_texto
    && !item.revisado_por_id
    && interpretarEmailClaro(item.assunto, item.corpo_texto).estrutura_valida;
}

async function diagnosticoClaro(dependencias = {}) {
  const consultar = dependencias.consultar || (() => AutomacaoEmail.query()
    .where({ origem: ORIGEM_CLARO, status: 'revisao' }).orderBy('recebido_em').orderBy('id'));
  const itens = await consultar();
  const contexto = itens.some(item => interpretarEmailClaro(item.assunto, item.corpo_texto).estrutura_valida)
    ? { vendas: await (dependencias.carregarVendas || carregarVendasClaro)(), finais: await (dependencias.etapasFinais || codigosEtapasFinais)() }
    : {};
  const contagens = {};
  const registros = [];
  for (const item of itens) {
    const motivo = item.erro || 'Sem motivo informado';
    contagens[motivo] = (contagens[motivo] || 0) + 1;
    const campos = interpretarEmailClaro(item.assunto, item.corpo_texto);
    const resolucao = campos.estrutura_valida
      ? await (dependencias.resolver || resolverVendaClaro)(item, campos, contexto)
      : { candidatas: [], erro: 'Formato do email não reconhecido.' };
    registros.push({ id: item.id, empresa: campos.empresa, autenticacao: json(item.dados_extraidos).autenticacao_email || null,
      autenticacao_valida: Boolean(item.autenticacao_valida && json(item.dados_extraidos).autenticacao_email?.metodo === 'dkim_original'),
      motivo, motivo_vinculo: resolucao.erro, candidatas: resolucao.candidatas,
      elegivel_reprocessamento: Boolean(elegivelReprocessamentoClaro(item)) });
  }
  return { total: itens.length, contagens, acoes_habilitadas: claroImapService.acoesAutomaticasHabilitadas(), registros };
}

async function repetirInvalidosClaro(dependencias = {}) {
  const consultar = dependencias.consultar || (() => AutomacaoEmail.query()
    .where({ origem: ORIGEM_CLARO, status: 'revisao' })
    .whereNotNull('corpo_texto')
    .whereNull('revisado_por_id')
    .orderBy('recebido_em').orderBy('id'));
  const reivindicar = dependencias.reivindicar || (item => AutomacaoEmail.query()
    .where({ id: item.id, origem: ORIGEM_CLARO, status: 'revisao', erro: item.erro })
    .whereNotNull('corpo_texto').whereNull('revisado_por_id')
    .patch({ status: 'pendente', erro: null, updated_at: new Date() }));
  const processar = dependencias.processar || processarPendente;
  const atualizar = dependencias.atualizar || ((id, dados) => AutomacaoEmail.query().patchAndFetchById(id, dados));
  const obter = dependencias.obter || (id => AutomacaoEmail.query().findById(id));
  const itens = (await consultar()).filter(elegivelReprocessamentoClaro);
  const origens = dependencias.verificar || !itens.length ? null : await claroImapService.verificarRegistrosOriginais(itens);
  const resultado = { selecionados: itens.length, repetidos: 0, falhas: 0, registros: [] };
  for (const item of itens) {
    let iniciouProcessamento = false;
    try {
      const origem = origens ? origens.get(item.id) : await dependencias.verificar(item);
      if (!origem.valida) {
        const motivo = origem.motivo || 'Origem do email não comprovada.';
        await atualizar(item.id, { status: 'revisao', autenticacao_valida: false, erro: motivo });
        resultado.registros.push({ id: item.id, status: 'revisao', motivo });
        continue;
      }
      if (!await reivindicar(item)) continue;
      const dados = { ...json(item.dados_extraidos), autenticacao_email: { metodo: 'dkim_original', motivo: origem.motivo, dominio: origem.dominio } };
      await atualizar(item.id, { autenticacao_valida: true, dados_extraidos: JSON.stringify(dados) });
      iniciouProcessamento = true;
      if (!await processar({ ...item, autenticacao_valida: true, dados_extraidos: JSON.stringify(dados), status: 'pendente', erro: null })) throw new Error('Registro não foi reivindicado para processamento.');
      resultado.repetidos += 1;
      const final = await obter(item.id);
      resultado.registros.push({ id: item.id, status: final?.status || 'erro', motivo: final?.erro || null });
    } catch (error) {
      resultado.falhas += 1;
      const motivo = String(error.message || error).slice(0, 2000);
      if (!iniciouProcessamento) await atualizar(item.id, { status: 'revisao', erro: motivo }).catch(() => undefined);
      resultado.registros.push({ id: item.id, status: 'erro', motivo });
    }
  }
  return resultado;
}
async function descartar(id, justificativa, usuarioId) { if (!String(justificativa || '').trim()) throw Object.assign(new Error('Informe a justificativa.'), { statusCode: 400 }); return AutomacaoEmail.query().patchAndFetchById(id, { status: 'descartado', justificativa_revisao: String(justificativa).trim(), revisado_por_id: usuarioId, processado_em: formatarSQL() }); }

function dadosHistorico(valor) {
  return json(valor, {});
}

function normalizarVersao(valor) {
  const instante = instanteUtc(valor);
  return instante === null ? String(valor || '') : String(instante);
}

function montarInconsistenciaHistorico(historico, venda, automacao) {
  const dados = dadosHistorico(historico.dados);
  if (dados.origem_movimentacao !== 'automacao_gmail') return null;
  const motivos = [];
  const criadaEm = venda?.criado_em || venda?.created_at || null;
  const historicoEmMs = instanteUtc(historico.created_at);
  const criadaEmMs = instanteUtc(criadaEm);
  if (!venda) motivos.push('Venda vinculada não encontrada.');
  if (venda && historicoEmMs !== null && criadaEmMs !== null && historicoEmMs < criadaEmMs) motivos.push('Movimentação anterior à criação da venda.');
  if (!automacao) motivos.push('Histórico Gmail sem automação correspondente.');
  const recebidoEmMs = instanteUtc(automacao?.recebido_em);
  if (venda && automacao && recebidoEmMs !== null && criadaEmMs !== null && recebidoEmMs < criadaEmMs) motivos.push('E-mail recebido antes da criação da venda.');
  const candidatas = json(automacao?.dados_extraidos).candidatas;
  const candidata = Array.isArray(candidatas)
    ? candidatas.find(item => Number(item.id) === Number(historico.venda_id))
    : null;
  if (Array.isArray(candidata?.divergencias) && candidata.divergencias.length > 0) {
    motivos.push(`Automação concluída com divergências: ${candidata.divergencias.join(', ')}.`);
  }
  if (motivos.length === 0) return null;
  return {
    historico_id: Number(historico.id),
    venda_id: Number(historico.venda_id),
    automacao_id: automacao ? Number(automacao.id) : Number(dados.automacao_email_id) || null,
    acao: historico.acao,
    status_anterior: historico.status_anterior || null,
    status_novo: historico.status_novo || null,
    historico_em: historico.created_at,
    email_recebido_em: automacao?.recebido_em || dados.automacao_recebida_em || null,
    venda_criada_em: criadaEm,
    venda_status_atual: venda?.status_funil || null,
    venda_updated_at: venda?.updated_at || null,
    motivos
  };
}

async function listarInconsistenciasHistorico(filtros = {}) {
  const pagina = Math.max(1, Number(filtros.page) || 1);
  const porPagina = Math.min(100, Math.max(10, Number(filtros.per_page) || 20));
  const historicos = await VendaHistorico.query()
    .whereIn('acao', ['venda.status_atualizado', 'venda.cancelada'])
    .whereNull('invalidated_at')
    .orderBy('id', 'desc');
  const gmail = historicos.filter(item => dadosHistorico(item.dados).origem_movimentacao === 'automacao_gmail');
  const vendaIds = [...new Set(gmail.map(item => Number(item.venda_id)).filter(Boolean))];
  const automacaoIds = [...new Set(gmail.map(item => Number(dadosHistorico(item.dados).automacao_email_id)).filter(Boolean))];
  const [vendas, automacoes] = await Promise.all([
    vendaIds.length ? Venda.query().findByIds(vendaIds) : [],
    automacaoIds.length ? AutomacaoEmail.query().findByIds(automacaoIds) : []
  ]);
  const vendasPorId = new Map(vendas.map(item => [Number(item.id), item]));
  const automacoesPorId = new Map(automacoes.map(item => [Number(item.id), item]));
  const inconsistencias = gmail.map(item => montarInconsistenciaHistorico(
    item,
    vendasPorId.get(Number(item.venda_id)),
    automacoesPorId.get(Number(dadosHistorico(item.dados).automacao_email_id))
  )).filter(Boolean);
  const inicio = (pagina - 1) * porPagina;
  return { data: inconsistencias.slice(inicio, inicio + porPagina), total: inconsistencias.length, page: pagina, per_page: porPagina };
}

const EFEITOS_REQUISITOS = {
  aceite: ['aceite_concluido'],
  biometria: ['biometria_concluida'],
  etapa_0800: ['etapa_0800_concluida', 'etapa_0800_concluida_em', 'etapa_0800_concluida_por_id'],
  etapa_abr: ['etapa_abr_concluida', 'etapa_abr_concluida_em', 'etapa_abr_concluida_por_id'],
  etapa_vivo: ['etapa_vivo_concluida', 'etapa_vivo_concluida_em', 'etapa_vivo_concluida_por_id']
};

function efeitosDerivadosComprovados(historico, venda) {
  const chaves = dadosHistorico(historico.dados).requisitos_concluidos_automaticamente;
  if (!Array.isArray(chaves)) return [];
  return chaves.flatMap(chave => EFEITOS_REQUISITOS[chave] || []).filter(coluna => {
    if (!coluna.endsWith('_em')) return venda?.[coluna] !== null && venda?.[coluna] !== false && venda?.[coluna] !== 0;
    return normalizarVersao(venda?.[coluna]) === normalizarVersao(historico.created_at);
  });
}

async function obterPreviaCorrecaoHistorico(historicoId, trx = null) {
  const historico = await VendaHistorico.query(trx).findById(historicoId);
  if (!historico || historico.invalidated_at) return null;
  const venda = await Venda.query(trx).findById(historico.venda_id);
  const dados = dadosHistorico(historico.dados);
  const automacao = dados.automacao_email_id ? await AutomacaoEmail.query(trx).findById(dados.automacao_email_id) : null;
  const inconsistencia = montarInconsistenciaHistorico(historico, venda, automacao);
  if (!inconsistencia) return null;
  const anterior = await VendaHistorico.query(trx)
    .where('venda_id', historico.venda_id)
    .where('id', '<', historico.id)
    .whereNotNull('status_novo')
    .whereNull('invalidated_at')
    .orderBy('id', 'desc')
    .first();
  const etapas = await FunilEtapa.query(trx).where({ ativo: true }).orderBy('ordem', 'asc').select('codigo', 'nome');
  return {
    ...inconsistencia,
    status_sugerido: anterior?.status_novo || historico.status_anterior || null,
    etapas,
    efeitos_derivados_comprovados: efeitosDerivadosComprovados(historico, venda),
    efeitos_nao_revertidos_automaticamente: historico.status_novo && historico.status_novo !== historico.status_anterior
      ? ['data_ativacao', 'sincronização do cliente e pacotes gerados']
      : []
  };
}

async function corrigirInconsistenciaHistorico(historicoId, dados, usuarioId) {
  const motivo = String(dados?.motivo || '').trim();
  const statusDestino = String(dados?.status_destino || '').trim();
  if (!motivo) throw Object.assign(new Error('Informe o motivo da correção.'), { statusCode: 400 });
  if (!statusDestino) throw Object.assign(new Error('Informe a etapa que deve permanecer na venda.'), { statusCode: 400 });
  const etapa = await FunilEtapa.query().findOne({ codigo: statusDestino, ativo: true });
  if (!etapa) throw Object.assign(new Error('A etapa escolhida não está ativa.'), { statusCode: 400 });

  return Venda.transaction(async trx => {
    const historico = await VendaHistorico.query(trx).findById(historicoId).forUpdate();
    if (!historico) throw Object.assign(new Error('Histórico não encontrado.'), { statusCode: 404 });
    if (historico.invalidated_at) throw Object.assign(new Error('Este histórico já foi corrigido.'), { statusCode: 409 });
    const venda = await Venda.query(trx).findById(historico.venda_id).forUpdate();
    if (!venda) throw Object.assign(new Error('Venda vinculada não encontrada.'), { statusCode: 404 });
    const automacaoId = Number(dadosHistorico(historico.dados).automacao_email_id) || null;
    const automacao = automacaoId ? await AutomacaoEmail.query(trx).findById(automacaoId) : null;
    if (!montarInconsistenciaHistorico(historico, venda, automacao)) {
      throw Object.assign(new Error('O histórico não corresponde mais a uma inconsistência corrigível.'), { statusCode: 409 });
    }
    if (normalizarVersao(venda.updated_at) !== normalizarVersao(dados?.versao_venda)) {
      throw Object.assign(new Error('A venda mudou desde a prévia. Atualize a auditoria antes de corrigir.'), { statusCode: 409 });
    }
    const agora = formatarSQL();
    const efeitos = dados?.reverter_efeitos_derivados ? efeitosDerivadosComprovados(historico, venda) : [];
    const patchVenda = { status_funil: statusDestino, ultima_atividade_em: agora, updated_at: agora };
    efeitos.forEach(coluna => { patchVenda[coluna] = coluna.endsWith('_por_id') || coluna.endsWith('_em') ? null : false; });
    await Venda.query(trx).findById(venda.id).patch(patchVenda);
    await VendaHistorico.query(trx).findById(historico.id).patch({
      invalidated_at: agora,
      invalidated_by_id: Number(usuarioId),
      invalidation_reason: motivo,
      correction_automation_id: automacaoId
    });
    await VendaHistorico.query(trx).insert({
      venda_id: Number(venda.id),
      usuario_id: Number(usuarioId),
      acao: 'venda.automacao_corrigida',
      status_anterior: venda.status_funil || null,
      status_novo: statusDestino,
      observacao: motivo,
      dados: {
        historico_invalidado_id: Number(historico.id),
        automacao_email_id: automacaoId,
        efeitos_derivados_revertidos: efeitos
      },
      created_at: agora
    });
    await auditLogService.registrar(null, {
      usuario_id: Number(usuarioId),
      acao: 'venda.automacao_historico_corrigido',
      entidade: 'vendas',
      entidade_id: venda.id,
      dados: { historico_id: historico.id, automacao_email_id: automacaoId, status_anterior: venda.status_funil, status_novo: statusDestino, motivo, efeitos }
    }, trx);
    return { status: 'ok', venda_id: Number(venda.id), historico_id: Number(historico.id), status_destino: statusDestino };
  });
}

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

module.exports = { ciclo, cicloClaro, coletarEmails, coletarHistorico, diagnosticarImap, processarPendentes, listar, listarVendasCandidatas, resumo, revisar, repetir, repetirRevisoes, repetirInvalidosClaro, diagnosticoClaro, descartar, listarInconsistenciasHistorico, obterPreviaCorrecaoHistorico, corrigirInconsistenciaHistorico, limparCorposExpirados, listarProblemas, resolverProblemaAutomatico, obterVendaProblemaAutomatico, _internals: { calcularDepois, extrairCorpoMensagem, registrarMensagem, prepararRepeticao, processarPendente, processarPendentesOrigem, elegivelReprocessamentoClaro, motivosExclusaoClaro, similaridadeClaro, divergenciasSecundarias, motivosInelegibilidade, avaliarCandidatas, validarVendaSelecionada, resolverVenda, resolverVendaClaro, buscarCandidatasClaro, resolverEtapaDestino, revalidarResolucaoAutomatica, montarInconsistenciaHistorico, efeitosDerivadosComprovados, vendaTemPortabilidade, emailRemetente, documento, centavos, tokenTelegramProblemas, processarRegistro, filtroProblemas, porPaginaProblemas, resumirVendasProblemas, enriquecerEtapasCandidatas, validarContaGmail, mensagemErroIntegracao, salvarEstadoIntegracao, salvarEstadoIntegracaoClaro, registrarInicioCiclo, registrarSucessoCiclo, registrarFalhaCiclo, estadoPublicoIntegracao } };
