const { parseUtcDateTime } = require('../utils/datetime');
const { dataPublicacaoTelegramConfirmada } = require('../utils/telegram-publicacao');

const FORMATADOR = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
});
const TIPOS = {
  futuro_cliente_adicionado: 'Futuro cliente adicionado',
  atualizacao: 'Dados atualizados',
  chamada_nao_atendida: 'Chamada não atendida',
  cliente_recusou: 'Cliente recusou',
  venda_recusada: 'Venda recusada',
  retorno_agendado: 'Retorno agendado',
  retorno_realizado: 'Retorno realizado',
  novo_envio_telegram: 'Primeiro envio ao Telegram',
  retorno_telegram: 'Retorno ao Telegram',
  publicacao_legada: 'Publicação antiga sem classificação',
  aceite_telegram: 'Atendimento aceito',
  recusa_telegram: 'Atendimento recusado',
  expiracao_telegram: 'Prazo da consultora encerrado',
  cancelamento_telegram: 'Encaminhamento cancelado',
  envio_solicitado: 'Envio ao Telegram solicitado',
  venda_registrada: 'Venda registrada',
  venda_vinculada: 'Venda vinculada manualmente',
  venda_desvinculada: 'Vínculo da venda removido',
  reversao: 'Marcação revertida',
  lixeira: 'Enviado para a lixeira',
  restauracao: 'Restaurado da lixeira'
};
const ACOES = {
  futuro_cliente_atualizado: 'atualizacao',
  campo_atualizado: 'atualizacao',
  primeira_ligacao_avaliada: 'atualizacao',
  chamada_nao_atendida: 'chamada_nao_atendida',
  cliente_recusou: 'cliente_recusou',
  venda_recusada: 'venda_recusada',
  retorno_marcado: 'retorno_agendado',
  retorno_realizado: 'retorno_realizado',
  futuro_cliente_enviado_distribuicao: 'envio_solicitado',
  futuro_cliente_enviado_lixeira: 'lixeira',
  futuro_cliente_restaurado: 'restauracao',
  futuro_cliente_revertido: 'reversao',
  chamada_nao_atendida_revertida: 'reversao',
  cliente_recusou_revertido: 'reversao',
  venda_recusada_revertida: 'reversao'
};

function json(valor) {
  if (valor && typeof valor === 'object') return valor;
  try { return JSON.parse(valor || '{}'); } catch { return {}; }
}

function dataIsoEstatisticas(valor) {
  const data = parseUtcDateTime(valor);
  if (!data) return null;
  const partes = Object.fromEntries(FORMATADOR.formatToParts(data)
    .filter(item => item.type !== 'literal').map(item => [item.type, item.value]));
  return `${partes.year}-${partes.month}-${partes.day}`;
}

function validarPeriodo(filtros = {}) {
  for (const chave of ['data_inicio', 'data_fim']) {
    const valor = filtros[chave];
    if (valor && (!/^\d{4}-\d{2}-\d{2}$/.test(valor)
      || !Number.isFinite(Date.parse(valor))
      || new Date(valor).toISOString().slice(0, 10) !== valor)) {
      throw Object.assign(new Error('Informe um período com datas válidas.'), { statusCode: 400 });
    }
  }
  if (filtros.data_inicio && filtros.data_fim && filtros.data_inicio > filtros.data_fim) {
    throw Object.assign(new Error('A data inicial deve ser anterior ou igual à data final.'), { statusCode: 400 });
  }
}

function dataDentroPeriodo(valor, filtros = {}, referencia = new Date()) {
  const data = parseUtcDateTime(valor);
  const iso = dataIsoEstatisticas(valor);
  return Boolean(iso && data <= referencia
    && (!filtros.data_inicio || iso >= filtros.data_inicio)
    && (!filtros.data_fim || iso <= filtros.data_fim));
}

function porLinha(itens, chave = 'lead_linha_id') {
  const mapa = new Map();
  for (const item of itens) {
    const id = Number(item[chave]);
    if (!mapa.has(id)) mapa.set(id, []);
    mapa.get(id).push(item);
  }
  return mapa;
}

