const Notificacao = require('../models/Notificacao');
const NotificacaoDestinatario = require('../models/NotificacaoDestinatario');
const Usuario = require('../models/Usuario');
const Venda = require('../models/Venda');
const FunilEtapa = require('../models/FunilEtapa');
/**
 * Servico de solicitacoes de aprovacao de vendas.
 */
const VendaAprovacaoSolicitacao = require('../models/VendaAprovacaoSolicitacao');
const VendaHistorico = require('../models/VendaHistorico');
const notificacaoEmailService = require('./notificacao-email.service');
const notificacaoService = require('./notificacao.service');
const { usuarioTemPermissaoLocal } = require('../utils/permissoes');

const STATUS_PENDENTE = 'pendente';
const STATUS_APROVADA = 'aprovada';
const STATUS_RECUSADA = 'recusada';
const STATUS_OBSOLETA = 'obsoleta';
const MOTIVO_VENDA_COMPARTILHADA = 'venda_compartilhada';
const MOTIVO_CLIENTE_VENDA_ANDAMENTO = 'cliente_venda_em_andamento';
const MOTIVO_CLIENTE_VENDA_CONCLUIDA_RECENTE = 'cliente_venda_concluida_recente';
const MESES_LIMITE_VENDA_CONCLUIDA = 24;
const TIPO_NOTIFICACAO_APROVACAO = 'venda_aprovacao_pendente';
const PERMISSAO_VISUALIZAR = 'vendas_aprovacoes_visualizar';
const PERMISSAO_DECIDIR = 'vendas_aprovacoes_decidir';

/**
 * Verifica se usuario tem permissao atende a condicao esperada.
 */
function usuarioTemPermissao(usuario, permissao) {
  if (!usuario || !usuario.ativo) return false;
  return usuarioTemPermissaoLocal(usuario, permissao);
}

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
 * Converte json para o formato interno esperado.
 */
function parseJson(valor, fallback = []) {
  if (!valor) return fallback;
  if (Array.isArray(valor)) return valor;

  if (typeof valor === 'string') {
    try {
      return JSON.parse(valor);
    } catch {
      return fallback;
    }
  }

  return valor;
}

/**
 * Normaliza motivos para uso interno consistente.
 */
function normalizarMotivos(motivos = []) {
  return Array.from(new Set(motivos)).sort();
}

/**
 * Verifica se motivos iguais atende a condicao esperada.
 */
function motivosIguais(a = [], b = []) {
  return JSON.stringify(normalizarMotivos(a)) === JSON.stringify(normalizarMotivos(b));
}

/**
 * Retorna nome venda no formato esperado pelo fluxo.
 */
function nomeVenda(venda) {
  return venda?.cliente?.nome || venda?.nome || venda?.razao_social || `Venda #${venda?.id}`;
}

/**
 * Processa descrever motivo conforme as regras do dominio.
 */
function descreverMotivo(motivo) {
  if (motivo === MOTIVO_VENDA_COMPARTILHADA) return 'venda compartilhada';
  if (motivo === MOTIVO_CLIENTE_VENDA_ANDAMENTO) return 'cliente com venda em andamento';
  if (motivo === MOTIVO_CLIENTE_VENDA_CONCLUIDA_RECENTE) return 'cliente com venda concluída há menos de 24 meses';
  return motivo;
}

/**
 * Monta mensagem motivos a partir dos dados informados.
 */
function montarMensagemMotivos(motivos) {
  return normalizarMotivos(motivos).map(descreverMotivo).join(' e ');
}
/**
 * Converte data do banco em data UTC valida.
 */
function normalizarDataUtc(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;

  const texto = String(valor).trim();
  const data = new Date(texto.includes('T') ? texto : `${texto.replace(' ', 'T')}Z`);
  return Number.isNaN(data.getTime()) ? null : data;
}

/**
 * Subtrai meses de uma data preservando o ultimo dia valido do mes de destino.
 */
function subtrairMeses(data, meses) {
  const resultado = new Date(data);
  const diaOriginal = resultado.getUTCDate();

  resultado.setUTCDate(1);
  resultado.setUTCMonth(resultado.getUTCMonth() - meses);
  const ultimoDia = new Date(Date.UTC(
    resultado.getUTCFullYear(),
    resultado.getUTCMonth() + 1,
    0
  )).getUTCDate();
  resultado.setUTCDate(Math.min(diaOriginal, ultimoDia));

  return resultado;
}

