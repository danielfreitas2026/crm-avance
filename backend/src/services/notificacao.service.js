/**
 * Servico de notificacoes, destinatarios, leitura e exibicao de popups.
 */
const Cliente = require('../models/Cliente');
const ClienteOperadora = require('../models/ClienteOperadora');
const Notificacao = require('../models/Notificacao');
const NotificacaoDestinatario = require('../models/NotificacaoDestinatario');
const Usuario = require('../models/Usuario');
const db = require('../database/connection');
const vendaNotificacaoParadaService = require('./venda-notificacao-parada.service');
const {
  salvarNotificacaoIdempotente,
  desativarNotificacoesAtivas
} = require('./notificacao-persistencia.service');
const { parseUtcDateTime } = require('../utils/datetime');
const {
  parsePermissoes,
  usuarioTemPermissaoLocal: usuarioTemPermissaoLocalImportado
} = require('../utils/permissoes');

const PERMISSAO_VISUALIZAR = 'notificacoes_visualizar';
const PERMISSAO_RECEBER_TODAS = 'notificacoes_receber_todas';
const TIPO_FIDELIDADE_CLIENTE = 'cliente_fidelidade';
const TIPO_NOTA_RETORNO_PRE = 'nota_retorno_pre';
const TIPO_NOTA_RETORNO_DUE = 'nota_retorno_due';
const TIPO_FUTURO_RETORNO_PRE = 'futuro_cliente_retorno_pre';
const TIPO_FUTURO_RETORNO_DUE = 'futuro_cliente_retorno_due';
const TIPOS_FUTURO_RETORNO = [TIPO_FUTURO_RETORNO_PRE, TIPO_FUTURO_RETORNO_DUE];
const TIPO_FUTURO_CLIENTE_DISTRIBUIDO = 'futuro_cliente_distribuido';
const TIPO_LEAD_RETORNO_PRE = 'lead_retorno_pre';
const TIPO_LEAD_RETORNO_DUE = 'lead_retorno_due';
const TIPOS_LEAD_RETORNO = [TIPO_LEAD_RETORNO_PRE, TIPO_LEAD_RETORNO_DUE];
const TIPOS_PROBLEMA_VENDA = [
  'venda_problema_aberto',
  'venda_problema_resolvido',
  'venda_problema_correcao'
];
const TIPOS_APROVACAO_VENDA = ['venda_aprovacao_pendente'];
const TIPOS_RETORNO_VENDA = ['venda_retorno_registrado'];
const TIPOS_CANCELAMENTO_VENDA = ['venda_cancelada'];
const TIPOS_BASE_VENDA = [
  ...TIPOS_PROBLEMA_VENDA,
  ...TIPOS_RETORNO_VENDA,
  ...TIPOS_CANCELAMENTO_VENDA
];
const TIPOS_OPERACIONAIS_VENDA = [
  ...TIPOS_BASE_VENDA,
  ...TIPOS_APROVACAO_VENDA
];
const TIPO_VENDA_PARADA = vendaNotificacaoParadaService.TIPO_NOTIFICACAO;
const PERMISSAO_VENDAS_PARADAS = vendaNotificacaoParadaService.PERMISSAO_VENDAS_PARADAS;

/**
 * Verifica se usuario tem permissao local atende a condicao esperada.
 */
function usuarioTemPermissaoLocal(usuario, permissao) {
  return usuarioTemPermissaoLocalImportado(usuario, permissao);
}

/**
 * Lista admins ativos conforme os filtros e parametros informados.
 */
async function listarAdminsAtivos(trx = null) {
  const usuarios = await Usuario.query(trx)
    .withGraphFetched('role')
    .where('ativo', true);

  return usuarios
    .filter(usuario => usuario.role?.nome === 'admin')
    .map(usuario => Number(usuario.id));
}

/**
 * Formata data iso para exibicao ou envio.
 */
function formatarDataISO(data = new Date()) {
  return [
    data.getFullYear(),
    String(data.getMonth() + 1).padStart(2, '0'),
    String(data.getDate()).padStart(2, '0')
  ].join('-');
}

/**
 * Converte data dia para o formato interno esperado.
 */
function parseDataDia(valor) {
  if (!valor || valor === '1899-11-30') return null;

  const texto = valor instanceof Date ? formatarDataISO(valor) : String(valor).slice(0, 10);
  const data = new Date(`${texto}T00:00:00`);

  return Number.isNaN(data.getTime()) ? null : data;
}

/**
 * Calcula dias restantes com base nos valores informados.
 */
function calcularDiasRestantes(fidelidadeFim) {
  const fim = parseDataDia(fidelidadeFim);

  if (!fim) return null;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  return Math.ceil((fim.getTime() - hoje.getTime()) / 86400000);
}

/**
 * Monta texto dias a partir dos dados informados.
 */
function montarTextoDias(diasRestantes) {
  if (diasRestantes < 0) {
    const diasVencida = Math.abs(diasRestantes);
    return diasVencida === 1 ? 'venceu há 1 dia' : `venceu há ${diasVencida} dias`;
  }

  if (diasRestantes === 0) return 'termina hoje';
  if (diasRestantes === 1) return 'termina em 1 dia';
  return `termina em ${diasRestantes} dias`;
}

/**
 * Monta nivel a partir dos dados informados.
 */
function montarNivel(diasRestantes) {
  if (diasRestantes < 0) return 'danger';
  if (diasRestantes <= 3) return 'danger';
  if (diasRestantes <= 10) return 'warn';
  return 'info';
}

/**
 * Converte data hora para o formato interno esperado.
 */
function parseDataHora(valor) {
  return parseUtcDateTime(valor);
}

/**
 * Formata data hora br para exibicao ou envio.
 */
function formatarDataHoraBR(valor) {
  const data = parseDataHora(valor);
  if (!data) return '';

  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo'
  });
}

/**
 * Lista usuarios destinatarios conforme os filtros e parametros informados.
 */
