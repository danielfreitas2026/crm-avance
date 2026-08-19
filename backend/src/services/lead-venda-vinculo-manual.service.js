/**
 * Busca, cria e desfaz vinculos manuais entre futuros clientes e vendas.
 */
const db = require('../database/connection');
const {
  expressaoCnpjVenda,
  extrairCnpjsMailing,
  normalizarCnpjVenda,
  resolverCnpjFuturoCliente
} = require('./lead-cnpj.service');
const { validarCnpj } = require('./cnpj.service');

function criarHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function formatarDateTimeSQL(data = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${data.getUTCFullYear()}-${pad(data.getUTCMonth() + 1)}-${pad(data.getUTCDate())} `
    + `${pad(data.getUTCHours())}:${pad(data.getUTCMinutes())}:${pad(data.getUTCSeconds())}`;
}

function resolverCnpjPesquisa(linha, cnpjInformado) {
  if (cnpjInformado === undefined || cnpjInformado === null || String(cnpjInformado).trim() === '') {
    return resolverCnpjFuturoCliente(linha);
  }

  try {
    return { cnpj: validarCnpj(cnpjInformado), origem: 'informado' };
  } catch (error) {
    throw criarHttpError(422, error.message || 'Informe um CNPJ valido para buscar vendas.');
  }
}

function validarVendaCompativelComCnpj(venda, cnpj) {
  if (normalizarCnpjVenda(venda) !== cnpj) {
    throw criarHttpError(409, 'A venda selecionada pertence a outro CNPJ.');
  }
}

function montarVendaCandidata(venda, contexto = {}) {
  const vendaId = Number(venda.id);
  const linhaVinculadaId = Number(venda.origem_lead_linha_id)
    || contexto.linhaPorVenda?.get(vendaId)
    || null;
  const cancelada = Boolean(venda.cancelada_em);
  const motivoBloqueio = cancelada
    ? 'Venda cancelada'
    : (linhaVinculadaId ? `Ja vinculada ao futuro cliente #${linhaVinculadaId}` : null);
  const vendedores = [...(contexto.vendedoras?.get(vendaId) || [])];
  if (!vendedores.length && venda.vendedora_id) {
    vendedores.push({ id: Number(venda.vendedora_id), nome: venda.vendedora_nome || 'Vendedor nao informado' });
  }
  return {
    id: vendaId,
    nome: venda.nome || venda.razao_social || '',
    razao_social: venda.razao_social || venda.nome || '',
    cnpj: venda.cnpj,
    data_venda: venda.data_venda,
    valor_total: venda.valor_total,
    status_funil: venda.status_funil,
    status_funil_nome: venda.status_funil_nome || venda.status_funil || 'Sem etapa',
    cancelada,
    vendedores,
    criador: venda.criado_por_id ? { id: Number(venda.criado_por_id), nome: venda.criador_nome || 'Nao informado' } : null,
    disponivel: !motivoBloqueio,
    motivo_bloqueio: motivoBloqueio,
    futuro_cliente_vinculado_id: linhaVinculadaId,
    vinculo_manual: Boolean(contexto.manualPorVenda?.get(vendaId))
  };
}

async function carregarLinha(linhaId, trx = db, bloquear = false) {
  let query = trx('lead_linhas as ll')
    .leftJoin('lead_sondagens as ls', 'ls.lead_linha_id', 'll.id')
    .leftJoin('usuarios as primeira', 'primeira.id', 'll.primeira_ligacao_usuario_id')
    .leftJoin('usuarios as marcador', 'marcador.id', 'll.futuro_cliente_marcado_por_id')
    .where('ll.id', Number(linhaId))
    .select(
      'll.*',
      'ls.cnpj as sondagem_cnpj',
      'primeira.nome as primeira_ligacao_usuario_nome',
      'marcador.nome as futuro_cliente_marcado_por_nome'
    );
  if (bloquear) query = query.forUpdate();
  return query.first();
}