/** Normaliza fontes persistidas; nunca infere a data de uma ação por updated_at. */
function montarMovimentacoes({ linhas = [], atribuicoes = [], auditorias = [], distribuicoes = [],
  publicacoes = [], vendas = [], vinculos = [], usuarios = [] }) {
  const atribuicoesMapa = porLinha(atribuicoes);
  const auditoriasMapa = porLinha(auditorias, 'entidade_id');
  const distribuicoesMapa = porLinha(distribuicoes);
  const publicacoesMapa = porLinha(publicacoes);
  const vinculosMapa = porLinha(vinculos);
  const nomes = new Map([...atribuicoes, ...auditorias, ...distribuicoes, ...publicacoes]
    .filter(item => item.usuario_nome || item.usuario_nome_historico)
    .map(item => [Number(item.usuario_id || item.usuario_id_historico), item.usuario_nome || item.usuario_nome_historico]));
  usuarios.forEach(item => nomes.set(Number(item.id), item.nome));
  const eventos = new Map();
  for (const linha of linhas) {
    const id = Number(linha.id);
    const janelas = (atribuicoesMapa.get(id) || []).sort((a, b) =>
      parseUtcDateTime(a.atribuido_em) - parseUtcDateTime(b.atribuido_em) || a.id - b.id);
    const audits = (auditoriasMapa.get(id) || []).map(audit => ({
      ...audit, dados: json(audit.dados), ocorrido_em: json(audit.dados).ocorrido_em || audit.created_at
    })).sort((a, b) => parseUtcDateTime(a.ocorrido_em) - parseUtcDateTime(b.ocorrido_em) || a.id - b.id);
    const pubs = publicacoesMapa.get(id) || [];
    const incompleto = pubs.some(item => item.tipo === 'legado');
    const eventosLinha = [];
    function adicionar(chave, tipo, data, autorId = null, autorNome = null, extra = {}) {
      const instante = parseUtcDateTime(data);
      if (!instante) return;
      const atribuicao = janelas.find(item => Number(item.id) === Number(extra.atribuicao_sondagem_id))
        || janelas.filter(item => parseUtcDateTime(item.atribuido_em) <= instante).at(-1);
      if (!atribuicao) return;
      const evento = {
        ...extra, id: chave, tipo, titulo: TIPOS[tipo], ocorrido_em: instante.toISOString(),
        lead_linha_id: id, atribuicao_sondagem_id: Number(atribuicao.id),
        responsavel_id: Number(atribuicao.usuario_id || atribuicao.usuario_id_historico) || null,
        responsavel_nome: atribuicao.usuario_nome || atribuicao.usuario_nome_historico || 'Usuário removido',
        envio_id: Number(atribuicao.envio_id), envio_nome: atribuicao.envio_nome,
        autor: { id: Number(autorId) || null, nome: autorNome || nomes.get(Number(autorId)) || (autorId ? 'Usuário removido' : 'Sistema') },
        historico_incompleto: incompleto
      };
      eventos.set(chave, evento);
      eventosLinha.push(evento);
    }
    const registros = audits.filter(item => item.acao.replace(/_admin$/, '') === 'lead_linha.futuro_cliente_marcado');
    const registroEm = [linha.futuro_cliente_marcado_em, ...registros.map(item => item.ocorrido_em)]
      .filter(item => parseUtcDateTime(item)).sort((a, b) => parseUtcDateTime(a) - parseUtcDateTime(b))[0];
    if (registroEm) {
      const audit = registros[0];
      adicionar(`registro:${id}`, 'futuro_cliente_adicionado', registroEm,
        audit?.usuario_id || linha.futuro_cliente_marcado_por_id, audit?.usuario_nome);
    }
    for (const audit of audits) {
      const acao = audit.acao.replace(/^lead_linha\./, '').replace(/_admin$/, '');
      if (acao === 'futuro_cliente_marcado') {
        if (audit !== registros[0]) {
          adicionar(`auditoria:${audit.id}`, 'atualizacao', audit.ocorrido_em, audit.usuario_id, audit.usuario_nome);
        }
      } else if (ACOES[acao]) {
        adicionar(`auditoria:${audit.id}`, ACOES[acao], audit.ocorrido_em, audit.usuario_id, audit.usuario_nome);
      }
    }
    // Campos específicos recuperam apenas eventos não representados nas auditorias.
    const datasLegadas = [
      ['cliente_recusou', linha.cliente_recusou_em, linha.cliente_recusou_por_id],
      ['chamada_nao_atendida', linha.chamada_nao_atendida_em, linha.chamada_nao_atendida_por_id],
      ['venda_recusada', linha.venda_recusada_em, linha.venda_recusada_por_id],
      ['retorno_realizado', linha.retorno_agendado_realizado_em, linha.retorno_agendado_realizado_por_id],
      ['retorno_realizado', linha.futuro_cliente_retorno_realizado_em, linha.futuro_cliente_retorno_realizado_por_id]
    ];
    for (const [tipo, data, autor] of datasLegadas) {
      const instante = parseUtcDateTime(data);
      if (!instante) continue;
      const ultimo = eventosLinha.filter(item => item.tipo === tipo && item.id.startsWith('auditoria:')).at(-1);
      const audit = ultimo && audits.find(item => `auditoria:${item.id}` === ultimo.id);
      // O middleware pode gravar depois da meia-noite. O campo específico conserva
      // o instante efetivo da última ação, sem criar uma segunda movimentação.
      if (ultimo && !audit.dados.ocorrido_em && parseUtcDateTime(ultimo.ocorrido_em) >= instante
        && (!autor || !ultimo.autor.id || Number(autor) === ultimo.autor.id)) {
        eventos.delete(ultimo.id);
        eventosLinha.splice(eventosLinha.indexOf(ultimo), 1);
        adicionar(ultimo.id, tipo, instante, ultimo.autor.id, ultimo.autor.nome);
      }
      if (!eventosLinha.some(item => item.tipo === tipo && item.ocorrido_em === instante.toISOString())) {
        adicionar(`campo:${id}:${tipo}:${data}`, tipo, data, autor);
      }
    }
    for (const item of distribuicoesMapa.get(id) || []) {
      adicionar(`aceite:${item.id}`, 'aceite_telegram', item.aceite_em, item.usuario_id, item.usuario_nome);
      const tipo = item.aceite_status === 'recusado' ? 'recusa_telegram'
        : String(item.aceite_status || '').startsWith('expirado') ? 'expiracao_telegram'
          : item.aceite_status === 'cancelado' ? 'cancelamento_telegram' : null;
      if (tipo) adicionar(`encerramento:${item.id}`, tipo, item.finalizado_em, item.usuario_id, item.usuario_nome);
    }
    for (const item of pubs) {
      const tipo = item.tipo === 'primeiro_envio' ? 'novo_envio_telegram'
        : item.tipo === 'republicacao' ? 'retorno_telegram' : 'publicacao_legada';
      adicionar(`publicacao:${item.id}`, tipo, item.publicado_em, item.usuario_id, item.usuario_nome,
        { atribuicao_sondagem_id: item.atribuicao_sondagem_id || undefined,
          envio_telegram_confirmado: Boolean(dataPublicacaoTelegramConfirmada(item)) });
    }
    const links = vinculosMapa.get(id) || [];
    for (const link of links) {
      adicionar(`vinculo:${link.id}`, 'venda_vinculada', link.vinculado_em || link.created_at, link.vinculado_por_id, null, { venda_id: Number(link.venda_id) });
      adicionar(`desvinculo:${link.id}`, 'venda_desvinculada', link.desvinculado_em, link.desvinculado_por_id, null, { venda_id: Number(link.venda_id) });
    }
    for (const venda of vendas.filter(item => Number(item.origem_lead_linha_id) === id || Number(item.id) === Number(linha.venda_id))) {
      // Uma associação manual não transforma a criação anterior da venda em resultado do mailing.
      if (links.some(link => Number(link.venda_id) === Number(venda.id))) continue;
      if (!parseUtcDateTime(venda.created_at) || parseUtcDateTime(venda.created_at) < parseUtcDateTime(registroEm || janelas[0]?.atribuido_em)) continue;
      adicionar(`venda:${venda.id}`, 'venda_registrada', venda.created_at, venda.criado_por_id, venda.usuario_nome,
        { venda_id: Number(venda.id), valor: Number(venda.valor_total || 0) });
    }
  }
  return [...eventos.values()].sort((a, b) => a.ocorrido_em.localeCompare(b.ocorrido_em) || a.id.localeCompare(b.id));
}