async function listarUsuariosDestinatarios(cliente, trx = null) {
  const usuarios = await Usuario.query()
    .withGraphFetched('role')
    .where('ativo', true);
  const ids = new Set();

  usuarios.forEach(usuario => {
    if (usuarioTemPermissaoLocal(usuario, PERMISSAO_RECEBER_TODAS)) {
      ids.add(Number(usuario.id));
    }
  });

  if (cliente.criado_por_id) {
    const criador = usuarios.find(usuario => Number(usuario.id) === Number(cliente.criado_por_id));

    if (criador?.ativo) {
      ids.add(Number(cliente.criado_por_id));
    }
  }

  const consultoras = await (trx || db)('cliente_consultoras')
    .where('cliente_id', cliente.id)
    .pluck('usuario_id');
  consultoras.forEach(id => ids.add(Number(id)));

  return Array.from(ids);
}

/**
 * Desativa notificacao fidelidade cliente quando nao e mais necessaria.
 */
async function desativarNotificacaoFidelidadeCliente(clienteId, trx = null) {
  return desativarNotificacoesAtivas(Notificacao.query(trx)
    .where(function () {
      this.where('source_key', `${TIPO_FIDELIDADE_CLIENTE}:${clienteId}`)
        .orWhere('source_key', 'like', `${TIPO_FIDELIDADE_CLIENTE}:${clienteId}:%`);
    }));
}

/**
 * Desativa notificacoes retorno nota quando nao e mais necessaria.
 */
async function desativarNotificacoesRetornoNota(notaId, trx = null) {
  const sourceKeys = [
    `${TIPO_NOTA_RETORNO_PRE}:${notaId}`,
    `${TIPO_NOTA_RETORNO_DUE}:${notaId}`
  ];

  return desativarNotificacoesAtivas(
    Notificacao.query(trx).whereIn('source_key', sourceKeys)
  );
}

/**
 * Sincroniza fidelidade cliente com os dados atuais.
 */
async function sincronizarFidelidadeCliente(clienteId, trx = null) {
  const cliente = await Cliente.query(trx)
    .findById(clienteId)
    .whereNull('excluido_em')
    .withGraphFetched('operadorasAtuais.operadora');

  if (!cliente) {
    await desativarNotificacaoFidelidadeCliente(clienteId, trx);
    return null;
  }

  await desativarNotificacoesAtivas(
    Notificacao.query(trx).where('source_key', `${TIPO_FIDELIDADE_CLIENTE}:${cliente.id}`)
  );

  const operadoras = cliente.operadorasAtuais?.length > 0
    ? cliente.operadorasAtuais
    : [];
  const sourceKeysAtivas = [];
  let ultimaNotificacao = null;

  for (const clienteOperadora of operadoras) {
    const diasRestantes = calcularDiasRestantes(clienteOperadora.fidelidade_fim);
    const sourceKey = `${TIPO_FIDELIDADE_CLIENTE}:${cliente.id}:${clienteOperadora.id}`;
    sourceKeysAtivas.push(sourceKey);

    if (diasRestantes === null || diasRestantes > 30) {
      await desativarNotificacoesAtivas(
        Notificacao.query(trx).where('source_key', sourceKey)
      );
      continue;
    }

    const nomeCliente = cliente.nome || cliente.razao_social || `Cliente #${cliente.id}`;
    const nomeOperadora = clienteOperadora.operadora?.nome || 'Operadora';
    const dados = {
      cliente_id: cliente.id,
      cliente_operadora_id: clienteOperadora.id,
      operadora_id: clienteOperadora.operadora_id,
      operadora_nome: nomeOperadora,
      cliente_nome: nomeCliente,
      fidelidade_fim: clienteOperadora.fidelidade_fim,
      dias_restantes: diasRestantes
    };

    const payload = {
      tipo: TIPO_FIDELIDADE_CLIENTE,
      titulo: diasRestantes < 0 ? 'Fidelidade de cliente vencida' : 'Fidelidade de cliente perto do fim',
      mensagem: `A fidelidade de ${nomeCliente} na ${nomeOperadora} ${montarTextoDias(diasRestantes)}.`,
      nivel: montarNivel(diasRestantes),
      entidade: 'clientes',
      entidade_id: cliente.id,
      source_key: sourceKey,
      dados: JSON.stringify(dados),
      ativa: true
    };

    const destinatarios = await listarUsuariosDestinatarios(cliente, trx);
    const resultado = await salvarNotificacaoIdempotente({
      sourceKeys: [sourceKey],
      sourceKeyNova: sourceKey,
      payload,
      destinatarios,
      trx
    });
    const notificacao = resultado.notificacao;
    ultimaNotificacao = notificacao;
  }

  const queryInativas = Notificacao.query(trx)
    .where('source_key', 'like', `${TIPO_FIDELIDADE_CLIENTE}:${cliente.id}:%`);

  if (sourceKeysAtivas.length > 0) {
    queryInativas.whereNotIn('source_key', sourceKeysAtivas);
  }

  await desativarNotificacoesAtivas(queryInativas);

  return ultimaNotificacao;
}

/**
 * Sincroniza notificacoes fidelidade com os dados atuais.
 */
async function sincronizarNotificacoesFidelidade() {
  const clientes = await Cliente.query()
    .select('id')
    .whereNull('excluido_em')
    .whereExists(
      ClienteOperadora.query()
        .select(db.raw('1'))
        .whereRaw('cliente_operadoras.cliente_id = clientes.id')
        .whereNotNull('fidelidade_fim')
    );

  for (const cliente of clientes) {
    await sincronizarFidelidadeCliente(cliente.id);
  }
}

/**
 * Salva notificacao retorno nota com os dados informados.
 */