/**
 * Verifica se venda concluida entrou na etapa final ha menos de 24 meses.
 */
function vendaConcluidaRecentemente(venda, etapaFinal, agora = new Date()) {
  if (!venda || venda.excluido_em || venda.cancelada_em || venda.status_funil !== etapaFinal) return false;

  const entradaEtapaFinal = normalizarDataUtc(venda.entrada_etapa_final_em);
  if (!entradaEtapaFinal) return false;

  return entradaEtapaFinal > subtrairMeses(agora, MESES_LIMITE_VENDA_CONCLUIDA);
}

/**
 * Verifica se venda ja enviada ainda esta em andamento no funil.
 */
function vendaEmAndamento(venda, etapaFinal) {
  return Boolean(
    venda
    && !venda.excluido_em
    && !venda.cancelada_em
    && venda.enviada_pos_venda_em
    && venda.status_funil !== etapaFinal
  );
}

/**
 * Retorna a etapa final atualmente configurada no funil.
 */
async function obterCodigoEtapaFinal(trx = null) {
  try {
    const etapa = await FunilEtapa.query(trx)
      .where('etapa_final', true)
      .orderBy('ativo', 'desc')
      .orderBy('ordem', 'asc')
      .first();

    return etapa?.codigo || 'concluido';
  } catch {
    return 'concluido';
  }
}

/**
 * Lista vendas anteriores do mesmo cliente com a data mais recente de entrada na etapa final.
 */
async function listarVendasAnterioresCliente(venda, etapaFinal, trx = null) {
  const clienteId = Number(venda?.cliente_id || 0);
  if (!clienteId) return [];

  const knex = Venda.knex();
  return Venda.query(trx)
    .where('cliente_id', clienteId)
    .whereNot('id', venda.id)
    .whereNull('excluido_em')
    .select('id', 'status_funil', 'enviada_pos_venda_em', 'cancelada_em', 'excluido_em')
    .select(knex.raw(
      `(SELECT MAX(vh.created_at)
        FROM venda_historicos vh
        WHERE vh.venda_id = vendas.id
          AND vh.status_novo = ?) AS entrada_etapa_final_em`,
      [etapaFinal]
    ));
}

/**
 * Monta os motivos de liberacao a partir de uma venda e de seu historico de cliente.
 */
function avaliarMotivosVenda(venda, vendasAnteriores, etapaFinal, agora = new Date()) {
  const motivos = [];
  const vendedoras = Array.isArray(venda?.vendedoras) && venda.vendedoras.length > 0
    ? venda.vendedoras
    : (venda?.vendedora_id ? [{ id: venda.vendedora_id }] : []);

  if (vendedoras.length > 1) {
    motivos.push(MOTIVO_VENDA_COMPARTILHADA);
  }

  const vendasElegiveis = vendasAnteriores.filter(item => Number(item?.id) !== Number(venda?.id));

  if (vendasElegiveis.some(item => vendaEmAndamento(item, etapaFinal))) {
    motivos.push(MOTIVO_CLIENTE_VENDA_ANDAMENTO);
  }

  if (vendasElegiveis.some(item => vendaConcluidaRecentemente(item, etapaFinal, agora))) {
    motivos.push(MOTIVO_CLIENTE_VENDA_CONCLUIDA_RECENTE);
  }

  return normalizarMotivos(motivos);
}

/**
 * Normaliza a descricao escrita pelo solicitante.
 */
