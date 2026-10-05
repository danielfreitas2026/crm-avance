const db = require('../database/connection');
const telegramService = require('./telegram.service');

const TIME_ZONE = 'America/Sao_Paulo';
const LIMITE_TEXTO_TELEGRAM = 4096;
const TABELA_EXECUCOES = 'telegram_resumo_execucoes';
const TIPO_EXECUCAO_DIARIA = 'diario';
let agendamentoIniciado = false;

function partesData(data = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(data).reduce((resultado, parte) => ({ ...resultado, [parte.type]: parte.value }), {});
}
function dataSqlHoje(data = new Date()) { const p = partesData(data); return `${p.year}-${p.month}-${p.day}`; }
function ehDiaUtil(data = new Date()) { return !['Sat', 'Sun'].includes(partesData(data).weekday); }
function formatarData(data) { const m = String(data || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : 'Não informado'; }
function formatarMoeda(valor) { return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function pluralUgr(quantidade) { return `${quantidade} UGR${quantidade === 1 ? '' : 's'}`; }
function temDocumento(valor) { return valor === true || valor === 1 || valor === '1'; }
function tipoVenda(venda) { return venda.tipo_venda || (venda.numeros_portados ? 'Portabilidade' : 'Novo'); }
function dataRegistroSql(alias = 'v') { return `DATE(COALESCE(${alias}.criado_em, ${alias}.created_at, ${alias}.data_venda))`; }
function aplicarFiltroPeriodoVendas(query, inicio, fim, alias = 'v') {
  return query
    .whereRaw(`${dataRegistroSql(alias)} BETWEEN ? AND ?`, [inicio, fim])
    .whereBetween(`${alias}.data_venda`, [inicio, fim]);
}
function agendamentoAtivo(valor = process.env.TELEGRAM_RESUMO_VENDAS_AGENDAMENTO_ATIVO, ambiente = process.env.NODE_ENV) {
  if (valor === undefined || valor === null || String(valor).trim() === '') {
    return String(ambiente || '').trim().toLowerCase() === 'production';
  }
  return String(valor).trim().toLowerCase() === 'true';
}

function montarBlocoVenda(venda, { incluirAceite = false, incluirDocumentacao = false } = {}) {
  const linhas = [
    `Data de cadastro: ${formatarData(venda.data_registro)}`,
    `Data da venda: ${formatarData(venda.data_venda)}`
  ];
  if (incluirAceite) linhas.push(`Data do aceite: ${formatarData(venda.data_ativacao)}`);
  linhas.push(
    `Consultores: ${venda.consultores || venda.consultor || 'Não informado'}`,
    `Razão social: ${venda.razao_social || venda.nome || 'Não informada'}`,
    `CNPJ: ${venda.cnpj || 'Não informado'}`,
    `Quantidade e valor: ${pluralUgr(Number(venda.quantidade_linhas || 0))} — ${formatarMoeda(venda.valor_total)}`,
    `Operadora: ${venda.operadora || 'Não informada'}`,
    `Tipo: ${tipoVenda(venda)}`
  );
  if (tipoVenda(venda).toLowerCase() === 'portabilidade' && venda.numeros_portados) linhas.push(`Números portados: ${venda.numeros_portados}`);
  if (incluirDocumentacao) linhas.push(`Documentação: ${temDocumento(venda.possui_doc_na_casa) ? 'OK' : 'Pendente'}`, `Aceite: ${venda.status_funil === 'ativacao' ? 'Sim' : 'Não'}`);
  return linhas.join('\n');
}
function totais(vendas) {
  const vendasContadas = new Set();
  return vendas.reduce((r, v) => {
    const id = v.id;
    if (id !== null && id !== undefined && vendasContadas.has(id)) return r;
    if (id !== null && id !== undefined) vendasContadas.add(id);
    return { quantidade: r.quantidade + Number(v.quantidade_linhas || 0), valor: r.valor + Number(v.valor_total || 0) };
  }, { quantidade: 0, valor: 0 });
}
function agruparPorConsultor(vendas) {
  return vendas.reduce((grupos, venda) => {
    const consultor = venda.consultor || 'Não informado';
    if (!grupos.has(consultor)) grupos.set(consultor, []);
    grupos.get(consultor).push(venda);
    return grupos;
  }, new Map());
}
function montarMensagensPorConsultor(cabecalho, vendas, opcoes) {
  const grupos = agruparPorConsultor(vendas);
  if (!grupos.size) return dividirMensagem(cabecalho, []);
  return Array.from(grupos, ([consultor, vendasDoConsultor]) => dividirMensagem(
    `${cabecalho}\nConsultor: ${consultor}`,
    vendasDoConsultor.map(venda => montarBlocoVenda(venda, opcoes))
  )).flat();
}
function dividirMensagem(cabecalho, blocos) {
  if (!blocos.length) return [cabecalho + '\n\nNenhuma venda no período.'];
  const mensagens = []; let atual = cabecalho;
  for (const bloco of blocos) { const proxima = `${atual}\n\n${bloco}`; if (proxima.length > LIMITE_TEXTO_TELEGRAM && atual !== cabecalho) { mensagens.push(atual); atual = `${cabecalho}\n\n${bloco}`; } else atual = proxima; }
  mensagens.push(atual); return mensagens;
}
function montarMensagensDiarias(vendas, data) {
  const comAceite = vendas.filter(v => v.status_funil === 'ativacao'); const semAceite = vendas.filter(v => v.status_funil !== 'ativacao');
  const aceitas = totais(comAceite); const pendentes = totais(semAceite); const total = totais(vendas); const d = formatarData(data);
  return [
    ...montarMensagensPorConsultor('Resultado diário de vendas', vendas, { incluirDocumentacao: true }),
    [`${d} — Total do dia`, '', `${pluralUgr(aceitas.quantidade)} com aceite, com receita de ${formatarMoeda(aceitas.valor)}`, `${pluralUgr(pendentes.quantidade)} sem aceite, com receita de ${formatarMoeda(pendentes.valor)}`, `${pluralUgr(total.quantidade)} no total, com receita de ${formatarMoeda(total.valor)}`].join('\n'),
    [`Resultado final do dia — ${d}`, '', `- Total de vendas com aceite: ${pluralUgr(aceitas.quantidade)} com receita de ${formatarMoeda(aceitas.valor)}`, `- Total de vendas sem aceite: ${pluralUgr(pendentes.quantidade)} com receita de ${formatarMoeda(pendentes.valor)}`, `- Total de vendas: ${pluralUgr(total.quantidade)} com receita de ${formatarMoeda(total.valor)}`].join('\n')
  ];
}
function inicioSemana(data) { const [a, m, d] = data.split('-').map(Number); const utc = new Date(Date.UTC(a, m - 1, d)); utc.setUTCDate(utc.getUTCDate() - ((utc.getUTCDay() + 6) % 7)); return utc.toISOString().slice(0, 10); }
function montarMensagensSemanais(vendas, inicio, fim) {
  const periodo = `[${formatarData(inicio)} até ${formatarData(fim)}]`;
  return [{ titulo: 'Vendas com aceite', vendas: vendas.filter(v => v.status_funil === 'ativacao'), textoTotal: 'com aceite', incluirAceite: true }, { titulo: 'Vendas sem aceite', vendas: vendas.filter(v => v.status_funil !== 'ativacao'), textoTotal: 'sem aceite', incluirAceite: false }].flatMap(secao => {
    const resumo = totais(secao.vendas); return [...montarMensagensPorConsultor(`Fechamento da semana ${periodo}: ${secao.titulo}`, secao.vendas, { incluirAceite: secao.incluirAceite }), `- Total de vendas ${secao.textoTotal}: ${pluralUgr(resumo.quantidade)} com receita de ${formatarMoeda(resumo.valor)}`];
  });
}
async function buscarVendas(inicio, fim) {
  const query = db('vendas as v')
    .leftJoin('venda_vendedoras as vv', 'vv.venda_id', 'v.id')
    .leftJoin('usuarios as u', function () { this.on('u.id', '=', db.raw('COALESCE(vv.usuario_id, v.vendedora_id)')); })
    .leftJoin('operadoras as o', 'o.id', 'v.operadora_id')
    .leftJoin('tipos_venda as tv', 'tv.id', 'v.tipo_venda_id')
    .select(
      'v.*',
      'u.nome as consultor',
      'o.nome as operadora',
      'tv.nome as tipo_venda',
      db.raw(`${dataRegistroSql('v')} AS data_registro`),
      db.raw(`COALESCE((SELECT GROUP_CONCAT(u_lista.nome ORDER BY vv_lista.ordem SEPARATOR ', ') FROM venda_vendedoras AS vv_lista INNER JOIN usuarios AS u_lista ON u_lista.id = vv_lista.usuario_id WHERE vv_lista.venda_id = v.id), u.nome) AS consultores`)
    );
  aplicarFiltroPeriodoVendas(query, inicio, fim);
  return query
    .whereNull('v.excluido_em')
    .whereNull('v.cancelada_em')
    .orderByRaw(`${dataRegistroSql('v')} ASC`)
    .orderBy('v.id');
}

async function reservarExecucaoAgendada(dataReferencia) {
  const agora = new Date();
  try {
    await db(TABELA_EXECUCOES).insert({
      data_referencia: dataReferencia,
      tipo: TIPO_EXECUCAO_DIARIA,
      status: 'em_andamento',
      iniciado_em: agora,
      created_at: agora,
      updated_at: agora
    });
    return true;
  } catch (error) {
    if (!['ER_DUP_ENTRY', 1062].includes(error.code) && error.errno !== 1062) throw error;
  }

  const atualizados = await db(TABELA_EXECUCOES)
    .where({ data_referencia: dataReferencia, tipo: TIPO_EXECUCAO_DIARIA })
    .where(builder => builder
      .where('status', 'falhou')
      .orWhere(subquery => subquery
        .where('status', 'em_andamento')
        .where('iniciado_em', '<', db.raw('DATE_SUB(NOW(), INTERVAL 1 HOUR)'))))
    .update({ status: 'em_andamento', iniciado_em: agora, concluido_em: null, erro: null, updated_at: agora });
  return atualizados > 0;
}

async function concluirExecucaoAgendada(dataReferencia, dados) {
  await db(TABELA_EXECUCOES)
    .where({ data_referencia: dataReferencia, tipo: TIPO_EXECUCAO_DIARIA })
    .update({ ...dados, concluido_em: new Date(), updated_at: new Date() });
}

async function enviarResumoDoDia(data = new Date(), opcoes = {}) {
  const fim = typeof data === 'string' ? data : dataSqlHoje(data);
  if (!telegramService.resumoVendasAtivo()) return { data: fim, mensagens: 0, ignorado: 'telegram_resumo_vendas_desativado' };
  const dataReferencia = typeof data === 'string' ? new Date(`${data}T12:00:00-03:00`) : data;
  if (!ehDiaUtil(dataReferencia)) return { data: fim, mensagens: 0, ignorado: 'fim_de_semana' };
  if (opcoes.agendada && !(await reservarExecucaoAgendada(fim))) {
    return { data: fim, mensagens: 0, ignorado: 'ja_enviado_ou_em_andamento' };
  }

  try {
    const vendasDia = await buscarVendas(fim, fim); const mensagens = [];
    if (partesData(dataReferencia).weekday === 'Fri') { const inicio = inicioSemana(fim); mensagens.push(...montarMensagensSemanais(await buscarVendas(inicio, fim), inicio, fim)); }
    mensagens.push(...montarMensagensDiarias(vendasDia, fim));
    for (const mensagem of mensagens) await telegramService.enviarResumoVendas(mensagem);
    if (opcoes.agendada) await concluirExecucaoAgendada(fim, { status: 'enviado', mensagens: mensagens.length });
    return { data: fim, mensagens: mensagens.length };
  } catch (error) {
    if (opcoes.agendada) await concluirExecucaoAgendada(fim, { status: 'falhou', erro: String(error.message || error).slice(0, 2000) });
    throw error;
  }
}
function proximaExecucao(data = new Date()) {
  const p = partesData(data);
  const alvo = new Date(`${p.year}-${p.month}-${p.day}T18:00:00-03:00`);
  if (alvo <= data) alvo.setUTCDate(alvo.getUTCDate() + 1);
  while (!ehDiaUtil(alvo)) alvo.setUTCDate(alvo.getUTCDate() + 1);
  return alvo;
}
function iniciarAgendamentoResumoVendas() {
  if (!telegramService.resumoVendasAtivo() || !agendamentoAtivo() || agendamentoIniciado) return false;
  agendamentoIniciado = true;
  const agendar = () => { const espera = Math.max(0, proximaExecucao().getTime() - Date.now()); setTimeout(async () => { try { const resultado = await enviarResumoDoDia(new Date(), { agendada: true }); console.log(`Resumo de vendas processado (${resultado.data}, ${resultado.mensagens} mensagens${resultado.ignorado ? `, ${resultado.ignorado}` : ''}).`); } catch (error) { console.error('Erro ao enviar resumo diário de vendas no Telegram:', error); } agendar(); }, espera); };
  agendar();
  return true;
}
module.exports = { enviarResumoDoDia, iniciarAgendamentoResumoVendas, _internals: { inicioSemana, montarBlocoVenda, tipoVenda, agruparPorConsultor, montarMensagensPorConsultor, montarMensagensDiarias, montarMensagensSemanais, proximaExecucao, ehDiaUtil, totais, dataRegistroSql, aplicarFiltroPeriodoVendas, agendamentoAtivo } };