async function carregarVendedoras(vendaIds, trx = db) {
  if (!vendaIds.length) return new Map();
  const rows = await trx('venda_vendedoras as vv')
    .join('usuarios as u', 'u.id', 'vv.usuario_id')
    .whereIn('vv.venda_id', vendaIds)
    .orderBy('vv.ordem', 'asc')
    .select('vv.venda_id', 'u.id', 'u.nome');
  return rows.reduce((mapa, row) => {
    const lista = mapa.get(Number(row.venda_id)) || [];
    lista.push({ id: Number(row.id), nome: row.nome });
    mapa.set(Number(row.venda_id), lista);
    return mapa;
  }, new Map());
}

async function listarVendasCandidatas(linhaId, cnpjInformado) {
  const linha = await carregarLinha(linhaId);
  if (!linha || !linha.futuro_cliente || linha.futuro_cliente_excluido_em) {
    throw criarHttpError(404, 'Futuro cliente ativo nao encontrado.');
  }
  const referencia = resolverCnpjPesquisa(linha, cnpjInformado);
  let referenciaOriginal = null;
  try {
    referenciaOriginal = resolverCnpjFuturoCliente(linha);
  } catch (error) {
    if (!cnpjInformado) throw error;
  }
  const cnpjVendaSql = expressaoCnpjVenda();
  const vendasEncontradas = await db('vendas as v')
    .leftJoin('clientes as c', 'c.id', 'v.cliente_id')
    .leftJoin('usuarios as principal', 'principal.id', 'v.vendedora_id')
    .leftJoin('usuarios as criador', 'criador.id', 'v.criado_por_id')
    .leftJoin('funil_etapas as fe', 'fe.codigo', 'v.status_funil')
    .whereNull('v.excluido_em')
    .where(builder => builder
      .whereRaw(`CHAR_LENGTH(${cnpjVendaSql}) BETWEEN 8 AND 14 AND LPAD(${cnpjVendaSql}, 14, '0') = ?`, [referencia.cnpj])
      .orWhere('c.cnpj_digitos', referencia.cnpj))
    .orderBy('v.data_venda', 'desc')
    .orderBy('v.id', 'desc')
    .select(
      'v.id', 'v.nome', 'v.razao_social', 'v.cnpj', 'v.cliente_id', 'v.data_venda',
      'v.valor_total', 'v.status_funil', 'v.cancelada_em', 'v.origem_lead_linha_id',
      'v.vendedora_id', 'v.criado_por_id', 'c.cnpj_digitos as cliente_cnpj_digitos',
      'principal.nome as vendedora_nome', 'criador.nome as criador_nome', 'fe.nome as status_funil_nome'
    );
  const vendas = vendasEncontradas.filter(venda => normalizarCnpjVenda(venda) === referencia.cnpj);

  const vendaIds = vendas.map(venda => Number(venda.id));
  const [linhasVinculadas, vendedoras, vinculosManuais] = await Promise.all([
    vendaIds.length
      ? db('lead_linhas').whereIn('venda_id', vendaIds).select('id', 'venda_id')
      : [],
    carregarVendedoras(vendaIds),
    vendaIds.length
      ? db('lead_venda_vinculos_manuais').whereIn('venda_id', vendaIds).whereNull('desvinculado_em').select('id', 'lead_linha_id', 'venda_id')
      : []
  ]);
  const linhaPorVenda = new Map(linhasVinculadas.map(item => [Number(item.venda_id), Number(item.id)]));
  const manualPorVenda = new Map(vinculosManuais.map(item => [Number(item.venda_id), item]));

  const candidatas = vendas.map(venda => montarVendaCandidata(venda, {
    linhaPorVenda,
    manualPorVenda,
    vendedoras
  }));
  const atual = candidatas.find(venda => Number(venda.id) === Number(linha.venda_id)) || null;
  const manualAtual = atual ? manualPorVenda.get(Number(atual.id)) : null;

  return {
    futuro_cliente_id: Number(linha.id),
    cnpj: referencia.cnpj,
    cnpj_origem: referencia.origem,
    cnpj_original: referenciaOriginal?.cnpj || null,
    cnpj_original_origem: referenciaOriginal?.origem || null,
    primeira_ligacao: {
      usuario_id: Number(linha.primeira_ligacao_usuario_id || linha.futuro_cliente_marcado_por_id) || null,
      usuario_nome: linha.primeira_ligacao_usuario_nome || linha.futuro_cliente_marcado_por_nome || null
    },
    vinculo_atual: atual ? {
      venda: atual,
      manual: Boolean(manualAtual),
      pode_desvincular: Boolean(manualAtual)
    } : null,
    vendas: candidatas
  };
}

