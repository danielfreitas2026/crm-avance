/**
 * Servico de abertura, correcao, verificacao e resolucao de problemas de vendas.
 */
const db = require('../database/connection');
const Notificacao = require('../models/Notificacao');
const NotificacaoDestinatario = require('../models/NotificacaoDestinatario');
const Usuario = require('../models/Usuario');
const Venda = require('../models/Venda');
const VendaHistorico = require('../models/VendaHistorico');
const VendaProblema = require('../models/VendaProblema');
const VendaProblemaDestinatario = require('../models/VendaProblemaDestinatario');
const VendaProblemaEvento = require('../models/VendaProblemaEvento');
const notificacaoEmailService = require('./notificacao-email.service');
const notificacaoService = require('./notificacao.service');
const { usuarioTemPermissaoLocal } = require('../utils/permissoes');

const STATUS_ATIVOS = ['aberto', 'resolvido', 'correcao_solicitada'];
const TIPOS_NOTIFICACAO_PROBLEMA = [
  'venda_problema_aberto',
  'venda_problema_resolvido',
  'venda_problema_correcao',
  'venda_problema_automatico'
];

/**
 * Formata date time sql para exibicao ou envio.
 */
function formatarDateTimeSQL(data = new Date()) {
  /**
   * Preenche valores numericos com zero a esquerda.
   */
  const pad = valor => String(valor).padStart(2, '0');

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
 * Cria um erro HTTP com status e mensagem padronizados.
 */
function erro(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * Busca usuario conforme os parametros informados.
 */
async function buscarUsuario(usuarioId) {
  return Usuario.query().findById(usuarioId).withGraphFetched('role');
}

/**
 * Verifica se usuario eh admin atende a condicao esperada.
 */
function usuarioEhAdmin(usuario) {
  return usuario?.role?.nome === 'admin';
}

/**
 * Verifica se usuario pode ver todas atende a condicao esperada.
 */
function usuarioPodeVerTodas(usuario) {
  return usuarioTemPermissaoLocal(usuario, 'vendas_ver_todas');
}

/**
 * Busca venda acessivel conforme os parametros informados.
 */
async function buscarVendaAcessivel(vendaId, usuarioId, trx = null) {
  const usuario = await buscarUsuario(usuarioId);
  const venda = await Venda.query(trx)
    .findById(vendaId)
    .whereNull('excluido_em')
    .withGraphFetched('[vendedora, vendedoras, cliente]');

  if (!venda) return null;
  if (usuarioPodeVerTodas(usuario)) return venda;

  const vinculado = Number(venda.criado_por_id) === Number(usuarioId)
    || Number(venda.vendedora_id) === Number(usuarioId)
    || (venda.vendedoras || []).some(item => Number(item.id) === Number(usuarioId));

  return vinculado ? venda : null;
}

/**
 * Retorna nome venda no formato esperado pelo fluxo.
 */
function nomeVenda(venda) {
  return venda?.cliente?.nome || venda?.nome || venda?.razao_social || `Venda #${venda?.id}`;
}

/**
 * Busca problema completo conforme os parametros informados.
 */
async function buscarProblemaCompleto(problemaId, trx = null) {
  return VendaProblema.query(trx)
    .findById(problemaId)
    .withGraphFetched('[venda.[cliente, vendedora, vendedoras], solicitante, destinatarios.usuario, eventos.usuario]')
    .modifyGraph('eventos', builder => builder.orderBy('created_at', 'asc').orderBy('id', 'asc'));
}

/**
 * Busca problema ativo conforme os parametros informados.
 */
async function buscarProblemaAtivo(vendaId, trx = null) {
  const problema = await VendaProblema.query(trx)
    .where('venda_id', vendaId)
    .whereIn('status', STATUS_ATIVOS)
    .orderBy('id', 'desc')
    .first();

  return problema ? buscarProblemaCompleto(problema.id, trx) : null;
}

/**
 * Lista problemas ativos conforme os filtros e parametros informados.
 */
async function listarProblemasAtivos(vendaId, trx = null) {
  return VendaProblema.query(trx)
    .where('venda_id', vendaId)
    .whereIn('status', STATUS_ATIVOS)
    .withGraphFetched('[venda.[cliente, vendedora, vendedoras], solicitante, destinatarios.usuario, eventos.usuario]')
    .modifyGraph('eventos', builder => builder.orderBy('created_at', 'asc').orderBy('id', 'asc'))
    .orderBy('updated_at', 'desc')
    .orderBy('id', 'desc');
}

/**
 * Registra evento no historico ou log.
 */
async function registrarEvento({ problemaId, usuarioId, tipo, mensagem, dados = {}, trx }) {
  return VendaProblemaEvento.query(trx).insertAndFetch({
    problema_id: Number(problemaId),
    usuario_id: usuarioId ? Number(usuarioId) : null,
    tipo,
    mensagem,
    dados: JSON.stringify(dados)
  });
}

/**
 * Registra historico venda no historico ou log.
 */
async function registrarHistoricoVenda({ vendaId, usuarioId, acao, observacao, dados = {}, trx }) {
  return VendaHistorico.query(trx).insert({
    venda_id: Number(vendaId),
    usuario_id: usuarioId ? Number(usuarioId) : null,
    acao,
    observacao,
    dados: JSON.stringify(dados),
    created_at: formatarDateTimeSQL()
  });
}

/**
 * Cria notificacao problema com os dados informados.
 */
async function criarNotificacaoProblema({ tipo, problema, evento, destinatariosIds, titulo, mensagem, nivel = 'danger', trx }) {
  await Notificacao.query(trx)
    .where('source_key', 'like', `venda_problema:%:${problema.id}:%`)
    .where('ativa', true)
    .patch({ ativa: false, updated_at: new Date() });

  const sourceKey = `venda_problema:${tipo}:${problema.id}:${evento.id}`;
  const notificacao = await Notificacao.query(trx).insertAndFetch({
    tipo,
    titulo,
    mensagem,
    nivel,
    entidade: 'vendas',
    entidade_id: problema.venda_id,
    source_key: sourceKey,
    dados: JSON.stringify({
      problema_id: problema.id,
      venda_id: problema.venda_id,
      venda_nome: nomeVenda(problema.venda),
      solicitante_id: problema.solicitante_id,
      evento_id: evento.id,
      evento_tipo: evento.tipo,
      mensagem: evento.mensagem
    }),
    ativa: true,
    updated_at: new Date()
  });

  const adminsIds = await notificacaoService.listarAdminsAtivos(trx);
  const idsFinais = [...new Set([
    ...destinatariosIds.map(Number).filter(Boolean),
    ...adminsIds
  ])];

  for (const usuarioId of idsFinais) {
    await NotificacaoDestinatario.query(trx).insert({
      notificacao_id: notificacao.id,
      usuario_id: usuarioId
    });
  }

  notificacaoEmailService.enviarEmailsPendentesAsync(notificacao.id);

  return notificacao;
}

/**
 * Resolve destinatarios a partir do contexto atual.
 */
async function resolverDestinatarios(venda, dados, trx) {
  if (dados.modo_destinatario === 'manual') {
    const ids = [...new Set((dados.destinatarios || []).map(Number).filter(Boolean))];

    if (ids.length === 0) {
      throw erro(400, 'Selecione ao menos um responsável.');
    }

    const usuarios = await Usuario.query(trx)
      .whereIn('id', ids)
      .where('ativo', true)
      .select('id');

    if (usuarios.length !== ids.length) {
      throw erro(400, 'Um ou mais responsáveis selecionados não estão ativos.');
    }

    return ids;
  }

  const vinculados = (venda.vendedoras || []).map(item => Number(item.id)).filter(Boolean);
  const fallback = venda.vendedora_id ? [Number(venda.vendedora_id)] : [];
  const ids = [...new Set(vinculados.length > 0 ? vinculados : fallback)];

  if (ids.length === 0) {
    throw erro(400, 'A venda não possui responsável vinculado.');
  }

  return ids;
}

/**
 * Abre problema e prepara o estado necessario.
 */
async function abrirProblema(vendaId, dados, usuarioId) {
  const motivo = String(dados.motivo || '').trim();

  if (!motivo) {
    throw erro(400, 'Informe o motivo do problema.');
  }

  return VendaProblema.transaction(async trx => {
    const venda = await buscarVendaAcessivel(vendaId, usuarioId, trx);

    if (!venda) {
      throw erro(404, 'Venda não encontrada.');
    }

    const destinatariosIds = await resolverDestinatarios(venda, dados, trx);
    const problema = await VendaProblema.query(trx).insertAndFetch({
      venda_id: venda.id,
      solicitante_id: usuarioId,
      status: 'aberto',
      aberto_em: formatarDateTimeSQL()
    });

    for (const responsavelId of destinatariosIds) {
      await VendaProblemaDestinatario.query(trx).insert({
        problema_id: problema.id,
        usuario_id: responsavelId
      });
    }

    const evento = await registrarEvento({
      problemaId: problema.id,
      usuarioId,
      tipo: 'abertura',
      mensagem: motivo,
      dados: { destinatarios: destinatariosIds },
      trx
    });

    const completo = await buscarProblemaCompleto(problema.id, trx);

    await criarNotificacaoProblema({
      tipo: 'venda_problema_aberto',
      problema: completo,
      evento,
      destinatariosIds,
      titulo: 'Venda marcada com problema',
      mensagem: `${nomeVenda(venda)} foi marcada com problema: ${motivo}`,
      trx
    });

    await registrarHistoricoVenda({
      vendaId: venda.id,
      usuarioId,
      acao: 'venda.problema_aberto',
      observacao: motivo,
      dados: { problema_id: problema.id, destinatarios: destinatariosIds },
      trx
    });

    return buscarProblemaCompleto(problema.id, trx);
  });
}

/**
 * Obtem ativo a partir dos dados informados.
 */
async function obterAtivo(vendaId, usuarioId) {
  const venda = await buscarVendaAcessivel(vendaId, usuarioId);

  if (!venda) {
    return null;
  }

  return buscarProblemaAtivo(venda.id);
}

/**
 * Lista ativos conforme os filtros e parametros informados.
 */
async function listarAtivos(vendaId, usuarioId) {
  const venda = await buscarVendaAcessivel(vendaId, usuarioId);

  if (!venda) {
    return [];
  }

  return listarProblemasAtivos(venda.id);
}

/**
 * Verifica se usuario eh responsavel atende a condicao esperada.
 */
function usuarioEhResponsavel(problema, usuarioId) {
  return (problema.destinatarios || []).some(item => Number(item.usuario_id) === Number(usuarioId));
}

/**
 * Resolve problema a partir do contexto atual.
 */
async function resolverProblema(problemaId, dados, usuarioId) {
  const mensagem = String(dados.mensagem || '').trim();

  if (!mensagem) {
    throw erro(400, 'Informe a mensagem de resolução.');
  }

  return VendaProblema.transaction(async trx => {
    const problema = await buscarProblemaCompleto(problemaId, trx);

    if (!problema || !STATUS_ATIVOS.includes(problema.status)) {
      throw erro(404, 'Problema ativo nao encontrado.');
    }

    const usuario = await buscarUsuario(usuarioId);
    const ehResponsavel = usuarioEhResponsavel(problema, usuarioId);

    if (!ehResponsavel && !usuarioEhAdmin(usuario)) {
      throw erro(403, 'Apenas responsáveis ou administradores podem marcar o problema como resolvido.');
    }

    const agora = formatarDateTimeSQL();
    await VendaProblema.query(trx).patchAndFetchById(problema.id, {
      status: 'resolvido',
      resolvido_em: agora,
      updated_at: agora
    });

    const patchDestinatarios = VendaProblemaDestinatario.query(trx).where('problema_id', problema.id);

    if (ehResponsavel) {
      patchDestinatarios.where('usuario_id', usuarioId);
    }

    await patchDestinatarios.patch({ resolvido_em: agora, updated_at: agora });

    const evento = await registrarEvento({
      problemaId: problema.id,
      usuarioId,
      tipo: 'resolucao',
      mensagem,
      trx
    });
    const atualizado = await buscarProblemaCompleto(problema.id, trx);

    await criarNotificacaoProblema({
      tipo: 'venda_problema_resolvido',
      problema: atualizado,
      evento,
      destinatariosIds: [problema.solicitante_id],
      titulo: 'Problema de venda marcado como resolvido',
      mensagem: `${nomeVenda(problema.venda)} foi marcada como resolvida: ${mensagem}`,
      nivel: 'warn',
      trx
    });

    await registrarHistoricoVenda({
      vendaId: problema.venda_id,
      usuarioId,
      acao: 'venda.problema_resolvido',
      observacao: mensagem,
      dados: { problema_id: problema.id },
      trx
    });

    return atualizado;
  });
}

/**
 * Executa a acao de solicitar correcao mantendo o estado da tela consistente.
 */
async function solicitarCorrecao(problemaId, dados, usuarioId) {
  const mensagem = String(dados.mensagem || '').trim();

  if (!mensagem) {
    throw erro(400, 'Informe a mensagem de correção.');
  }

  return VendaProblema.transaction(async trx => {
    const problema = await buscarProblemaCompleto(problemaId, trx);

    if (!problema || !STATUS_ATIVOS.includes(problema.status)) {
      throw erro(404, 'Problema ativo nao encontrado.');
    }

    if (Number(problema.solicitante_id) !== Number(usuarioId)) {
      throw erro(403, 'Apenas o solicitante pode pedir novas correcoes.');
    }

    const agora = formatarDateTimeSQL();
    await VendaProblema.query(trx).patchAndFetchById(problema.id, {
      status: 'correcao_solicitada',
      resolvido_em: null,
      updated_at: agora
    });

    await VendaProblemaDestinatario.query(trx)
      .where('problema_id', problema.id)
      .patch({ resolvido_em: null, updated_at: agora });

    const evento = await registrarEvento({
      problemaId: problema.id,
      usuarioId,
      tipo: 'correcao',
      mensagem,
      trx
    });
    const atualizado = await buscarProblemaCompleto(problema.id, trx);
    const destinatariosIds = atualizado.destinatarios.map(item => item.usuario_id);

    await criarNotificacaoProblema({
      tipo: 'venda_problema_correcao',
      problema: atualizado,
      evento,
      destinatariosIds,
      titulo: 'Nova correção solicitada em venda',
      mensagem: `${nomeVenda(problema.venda)} precisa de nova correção: ${mensagem}`,
      trx
    });

    await registrarHistoricoVenda({
      vendaId: problema.venda_id,
      usuarioId,
      acao: 'venda.problema_correcao_solicitada',
      observacao: mensagem,
      dados: { problema_id: problema.id },
      trx
    });

    return atualizado;
  });
}

/**
 * Processa verificar problema conforme as regras do dominio.
 */
async function verificarProblema(problemaId, usuarioId) {
  return VendaProblema.transaction(async trx => {
    const problema = await buscarProblemaCompleto(problemaId, trx);

    if (!problema || !STATUS_ATIVOS.includes(problema.status)) {
      throw erro(404, 'Problema ativo nao encontrado.');
    }

    const usuario = await buscarUsuario(usuarioId);

    if (Number(problema.solicitante_id) !== Number(usuarioId) && !usuarioEhAdmin(usuario)) {
      throw erro(403, 'Apenas o solicitante ou administradores podem verificar o problema.');
    }

    const agora = formatarDateTimeSQL();
    await VendaProblema.query(trx).patchAndFetchById(problema.id, {
      status: 'verificado',
      verificado_em: agora,
      updated_at: agora
    });

    const evento = await registrarEvento({
      problemaId: problema.id,
      usuarioId,
      tipo: 'verificacao',
      mensagem: 'Problema verificado e fechado.',
      trx
    });

    await Notificacao.query(trx)
      .where('source_key', 'like', `venda_problema:%:${problema.id}:%`)
      .patch({ ativa: false, updated_at: new Date() });

    await registrarHistoricoVenda({
      vendaId: problema.venda_id,
      usuarioId,
      acao: 'venda.problema_verificado',
      observacao: evento.mensagem,
      dados: { problema_id: problema.id },
      trx
    });

    return buscarProblemaCompleto(problema.id, trx);
  });
}

/**
 * Verifica se usuario tem notificacao problema atende a condicao esperada.
 */
async function usuarioTemNotificacaoProblema(usuarioId) {
  const total = await db('notificacao_destinatarios as nd')
    .join('notificacoes as n', 'nd.notificacao_id', 'n.id')
    .where('nd.usuario_id', usuarioId)
    .where('n.ativa', true)
    .whereIn('n.tipo', TIPOS_NOTIFICACAO_PROBLEMA)
    .count('nd.id as total')
    .first();

  return Number(total?.total || 0) > 0;
}

/**
 * Lista destinatarios disponiveis conforme os filtros e parametros informados.
 */
async function listarDestinatariosDisponiveis() {
  return Usuario.query()
    .withGraphFetched('role')
    .where('ativo', true)
    .orderBy('nome', 'asc')
    .select('id', 'nome', 'email', 'role_id', 'foto_perfil');
}

module.exports = {
  TIPOS_NOTIFICACAO_PROBLEMA,
  abrirProblema,
  obterAtivo,
  listarAtivos,
  resolverProblema,
  solicitarCorrecao,
  verificarProblema,
  listarDestinatariosDisponiveis,
  usuarioTemNotificacaoProblema
};
