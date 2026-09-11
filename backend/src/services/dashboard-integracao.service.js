/**
 * Sincroniza vendas do CRM com o dashboard externo.
 *
 * Uma venda do CRM pode ter chips com vendedoras, operadoras e tipos diferentes.
 * Cada chip vira um lançamento idempotente próprio no dashboard.
 */
const axios = require('axios');
const Venda = require('../models/Venda');
const { parseUtcDateTime } = require('../utils/datetime');
const { possuiDocumentacao, valorBooleano } = require('./venda-documentacao.service');

const NOME_TABELA = 'dashboard_integracao_vendas';
const CACHE_REFERENCIAS_MS = 5 * 60 * 1000;
const LIMITE_REQUISICOES_POR_MINUTO = 120;
let cacheReferencias = null;
let inicioJanelaRequisicoes = Date.now();
let requisicoesNaJanela = 0;
const FUSO_HORARIO_DASHBOARD = 'America/Sao_Paulo';

async function reservarRequisicao() {
  while (true) {
    const agora = Date.now();
    const decorrido = agora - inicioJanelaRequisicoes;
    if (decorrido >= 60 * 1000) { inicioJanelaRequisicoes = agora; requisicoesNaJanela = 0; }
    if (requisicoesNaJanela < LIMITE_REQUISICOES_POR_MINUTO) { requisicoesNaJanela += 1; return; }
    await new Promise(resolve => setTimeout(resolve, Math.max(1, 60 * 1000 - decorrido)));
  }
}

function configuracao() {
  const baseUrl = String(process.env.DASHBOARD_INTEGRATION_URL || '').trim().replace(/\/+$/, '');
  const apiKey = String(process.env.DASHBOARD_INTEGRATION_API_KEY || '').trim();
  return { baseUrl, apiKey };
}