function filtrarMovimentacoes(eventos, filtros = {}) {
  validarPeriodo(filtros);
  return eventos.filter(item => dataDentroPeriodo(item.ocorrido_em, filtros)
    && (!filtros.usuario_id || Number(filtros.usuario_id) === Number(item.responsavel_id))
    && (!filtros.envio_id || Number(filtros.envio_id) === Number(item.envio_id)));
}

function resumirMovimentacoes(eventos, base = {}) {
  const tipos = {};
  for (const item of eventos) tipos[item.tipo] = (tipos[item.tipo] || 0) + 1;
  const distintos = (tipo, chave) => new Set(eventos.filter(item => item.tipo === tipo).map(item => item[chave])).size;
  const vendas = new Map(eventos.filter(item => item.tipo === 'venda_registrada').map(item => [item.venda_id, item.valor]));
  return {
    ...base, clientes_movimentados: new Set(eventos.map(item => item.lead_linha_id)).size,
    futuros_clientes_adicionados: distintos('futuro_cliente_adicionado', 'lead_linha_id'),
    clientes_enviados_telegram: new Set(eventos.filter(item => item.envio_telegram_confirmado)
      .map(item => item.lead_linha_id)).size,
    // Mantém o contrato anterior para consumidores que ainda precisam distinguir primeiros envios.
    novos_envios_telegram: distintos('novo_envio_telegram', 'lead_linha_id'),
    vendas_registradas: vendas.size, valor_vendido: [...vendas.values()].reduce((soma, valor) => soma + Number(valor || 0), 0),
    total_acoes: eventos.length, acoes_por_tipo: tipos,
    ultima_movimentacao_em: eventos.at(-1)?.ocorrido_em || null,
    historico_incompleto: eventos.some(item => item.historico_incompleto)
  };
}