async function salvarNotificacaoRetornoNota(nota, etapa, agora) {
  if (nota.retorno_realizado_em) {
    await desativarNotificacoesRetornoNota(nota.id);
    return null;
  }
  const retorno = parseDataHora(nota.retorno_agendado_para);
  if (!retorno) {
    await desativarNotificacoesRetornoNota(nota.id);
    return null;
  }

  const sourceKeys = [
    `${TIPO_NOTA_RETORNO_PRE}:${nota.id}`,
    `${TIPO_NOTA_RETORNO_DUE}:${nota.id}`
  ];
  const sourceKey = `${etapa}:${nota.id}`;
  const tituloNota = nota.titulo || 'Sem titulo';
  const destino = nota.entidade_tipo === 'cliente' ? 'clientes' : nota.entidade_tipo === 'lead' ? 'clientes-secretos' : 'vendas';
  const retornoFormatado = formatarDataHoraBR(nota.retorno_agendado_para);
  const isDue = etapa === TIPO_NOTA_RETORNO_DUE;
  const payload = {
    tipo: etapa,
    titulo: isDue ? 'Retorno de ligacao vencido' : 'Retorno de ligacao em breve',
    mensagem: isDue
      ? `Retorne a ligacao de "${tituloNota}" marcada para ${retornoFormatado}.`
      : `Retorno de "${tituloNota}" marcado para ${retornoFormatado}.`,
    nivel: isDue ? 'danger' : 'warn',
    entidade: destino,
    entidade_id: nota.entidade_id,
    source_key: sourceKey,
    dados: JSON.stringify({
      nota_id: nota.id,
      entidade_tipo: nota.entidade_tipo,
      entidade_id: nota.entidade_id,
      retorno_agendado_para: nota.retorno_agendado_para,
      retorno_etapa: isDue ? 'due' : 'pre',
      titulo_nota: tituloNota
    }),
    ativa: true
  };

  const adminsIds = await listarAdminsAtivos();
  const destinatariosIds = Array.from(new Set([Number(nota.usuario_id), ...adminsIds].filter(Boolean)));
  const resultado = await salvarNotificacaoIdempotente({
    sourceKeys,
    sourceKeyNova: sourceKey,
    payload,
    destinatarios: destinatariosIds,
    agora
  });

  return resultado.notificacao;
}

/**
 * Sincroniza retornos notas com os dados atuais.
 */
async function sincronizarRetornosNotas(usuarioId = null) {
  const agora = new Date();
  // Gera a notificacao assim que a nota tem data de retorno marcada (qualquer data),
  // independente da janela de pre-aviso e do status de pos-venda da venda.
  const query = db('entidade_notas')
    .whereNotNull('retorno_agendado_para')
    .whereNull('retorno_realizado_em')
    .select('id', 'entidade_tipo', 'entidade_id', 'usuario_id', 'titulo', 'retorno_agendado_para', 'retorno_realizado_em');

  if (usuarioId) {
    query.where('usuario_id', Number(usuarioId));
  }

  const notas = await query;

  for (const nota of notas) {
    const retorno = parseDataHora(nota.retorno_agendado_para);
    if (!retorno) {
      await desativarNotificacoesRetornoNota(nota.id);
      continue;
    }

    if (retorno <= agora) {
      await salvarNotificacaoRetornoNota(nota, TIPO_NOTA_RETORNO_DUE, agora);
    } else {
      await salvarNotificacaoRetornoNota(nota, TIPO_NOTA_RETORNO_PRE, agora);
    }
  }
}

/** Indica se o retorno do card deve seguir a fila de mailing da consultora atual. */
function isRetornoLeadAgendadoElegivel(linha) {
  if (!linha || !linha.retorno_agendado_em || linha.retorno_agendado_realizado_em || linha.cliente_recusou) return false;
  return !linha.futuro_cliente || linha.status_operacional === 'distribuido_venda';
}