function estaConfigurada() { const { baseUrl, apiKey } = configuracao(); return Boolean(baseUrl && apiKey); }
function idsLiberadosExcepcionalmente() {
  return new Set(String(process.env.DASHBOARD_INTEGRATION_MANUAL_RETRY_SALE_IDS || '')
    .split(',')
    .map(valor => Number(valor.trim()))
    .filter(Number.isInteger));
}
function normalizarTexto(valor) { return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
function somenteDigitos(valor) { return String(valor || '').replace(/\D/g, ''); }
function obterNomeReferencia(item) { return item?.full_name || item?.name || item?.nome || item?.label || item?.title || ''; }
function obterColecaoReferencias(referencias, chave) { const raiz = referencias?.data || referencias || {}; return Array.isArray(raiz[chave]) ? raiz[chave] : []; }
function lancamentoConfirmadoNoDashboard(item) { return item?.status === 'enviada' || Boolean(item?.dashboard_sale_id); }
function separarReenviosPorExistencia(itens = []) {
  return itens.reduce((grupos, item) => {
    grupos[lancamentoConfirmadoNoDashboard(item) ? 'existentes' : 'novos'].push(item);
    return grupos;
  }, { existentes: [], novos: [] });
}

function obterMapaConfigurado(chave) {
  const valor = process.env[`DASHBOARD_INTEGRATION_${chave.toUpperCase()}_MAP`];
  if (!valor) return {};
  try { const mapa = JSON.parse(valor); return mapa && typeof mapa === 'object' && !Array.isArray(mapa) ? mapa : {}; }
  catch { throw new Error(`A variavel DASHBOARD_INTEGRATION_${chave.toUpperCase()}_MAP deve conter JSON valido.`); }
}

function resolverIdReferencia({ referencias, colecao, chaveMapa, referenciaLocal }) {
  const mapa = obterMapaConfigurado(chaveMapa);
  const configurado = mapa[String(referenciaLocal?.id)];
  if (configurado !== undefined && configurado !== null && String(configurado).trim() !== '') return Number(configurado);
  const opcoes = obterColecaoReferencias(referencias, colecao);
  const nome = normalizarTexto(referenciaLocal?.nome);
  const correspondenciaPorNome = opcoes.find(item => normalizarTexto(obterNomeReferencia(item)) === nome);
  const correspondenciaPorId = opcoes.find(item => Number(item?.id) === Number(referenciaLocal?.id));
  const correspondencia = correspondenciaPorNome || correspondenciaPorId;
  if (!correspondencia?.id) throw new Error(`Nao foi encontrada referencia ativa no dashboard para ${chaveMapa} "${referenciaLocal?.nome || referenciaLocal?.id || 'nao informado'}".`);
  return Number(correspondencia.id);
}

function formatarDataHoraVenda(venda) {
  const criadoEm = venda.criado_em || venda.created_at;
  const dataHoraUtc = parseUtcDateTime(criadoEm);
  const partesLocais = dataHoraUtc
    ? new Intl.DateTimeFormat('en-CA', {
      timeZone: FUSO_HORARIO_DASHBOARD,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(dataHoraUtc).reduce((resultado, parte) => ({ ...resultado, [parte.type]: parte.value }), {})
    : null;
  const saleDate = String(venda.data_venda || (partesLocais && `${partesLocais.year}-${partesLocais.month}-${partesLocais.day}`) || criadoEm || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) throw new Error('A venda nao possui uma data valida para enviar ao dashboard.');
  return { sale_date: saleDate, sale_time: partesLocais ? `${partesLocais.hour}:${partesLocais.minute}` : '00:00' };
}

function normalizarChips(valor) {
  if (Array.isArray(valor)) return valor.filter(item => item && typeof item === 'object');
  if (!String(valor || '').trim()) return [];
  try { const itens = JSON.parse(valor); return Array.isArray(itens) ? itens.filter(item => item && typeof item === 'object') : []; }
  catch { return []; }
}

function itensSincronizacao(venda) {
  const chips = normalizarChips(venda.valores_unitarios_chips);
  return chips.length ? chips.map((_chip, index) => `chip-${index + 1}`) : ['principal'];
}

function idExternoVenda(vendaId, itemKey = 'principal') {
  return itemKey === 'principal'
    ? `crm-venda-${Number(vendaId)}`
    : `crm-venda-${Number(vendaId)}-${itemKey}`;
}

function chipDaVenda(venda, itemKey) {
  const match = /^chip-(\d+)$/.exec(String(itemKey || ''));
  if (!match) return null;
  return normalizarChips(venda._dashboardIntegration?.chips || venda.valores_unitarios_chips)[Number(match[1]) - 1] || null;
}

function resolverTipoVendaDoChip(chip, referencias) {
  const tipo = normalizarTexto(chip?.tipo_linha || chip?.tipo || chip?.categoria);
  const codigo = tipo === 'novo' ? 'new' : tipo === 'portabilidade' ? 'portability' : null;
  const referencia = obterColecaoReferencias(referencias, 'sale_types').find(item => item.code === codigo);
  if (!referencia?.id) throw new Error(`Nao foi encontrado tipo de venda ativo no dashboard para o chip "${tipo || 'nao informado'}".`);
  return Number(referencia.id);
}

function referenciaDoChip(venda, chip, tipo) {
  if (!chip) return venda[tipo];
  const dados = venda._dashboardIntegration || {};
  if (tipo === 'vendedora') return dados.vendedorasPorId?.[Number(chip.vendedora_id)] || venda.vendedora;
  if (tipo === 'operadora') return dados.operadorasPorId?.[Number(chip.operadora_id)] || venda.operadora;
  return venda[tipo];
}

function valorMonetario(valor, mensagem) {
  const numero = Number(String(valor ?? '').replace(',', '.'));
  if (!Number.isFinite(numero) || numero < 0) throw new Error(mensagem);
  return numero.toFixed(2);
}

function montarPayloadVenda(venda, referencias, itemKey = 'principal') {
  const { sale_date, sale_time } = formatarDataHoraVenda(venda);
  const chip = chipDaVenda(venda, itemKey);
  const quantidade = Number(chip?.quantidade ?? venda.quantidade_linhas ?? 0);
  if (!Number.isInteger(quantidade) || quantidade < 1) throw new Error('A venda nao possui uma quantidade valida para enviar ao dashboard.');
  const unitValue = chip
    ? valorMonetario(chip.valor_unitario, 'O chip nao possui um valor unitario valido para enviar ao dashboard.')
    : valorMonetario(Number(venda.valor_total || 0) / quantidade, 'A venda nao possui um valor valido para enviar ao dashboard.');
  const vendedora = referenciaDoChip(venda, chip, 'vendedora');
  const operadora = referenciaDoChip(venda, chip, 'operadora');

  return {
    external_sale_id: idExternoVenda(venda.id, itemKey),
    seller_id: resolverIdReferencia({ referencias, colecao: 'sellers', chaveMapa: 'seller', referenciaLocal: vendedora }),
    service_id: resolverIdReferencia({ referencias, colecao: 'services', chaveMapa: 'service', referenciaLocal: venda.servico }),
    operator_id: resolverIdReferencia({ referencias, colecao: 'operators', chaveMapa: 'operator', referenciaLocal: operadora }),
    sale_type_id: chip ? resolverTipoVendaDoChip(chip, referencias) : resolverIdReferencia({ referencias, colecao: 'sale_types', chaveMapa: 'sale_type', referenciaLocal: venda.tipoVenda }),
    sale_date,
    sale_time,
    cnpj: somenteDigitos(venda.cnpj),
    company_name: venda.razao_social || venda.nome,
    phone: somenteDigitos(venda.telefone),
    closed_by_name: venda.nome_fechou_venda || vendedora?.nome || '',
    quantity: quantidade,
    unit_value: unitValue,
    has_doc: possuiDocumentacao(venda),
    is_base_sale: valorBooleano(venda.cliente_da_base),
    // String vazia é aceita tanto pelo dashboard atual quanto pelo que aceita null.
    notes: venda.observacoes || ''
  };
}

async function obterReferencias({ atualizar = false } = {}) {
  if (!estaConfigurada()) throw new Error('A integracao com o dashboard nao esta configurada.');
  if (!atualizar && cacheReferencias && Date.now() - cacheReferencias.em < CACHE_REFERENCIAS_MS) return cacheReferencias.valor;
  const { baseUrl, apiKey } = configuracao();
  await reservarRequisicao();
  const resposta = await axios.get(`${baseUrl}/api/v1/integration/references`, { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 10000 });
  cacheReferencias = { valor: resposta.data, em: Date.now() };
  return resposta.data;
}

async function atualizarLancamentoNoDashboard(baseUrl, apiKey, payload) {
  const { external_sale_id: externalSaleId, ...dadosVenda } = payload;
  return axios.put(
    `${baseUrl}/api/v1/integration/sales/${encodeURIComponent(externalSaleId)}`,
    dadosVenda,
    { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 10000 }
  );
}

async function registrarVendaPendente(venda, trx) {
  const vendaId = Number(typeof venda === 'object' ? venda.id : venda);
  const itens = typeof venda === 'object' ? itensSincronizacao(venda) : ['principal'];
  for (const itemKey of itens) {
    const existe = await trx(NOME_TABELA).where({ venda_id: vendaId, item_key: itemKey }).first();
    if (!existe) {
      await trx(NOME_TABELA).insert({
        venda_id: vendaId,
        item_key: itemKey,
        status: 'pendente',
        pode_reenviar_manualmente: true
      });
    }
  }
}

async function obterVendaParaEnvio(vendaId) {
  const venda = await Venda.query()
    .findById(vendaId)
    .select('vendas.*')
    .select(Venda.knex().raw(
      '(SELECT COUNT(*) FROM venda_arquivos va WHERE va.venda_id = vendas.id AND va.excluido_em IS NULL) as total_arquivos'
    ))
    .withGraphFetched('[vendedora, servico, operadora, tipoVenda]');
  if (!venda) return null;
  const chips = normalizarChips(venda.valores_unitarios_chips);
  const idsVendedoras = [...new Set(chips.map(chip => Number(chip.vendedora_id)).filter(Number.isInteger))];
  const idsOperadoras = [...new Set(chips.map(chip => Number(chip.operadora_id)).filter(Number.isInteger))];
  const knex = Venda.knex();
  const [vendedoras, operadoras] = await Promise.all([
    idsVendedoras.length ? knex('usuarios').whereIn('id', idsVendedoras).select('id', 'nome') : [],
    idsOperadoras.length ? knex('operadoras').whereIn('id', idsOperadoras).select('id', 'nome') : []
  ]);
  venda._dashboardIntegration = {
    chips,
    vendedorasPorId: Object.fromEntries(vendedoras.map(item => [Number(item.id), item])),
    operadorasPorId: Object.fromEntries(operadoras.map(item => [Number(item.id), item]))
  };
  return venda;
}

function mensagemErro(error) {
  const erroApi = error.response?.data?.error;
  const detalhe = erroApi?.message || error.response?.data?.message || erroApi || error.message;
  const campos = erroApi?.fieldErrors && typeof erroApi.fieldErrors === 'object'
    ? ` (${Object.entries(erroApi.fieldErrors).map(([campo, mensagem]) => `${campo}: ${mensagem}`).join('; ')})`
    : '';
  return `${String(detalhe || 'Falha desconhecida ao enviar venda ao dashboard.')}${campos}`.slice(0, 4000);
}

async function atualizarFalha(knex, pendencia, error) {
  await knex(NOME_TABELA)
    .where({ id: pendencia.id })
    .update({
      status: 'erro',
      tentativas: Number(pendencia.tentativas || 0) + 1,
      ultimo_erro: mensagemErro(error),
      ultima_tentativa_em: knex.fn.now(),
      updated_at: knex.fn.now()
    });
}

async function enviarVendaPendente(vendaId, itemKey = 'principal') {
  const knex = Venda.knex();
  const pendencia = await knex(NOME_TABELA).where({ venda_id: Number(vendaId), item_key: itemKey }).first();
  if (!pendencia || pendencia.status === 'enviada') return { ignorada: true };
  try {
    if (!estaConfigurada()) throw new Error('A integracao com o dashboard nao esta configurada.');
    const venda = await obterVendaParaEnvio(vendaId);
    if (!venda) throw new Error('Venda nao encontrada para sincronizacao.');
    const referencias = await obterReferencias();
    const payload = montarPayloadVenda(venda, referencias, itemKey);
    const { baseUrl, apiKey } = configuracao();
    await reservarRequisicao();
    const resposta = await axios.post(`${baseUrl}/api/v1/integration/sales`, payload, { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 10000 });
    await knex(NOME_TABELA).where({ venda_id: Number(vendaId), item_key: itemKey }).update({ status: 'enviada', tentativas: Number(pendencia.tentativas || 0) + 1, ultimo_erro: null, dashboard_sale_id: resposta.data?.data?.id || null, enviada_em: knex.fn.now(), ultima_tentativa_em: knex.fn.now(), updated_at: knex.fn.now() });
    return { enviada: true, idempotente: resposta.data?.idempotent === true };
  } catch (error) {
    await atualizarFalha(knex, pendencia, error);
    throw error;
  }
}

/**
 * Remove do dashboard todos os lancamentos que pertencem a uma venda do CRM.
 * A API externa trata uma venda ausente como exclusao idempotente.
 */
async function excluirVendaNoDashboard(vendaId) {
  const knex = Venda.knex();
  const itens = await knex(NOME_TABELA)
    .where({ venda_id: Number(vendaId) })
    .whereNot('status', 'excluida')
    .orderBy('id')
    .select('id', 'item_key', 'status', 'dashboard_sale_id', 'tentativas');

  if (itens.length === 0) return { excluidos: 0 };

  const existeVendaConfirmadaNoDashboard = itens.some(item => item.status === 'enviada' || item.dashboard_sale_id);
  if (!estaConfigurada()) {
    if (existeVendaConfirmadaNoDashboard) throw new Error('A integracao com o dashboard nao esta configurada para excluir esta venda.');
    await knex(NOME_TABELA)
      .whereIn('id', itens.map(item => item.id))
      .update({ status: 'excluida', updated_at: knex.fn.now() });
    return { excluidos: 0 };
  }

  const { baseUrl, apiKey } = configuracao();
  for (const item of itens) {
    try {
      await reservarRequisicao();
      await axios.delete(`${baseUrl}/api/v1/integration/sales/${encodeURIComponent(idExternoVenda(vendaId, item.item_key))}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 10000
      });
      await knex(NOME_TABELA).where({ id: item.id }).update({
        status: 'excluida',
        dashboard_sale_id: null,
        ultimo_erro: null,
        ultima_tentativa_em: knex.fn.now(),
        updated_at: knex.fn.now()
      });
    } catch (error) {
      await atualizarFalha(knex, item, error);
      const erroIntegracao = new Error(`O dashboard recusou a exclusão: ${mensagemErro(error)}`);
      erroIntegracao.statusCode = 502;
      throw erroIntegracao;
    }
  }

  return { excluidos: itens.length };
}

/**
 * Recria no dashboard os lancamentos removidos ao restaurar uma venda da lixeira.
 */
async function restaurarVendaNoDashboard(vendaId) {
  const knex = Venda.knex();
  const itens = await knex(NOME_TABELA)
    .where({ venda_id: Number(vendaId), status: 'excluida' })
    .orderBy('id')
    .select('id', 'item_key');

  if (itens.length === 0) return obterResumoSincronizacao(vendaId);
  if (!estaConfigurada()) throw new Error('A integracao com o dashboard nao esta configurada para restaurar esta venda.');

  await knex(NOME_TABELA).whereIn('id', itens.map(item => item.id)).update({
    status: 'pendente',
    ultimo_erro: null,
    updated_at: knex.fn.now()
  });
  return enviarVendaCriada(vendaId);
}

/**
 * Reflete uma edição do CRM no dashboard externo.
 * Atualiza os lançamentos pelo identificador externo estável. Novos chips criados
 * durante a edição também usam PUT para que o dashboard não os anuncie como venda nova.
 */
async function sincronizarVendaAtualizada(vendaId) {
  const venda = await obterVendaParaEnvio(vendaId);
  if (!venda) return null;
  if (!estaConfigurada()) return obterResumoSincronizacao(vendaId);

  try {
    const knex = Venda.knex();
    const referencias = await obterReferencias();
    const itemKeysAtuais = itensSincronizacao(venda);
    const payloads = new Map(itemKeysAtuais.map(itemKey => [
      itemKey,
      montarPayloadVenda(venda, referencias, itemKey)
    ]));
    const itensAnteriores = await knex(NOME_TABELA)
      .where({ venda_id: Number(vendaId) })
      .whereNot('status', 'excluida')
      .orderBy('id');

    await knex.transaction(trx => registrarVendaPendente(venda, trx));
    const { baseUrl, apiKey } = configuracao();

    for (const itemKey of itemKeysAtuais) {
      const pendencia = await knex(NOME_TABELA)
        .where({ venda_id: Number(vendaId), item_key: itemKey })
        .first();
      const payload = payloads.get(itemKey);
      try {
        await reservarRequisicao();
        const resposta = await atualizarLancamentoNoDashboard(baseUrl, apiKey, payload);
        await knex(NOME_TABELA).where({ id: pendencia.id }).update({
          status: 'enviada',
          tentativas: Number(pendencia.tentativas || 0) + 1,
          ultimo_erro: null,
          dashboard_sale_id: resposta.data?.data?.id || pendencia.dashboard_sale_id || null,
          enviada_em: knex.fn.now(),
          ultima_tentativa_em: knex.fn.now(),
          updated_at: knex.fn.now()
        });
      } catch (error) {
        await atualizarFalha(knex, pendencia, error);
        throw error;
      }
    }

    const chavesAtuais = new Set(itemKeysAtuais);
    for (const item of itensAnteriores.filter(item => !chavesAtuais.has(item.item_key))) {
      try {
        await reservarRequisicao();
        await axios.delete(
          `${baseUrl}/api/v1/integration/sales/${encodeURIComponent(idExternoVenda(vendaId, item.item_key))}`,
          { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 10000 }
        );
        await knex(NOME_TABELA).where({ id: item.id }).delete();
      } catch (error) {
        await atualizarFalha(knex, item, error);
        throw error;
      }
    }

    return obterResumoSincronizacao(vendaId);
  } catch (error) {
    // A edição local já foi confirmada. Mantemos o erro de sincronização para
    // exibição e uma tentativa posterior, sem desfazer a alteração no CRM.
    console.error(`Erro ao atualizar venda ${vendaId} no dashboard:`, mensagemErro(error));
    return obterResumoSincronizacao(vendaId);
  }
}

/**
 * Atualiza somente lancamentos que ja existem no dashboard.
 * Este fluxo nunca cria nem exclui lancamentos, evitando o anuncio de venda nova.
 */
async function sincronizarDocumentacaoAtualizada(vendaId) {
  const knex = Venda.knex();
  const itensRegistrados = await knex(NOME_TABELA)
    .where({ venda_id: Number(vendaId) })
    .whereNot('status', 'excluida')
    .orderBy('id');
  const itens = itensRegistrados.filter(lancamentoConfirmadoNoDashboard);

  if (itens.length === 0 || !estaConfigurada()) {
    return { atualizados: 0, ignorados: itens.length, erros: 0 };
  }

  const venda = await obterVendaParaEnvio(vendaId);
  if (!venda) return { atualizados: 0, ignorados: itens.length, erros: 0 };

  const chavesAtuais = new Set(itensSincronizacao(venda));
  const elegiveis = itens.filter(item => chavesAtuais.has(item.item_key));
  const resultado = {
    atualizados: 0,
    ignorados: itens.length - elegiveis.length,
    erros: 0
  };

  let referencias;
  try {
    referencias = await obterReferencias();
  } catch (error) {
    for (const item of elegiveis) await atualizarFalha(knex, item, error);
    console.error(`Erro ao sincronizar documentacao da venda ${vendaId} no dashboard:`, mensagemErro(error));
    return { ...resultado, erros: elegiveis.length };
  }

  const { baseUrl, apiKey } = configuracao();
  for (const item of elegiveis) {
    try {
      const payload = montarPayloadVenda(venda, referencias, item.item_key);
      await reservarRequisicao();
      const resposta = await atualizarLancamentoNoDashboard(baseUrl, apiKey, payload);
      await knex(NOME_TABELA).where({ id: item.id }).update({
        status: 'enviada',
        tentativas: Number(item.tentativas || 0) + 1,
        ultimo_erro: null,
        dashboard_sale_id: resposta.data?.data?.id || item.dashboard_sale_id || null,
        enviada_em: knex.fn.now(),
        ultima_tentativa_em: knex.fn.now(),
        updated_at: knex.fn.now()
      });
      resultado.atualizados += 1;
    } catch (error) {
      await atualizarFalha(knex, item, error);
      resultado.erros += 1;
      console.error(`Erro ao sincronizar documentacao da venda ${vendaId} no dashboard:`, mensagemErro(error));
    }
  }

  return resultado;
}

async function listarCandidatosReconciliacaoDocumentacao() {
  return Venda.knex()(`${NOME_TABELA} as integracao`)
    .innerJoin('vendas as venda', 'venda.id', 'integracao.venda_id')
    .whereNull('venda.excluido_em')
    .whereNot('integracao.status', 'excluida')
    .where(builder => builder.where('integracao.status', 'enviada').orWhereNotNull('integracao.dashboard_sale_id'))
    .groupBy('integracao.venda_id')
    .orderBy('integracao.venda_id')
    .select('integracao.venda_id')
    .count('* as total_lancamentos');
}

function montarResumo(items = [], vendaId = null) {
  if (items.length === 0) return null;
  const todosEnviados = items.every(item => item.status === 'enviada');
  const comErro = items.some(item => item.status === 'erro');
  const vendaLiberada = idsLiberadosExcepcionalmente().has(Number(vendaId));
  const podeReenviar = items.some(item => item.status === 'erro' && (Boolean(item.pode_reenviar_manualmente) || vendaLiberada));
  const primeiroErro = items.find(item => item.status === 'erro' && item.ultimo_erro);

  return {
    status: todosEnviados ? 'enviada' : (comErro ? 'erro' : 'pendente'),
    mensagem: primeiroErro?.ultimo_erro || null,
    pode_reenviar_manualmente: podeReenviar,
    itens: items.map(item => ({
      item_key: item.item_key,
      status: item.status,
      mensagem: item.ultimo_erro || null
    }))
  };
}

async function obterResumoSincronizacao(vendaId) {
  const items = await Venda.knex()(NOME_TABELA)
    .where({ venda_id: Number(vendaId) })
    .orderBy('id')
    .select('item_key', 'status', 'ultimo_erro', 'pode_reenviar_manualmente');
  return montarResumo(items, vendaId);
}

async function enviarVendaCriada(vendaId) {
  const pendencias = await Venda.knex()(NOME_TABELA)
    .where({ venda_id: Number(vendaId), status: 'pendente' })
    .orderBy('id')
    .select('item_key');

  for (const pendencia of pendencias) {
    try {
      await enviarVendaPendente(vendaId, pendencia.item_key);
    } catch {
      // A falha ja foi persistida e sera apresentada na resposta do cadastro.
    }
  }

  return obterResumoSincronizacao(vendaId);
}

async function reenviarVendaManualmente(vendaId) {
  const pendencias = await Venda.knex()(NOME_TABELA)
    .where({ venda_id: Number(vendaId), status: 'erro' })
    .orderBy('id')
    .select('item_key', 'pode_reenviar_manualmente', 'dashboard_sale_id');

  const vendaLiberada = idsLiberadosExcepcionalmente().has(Number(vendaId));
  const elegiveis = pendencias.filter(item => Boolean(item.pode_reenviar_manualmente) || vendaLiberada);
  if (elegiveis.length === 0) return { status: 'nao_elegivel' };

  const { existentes, novos } = separarReenviosPorExistencia(elegiveis);
  if (existentes.length > 0) {
    await sincronizarDocumentacaoAtualizada(vendaId);
  }

  for (const pendencia of novos) {
    try {
      await enviarVendaPendente(vendaId, pendencia.item_key);
    } catch {
      // A falha ja foi persistida e sera retornada no resumo atualizado.
    }
  }

  return obterResumoSincronizacao(vendaId);
}

module.exports = {
  excluirVendaNoDashboard,
  enviarVendaCriada,
  estaConfigurada,
  montarPayloadVenda,
  obterResumoSincronizacao,
  reenviarVendaManualmente,
  registrarVendaPendente,
  restaurarVendaNoDashboard,
  resolverIdReferencia,
  listarCandidatosReconciliacaoDocumentacao,
  sincronizarDocumentacaoAtualizada,
  sincronizarVendaAtualizada,
  _internals: { atualizarLancamentoNoDashboard, chipDaVenda, formatarDataHoraVenda, idExternoVenda, idsLiberadosExcepcionalmente, itensSincronizacao, lancamentoConfirmadoNoDashboard, mensagemErro, montarResumo, normalizarChips, normalizarTexto, separarReenviosPorExistencia, somenteDigitos, resolverTipoVendaDoChip }
};