function agruparMovimentacoes(eventos, chaveFn) {
  const grupos = new Map();
  for (const item of eventos) {
    const chave = chaveFn(item);
    if (!grupos.has(chave.id)) grupos.set(chave.id, { chave, eventos: [] });
    grupos.get(chave.id).eventos.push(item);
  }
  return [...grupos.values()].map(item => resumirMovimentacoes(item.eventos, item.chave));
}

const chaveUsuario = item => ({ id: item.responsavel_id, usuario_id: item.responsavel_id, usuario_nome: item.responsavel_nome });
const chaveMailing = item => ({ id: item.envio_id, envio_id: item.envio_id, envio_nome: item.envio_nome });

function detalharLinhas(linhas, eventos) {
  const mapa = porLinha(eventos);
  return linhas.filter(item => mapa.has(Number(item.id))).map(item => {
    const movimentos = mapa.get(Number(item.id));
    return { ...item, dados_json: json(item.dados_json),
      ultima_movimentacao_em: movimentos.at(-1).ocorrido_em, movimentacoes_periodo: movimentos };
  }).sort((a, b) => b.ultima_movimentacao_em.localeCompare(a.ultima_movimentacao_em) || a.id - b.id);
}

/** Consultas em lote preservam todas as janelas antes de filtrar o responsável/período. */
async function carregar(filtros = {}) {
  validarPeriodo(filtros);
  const db = require('../database/connection');
  const candidatas = db('lead_atribuicoes as la').join('lead_envios as le', 'le.id', 'la.envio_id')
    .where('la.etapa', 'sondagem').where('le.origem', 'mailing').distinct('la.lead_linha_id');
  if (filtros.usuario_id) candidatas.where(builder => builder.where('la.usuario_id', Number(filtros.usuario_id))
    .orWhere('la.usuario_id_historico', Number(filtros.usuario_id)));
  if (filtros.envio_id) candidatas.where('la.envio_id', Number(filtros.envio_id));
  const ids = (await candidatas).map(item => Number(item.lead_linha_id));
  if (!ids.length) return { linhas: [], eventos: [], historico_incompleto: false };
  const [linhas, atribuicoes, auditorias, distribuicoes, publicacoes, vendas, vinculos] = await Promise.all([
    db('lead_linhas').whereIn('id', ids).select('*'),
    db('lead_atribuicoes as la').join('lead_envios as le', 'le.id', 'la.envio_id')
      .leftJoin('usuarios as u', 'u.id', 'la.usuario_id').whereIn('la.lead_linha_id', ids)
      .where('la.etapa', 'sondagem').where('le.origem', 'mailing').select('la.*', 'le.nome as envio_nome', 'u.nome as usuario_nome'),
    db('audit_logs as a').leftJoin('usuarios as u', 'u.id', 'a.usuario_id')
      .where('a.entidade', 'lead_linhas').whereIn('a.entidade_id', ids.map(String)).select('a.*', 'u.nome as usuario_nome'),
    db('lead_atribuicoes as la').leftJoin('usuarios as u', 'u.id', 'la.usuario_id')
      .whereIn('la.lead_linha_id', ids).where('la.etapa', 'venda').whereNotNull('la.aceite_status')
      .select('la.*', 'u.nome as usuario_nome'),
    db('lead_telegram_publicacoes as p').leftJoin('usuarios as u', 'u.id', 'p.usuario_id')
      .whereIn('p.lead_linha_id', ids).select('p.*', 'u.nome as usuario_nome'),
    db('vendas as v').leftJoin('usuarios as u', 'u.id', 'v.criado_por_id')
      .where(builder => builder.whereIn('v.origem_lead_linha_id', ids).orWhereIn('v.id',
        db('lead_linhas').whereIn('id', ids).whereNotNull('venda_id').select('venda_id')))
      .select('v.id', 'v.origem_lead_linha_id', 'v.created_at', 'v.criado_por_id', 'v.valor_total', 'u.nome as usuario_nome'),
    db('lead_venda_vinculos_manuais').whereIn('lead_linha_id', ids).select('*')
  ]);
  const idsAutores = [...new Set([
    ...linhas.flatMap(item => [item.futuro_cliente_marcado_por_id, item.cliente_recusou_por_id,
      item.chamada_nao_atendida_por_id, item.venda_recusada_por_id,
      item.retorno_agendado_realizado_por_id, item.futuro_cliente_retorno_realizado_por_id]),
    ...vinculos.flatMap(item => [item.vinculado_por_id, item.desvinculado_por_id])
  ].map(Number).filter(Boolean))];
  const usuarios = idsAutores.length ? await db('usuarios').whereIn('id', idsAutores).select('id', 'nome') : [];
  const todos = montarMovimentacoes({ linhas, atribuicoes, auditorias, distribuicoes, publicacoes, vendas, vinculos, usuarios });
  return { linhas, eventos: filtrarMovimentacoes(todos, filtros),
    historico_incompleto: publicacoes.some(item => item.tipo === 'legado') };
}