function tituloFuturoCliente(dadosJson, linhaId) {
  const dados = parseDados(dadosJson);
  const entrada = Object.entries(dados).find(([chave, valor]) => {
    const nome = String(chave || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return valor && ['razao social', 'empresa', 'nome fantasia', 'nome'].some(termo => nome.includes(termo));
  });
  return String(entrada?.[1] || `Futuro cliente #${linhaId}`);
}

async function salvarNotificacaoRetornoFuturoCliente(linha, etapa, agora) {
  const retorno = parseDataHora(linha.retorno_em);
  if (!retorno) return null;
  const isDue = etapa === TIPO_FUTURO_RETORNO_DUE;
  const sourceKeys = TIPOS_FUTURO_RETORNO.map(tipo => `${tipo}:${linha.lead_linha_id}`);
  const sourceKey = `${etapa}:${linha.lead_linha_id}`;
  const nome = tituloFuturoCliente(linha.dados_json, linha.lead_linha_id);
  const retornoFormatado = formatarDataHoraBR(linha.retorno_em);
  const payload = {
    tipo: etapa,
    titulo: isDue ? 'Retorno de futuro cliente vencido' : 'Retorno de futuro cliente em breve',
    mensagem: isDue
      ? `Retorne a ligacao de "${nome}" marcada para ${retornoFormatado}.`
      : `Retorno de "${nome}" marcado para ${retornoFormatado}.`,
    nivel: isDue ? 'danger' : 'warn',
    entidade: 'lead_linhas',
    entidade_id: linha.lead_linha_id,
    source_key: sourceKey,
    dados: JSON.stringify({
      lead_linha_id: linha.lead_linha_id,
      retorno_agendado_para: linha.retorno_em,
      retorno_etapa: isDue ? 'due' : 'pre',
      titulo_nota: nome
    }),
    ativa: true
  };
  const adminsIds = await listarAdminsAtivos();
  const destinatarios = Array.from(new Set([Number(linha.usuario_id), ...adminsIds].filter(Boolean)));
  const resultado = await salvarNotificacaoIdempotente({
    sourceKeys,
    sourceKeyNova: sourceKey,
    payload,
    destinatarios,
    agora
  });
  return resultado.notificacao;
}

/** Notificacao interna da distribuicao para venda via Telegram. */
async function criarNotificacaoFuturoClienteDistribuido(dados, trx = null) {
  const linhaId = Number(dados.leadLinhaId);
  const vendedoraId = Number(dados.vendedoraId);
  const sourceKey = TIPO_FUTURO_CLIENTE_DISTRIBUIDO + ':' + linhaId;
  const agora = new Date();
  const payload = {
    tipo: TIPO_FUTURO_CLIENTE_DISTRIBUIDO,
    titulo: 'Nova indicacao aguardando aceite',
    mensagem: 'Uma nova indicacao foi encaminhada para voce. Aceite para liberar os detalhes.',
    nivel: 'info',
    entidade: 'lead_linhas',
    entidade_id: linhaId,
    source_key: sourceKey,
    dados: JSON.stringify({ lead_linha_id: linhaId, encaminhado_por_telegram_id: String(dados.gerenteTelegramId || ''), encaminhado_em: agora.toISOString() }),
    ativa: true
  };
  const resultado = await salvarNotificacaoIdempotente({
    sourceKeys: [sourceKey],
    sourceKeyNova: sourceKey,
    payload,
    destinatarios: [vendedoraId],
    agora,
    trx,
    rearmarQuando: () => false
  });
  return resultado.notificacao;
}

/** Mantem o alerta ativo durante o prazo de contato depois do aceite. */
async function atualizarNotificacaoFuturoClienteAceito(dados, trx = null) {
  const linhaId = Number(dados.leadLinhaId);
  const vendedoraId = Number(dados.vendedoraId);
  const sourceKey = `${TIPO_FUTURO_CLIENTE_DISTRIBUIDO}:${linhaId}`;
  const agora = new Date();
  const prazoFormatado = formatarDataHoraBR(dados.prazoAcaoEm);
  const payload = {
    tipo: TIPO_FUTURO_CLIENTE_DISTRIBUIDO,
    titulo: 'Contato da indicacao pendente',
    mensagem: `Indicacao aceita. Registre uma acao no CRM ate ${prazoFormatado}.`,
    nivel: 'warn',
    entidade: 'lead_linhas',
    entidade_id: linhaId,
    source_key: sourceKey,
    dados: JSON.stringify({ lead_linha_id: linhaId, aceite_em: agora.toISOString(), prazo_acao_em: dados.prazoAcaoEm }),
    ativa: true
  };
  const resultado = await salvarNotificacaoIdempotente({
    sourceKeys: [sourceKey],
    sourceKeyNova: sourceKey,
    payload,
    destinatarios: [vendedoraId],
    agora,
    trx,
    rearmarQuando: () => false
  });
  return resultado.notificacao;
}

/**
 * Encerra os alertas operacionais que exigem uma acao da consultora para uma linha.
 * A baixa e baseada na alteracao efetiva do lead, e nao na simples abertura do popup.
 */
async function desativarAlertasObrigatoriosDaLinha(linhaId, trx = null) {
  const id = Number(linhaId);
  if (!id) return 0;

  return Notificacao.query(trx)
    .where('entidade', 'lead_linhas')
    .where('entidade_id', id)
    .whereIn('tipo', [
      TIPO_FUTURO_CLIENTE_DISTRIBUIDO,
      ...TIPOS_FUTURO_RETORNO,
      ...TIPOS_LEAD_RETORNO
    ])
    .where('ativa', true)
    .patch({ ativa: false, updated_at: new Date() });
}

async function sincronizarRetornosFuturosClientes() {
  const agora = new Date();
  const linhas = await db('lead_sondagens as ls')
    .join('lead_linhas as ll', 'll.id', 'ls.lead_linha_id')
    .where('ll.futuro_cliente', true)
    .whereNull('ll.futuro_cliente_excluido_em')
    .whereNull('ll.retorno_agendado_em')
    .whereNull('ll.futuro_cliente_retorno_realizado_em')
    .whereNotNull('ls.retorno_em')
    .select('ls.lead_linha_id', 'ls.usuario_id', 'ls.retorno_em', 'll.dados_json');

  for (const linha of linhas) {
    const retorno = parseDataHora(linha.retorno_em);
    if (!retorno) continue;
    if (retorno <= agora) {
      await salvarNotificacaoRetornoFuturoCliente(linha, TIPO_FUTURO_RETORNO_DUE, agora);
    } else {
      await salvarNotificacaoRetornoFuturoCliente(linha, TIPO_FUTURO_RETORNO_PRE, agora);
    }
  }

  const notificacoesObsoletas = await db('notificacoes as n')
    .leftJoin('lead_sondagens as ls', 'ls.lead_linha_id', 'n.entidade_id')
    .leftJoin('lead_linhas as ll', 'll.id', 'n.entidade_id')
    .whereIn('n.tipo', TIPOS_FUTURO_RETORNO)
    .where('n.ativa', true)
    .where(builder => builder.whereNull('ls.retorno_em').orWhereNull('ll.id').orWhere('ll.futuro_cliente', false).orWhereNotNull('ll.futuro_cliente_excluido_em').orWhereNotNull('ll.retorno_agendado_em').orWhereNotNull('ll.futuro_cliente_retorno_realizado_em').orWhereIn('ll.status_operacional', ['vendido', 'perdido']).orWhereNotNull('ll.venda_id').orWhereNotNull('ll.venda_recusada_em'))
    .distinct('n.id');

  const notificacoesObsoletasIds = notificacoesObsoletas.map(notificacao => notificacao.id);
  if (notificacoesObsoletasIds.length > 0) {
    await db('notificacoes')
      .whereIn('id', notificacoesObsoletasIds)
      .update({ ativa: false, updated_at: agora });
  }
}

async function salvarNotificacaoRetornoLead(linha, etapa, agora) {
  const retorno = parseDataHora(linha.retorno_agendado_em);
  if (!retorno) return null;
  const isDue = etapa === TIPO_LEAD_RETORNO_DUE;
  const sourceKeys = TIPOS_LEAD_RETORNO.map(tipo => `${tipo}:${linha.id}`);
  const sourceKey = `${etapa}:${linha.id}`;
  const nome = tituloFuturoCliente(linha.dados_json, linha.id);
  const retornoFormatado = formatarDataHoraBR(linha.retorno_agendado_em);
  const payload = {
    tipo: etapa,
    titulo: isDue ? 'Retorno de lead vencido' : 'Retorno de lead em breve',
    mensagem: isDue
      ? `Retorne a ligacao de "${nome}" marcada para ${retornoFormatado}.`
      : `Retorno de "${nome}" marcado para ${retornoFormatado}.`,
    nivel: isDue ? 'danger' : 'warn',
    entidade: 'lead_linhas',
    entidade_id: linha.id,
    source_key: sourceKey,
    dados: JSON.stringify({
      lead_linha_id: linha.id,
      retorno_agendado_para: linha.retorno_agendado_em,
      retorno_etapa: isDue ? 'due' : 'pre',
      titulo_nota: nome
    }),
    ativa: true
  };
  const adminsIds = await listarAdminsAtivos();
  const destinatarios = Array.from(new Set([Number(linha.atribuido_para_id), ...adminsIds].filter(Boolean)));
  const resultado = await salvarNotificacaoIdempotente({
    sourceKeys,
    sourceKeyNova: sourceKey,
    payload,
    destinatarios,
    agora
  });
  return resultado.notificacao;
}

/**
 * Sincroniza os retornos marcados direto no card de lead recebido.
 * Futuros clientes encaminhados para venda continuam usando esse fluxo, pois o
 * retorno pertence a consultora que recebeu o encaminhamento.
 */
async function sincronizarRetornosLeads() {
  const agora = new Date();
  const linhas = await db('lead_linhas')
    .whereNotNull('retorno_agendado_em')
    .whereNull('retorno_agendado_realizado_em')
    .where('cliente_recusou', false)
    .where(builder => builder
      .where('futuro_cliente', false)
      .orWhere(subquery => subquery
        .where('futuro_cliente', true)
        .where('status_operacional', 'distribuido_venda')))
    .select('id', 'atribuido_para_id', 'retorno_agendado_em', 'retorno_agendado_realizado_em', 'dados_json', 'futuro_cliente', 'status_operacional');

  for (const linha of linhas) {
    const retorno = parseDataHora(linha.retorno_agendado_em);
    if (!retorno) continue;
    if (retorno <= agora) {
      await salvarNotificacaoRetornoLead(linha, TIPO_LEAD_RETORNO_DUE, agora);
    } else {
      await salvarNotificacaoRetornoLead(linha, TIPO_LEAD_RETORNO_PRE, agora);
    }
  }

  const notificacoesObsoletas = await db('notificacoes as n')
    .leftJoin('lead_linhas as ll', 'll.id', 'n.entidade_id')
    .whereIn('n.tipo', TIPOS_LEAD_RETORNO)
    .where('n.ativa', true)
    .where(builder => builder
      .whereNull('ll.id')
      .orWhereNull('ll.retorno_agendado_em')
      .orWhereNotNull('ll.retorno_agendado_realizado_em')
      .orWhere('ll.cliente_recusou', true)
      .orWhere(subquery => subquery
        .where('ll.futuro_cliente', true)
        .where(inner => inner
          .whereNull('ll.status_operacional')
          .orWhereNot('ll.status_operacional', 'distribuido_venda'))))
    .distinct('n.id');

  const notificacoesObsoletasIds = notificacoesObsoletas.map(notificacao => notificacao.id);
  if (notificacoesObsoletasIds.length > 0) {
    await db('notificacoes')
      .whereIn('id', notificacoesObsoletasIds)
      .update({ ativa: false, updated_at: agora });
  }
}

/**
 * Sincroniza somente o retorno da nota alterada recentemente.
 */
async function sincronizarRetornoNota(notaId) {
  const id = Number(notaId);
  if (!id) return null;

  const agora = new Date();
  const nota = await db('entidade_notas')
    .where('id', id)
    .select('id', 'entidade_tipo', 'entidade_id', 'usuario_id', 'titulo', 'retorno_agendado_para', 'retorno_realizado_em')
    .first();

  if (!nota || !nota.retorno_agendado_para || nota.retorno_realizado_em) {
    await desativarNotificacoesRetornoNota(id);
    return null;
  }

  const retorno = parseDataHora(nota.retorno_agendado_para);
  if (!retorno) {
    await desativarNotificacoesRetornoNota(id);
    return null;
  }

  if (retorno <= agora) {
    return salvarNotificacaoRetornoNota(nota, TIPO_NOTA_RETORNO_DUE, agora);
  }
  return salvarNotificacaoRetornoNota(nota, TIPO_NOTA_RETORNO_PRE, agora);
}

/**
 * Sincroniza somente o retorno de um lead alterado recentemente.
 */
async function sincronizarRetornoLead(linhaId) {
  const id = Number(linhaId);
  if (!id) return null;

  const agora = new Date();
  const linha = await db('lead_linhas')
    .where('id', id)
    .select('id', 'atribuido_para_id', 'retorno_agendado_em', 'retorno_agendado_realizado_em', 'cliente_recusou', 'futuro_cliente', 'status_operacional', 'dados_json')
    .first();

  if (!isRetornoLeadAgendadoElegivel(linha)) {
    await Notificacao.query()
      .whereIn('tipo', TIPOS_LEAD_RETORNO)
      .where('entidade', 'lead_linhas')
      .where('entidade_id', id)
      .where('ativa', true)
      .patch({ ativa: false, updated_at: agora });
    return null;
  }

  const retorno = parseDataHora(linha.retorno_agendado_em);
  if (!retorno) return null;

  if (retorno <= agora) {
    return salvarNotificacaoRetornoLead(linha, TIPO_LEAD_RETORNO_DUE, agora);
  }
  return salvarNotificacaoRetornoLead(linha, TIPO_LEAD_RETORNO_PRE, agora);
}

/**
 * Converte dados para o formato interno esperado.
 */
function parseDados(dados) {
  if (!dados) return {};

  if (typeof dados === 'string') {
    try {
      return JSON.parse(dados);
    } catch {
      return {};
    }
  }

  return dados;
}

/**
 * Aplica join destinatario usuario sobre a consulta ou conjunto informado.
 */
function aplicarJoinDestinatarioUsuario(query, usuarioId) {
  return query.leftJoin('notificacao_destinatarios as nd', function () {
    this.on('nd.notificacao_id', '=', 'n.id')
      .andOn('nd.usuario_id', '=', db.raw('?', [Number(usuarioId)]));
  });
}

/**
 * Aplica filtro tipos visiveis sobre a consulta ou conjunto informado.
 */
function aplicarFiltroTiposVisiveis(query, { podeReceberTodas, podeVerTudo, podeVerAprovacoes, podeVerVendasParadas }) {
  if (!podeReceberTodas) {
    query.whereNotNull('nd.id');
  }

  if (!podeVerTudo) {
    query.whereIn('n.tipo', [
      TIPO_NOTA_RETORNO_PRE,
      TIPO_NOTA_RETORNO_DUE,
      ...TIPOS_FUTURO_RETORNO,
      TIPO_FUTURO_CLIENTE_DISTRIBUIDO,
      ...TIPOS_LEAD_RETORNO,
      ...(podeVerAprovacoes ? TIPOS_OPERACIONAIS_VENDA : TIPOS_BASE_VENDA),
      ...(podeVerVendasParadas ? [TIPO_VENDA_PARADA] : [])
    ]);
  } else if (!podeVerVendasParadas) {
    query.whereNot('n.tipo', TIPO_VENDA_PARADA);
  }

  return query;
}

/**
 * Remove da fila da navbar as notificacoes ocultadas pelo usuario.
 */
function aplicarFiltroNavbar(query) {
  return query.whereNull('nd.ocultada_em');
}

function aplicarLimiteListagem(query, filtros = {}) {
  if (filtros.escopo === 'dashboard') return query;
  const limit = Math.min(Math.max(Number(filtros.limit || 20), 1), 50);
  return query.limit(limit);
}

/**
 * Mapeia notificacao para o formato usado pela aplicacao.
 */
function mapearNotificacao(notificacao) {
  return {
    ...notificacao,
    dados: parseDados(notificacao.dados),
    lida: Boolean(notificacao.lida_em)
  };
}

/**
 * Exclui notificacoes por ids conforme a regra de negocio.
 */
async function excluirNotificacoesPorIds(notificacaoIds, trx) {
  const ids = [...new Set(notificacaoIds.map(id => Number(id)).filter(Boolean))];
  if (ids.length === 0) return 0;

  await trx('notificacao_destinatarios')
    .whereIn('notificacao_id', ids)
    .delete();

  await trx('notificacoes')
    .whereIn('id', ids)
    .delete();

  return ids.length;
}

/**
 * Busca notificacoes sem entidade conforme os parametros informados.
 */
async function buscarNotificacoesSemEntidade(tabela, trx) {
  const alias = tabela === 'clientes' ? 'c' : 'v';

  return trx('notificacoes as n')
    .leftJoin(`${tabela} as ${alias}`, 'n.entidade_id', `${alias}.id`)
    .where('n.entidade', tabela)
    .whereNotNull('n.entidade_id')
    .where(builder => {
      builder
        .whereNull(`${alias}.id`)
        .orWhereNotNull(`${alias}.excluido_em`);
    })
    .select('n.id');
}

/**
 * Limpa notificacoes sem objeto referente e restaura o estado inicial.
 */
async function limparNotificacoesSemObjetoReferente() {
  return db.transaction(async trx => {
    const [notificacoesClientes, notificacoesVendas] = await Promise.all([
      buscarNotificacoesSemEntidade('clientes', trx),
      buscarNotificacoesSemEntidade('vendas', trx)
    ]);

    return excluirNotificacoesPorIds([
      ...notificacoesClientes.map(notificacao => notificacao.id),
      ...notificacoesVendas.map(notificacao => notificacao.id)
    ], trx);
  });
}

/**
 * Lista notificacoes conforme os filtros e parametros informados.
 */
async function listarNotificacoes(usuarioId, filtros = {}) {
  const usuario = await Usuario.query()
    .findById(usuarioId)
    .withGraphFetched('role');
  const podeReceberTodas = usuarioTemPermissaoLocal(usuario, PERMISSAO_RECEBER_TODAS);
  const podeVerTudo = usuarioTemPermissaoLocal(usuario, PERMISSAO_VISUALIZAR);
  const podeVerAprovacoes = usuarioTemPermissaoLocal(usuario, 'vendas_aprovacoes_visualizar')
    || usuarioTemPermissaoLocal(usuario, 'vendas_aprovacoes_decidir');
  const podeVerVendasParadas = usuarioTemPermissaoLocal(usuario, PERMISSAO_VENDAS_PARADAS);

  const ordemDataHora = filtros.ordem === 'data_hora_asc' ? 'asc' : 'desc';
  const query = aplicarJoinDestinatarioUsuario(Notificacao.query().alias('n'), usuarioId)
    .where('n.ativa', true)
    .orderBy('n.updated_at', ordemDataHora)
    .orderBy('n.id', ordemDataHora)
    .select(
      'nd.id as destinatario_id',
      'nd.lida_em',
      'n.id',
      'n.tipo',
      'n.titulo',
      'n.mensagem',
      'n.nivel',
      'n.entidade',
      'n.entidade_id',
      'n.dados',
      'n.created_at',
      'n.updated_at'
    );

  aplicarLimiteListagem(query, filtros);

  aplicarFiltroTiposVisiveis(query, { podeReceberTodas, podeVerTudo, podeVerAprovacoes, podeVerVendasParadas });

  if (filtros.nao_lidas) {
    query.whereNull('nd.lida_em');
  }

  const contadorQuery = aplicarJoinDestinatarioUsuario(Notificacao.query().alias('n'), usuarioId)
    .where('n.ativa', true)
    .whereNull('nd.lida_em')
    .count('n.id as total')
    .first();

  aplicarFiltroTiposVisiveis(contadorQuery, { podeReceberTodas, podeVerTudo, podeVerAprovacoes, podeVerVendasParadas });

  const [notificacoes, contador] = await Promise.all([
    query,
    contadorQuery
  ]);

  return {
    unread_count: Number(contador?.total || 0),
    notificacoes: notificacoes.map(mapearNotificacao)
  };
}

/**
 * Lista urgentes conforme os filtros e parametros informados.
 */
/** Desativa distribuicoes que ja receberam uma resolucao no registro do futuro cliente. */
async function sincronizarDistribuicoesResolvidas() {
  const agora = new Date();
  const notificacoes = await db('notificacoes as n')
    .leftJoin('lead_linhas as ll', 'll.id', 'n.entidade_id')
    .leftJoin('lead_sondagens as ls', 'ls.lead_linha_id', 'll.id')
    .where('n.tipo', TIPO_FUTURO_CLIENTE_DISTRIBUIDO)
    .where('n.ativa', true)
    .where(builder => builder
      .whereNull('ll.id')
      .orWhereNot('ll.status_operacional', 'distribuido_venda')
      .orWhereNotNull('ll.venda_id')
      .orWhereNotNull('ll.venda_recusada_em')
      .orWhereNotNull('ll.retorno_agendado_em')
      .orWhereNotNull('ls.retorno_em'))
    .distinct('n.id');

  if (notificacoes.length) {
    await db('notificacoes').whereIn('id', notificacoes.map(item => item.id))
      .update({ ativa: false, updated_at: agora });
  }
}

/**
 * Atualiza os alertas baseados em prazo fora do caminho de resposta da interface.
 */
async function sincronizarNotificacoesPendentes() {
  await sincronizarNotificacoesFidelidade();
  await sincronizarRetornosNotas();
  await sincronizarRetornosFuturosClientes();
  await sincronizarRetornosLeads();
  await sincronizarDistribuicoesResolvidas();
  await vendaNotificacaoParadaService.sincronizarVendasParadas();
  await limparNotificacoesSemObjetoReferente();
}

async function listarUrgentes(usuarioId) {
  const usuario = await Usuario.query()
    .findById(usuarioId)
    .withGraphFetched('role');
  const podeReceberTodas = usuarioTemPermissaoLocal(usuario, PERMISSAO_RECEBER_TODAS);
  const podeVerTudo = usuarioTemPermissaoLocal(usuario, PERMISSAO_VISUALIZAR);
  const podeVerAprovacoes = usuarioTemPermissaoLocal(usuario, 'vendas_aprovacoes_visualizar')
    || usuarioTemPermissaoLocal(usuario, 'vendas_aprovacoes_decidir');
  const podeVerVendasParadas = usuarioTemPermissaoLocal(usuario, PERMISSAO_VENDAS_PARADAS);

  const query = aplicarJoinDestinatarioUsuario(Notificacao.query().alias('n'), usuarioId)
    .where('n.ativa', true)
    .whereNull('nd.popup_visto_em')
    // A sincronizacao atualiza updated_at a cada consulta. A fila usa a criacao
    // para manter os alertas estaveis ate que uma acao os resolva.
    .orderBy('n.created_at', 'asc')
    .orderBy('n.id', 'asc')
    .select(
      'nd.id as destinatario_id',
      'nd.lida_em',
      'nd.popup_visto_em',
      'n.id',
      'n.tipo',
      'n.titulo',
      'n.mensagem',
      'n.nivel',
      'n.entidade',
      'n.entidade_id',
      'n.dados',
      'n.created_at',
      'n.updated_at'
    );

  aplicarFiltroTiposVisiveis(query, { podeReceberTodas, podeVerTudo, podeVerAprovacoes, podeVerVendasParadas });
  aplicarFiltroNavbar(query);

  const notificacoes = await query;

  return notificacoes.map(mapearNotificacao);
}

/**
 * Marca como lida conforme a acao solicitada.
 */
async function marcarComoLida(notificacaoId, usuarioId) {
  const usuario = await Usuario.query()
    .findById(usuarioId)
    .withGraphFetched('role');
  const podeReceberTodas = usuarioTemPermissaoLocal(usuario, PERMISSAO_RECEBER_TODAS);
  const podeVerTudo = usuarioTemPermissaoLocal(usuario, PERMISSAO_VISUALIZAR);
  const podeVerAprovacoes = usuarioTemPermissaoLocal(usuario, 'vendas_aprovacoes_visualizar')
    || usuarioTemPermissaoLocal(usuario, 'vendas_aprovacoes_decidir');
  const podeVerVendasParadas = usuarioTemPermissaoLocal(usuario, PERMISSAO_VENDAS_PARADAS);

  const query = aplicarJoinDestinatarioUsuario(Notificacao.query().alias('n'), usuarioId)
    .where('n.id', notificacaoId)
    .where('n.ativa', true)
    .select('n.id', 'nd.id as destinatario_id', 'nd.lida_em');

  aplicarFiltroTiposVisiveis(query, { podeReceberTodas, podeVerTudo, podeVerAprovacoes, podeVerVendasParadas });

  const notificacao = await query.first();

  if (!notificacao) {
    return false;
  }

  if (notificacao.destinatario_id) {
    if (!notificacao.lida_em) {
      await NotificacaoDestinatario.query()
        .patchAndFetchById(notificacao.destinatario_id, { lida_em: new Date() });
    }
  } else {
    await NotificacaoDestinatario.query().insert({
      notificacao_id: notificacao.id,
      usuario_id: usuarioId,
      lida_em: new Date()
    });
  }

  return true;
}

/**
 * Marca todas como lidas conforme a acao solicitada.
 */
async function marcarTodasComoLidas(usuarioId) {
  const usuario = await Usuario.query()
    .findById(usuarioId)
    .withGraphFetched('role');
  const podeReceberTodas = usuarioTemPermissaoLocal(usuario, PERMISSAO_RECEBER_TODAS);
  const podeVerTudo = usuarioTemPermissaoLocal(usuario, PERMISSAO_VISUALIZAR);
  const podeVerAprovacoes = usuarioTemPermissaoLocal(usuario, 'vendas_aprovacoes_visualizar')
    || usuarioTemPermissaoLocal(usuario, 'vendas_aprovacoes_decidir');
  const podeVerVendasParadas = usuarioTemPermissaoLocal(usuario, PERMISSAO_VENDAS_PARADAS);

  const query = aplicarJoinDestinatarioUsuario(Notificacao.query().alias('n'), usuarioId)
    .where('n.ativa', true)
    .whereNull('nd.lida_em')
    .select('n.id', 'nd.id as destinatario_id');

  aplicarFiltroTiposVisiveis(query, { podeReceberTodas, podeVerTudo, podeVerAprovacoes, podeVerVendasParadas });

  const notificacoes = await query;

  if (notificacoes.length === 0) {
    return 0;
  }

  const agora = new Date();
  const destinatariosExistentes = notificacoes
    .map(item => item.destinatario_id)
    .filter(Boolean);
  const notificacoesSemDestinatario = notificacoes
    .filter(item => !item.destinatario_id)
    .map(item => item.id);

  if (destinatariosExistentes.length > 0) {
    await NotificacaoDestinatario.query()
      .whereIn('id', destinatariosExistentes)
      .patch({ lida_em: agora });
  }

  for (const notificacaoId of notificacoesSemDestinatario) {
    await NotificacaoDestinatario.query().insert({
      notificacao_id: notificacaoId,
      usuario_id: usuarioId,
      lida_em: agora
    });
  }

  return notificacoes.length;
}

/**
 * Marca popup visto conforme a acao solicitada.
 */
async function marcarPopupVisto(notificacaoId, usuarioId) {
  const usuario = await Usuario.query()
    .findById(usuarioId)
    .withGraphFetched('role');
  const podeReceberTodas = usuarioTemPermissaoLocal(usuario, PERMISSAO_RECEBER_TODAS);
  const podeVerTudo = usuarioTemPermissaoLocal(usuario, PERMISSAO_VISUALIZAR);
  const podeVerAprovacoes = usuarioTemPermissaoLocal(usuario, 'vendas_aprovacoes_visualizar')
    || usuarioTemPermissaoLocal(usuario, 'vendas_aprovacoes_decidir');
  const podeVerVendasParadas = usuarioTemPermissaoLocal(usuario, PERMISSAO_VENDAS_PARADAS);

  const query = aplicarJoinDestinatarioUsuario(Notificacao.query().alias('n'), usuarioId)
    .where('n.id', notificacaoId)
    .where('n.ativa', true)
    .select('n.id', 'nd.id as destinatario_id', 'nd.popup_visto_em');

  aplicarFiltroTiposVisiveis(query, { podeReceberTodas, podeVerTudo, podeVerAprovacoes, podeVerVendasParadas });

  const notificacao = await query.first();

  if (!notificacao) {
    return false;
  }

  if (notificacao.destinatario_id) {
    if (!notificacao.popup_visto_em) {
      await NotificacaoDestinatario.query()
        .patchAndFetchById(notificacao.destinatario_id, { popup_visto_em: new Date() });
    }
  } else {
    await NotificacaoDestinatario.query().insert({
      notificacao_id: notificacao.id,
      usuario_id: usuarioId,
      popup_visto_em: new Date()
    });
  }

  return true;
}

/**
 * Persiste a ocultacao no destinatario existente ou materializa o destinatario
 * de uma notificacao global.
 */
async function salvarOcultacaoDestinatario({ notificacaoId, usuarioId, destinatarioId, ocultadaEm }, dependencias = {}) {
  const DestinatarioModel = dependencias.DestinatarioModel || NotificacaoDestinatario;
  const knex = dependencias.knex || db;

  if (destinatarioId) {
    await DestinatarioModel.query()
      .patchAndFetchById(destinatarioId, { ocultada_em: ocultadaEm });
    return;
  }

  await knex('notificacao_destinatarios')
    .insert({
      notificacao_id: notificacaoId,
      usuario_id: usuarioId,
      ocultada_em: ocultadaEm
    })
    .onConflict(['notificacao_id', 'usuario_id'])
    .merge({ ocultada_em: ocultadaEm });
}

/**
 * Oculta uma notificacao somente para o usuario atual.
 */
async function ocultarNotificacao(notificacaoId, usuarioId) {
  const usuario = await Usuario.query()
    .findById(usuarioId)
    .withGraphFetched('role');
  const podeReceberTodas = usuarioTemPermissaoLocal(usuario, PERMISSAO_RECEBER_TODAS);
  const podeVerTudo = usuarioTemPermissaoLocal(usuario, PERMISSAO_VISUALIZAR);
  const podeVerAprovacoes = usuarioTemPermissaoLocal(usuario, 'vendas_aprovacoes_visualizar')
    || usuarioTemPermissaoLocal(usuario, 'vendas_aprovacoes_decidir');
  const podeVerVendasParadas = usuarioTemPermissaoLocal(usuario, PERMISSAO_VENDAS_PARADAS);

  const query = aplicarJoinDestinatarioUsuario(Notificacao.query().alias('n'), usuarioId)
    .where('n.id', notificacaoId)
    .where('n.ativa', true)
    .select('n.id', 'nd.id as destinatario_id');

  aplicarFiltroTiposVisiveis(query, { podeReceberTodas, podeVerTudo, podeVerAprovacoes, podeVerVendasParadas });
  aplicarFiltroNavbar(query);

  const notificacao = await query.first();
  if (!notificacao) return false;

  await salvarOcultacaoDestinatario({
    notificacaoId: notificacao.id,
    usuarioId,
    destinatarioId: notificacao.destinatario_id,
    ocultadaEm: new Date()
  });

  return true;
}

module.exports = {
  PERMISSAO_VISUALIZAR,
  PERMISSAO_RECEBER_TODAS,
  TIPOS_PROBLEMA_VENDA,
  TIPOS_APROVACAO_VENDA,
  TIPOS_RETORNO_VENDA,
  TIPO_FUTURO_CLIENTE_DISTRIBUIDO,
  listarAdminsAtivos,
  listarNotificacoes,
  listarUrgentes,
  marcarComoLida,
  marcarPopupVisto,
  marcarTodasComoLidas,
  ocultarNotificacao,
  sincronizarFidelidadeCliente,
  sincronizarNotificacoesFidelidade,
  desativarNotificacoesRetornoNota,
  sincronizarRetornosNotas,
  sincronizarRetornoNota,
  sincronizarRetornosFuturosClientes,
  criarNotificacaoFuturoClienteDistribuido,
  atualizarNotificacaoFuturoClienteAceito,
  desativarAlertasObrigatoriosDaLinha,
  sincronizarRetornoLead,
  sincronizarRetornosLeads,
  sincronizarNotificacoesPendentes,
  limparNotificacoesSemObjetoReferente,
  _internals: {
    aplicarFiltroNavbar,
    aplicarLimiteListagem,
    aplicarFiltroTiposVisiveis,
    isRetornoLeadAgendadoElegivel,
    salvarOcultacaoDestinatario
  }
};