function normalizarMotivoDescricao(valor, venda, motivos = []) {
  const descricao = String(valor || '').trim().slice(0, 5000);
  if (descricao) return descricao;

  const nomes = (Array.isArray(venda?.vendedoras) ? venda.vendedoras : [])
    .map(item => item.nome)
    .filter(Boolean);
  if (motivos.length === 1 && motivos[0] === MOTIVO_VENDA_COMPARTILHADA) {
    return nomes.length > 0
    ? `Venda compartilhada entre ${nomes.join(' e ')}.`
    : 'Venda compartilhada.';
  }

  return `Venda requer liberação ADM por ${montarMensagemMotivos(motivos)}.`;
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
 * Obtem venda com relacoes a partir dos dados informados.
 */
async function obterVendaComRelacoes(vendaId, trx = null) {
  return Venda.query(trx)
    .findById(vendaId)
    .whereNull('excluido_em')
    .withGraphFetched('[cliente, vendedora, vendedoras, criador]')
    .modifyGraph('vendedora', builder => builder.select('id', 'nome', 'email', 'foto_perfil'))
    .modifyGraph('vendedoras', builder => builder.select('usuarios.id', 'usuarios.nome', 'usuarios.email', 'usuarios.foto_perfil').orderBy('venda_vendedoras.ordem', 'asc'))
    .modifyGraph('criador', builder => builder.select('id', 'nome', 'email', 'foto_perfil'));
}

/**
 * Processa avaliar requisitos venda conforme as regras do dominio.
 */
async function avaliarRequisitosVenda(vendaId, trx = null) {
  const venda = await obterVendaComRelacoes(vendaId, trx);

  if (!venda) {
    return { venda: null, motivos: [] };
  }

  const etapaFinal = await obterCodigoEtapaFinal(trx);
  const vendasAnteriores = await listarVendasAnterioresCliente(venda, etapaFinal, trx);

  return {
    venda,
    motivos: avaliarMotivosVenda(venda, vendasAnteriores, etapaFinal)
  };
}

/**
 * Busca solicitacao atual conforme os parametros informados.
 */
async function buscarSolicitacaoAtual(vendaId, trx = null) {
  return VendaAprovacaoSolicitacao.query(trx)
    .where('venda_id', vendaId)
    .whereNot('status', STATUS_OBSOLETA)
    .orderBy('id', 'desc')
    .first();
}

/**
 * Processa obsoletar solicitacoes conforme as regras do dominio.
 */
async function obsoletarSolicitacoes(vendaId, trx = null) {
  return VendaAprovacaoSolicitacao.query(trx)
    .where('venda_id', vendaId)
    .whereNot('status', STATUS_OBSOLETA)
    .patch({
      status: STATUS_OBSOLETA,
      updated_at: new Date()
    });
}

/**
 * Lista aprovadores conforme os filtros e parametros informados.
 */
async function listarAprovadores(trx = null) {
  const usuarios = await Usuario.query(trx)
    .withGraphFetched('role')
    .where('ativo', true)
    .orderBy('nome', 'asc');

  return usuarios.filter(usuario => usuarioTemPermissao(usuario, PERMISSAO_DECIDIR));
}

/**
 * Cria ou atualizar notificacao pendente com os dados informados.
 */
async function criarOuAtualizarNotificacaoPendente(solicitacao, venda, trx = null) {
  const aprovadores = await listarAprovadores(trx);
  const adminsIds = await notificacaoService.listarAdminsAtivos(trx);
  const destinatariosIds = Array.from(new Set([
    ...aprovadores.map(usuario => Number(usuario.id)),
    ...adminsIds
  ]));

  if (destinatariosIds.length === 0) {
    return null;
  }

  const motivos = parseJson(solicitacao.motivos, []);
  const sourceKey = `venda_aprovacao:${solicitacao.id}`;
  const payload = {
    tipo: TIPO_NOTIFICACAO_APROVACAO,
    titulo: 'Venda aguardando liberacao ADM',
    mensagem: `${nomeVenda(venda)} precisa de liberacao por ${montarMensagemMotivos(motivos)}.`,
    nivel: 'warn',
    entidade: 'vendas',
    entidade_id: venda.id,
    source_key: sourceKey,
    dados: JSON.stringify({
      venda_id: venda.id,
      solicitacao_id: solicitacao.id,
      venda_nome: nomeVenda(venda),
      motivos
    }),
    ativa: true,
    updated_at: new Date()
  };

  let notificacao = await Notificacao.query(trx).where('source_key', sourceKey).first();

  notificacao = notificacao
    ? await Notificacao.query(trx).patchAndFetchById(notificacao.id, payload)
    : await Notificacao.query(trx).insertAndFetch(payload);

  await NotificacaoDestinatario.query(trx)
    .where('notificacao_id', notificacao.id)
    .whereNotIn('usuario_id', destinatariosIds)
    .delete();

  for (const usuarioId of destinatariosIds) {
    const existente = await NotificacaoDestinatario.query(trx)
      .where('notificacao_id', notificacao.id)
      .where('usuario_id', usuarioId)
      .first();

    if (!existente) {
      await NotificacaoDestinatario.query(trx).insert({
        notificacao_id: notificacao.id,
        usuario_id: usuarioId
      });
    }
  }

  notificacaoEmailService.enviarEmailsPendentesAsync(notificacao.id);

  return notificacao;
}

/**
 * Desativa notificacao solicitacao quando nao e mais necessaria.
 */
async function desativarNotificacaoSolicitacao(solicitacaoId, trx = null) {
  return Notificacao.query(trx)
    .where('source_key', `venda_aprovacao:${solicitacaoId}`)
    .patch({ ativa: false, updated_at: new Date() });
}

/**
 * Valida envio pos venda e retorna o resultado esperado.
 */
async function validarEnvioPosVenda(vendaId, usuarioId, dados = {}, trx = null) {
  const { venda, motivos } = await avaliarRequisitosVenda(vendaId, trx);

  if (!venda) {
    return { status: 'not_found' };
  }

  const atual = await buscarSolicitacaoAtual(venda.id, trx);
  const motivosAtuais = atual ? parseJson(atual.motivos, []) : [];

  if (motivos.length === 0) {
    if (atual) {
      await obsoletarSolicitacoes(venda.id, trx);
      await desativarNotificacaoSolicitacao(atual.id, trx);
    }

    return { status: 'liberada', venda };
  }

  if (atual && !motivosIguais(motivosAtuais, motivos)) {
    await obsoletarSolicitacoes(venda.id, trx);
    await desativarNotificacaoSolicitacao(atual.id, trx);
    return criarSolicitacaoPendente(venda, motivos, usuarioId, dados, trx);
  }

  if (atual?.status === STATUS_APROVADA) {
    return { status: 'liberada', venda, solicitacao: atual };
  }

  if (atual?.status === STATUS_RECUSADA) {
    await obsoletarSolicitacoes(venda.id, trx);
    await desativarNotificacaoSolicitacao(atual.id, trx);
    return criarSolicitacaoPendente(venda, motivos, usuarioId, dados, trx);
  }

  if (atual?.status === STATUS_PENDENTE) {
    await criarOuAtualizarNotificacaoPendente(atual, venda, trx);
    return {
      status: 'pendente',
      venda,
      solicitacao: atual,
      message: 'Solicitação já está aguardando aprovação do ADM.'
    };
  }

  return criarSolicitacaoPendente(venda, motivos, usuarioId, dados, trx);
}

/**
 * Cria solicitacao pendente com os dados informados.
 */
async function criarSolicitacaoPendente(venda, motivos, usuarioId, dados = {}, trx = null) {
  const agora = formatarDateTimeSQL();
  const solicitacao = await VendaAprovacaoSolicitacao.query(trx).insertAndFetch({
    venda_id: venda.id,
    status: STATUS_PENDENTE,
    motivos: JSON.stringify(normalizarMotivos(motivos)),
    motivo_descricao: normalizarMotivoDescricao(dados?.motivo_descricao, venda, motivos),
    solicitado_por_id: usuarioId,
    solicitado_em: agora
  });

  await criarOuAtualizarNotificacaoPendente(solicitacao, venda, trx);

  await registrarHistoricoVenda({
    vendaId: venda.id,
    usuarioId,
    acao: 'venda.aprovacao_solicitada',
    observacao: `Solicitacao de liberacao ADM criada: ${montarMensagemMotivos(motivos)}.`,
    dados: {
      solicitacao_id: solicitacao.id,
      motivos
    },
    trx
  });

  return {
    status: 'pendente',
    venda,
    solicitacao,
    message: 'Solicitação enviada para aprovação do ADM.'
  };
}

/**
 * Sincroniza aprovacao apos alteracao com os dados atuais.
 */
async function sincronizarAprovacaoAposAlteracao(vendaId, trx = null) {
  const atual = await buscarSolicitacaoAtual(vendaId, trx);
  if (!atual) return null;

  const { motivos } = await avaliarRequisitosVenda(vendaId, trx);
  const motivosAtuais = parseJson(atual.motivos, []);

  if (motivos.length === 0 || !motivosIguais(motivosAtuais, motivos)) {
    await obsoletarSolicitacoes(vendaId, trx);
    await desativarNotificacaoSolicitacao(atual.id, trx);
    return STATUS_OBSOLETA;
  }

  return atual.status;
}

/**
 * Lista solicitacoes conforme os filtros e parametros informados.
 */
async function listarSolicitacoes(filtros = {}) {
  const statusPermitidos = [STATUS_PENDENTE, STATUS_APROVADA, STATUS_RECUSADA, STATUS_OBSOLETA];
  const query = VendaAprovacaoSolicitacao.query()
    .withGraphFetched('[venda.[cliente, vendedora, vendedoras], solicitante, decisor]')
    .modifyGraph('venda.vendedora', builder => builder.select('id', 'nome', 'email', 'foto_perfil'))
    .modifyGraph('venda.vendedoras', builder => builder.select('usuarios.id', 'usuarios.nome', 'usuarios.email', 'usuarios.foto_perfil').orderBy('venda_vendedoras.ordem', 'asc'))
    .modifyGraph('solicitante', builder => builder.select('id', 'nome', 'email', 'foto_perfil'))
    .modifyGraph('decisor', builder => builder.select('id', 'nome', 'email', 'foto_perfil'))
    .orderBy('solicitado_em', 'desc')
    .orderBy('id', 'desc');

  if (filtros.status && statusPermitidos.includes(filtros.status)) {
    query.where('status', filtros.status);
  }

  const solicitacoes = await query;

  return solicitacoes.map(solicitacao => ({
    ...solicitacao,
    motivos: parseJson(solicitacao.motivos, [])
  }));
}

/**
 * Processa decidir solicitacao conforme as regras do dominio.
 */
async function decidirSolicitacao(id, dados, usuarioId, decisao, contexto = {}) {
  const status = decisao === 'aprovar' ? STATUS_APROVADA : STATUS_RECUSADA;
  const acao = decisao === 'aprovar' ? 'venda.aprovacao_aprovada' : 'venda.aprovacao_recusada';
  const observacaoDecisao = String(dados?.observacao || '').trim() || null;
  const decisorTelegram = contexto?.telegram || null;

  const resultado = await VendaAprovacaoSolicitacao.transaction(async trx => {
    const solicitacao = await VendaAprovacaoSolicitacao.query(trx).findById(id);

    if (!solicitacao || solicitacao.status !== STATUS_PENDENTE) {
      const error = new Error('Solicitacao pendente nao encontrada.');
      error.statusCode = 404;
      throw error;
    }

    const { motivos } = await avaliarRequisitosVenda(solicitacao.venda_id, trx);
    const motivosSolicitacao = parseJson(solicitacao.motivos, []);

    if (motivos.length === 0 || !motivosIguais(motivosSolicitacao, motivos)) {
      await obsoletarSolicitacoes(solicitacao.venda_id, trx);
      await desativarNotificacaoSolicitacao(solicitacao.id, trx);
      return { desatualizada: true };
    }

    const agora = formatarDateTimeSQL();
    const atualizada = await VendaAprovacaoSolicitacao.query(trx).patchAndFetchById(solicitacao.id, {
      status,
      decidido_por_id: decisorTelegram ? null : usuarioId,
      decidido_em: agora,
      observacao_decisao: observacaoDecisao,
      updated_at: agora
    });

    await desativarNotificacaoSolicitacao(solicitacao.id, trx);

    await registrarHistoricoVenda({
      vendaId: solicitacao.venda_id,
      usuarioId,
      acao,
      observacao: observacaoDecisao || (status === STATUS_APROVADA ? 'Venda liberada pelo ADM.' : 'Venda recusada pelo ADM.'),
      dados: {
        solicitacao_id: solicitacao.id,
        motivos: motivosSolicitacao,
        status,
        ...(decisorTelegram ? { decisor_telegram: decisorTelegram } : {})
      },
      trx
    });

    return VendaAprovacaoSolicitacao.query(trx)
      .findById(atualizada.id)
      .withGraphFetched('[venda.[cliente, vendedora, vendedoras], solicitante, decisor]');
  });

  if (resultado?.desatualizada) {
    const error = new Error('A solicitação ficou desatualizada após alterações na venda.');
    error.statusCode = 409;
    throw error;
  }

  return resultado;
}

module.exports = {
  STATUS_PENDENTE,
  STATUS_APROVADA,
  STATUS_RECUSADA,
  STATUS_OBSOLETA,
  TIPO_NOTIFICACAO_APROVACAO,
  PERMISSAO_VISUALIZAR,
  PERMISSAO_DECIDIR,
  avaliarRequisitosVenda,
  validarEnvioPosVenda,
  sincronizarAprovacaoAposAlteracao,
  listarSolicitacoes,
  aprovarSolicitacao: (id, dados, usuarioId, contexto) => decidirSolicitacao(id, dados, usuarioId, 'aprovar', contexto),
  recusarSolicitacao: (id, dados, usuarioId, contexto) => decidirSolicitacao(id, dados, usuarioId, 'recusar', contexto),
  _internals: {
    avaliarMotivosVenda,
    montarMensagemMotivos,
    normalizarMotivoDescricao,
    subtrairMeses,
    vendaConcluidaRecentemente,
    vendaEmAndamento
  }
};