async function obterEstatisticasResumo(filtros = {}) {
  const { eventos, historico_incompleto } = await carregar(filtros);
  return { total: { ...resumirMovimentacoes(eventos), historico_incompleto },
    usuarios: agruparMovimentacoes(eventos, chaveUsuario) };
}

async function obterEstatisticasMailings(filtros = {}) {
  const { eventos, historico_incompleto } = await carregar(filtros);
  return { resumo: { ...resumirMovimentacoes(eventos), historico_incompleto },
    data: agruparMovimentacoes(eventos, chaveMailing) };
}

function paginarLinhas(linhas, eventos, filtros = {}, historico_incompleto = false) {
  const page = Math.max(1, Number.parseInt(filtros.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, Number.parseInt(filtros.page_size, 10) || 50));
  const busca = String(filtros.busca || '').trim().toLowerCase();
  const detalhes = detalharLinhas(linhas, eventos)
    .filter(item => !busca || JSON.stringify(item.dados_json).toLowerCase().includes(busca));
  return { resumo: { ...resumirMovimentacoes(eventos), historico_incompleto },
    data: detalhes.slice((page - 1) * pageSize, page * pageSize), total: detalhes.length, page, page_size: pageSize };
}

async function obterEstatisticasLinhas(filtros = {}) {
  const dados = await carregar(filtros);
  return paginarLinhas(dados.linhas, dados.eventos, filtros, dados.historico_incompleto);
}