async function vincularVenda(linhaId, vendaId, usuarioId, cnpjInformado) {
  const agora = formatarDateTimeSQL();
  const resultado = await db.transaction(async trx => {
    const linha = await carregarLinha(linhaId, trx, true);
    if (!linha || !linha.futuro_cliente || linha.futuro_cliente_excluido_em) {
      throw criarHttpError(404, 'Futuro cliente ativo nao encontrado.');
    }
    if (linha.venda_id || linha.status_operacional === 'vendido') {
      throw criarHttpError(409, 'Este futuro cliente ja possui uma venda vinculada.');
    }
    if (linha.status_operacional === 'perdido' || linha.venda_recusada_em || linha.venda_recusada_motivo) {
      throw criarHttpError(409, 'Reverta a recusa antes de vincular uma venda.');
    }

    const referencia = resolverCnpjPesquisa(linha, cnpjInformado);
    const venda = await trx('vendas as v')
      .leftJoin('clientes as c', 'c.id', 'v.cliente_id')
      .where('v.id', Number(vendaId))
      .forUpdate()
      .first('v.*', 'c.cnpj_digitos as cliente_cnpj_digitos');
    if (!venda || venda.excluido_em) throw criarHttpError(404, 'Venda nao encontrada.');
    if (venda.cancelada_em) throw criarHttpError(409, 'Vendas canceladas nao podem ser vinculadas.');
    validarVendaCompativelComCnpj(venda, referencia.cnpj);
    if (venda.origem_lead_linha_id) {
      throw criarHttpError(409, `Esta venda ja esta vinculada ao futuro cliente #${venda.origem_lead_linha_id}.`);
    }
    const outraLinha = await trx('lead_linhas').where('venda_id', Number(venda.id)).forUpdate().first('id');
    if (outraLinha) throw criarHttpError(409, `Esta venda ja esta vinculada ao futuro cliente #${outraLinha.id}.`);

    const atribuicao = await trx('lead_atribuicoes')
      .where({ lead_linha_id: Number(linha.id), etapa: 'venda' })
      .orderBy('id', 'desc')
      .forUpdate()
      .first();
    const origemSondadorId = Number(linha.primeira_ligacao_usuario_id || linha.futuro_cliente_marcado_por_id) || null;
    const [vinculoId] = await trx('lead_venda_vinculos_manuais').insert({
      lead_linha_id: Number(linha.id),
      venda_id: Number(venda.id),
      vinculado_por_id: Number(usuarioId),
      origem_sondador_id: origemSondadorId,
      lead_etapa_anterior: linha.etapa_atual || null,
      lead_status_anterior: linha.status_operacional || null,
      lead_cliente_id_anterior: linha.cliente_id || null,
      lead_venda_id_anterior: linha.venda_id || null,
      atribuicao_id: atribuicao?.id || null,
      atribuicao_status_anterior: atribuicao?.status || null,
      atribuicao_finalizado_em_anterior: atribuicao?.finalizado_em || null,
      atribuicao_acao_registrada_em_anterior: atribuicao?.acao_registrada_em || null,
      atribuicao_acao_registrada_tipo_anterior: atribuicao?.acao_registrada_tipo || null,
      venda_origem_lead_linha_id_anterior: venda.origem_lead_linha_id || null,
      venda_origem_sondador_id_anterior: venda.origem_sondador_id || null,
      vinculado_em: agora,
      created_at: agora,
      updated_at: agora
    });

    await trx('vendas').where('id', Number(venda.id)).update({
      origem_lead_linha_id: Number(linha.id),
      origem_sondador_id: origemSondadorId,
      updated_at: agora
    });
    await trx('lead_linhas').where('id', Number(linha.id)).update({
      venda_id: Number(venda.id),
      cliente_id: venda.cliente_id || null,
      etapa_atual: 'venda',
      status_operacional: 'vendido',
      updated_at: agora
    });
    if (atribuicao) {
      await trx('lead_atribuicoes').where('id', Number(atribuicao.id)).update({
        status: 'vendido',
        finalizado_em: agora,
        acao_registrada_em: agora,
        acao_registrada_tipo: 'venda_vinculada_manual',
        updated_at: agora
      });
    }
    await require('./notificacao.service').desativarAlertasObrigatoriosDaLinha(linha.id, trx);

    return {
      vinculo_id: Number(vinculoId),
      linha_id: Number(linha.id),
      venda_id: Number(venda.id),
      origem_sondador_id: origemSondadorId,
      vendedor_id: Number(venda.vendedora_id) || null,
      cnpj_pesquisado: referencia.cnpj
    };
  });
  return resultado;
}

