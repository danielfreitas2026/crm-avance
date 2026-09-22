const Venda = require('../models/Venda');
const VendaFunilAutomacao = require('../models/VendaFunilAutomacao');
const VendaFunilAutomacaoHistorico = require('../models/VendaFunilAutomacaoHistorico');
const FunilEtapa = require('../models/FunilEtapa');
const vendaService = require('./venda.service');
const auditLogService = require('./audit-log.service');

const PRIORIDADES = ['alta', 'media', 'baixa'];
const DIAS_OCULTAR_CONCLUIDAS = 14;

function formatarSQL(data = new Date()) {
  return data.toISOString().slice(0, 19).replace('T', ' ');
}

function estadoInicial(venda, agora = formatarSQL()) {
  return {
    venda_id: Number(venda.id),
    status_funil: venda.status_funil || null,
    prioridade_funil: venda.prioridade_funil || 'media',
    cancelada_em: venda.cancelada_em || null,
    motivo_cancelamento: venda.motivo_cancelamento || null,
    aceite_concluido_auto: false,
    biometria_concluida_auto: false,
    ultima_atividade_em: venda.ultima_atividade_em || venda.updated_at || venda.created_at || agora,
    created_at: agora,
    updated_at: agora
  };
}

async function garantirEstado(venda, trx = null) {
  const agora = formatarSQL();
  await VendaFunilAutomacao.query(trx)
    .insert(estadoInicial(venda, agora))
    .onConflict('venda_id')
    .ignore();
  return VendaFunilAutomacao.query(trx).findById(venda.id);
}

async function inicializarParaVenda(venda, trx = null) {
  if (!venda?.id) return null;
  return garantirEstado(venda, trx);
}

async function obterVendaElegivel(vendaId, trx = null, bloquear = false) {
  let query = Venda.query(trx).findById(vendaId);
  if (bloquear) query = query.forUpdate();
  const venda = await query;
  if (!venda || venda.excluido_em || !venda.enviada_pos_venda_em) return null;
  return venda;
}

async function registrarHistorico(estado, dados, trx) {
  return VendaFunilAutomacaoHistorico.query(trx).insert({
    venda_id: estado.venda_id,
    usuario_id: dados.usuarioId || null,
    automacao_email_id: dados.automacaoEmailId || null,
    origem: dados.origem,
    acao: dados.acao,
    status_anterior: estado.status_funil || null,
    status_novo: dados.status_funil ?? estado.status_funil ?? null,
    prioridade_anterior: estado.prioridade_funil || 'media',
    prioridade_nova: dados.prioridade_funil || estado.prioridade_funil || 'media',
    observacao: dados.observacao || null,
    dados: {
      ...(dados.dados || {}),
      ...(dados.origem.startsWith('automacao_') ? { origem_movimentacao: dados.origem } : {})
    },
    created_at: dados.agora
  });
}

async function historicoDoEmail(automacaoEmailId, trx) {
  if (!automacaoEmailId) return null;
  return VendaFunilAutomacaoHistorico.query(trx).findOne({ automacao_email_id: automacaoEmailId });
}

async function movimentar(vendaId, dados, opcoes = {}) {
  const origem = opcoes.origem || 'ajuste_manual';
  const usuarioId = opcoes.usuarioId || null;
  if (origem === 'ajuste_manual') {
    const permitido = await vendaService._internals.usuarioPodeAcessarVenda(vendaId, usuarioId);
    if (!permitido) return { status: 'not_found' };
  }

  const status = String(dados.status_funil || '').trim();
  const prioridadeInformada = dados.prioridade_funil === undefined
    ? null
    : String(dados.prioridade_funil || '').trim().toLowerCase();
  const etapa = status ? await FunilEtapa.query().findOne({ codigo: status, ativo: true }) : null;
  if (!etapa) return { status: 'invalid', message: 'Status do funil inválido.' };
  if (prioridadeInformada !== null && !PRIORIDADES.includes(prioridadeInformada)) return { status: 'invalid', message: 'Prioridade do funil inválida.' };

  return Venda.transaction(async trx => {
    const venda = await obterVendaElegivel(vendaId, trx, true);
    if (!venda) return { status: 'not_found' };
    let estado = await garantirEstado(venda, trx);
    estado = await VendaFunilAutomacao.query(trx).findById(vendaId).forUpdate();
    if (origem.startsWith('automacao_') && await historicoDoEmail(opcoes.automacaoEmailId, trx)) {
      return { status: 'ok', estado, alterada: false };
    }
    if (estado.cancelada_em) return { status: 'invalid', message: 'Venda cancelada no funil automático não pode ser movimentada.' };
    if (origem.startsWith('automacao_') && estado.status_funil !== status) {
      const etapaAtual = await FunilEtapa.query(trx).findOne({ codigo: estado.status_funil });
      if (etapaAtual && Number(etapa.ordem) < Number(etapaAtual.ordem)) {
        return { status: 'invalid', message: 'O e-mail tentaria regredir o funil.' };
      }
    }
    const prioridade = prioridadeInformada || estado.prioridade_funil || 'media';

    const agora = formatarSQL();
    const atualizada = await VendaFunilAutomacao.query(trx).patchAndFetchById(vendaId, {
      status_funil: status,
      prioridade_funil: prioridade,
      ...(opcoes.marcadores?.aceite ? { aceite_concluido_auto: true } : {}),
      ...(opcoes.marcadores?.biometria ? { biometria_concluida_auto: true } : {}),
      ultima_atividade_em: agora,
      updated_at: agora
    });
    await registrarHistorico(estado, {
      origem,
      usuarioId,
      automacaoEmailId: opcoes.automacaoEmailId || null,
      acao: status !== estado.status_funil ? 'venda.status_atualizado' : prioridade !== estado.prioridade_funil ? 'venda.prioridade_atualizada' : 'venda.observacao_adicionada',
      status_funil: status,
      prioridade_funil: prioridade,
      observacao: String(dados.observacao || '').trim() || null,
      dados: opcoes.recebidoEm ? { automacao_recebida_em: opcoes.recebidoEm } : null,
      agora
    }, trx);

    if (origem === 'ajuste_manual') {
      await auditLogService.registrar(null, {
        usuario_id: usuarioId,
        acao: 'venda.funil_automacao_atualizado',
        entidade: 'vendas',
        entidade_id: vendaId,
        dados: { status_anterior: estado.status_funil, status_novo: status, prioridade_anterior: estado.prioridade_funil, prioridade_nova: prioridade }
      }, trx);
    }
    return { status: 'ok', estado: atualizada, alterada: true };
  });
}