function montarWorkbook(linhas, eventos, historicoIncompleto = false) {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CRM Avance';
  const metricas = [
    ['Clientes movimentados', 'clientes_movimentados'], ['Futuros clientes adicionados', 'futuros_clientes_adicionados'],
    ['Clientes enviados ao Telegram', 'clientes_enviados_telegram'], ['Vendas registradas', 'vendas_registradas'],
    ['Ações no período', 'total_acoes'], ['Valor vendido', 'valor_vendido']
  ];
  function tabela(nome, colunas, dados) {
    const ws = workbook.addWorksheet(nome);
    ws.addRow(colunas.map(([titulo]) => titulo));
    dados.forEach(item => ws.addRow(colunas.map(([, chave]) => item[chave] ?? '')));
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, ws.rowCount), column: colunas.length } };
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
    ws.columns = colunas.map(([titulo]) => ({ width: Math.max(18, Math.min(40, titulo.length + 4)) }));
  }
  tabela('Resumo', [...metricas, ['Histórico incompleto', 'aviso']], [
    { ...resumirMovimentacoes(eventos), aviso: historicoIncompleto ? 'Sim: dados antigos podem estar incompletos' : 'Não' }
  ]);
  tabela('Resumo por usuário', [['Usuário', 'usuario_nome'], ...metricas], agruparMovimentacoes(eventos, chaveUsuario));
  tabela('Mailings', [['Usuário', 'usuario_nome'], ['Mailing', 'envio_nome'], ...metricas],
    agruparMovimentacoes(eventos, item => ({
      id: `${item.responsavel_id}:${item.envio_id}`, usuario_nome: item.responsavel_nome, envio_nome: item.envio_nome
    })));
  tabela('Clientes', [['Lead ID', 'id'], ['Última movimentação (São Paulo)', 'data_local'], ['Dados', 'dados']],
    detalharLinhas(linhas, eventos).map(item => ({ ...item, dados: JSON.stringify(item.dados_json),
      data_local: parseUtcDateTime(item.ultima_movimentacao_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) })));
  tabela('Movimentações', [['Data (São Paulo)', 'data_local'], ['Lead ID', 'lead_linha_id'], ['Mailing', 'envio_nome'],
    ['Responsável pela qualificação', 'responsavel_nome'], ['Ação', 'titulo'], ['Autor', 'autor_nome'], ['Venda ID', 'venda_id']],
  eventos.map(item => ({ ...item, autor_nome: item.autor.nome,
    data_local: parseUtcDateTime(item.ocorrido_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) })));
  return workbook;
}

async function gerarXlsxEstatisticasFuturosClientes(filtros = {}) {
  const { linhas, eventos, historico_incompleto } = await carregar(filtros);
  const workbook = montarWorkbook(linhas, eventos, historico_incompleto);
  const sufixo = filtros.data_inicio || filtros.data_fim
    ? `${filtros.data_inicio || 'inicio'}-a-${filtros.data_fim || 'hoje'}` : 'todo-periodo';
  return { buffer: await workbook.xlsx.writeBuffer(), nome: `estatisticas-futuros-clientes-${sufixo}.xlsx` };
}

module.exports = { obterEstatisticasResumo, obterEstatisticasMailings, obterEstatisticasLinhas,
  gerarXlsxEstatisticasFuturosClientes,
  _internals: { TIPOS, dataIsoEstatisticas, validarPeriodo, dataDentroPeriodo, montarMovimentacoes,
    filtrarMovimentacoes, resumirMovimentacoes, agruparMovimentacoes, detalharLinhas, paginarLinhas, montarWorkbook } };