async function desvincularVenda(linhaId, usuarioId) {
  const agora = formatarDateTimeSQL();
  const resultado = await db.transaction(async trx => {
    const vinculo = await trx('lead_venda_vinculos_manuais')
      .where('lead_linha_id', Number(linhaId))
      .whereNull('desvinculado_em')
      .orderBy('id', 'desc')
      .forUpdate()
      .first();
    if (!vinculo) throw criarHttpError(409, 'Este vinculo nao foi criado manualmente e nao pode ser desfeito aqui.');

    const linha = await trx('lead_linhas').where('id', Number(linhaId)).forUpdate().first();
    const venda = await trx('vendas').where('id', Number(vinculo.venda_id)).forUpdate().first();
    if (!linha || !venda) throw criarHttpError(409, 'O vinculo nao esta mais consistente.');
    if (Number(linha.venda_id) !== Number(venda.id) || Number(venda.origem_lead_linha_id) !== Number(linha.id)) {
      throw criarHttpError(409, 'O vinculo foi alterado depois da criacao e nao pode ser desfeito automaticamente.');
    }

    await trx('vendas').where('id', Number(venda.id)).update({
      origem_lead_linha_id: vinculo.venda_origem_lead_linha_id_anterior || null,
      origem_sondador_id: vinculo.venda_origem_sondador_id_anterior || null,
      updated_at: agora
    });
    await trx('lead_linhas').where('id', Number(linha.id)).update({
      venda_id: vinculo.lead_venda_id_anterior || null,
      cliente_id: vinculo.lead_cliente_id_anterior || null,
      etapa_atual: vinculo.lead_etapa_anterior || 'sondagem',
      status_operacional: vinculo.lead_status_anterior || 'qualificado',
      updated_at: agora
    });
    if (vinculo.atribuicao_id) {
      await trx('lead_atribuicoes').where('id', Number(vinculo.atribuicao_id)).update({
        status: vinculo.atribuicao_status_anterior,
        finalizado_em: vinculo.atribuicao_finalizado_em_anterior || null,
        acao_registrada_em: vinculo.atribuicao_acao_registrada_em_anterior || null,
        acao_registrada_tipo: vinculo.atribuicao_acao_registrada_tipo_anterior || null,
        updated_at: agora
      });
    }
    await trx('lead_venda_vinculos_manuais').where('id', Number(vinculo.id)).update({
      desvinculado_por_id: Number(usuarioId),
      desvinculado_em: agora,
      updated_at: agora
    });
    return {
      vinculo_id: Number(vinculo.id),
      linha_id: Number(linha.id),
      venda_id: Number(venda.id),
      origem_sondador_id: vinculo.origem_sondador_id || null,
      vendedor_id: Number(venda.vendedora_id) || null
    };
  });

  try {
    await require('./notificacao.service').sincronizarRetornosLeads();
  } catch (error) {
    console.error('Erro ao ressincronizar notificacoes depois de desfazer vinculo manual:', error);
  }
  return resultado;
}

module.exports = {
  desvincularVenda,
  listarVendasCandidatas,
  vincularVenda,
  _internals: {
    expressaoCnpjVenda,
    extrairCnpjsMailing,
    montarVendaCandidata,
    normalizarCnpjVenda,
    resolverCnpjPesquisa,
    resolverCnpjFuturoCliente,
    validarVendaCompativelComCnpj
  }
};