async function cancelar(vendaId, dados, opcoes = {}) {
  const motivo = String(dados.motivo || '').trim();
  if (!motivo) return { status: 'invalid', message: 'Informe o motivo do cancelamento.' };
  return Venda.transaction(async trx => {
    const venda = await obterVendaElegivel(vendaId, trx, true);
    if (!venda) return { status: 'not_found' };
    let estado = await garantirEstado(venda, trx);
    estado = await VendaFunilAutomacao.query(trx).findById(vendaId).forUpdate();
    if (await historicoDoEmail(opcoes.automacaoEmailId, trx)) {
      return { status: 'ok', estado, alterada: false };
    }
    if (estado.cancelada_em) return { status: 'ok', estado, alterada: false };
    const agora = formatarSQL();
    const atualizada = await VendaFunilAutomacao.query(trx).patchAndFetchById(vendaId, {
      cancelada_em: agora,
      motivo_cancelamento: motivo,
      ultima_atividade_em: agora,
      updated_at: agora
    });
    await registrarHistorico(estado, {
      origem: opcoes.origem || 'automacao_gmail',
      automacaoEmailId: opcoes.automacaoEmailId || null,
      acao: 'venda.cancelada',
      observacao: motivo,
      dados: opcoes.recebidoEm ? { automacao_recebida_em: opcoes.recebidoEm } : null,
      agora
    }, trx);
    return { status: 'ok', estado: atualizada, alterada: true };
  });
}

async function listar(filtros, usuarioId) {
  const vendas = await vendaService.listarVendas({ enviadas_pos_venda: '1' }, usuarioId);
  const lista = Array.isArray(vendas) ? vendas : vendas.data || [];
  if (!lista.length) return [];
  const ids = lista.map(venda => Number(venda.id));
  const [estados, historicos, etapaFinal] = await Promise.all([
    VendaFunilAutomacao.query().whereIn('venda_id', ids),
    VendaFunilAutomacaoHistorico.query().whereIn('venda_id', ids).withGraphFetched('usuario').orderBy('created_at', 'asc').orderBy('id', 'asc'),
    FunilEtapa.query().findOne({ etapa_final: true })
  ]);
  const estadosPorVenda = new Map(estados.map(estado => [Number(estado.venda_id), estado]));
  const historicosPorVenda = historicos.reduce((mapa, item) => {
    const chave = Number(item.venda_id);
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push(item);
    return mapa;
  }, new Map());
  const limite = Date.now() - DIAS_OCULTAR_CONCLUIDAS * 86400000;

  return lista.map(venda => {
    const estado = estadosPorVenda.get(Number(venda.id)) || estadoInicial(venda);
    return {
      ...venda,
      status_funil_real: venda.status_funil || null,
      cancelada_em_real: venda.cancelada_em || null,
      motivo_cancelamento_real: venda.motivo_cancelamento || null,
      status_funil: estado.status_funil || null,
      prioridade_funil: estado.prioridade_funil || 'media',
      cancelada_em: estado.cancelada_em || null,
      motivo_cancelamento: estado.motivo_cancelamento || null,
      aceite_concluido: Boolean(estado.aceite_concluido_auto || venda.aceite_concluido),
      biometria_concluida: Boolean(estado.biometria_concluida_auto || venda.biometria_concluida),
      aceite_concluido_auto: Boolean(estado.aceite_concluido_auto),
      biometria_concluida_auto: Boolean(estado.biometria_concluida_auto),
      ultima_atividade_em: estado.ultima_atividade_em || null,
      divergente_automacao: (estado.status_funil || null) !== (venda.status_funil || null)
        || Boolean(estado.cancelada_em) !== Boolean(venda.cancelada_em)
        || Boolean(estado.aceite_concluido_auto || venda.aceite_concluido) !== Boolean(venda.aceite_concluido)
        || Boolean(estado.biometria_concluida_auto || venda.biometria_concluida) !== Boolean(venda.biometria_concluida),
      historico: historicosPorVenda.get(Number(venda.id)) || []
    };
  }).filter(venda => {
    if (String(filtros?.somente_divergentes || '') === '1' && !venda.divergente_automacao) return false;
    if (venda.status_funil !== etapaFinal?.codigo) return true;
    const atividade = new Date(String(venda.ultima_atividade_em || '').replace(' ', 'T') + 'Z').getTime();
    return !Number.isFinite(atividade) || atividade > limite;
  });
}

module.exports = { inicializarParaVenda, movimentar, cancelar, listar, _internals: { estadoInicial, garantirEstado } };
