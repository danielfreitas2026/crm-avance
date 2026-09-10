/**
 * Servico de fechamento mensal, resumo gerencial, detalhes e exportacoes.
 */
const Venda = require('../models/Venda');
const FunilEtapa = require('../models/FunilEtapa');
const RegraComissao = require('../models/RegraComissao');
const ExcelJS = require('exceljs');
const vendaService = require('./venda.service');
const {
  FORMATO_MOEDA_BR,
  FORMATO_INTEIRO_BR,
  classificacaoClienteBasePlanilha
} = require('../utils/formato-planilha');

const STATUS_FINAL_FALLBACK = 'concluido';
const CODIGO_RETORNO_HISTORICO = '__retorno_historico';

const CATEGORIA_POR_SERVICO = {
  'telefonia movel': 'movel',
  'movel': 'movel',
  'telefonia fixa': 'fixo',
  'fixo': 'fixo',
  'internet': 'internet'
};

/**
 * Normaliza servico nome para uso interno consistente.
 */
function normalizarServicoNome(nome) {
  return String(nome || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Retorna categoria servico no formato esperado pelo fluxo.
 */
function categoriaServico(servicoNome) {
  if (!servicoNome) return null;
  return CATEGORIA_POR_SERVICO[normalizarServicoNome(servicoNome)] || null;
}

/**
 * Retorna categoria painel no formato esperado pelo fluxo.
 */
function categoriaPainel(servicoNome) {
  return categoriaServico(servicoNome) || 'outros';
}

/**
 * Retorna label categoria painel no formato esperado pelo fluxo.
 */
function labelCategoriaPainel(categoria) {
  return ({
    movel: 'Móvel',
    fixo: 'Fixo',
    internet: 'Internet / Velox',
    outros: 'Outros'
  })[categoria] || 'Outros';
}

/**
 * Retorna tipo venda normalizado no formato esperado pelo fluxo.
 */
function tipoVendaNormalizado(tipoVendaNome) {
  if (!tipoVendaNome) return null;
  const nome = normalizarServicoNome(tipoVendaNome);
  if (nome.includes('porta')) return 'portabilidade';
  if (nome.includes('novo')) return 'novo';
  return null;
}

/**
 * Normaliza data para uso interno consistente.
 */
function normalizarData(valor) {
  if (!valor) return null;
  const texto = String(valor).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : null;
}

/**
 * Retorna data venda referencia sql no formato esperado pelo fluxo.
 */
function dataVendaReferenciaSQL(alias = 'v') {
  return `COALESCE(NULLIF(NULLIF(${alias}.data_venda, '0000-00-00'), '1899-11-30'), DATE(${alias}.created_at))`;
}

/**
 * Retorna data ativacao referencia sql no formato esperado pelo fluxo.
 */
function dataAtivacaoReferenciaSQL(alias = 'v') {
  return `COALESCE(NULLIF(NULLIF(${alias}.data_ativacao, '0000-00-00'), '1899-11-30'), ${dataVendaReferenciaSQL(alias)})`;
}

/**
 * Converte chips para o formato interno esperado.
 */
function parseChips(rawChips) {
  if (!rawChips) return [];

  let lista = rawChips;
  if (typeof rawChips === 'string') {
    try {
      lista = JSON.parse(rawChips);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(lista)) return [];

  return lista
    .map(item => ({
      quantidade: Number(item.quantidade || 0),
      gb: String(item.gb || '').trim(),
      tipo_linha: (item.tipo_linha || item.tipo || item.categoria)
        ? tipoVendaNormalizado(item.tipo_linha || item.tipo || item.categoria) || 'novo'
        : null,
      valor_unitario: Number(item.valor_unitario || 0),
      ...(item.operadora_atual_id ? { operadora_atual_id: Number(item.operadora_atual_id) } : {}),
      ...(item.operadora_atual_nome ? { operadora_atual_nome: String(item.operadora_atual_nome).trim() } : {}),
      ...(item.operadora_id ? { operadora_id: Number(item.operadora_id) } : {}),
      ...(item.operadora_nome ? { operadora_nome: String(item.operadora_nome).trim() } : {}),
      vendedora_id: item.vendedora_id ? Number(item.vendedora_id) : null
    }))
    .filter(item => item.quantidade > 0);
}

/**
 * Converte numeros linha para o formato interno esperado.
 */
function parseNumerosLinha(valor) {
  if (!valor) return [];

  if (Array.isArray(valor)) {
    return valor.map(item => String(item || '').trim()).filter(Boolean);
  }

  if (typeof valor === 'string') {
    try {
      return parseNumerosLinha(JSON.parse(valor));
    } catch {
      return valor
        .split(/\r?\n|[,;]/)
        .map(item => item.trim())
        .filter(Boolean);
    }
  }

  return [];
}

/**
 * Processa extrair numeros gigas conforme as regras do dominio.
 */
function extrairNumerosGigas(valor) {
  const texto = String(valor || '');
  const matches = texto.match(/\d+(?:[.,]\d+)?/g) || [];

  return matches
    .map(item => Number(String(item).replace(',', '.')))
    .filter(numero => Number.isFinite(numero) && numero > 0);
}

/**
 * Formata gigas para exibicao ou envio.
 */
function formatarGigas(numero) {
  const valor = Number(numero || 0);
  if (!Number.isFinite(valor) || valor <= 0) return null;

  const texto = Number.isInteger(valor)
    ? String(valor)
    : valor.toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');

  return `${texto}GB`;
}

/**
 * Processa gigas unitarios conforme as regras do dominio.
 */
function gigasUnitarios(gbPrincipal, quantidade, gbFallback = '') {
  const totalChips = Math.max(Number(quantidade || 0), 0);
  if (totalChips === 0) return [];

  const textoPrincipal = String(gbPrincipal || '').trim();
  const textoFallback = String(gbFallback || '').trim();
  const texto = textoPrincipal || textoFallback;
  if (!texto) return Array(totalChips).fill('');

  const numeros = extrairNumerosGigas(texto);

  if (numeros.length === 1) {
    return Array(totalChips).fill(formatarGigas(numeros[0]) || texto);
  }

  if (numeros.length >= totalChips) {
    return numeros.slice(0, totalChips).map(formatarGigas);
  }

  if (numeros.length > 1) {
    const totalGigas = numeros.reduce((soma, numero) => soma + numero, 0);
    return Array(totalChips).fill(formatarGigas(totalGigas / totalChips));
  }

  return Array(totalChips).fill(texto);
}

/**
 * Carrega regras comissao ativas e atualiza o estado relacionado.
 */
async function carregarRegrasComissaoAtivas() {
  return RegraComissao.query()
    .alias('rc')
    .leftJoin('operadoras as o', 'rc.operadora_id', 'o.id')
    .select('rc.*', 'o.nome as operadora_nome')
    .where('rc.ativo', true)
    .orderByRaw('rc.operadora_id IS NOT NULL DESC')
    .orderBy('o.nome', 'asc')
    .orderBy('rc.valor_min', 'asc')
    .orderBy('rc.valor_max', 'asc')
    .orderBy('rc.id', 'asc');
}

/**
 * Obtem codigo etapa final a partir dos dados informados.
 */
async function obterCodigoEtapaFinal() {
  try {
    const etapa = await FunilEtapa.query()
      .where('etapa_final', true)
      .orderBy('ativo', 'desc')
      .orderBy('ordem', 'asc')
      .first();

    return etapa?.codigo || STATUS_FINAL_FALLBACK;
  } catch {
    return STATUS_FINAL_FALLBACK;
  }
}

/**
 * Lista etapas painel conforme os filtros e parametros informados.
 */
async function listarEtapasPainel() {
  try {
    const etapas = await FunilEtapa.query()
      .where('ativo', true)
      .orderBy('ordem', 'asc')
      .orderBy('nome', 'asc');

    if (etapas.length > 0) {
      return etapas.map(etapa => ({
        codigo: etapa.codigo,
        nome: etapa.nome,
        etapa_final: Boolean(etapa.etapa_final)
      }));
    }
  } catch {
    // Usa fallback abaixo quando a tabela de funil não estiver disponível.
  }

  return [
    { codigo: 'aprovacao', nome: 'Aprovação', etapa_final: false },
    { codigo: 'ativacao', nome: 'Ativação', etapa_final: false },
    { codigo: 'envio', nome: 'Envio / Logística', etapa_final: false },
    { codigo: 'entrega', nome: 'Entrega', etapa_final: false },
    { codigo: 'confirmacao', nome: 'Confirmação', etapa_final: false },
    { codigo: STATUS_FINAL_FALLBACK, nome: 'Concluído', etapa_final: true }
  ];
}

/**
 * Retorna nome etapa no formato esperado pelo fluxo.
 */
function nomeEtapa(etapas, codigo) {
  if (codigo === CODIGO_RETORNO_HISTORICO) return 'Já retornou';
  if (codigo === 'retorno') return 'Retorno';
  return etapas.find(etapa => etapa.codigo === codigo)?.nome || codigo || 'Sem etapa';
}

/**
 * Processa venda teve retorno conforme as regras do dominio.
 */
function vendaTeveRetorno(venda = {}) {
  return Boolean(venda.retornou_em || venda.motivo_retorno || venda.status_anterior_retorno);
}

/**
 * Processa venda teve retorno corrigido conforme as regras do dominio.
 */
function vendaTeveRetornoCorrigido(venda = {}) {
  return venda.status_funil !== 'retorno' && vendaTeveRetorno(venda);
}

/**
 * Converte o valor para texto seguro.
 */
function valorTexto(valor) {
  return valor === null || valor === undefined ? '' : String(valor).trim();
}

/**
 * Retorna data para excel no formato esperado pelo fluxo.
 */
function dataParaExcel(valor) {
  const data = normalizarData(valor);
  if (!data) return null;
  const [ano, mes, dia] = data.split('-').map(Number);
  return new Date(ano, mes - 1, dia);
}

/**
 * Retorna nome arquivo seguro no formato esperado pelo fluxo.
 */
function nomeArquivoSeguro(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

/**
 * Normaliza vendedoras venda para uso interno consistente.
 */
function normalizarVendedorasVenda(venda = {}) {
  const vinculadas = Array.isArray(venda.vendedoras) ? venda.vendedoras : [];
  const lista = vinculadas
    .map(item => ({
      id: item.id ? Number(item.id) : null,
      nome: item.nome || 'Sem vendedora',
      email: item.email || ''
    }))
    .filter(item => item.id);

  if (lista.length > 0) {
    return lista;
  }

  return venda.vendedora_id ? [{
    id: Number(venda.vendedora_id),
    nome: venda.vendedora_nome || 'Sem vendedora',
    email: venda.vendedora_email || ''
  }] : [];
}

/**
 * Retorna vendedoras comissao linha no formato esperado pelo fluxo.
 */
function vendedorasComissaoLinha(linha) {
  if (linha.vendedora?.id) {
    return [linha.vendedora];
  }

  return Array.isArray(linha.vendedoras) && linha.vendedoras.length > 0
    ? linha.vendedoras
    : [];
}

/**
 * Processa anexar vendedoras vendas conforme as regras do dominio.
 */
async function anexarVendedorasVendas(vendas = []) {
  const ids = vendas.map(venda => Number(venda.id)).filter(Boolean);
  if (ids.length === 0) return vendas;

  const linhas = await Venda.knex()('venda_vendedoras as vv')
    .join('usuarios as u', 'vv.usuario_id', 'u.id')
    .whereIn('vv.venda_id', ids)
    .orderBy('vv.ordem', 'asc')
    .select(
      'vv.venda_id',
      'u.id',
      'u.nome',
      'u.email'
    );

  const porVenda = new Map();
  linhas.forEach(linha => {
    const vendaId = Number(linha.venda_id);
    const atual = porVenda.get(vendaId) || [];
    atual.push({
      id: Number(linha.id),
      nome: linha.nome,
      email: linha.email || ''
    });
    porVenda.set(vendaId, atual);
  });

  return vendas.map(venda => ({
    ...venda,
    vendedoras: porVenda.get(Number(venda.id)) || normalizarVendedorasVenda(venda)
  }));
}

/**
 * Processa encontrar regra comissao conforme as regras do dominio.
 */
function encontrarRegraComissao(regras, valorUnitario, operadoraId) {
  const valor = Number(valorUnitario || 0);
  if (!Number.isFinite(valor)) return null;

  const candidatas = regras.filter(regra => (
    valor >= Number(regra.valor_min || 0)
    && valor <= Number(regra.valor_max || 0)
  ));
  const operadora = operadoraId ? Number(operadoraId) : null;

  return candidatas.find(regra => regra.operadora_id && Number(regra.operadora_id) === operadora)
    || candidatas.find(regra => !regra.operadora_id)
    || null;
}

/**
 * Monta regra comissao resumo a partir dos dados informados.
 */
function montarRegraComissaoResumo(regra) {
  if (!regra) return null;

  return {
    id: regra.id,
    operadora_id: regra.operadora_id ? Number(regra.operadora_id) : null,
    operadora_nome: regra.operadora_nome || null,
    valor_min: Number(regra.valor_min || 0),
    valor_max: Number(regra.valor_max || 0),
    valor_comissao: Number(regra.valor_comissao || 0),
    valor_comissao_base: Number(regra.valor_comissao_base ?? regra.valor_comissao ?? 0),
    valor_comissao_base_propria: Number(regra.valor_comissao_base_propria ?? regra.valor_comissao_base ?? regra.valor_comissao ?? 0),
    prioridade_base_dupla: regra.prioridade_base_dupla || 'base_propria'
  };
}

/**
 * Retorna quantidade chips venda no formato esperado pelo fluxo.
 */
function quantidadeChipsVenda(venda) {
  const chips = parseChips(venda.valores_unitarios_chips);
  const totalChips = chips.reduce((soma, item) => soma + item.quantidade, 0);
  if (totalChips > 0) return totalChips;

  const linhas = Number(venda.quantidade_linhas || 0);
  return linhas > 0 ? linhas : 0;
}

/**
 * Retorna quantidade chips por tipo no formato esperado pelo fluxo.
 */
function quantidadeChipsPorTipo(venda, tipo) {
  const chips = parseChips(venda.valores_unitarios_chips);
  const temTipoPorItem = chips.length > 0 && chips.some(chip => chip.tipo_linha);

  if (temTipoPorItem) {
    return chips.reduce((soma, chip) => (
      chip.tipo_linha === tipo ? soma + chip.quantidade : soma
    ), 0);
  }

  return tipoVendaNormalizado(venda.tipo_venda_nome) === tipo ? quantidadeChipsVenda(venda) : 0;
}

/**
 * Carrega vendas no periodo e atualiza o estado relacionado.
 */
async function carregarVendasNoPeriodo(filtros, criterioData = 'registro', opcoes = {}) {
  const inicio = normalizarData(filtros.data_inicio);
  const fim = normalizarData(filtros.data_fim);
  const statusFinal = await obterCodigoEtapaFinal();
  const dataReferencia = criterioData === 'ativacao'
    ? dataAtivacaoReferenciaSQL('v')
    : dataVendaReferenciaSQL('v');

  const query = Venda.query()
    .alias('v')
    .leftJoin('operadoras as o', 'v.operadora_id', 'o.id')
    .leftJoin('tipos_venda as tv', 'v.tipo_venda_id', 'tv.id')
    .leftJoin('servicos as s', 'v.servico_id', 's.id')
    .leftJoin('usuarios as u', 'v.vendedora_id', 'u.id')
    .leftJoin('clientes as c', 'v.cliente_id', 'c.id')
    .leftJoin('operadoras as oc', 'c.operadora_atual_id', 'oc.id')
    
    .whereNull('v.excluido_em')
    .select(
      'v.id',
      'v.status_funil',
      'v.prioridade_funil',
      'v.protocolo',
      'v.login',
      'v.senha',
      'v.numero_cliente_contrato',
      'v.nome',
      'v.razao_social',
      'v.cnpj',
      'v.email',
      'v.email_2',
      'v.telefone',
      'v.fixo_ddd',
      'v.nome_representante_legal',
      'v.cpf_representante_legal',
      'v.telefone_representante_legal',
      'v.email_representante_legal',
      'v.nome_administrador',
      'v.cpf_administrador',
      'v.telefone_administrador',
      'v.email_administrador',
      'v.nome_fechou_venda',
      'v.setor_funcao',
      'v.valor_total',
      'v.valores_unitarios_chips',
      'v.cliente_da_base',
      'v.numeros_portados',
      'v.numeros_ativados',
      'v.cliente_solicitou_servicos',
      'v.cliente_solicitou_bloqueio_qtd',
      'v.cliente_solicitou_cancelamento_qtd',
      'v.cliente_solicitou_numeros',
      'v.quantidade_linhas',
      'v.data_venda',
      'v.data_ativacao',
      'v.criado_em',
      'v.created_at',
      'v.updated_at',
      'v.dia_vencimento',
      'v.ddd',
      'v.gb',
      'v.qc_feito_por',
      'v.promessa_cliente',
      'v.promessa_cumprida',
      'v.observacoes',
      'v.endereco',
      'v.numero_endereco',
      'v.complemento',
      'v.bairro',
      'v.municipio',
      'v.uf',
      'v.cep',
      'v.endereco_real_divergente',
      'v.endereco_real',
      'v.numero_endereco_real',
      'v.complemento_real',
      'v.bairro_real',
      'v.municipio_real',
      'v.uf_real',
      'v.cep_real',
      'v.ponto_referencia',
      'v.tipo_local_cpf',
      'v.horario_aceite_inicio',
      'v.horario_aceite_fim',
      'v.dia_aceite_inicio',
      'v.dia_aceite_fim',
      'v.dia_aceite_fixo',
      'v.horario_aceite_fixo',
      'v.motivo_retorno',
      'v.status_anterior_retorno',
      'v.retornou_em',
      'v.corrigido_em',
      'v.operadora_id',
      'v.vendedora_id',
      'v.tipo_venda_id',
      'v.servico_id',
      'v.cliente_id',
      'o.nome as operadora_nome',
      'tv.nome as tipo_venda_nome',
      's.nome as servico_nome',
      'u.nome as vendedora_nome',
      'u.email as vendedora_email',
      'c.nome as cliente_nome',
      'c.razao_social as cliente_razao_social',
      'c.cnpj as cliente_cnpj',
      'c.fidelidade_fim as cliente_fidelidade_fim',
      'c.operadora_atual_id as cliente_operadora_atual_id',
      'c.base_anterior_sistema as cliente_base_anterior_sistema',
      'oc.nome as cliente_operadora_atual_nome',
      Venda.knex().raw(`(
        SELECT GROUP_CONCAT(co.operadora_id)
        FROM cliente_operadoras co
        WHERE co.cliente_id = c.id
      ) as cliente_operadoras_ids`)
    );

  if (!opcoes.incluirRetornos) {
    query.whereNot('v.status_funil', 'retorno');
  }

  if (inicio) {
    query.whereRaw(`${dataReferencia} >= ?`, [inicio]);
  }

  if (fim) {
    query.whereRaw(`${dataReferencia} <= ?`, [fim]);
  }

  const vendas = await query;

  return {
    vendas: await anexarVendedorasVendas(vendas),
    statusFinal
  };
}

/**
 * Carrega venda fechamento por id e atualiza o estado relacionado.
 */
async function carregarVendaFechamentoPorId(id) {
  const venda = await Venda.query()
    .alias('v')
    .leftJoin('operadoras as o', 'v.operadora_id', 'o.id')
    .leftJoin('tipos_venda as tv', 'v.tipo_venda_id', 'tv.id')
    .leftJoin('servicos as s', 'v.servico_id', 's.id')
    .leftJoin('usuarios as u', 'v.vendedora_id', 'u.id')
    .leftJoin('clientes as c', 'v.cliente_id', 'c.id')
    .leftJoin('operadoras as oc', 'c.operadora_atual_id', 'oc.id')
    .where('v.id', id)
    .whereNull('v.excluido_em')
    .select(
      'v.id',
      'v.status_funil',
      'v.prioridade_funil',
      'v.protocolo',
      'v.login',
      'v.senha',
      'v.numero_cliente_contrato',
      'v.nome',
      'v.razao_social',
      'v.cnpj',
      'v.email',
      'v.email_2',
      'v.telefone',
      'v.fixo_ddd',
      'v.nome_representante_legal',
      'v.cpf_representante_legal',
      'v.telefone_representante_legal',
      'v.email_representante_legal',
      'v.nome_administrador',
      'v.cpf_administrador',
      'v.telefone_administrador',
      'v.email_administrador',
      'v.nome_fechou_venda',
      'v.setor_funcao',
      'v.valor_total',
      'v.valores_unitarios_chips',
      'v.numeros_portados',
      'v.numeros_ativados',
      'v.cliente_solicitou_servicos',
      'v.cliente_solicitou_bloqueio_qtd',
      'v.cliente_solicitou_cancelamento_qtd',
      'v.cliente_solicitou_numeros',
      'v.quantidade_linhas',
      'v.data_venda',
      'v.data_ativacao',
      'v.criado_em',
      'v.created_at',
      'v.updated_at',
      'v.dia_vencimento',
      'v.ddd',
      'v.gb',
      'v.qc_feito_por',
      'v.promessa_cliente',
      'v.promessa_cumprida',
      'v.observacoes',
      'v.endereco',
      'v.numero_endereco',
      'v.complemento',
      'v.bairro',
      'v.municipio',
      'v.uf',
      'v.cep',
      'v.endereco_real_divergente',
      'v.endereco_real',
      'v.numero_endereco_real',
      'v.complemento_real',
      'v.bairro_real',
      'v.municipio_real',
      'v.uf_real',
      'v.cep_real',
      'v.ponto_referencia',
      'v.tipo_local_cpf',
      'v.horario_aceite_inicio',
      'v.horario_aceite_fim',
      'v.dia_aceite_inicio',
      'v.dia_aceite_fim',
      'v.dia_aceite_fixo',
      'v.horario_aceite_fixo',
      'v.motivo_retorno',
      'v.status_anterior_retorno',
      'v.retornou_em',
      'v.corrigido_em',
      'v.operadora_id',
      'v.vendedora_id',
      'v.tipo_venda_id',
      'v.servico_id',
      'v.cliente_id',
      'o.nome as operadora_nome',
      'tv.nome as tipo_venda_nome',
      's.nome as servico_nome',
      'u.nome as vendedora_nome',
      'u.email as vendedora_email',
      'c.nome as cliente_nome',
      'c.razao_social as cliente_razao_social',
      'c.cnpj as cliente_cnpj',
      'c.fidelidade_fim as cliente_fidelidade_fim',
      'c.operadora_atual_id as cliente_operadora_atual_id',
      'c.base_anterior_sistema as cliente_base_anterior_sistema',
      'oc.nome as cliente_operadora_atual_nome',
      Venda.knex().raw(`(
        SELECT GROUP_CONCAT(co.operadora_id)
        FROM cliente_operadoras co
        WHERE co.cliente_id = c.id
      ) as cliente_operadoras_ids`)
    )
    .first();

  if (!venda) return null;

  const [comVendedoras] = await anexarVendedorasVendas([venda]);
  return comVendedoras;
}

/**
 * Classifica secao conforme as regras do dominio.
 */
function classificarSecao(statusFunil, statusFinal = STATUS_FINAL_FALLBACK) {
  if (statusFunil === statusFinal) return 'ativas';
  if (statusFunil && statusFunil !== 'retorno') return 'tratando';
  return null;
}

/**
 * Monta etapas zeradas a partir dos dados informados.
 */
function montarEtapasZeradas(etapasBase = [], statusFinal = STATUS_FINAL_FALLBACK) {
  return etapasBase.map(etapa => ({
    codigo: etapa.codigo,
    nome: etapa.nome,
    vendas: 0,
    ugrs: 0,
    retorno: Boolean(etapa.retorno),
    etapa_final: etapa.codigo === statusFinal || Boolean(etapa.etapa_final)
  }));
}

/**
 * Processa nova linha operadora conforme as regras do dominio.
 */
function novaLinhaOperadora(operadoraId, operadoraNome, etapasBase = [], statusFinal = STATUS_FINAL_FALLBACK) {
  return {
    operadora_id: operadoraId,
    operadora_nome: operadoraNome || 'Sem operadora',
    total_vendas: 0,
    contratos: 0,
    ugrs: 0,
    movel: 0,
    fixo: 0,
    internet: 0,
    novo: 0,
    portabilidade: 0,
    receita: 0,
    etapas_funil: montarEtapasZeradas(etapasBase, statusFinal)
  };
}

/**
 * Soma etapa linha considerando os dados informados.
 */
function somarEtapaLinha(linha, venda, chips, etapasBase = [], statusFinal = STATUS_FINAL_FALLBACK) {
  const codigo = venda.status_funil || etapasBase[0]?.codigo || 'sem_etapa';
  let etapa = linha.etapas_funil.find(item => item.codigo === codigo);

  if (!etapa) {
    etapa = {
      codigo,
      nome: nomeEtapa(etapasBase, codigo),
      vendas: 0,
      ugrs: 0,
      retorno: codigo === 'retorno',
      etapa_final: codigo === statusFinal
    };
    linha.etapas_funil.push(etapa);
  }

  etapa.vendas += 1;
  etapa.ugrs += chips;
}

/**
 * Soma retorno historico linha considerando os dados informados.
 */
function somarRetornoHistoricoLinha(linha, venda, chips) {
  if (!vendaTeveRetornoCorrigido(venda)) return;

  let etapa = linha.etapas_funil.find(item => item.codigo === CODIGO_RETORNO_HISTORICO);

  if (!etapa) {
    etapa = {
      codigo: CODIGO_RETORNO_HISTORICO,
      nome: nomeEtapa([], CODIGO_RETORNO_HISTORICO),
      vendas: 0,
      ugrs: 0,
      retorno: true,
      etapa_final: false
    };
    linha.etapas_funil.push(etapa);
  }

  etapa.vendas += 1;
  etapa.ugrs += chips;
}

/**
 * Agrupa os chips da venda pela operadora de destino.
 */
function agruparChipsPorOperadora(venda) {
  const chips = parseChips(venda.valores_unitarios_chips);

  if (chips.length === 0) {
    return [{
      operadora_id: venda.operadora_id ? Number(venda.operadora_id) : null,
      operadora_nome: venda.operadora_nome || null,
      quantidade: quantidadeChipsVenda(venda),
      novo: quantidadeChipsPorTipo(venda, 'novo'),
      portabilidade: quantidadeChipsPorTipo(venda, 'portabilidade'),
      valor_total: Number(venda.valor_total || 0)
    }];
  }

  const grupos = new Map();

  chips.forEach(chip => {
    const operadoraId = chip.operadora_id ? Number(chip.operadora_id) : (venda.operadora_id ? Number(venda.operadora_id) : null);
    const chave = operadoraId ?? 'sem_operadora';
    const atual = grupos.get(chave) || {
      operadora_id: operadoraId,
      operadora_nome: chip.operadora_nome || (Number(venda.operadora_id) === operadoraId ? venda.operadora_nome : null),
      quantidade: 0,
      novo: 0,
      portabilidade: 0,
      valor_total: 0
    };

    atual.quantidade += Number(chip.quantidade || 0);
    atual.valor_total += Number(chip.quantidade || 0) * Number(chip.valor_unitario || 0);
    if (chip.tipo_linha === 'portabilidade') atual.portabilidade += Number(chip.quantidade || 0);
    else atual.novo += Number(chip.quantidade || 0);
    grupos.set(chave, atual);
  });

  return Array.from(grupos.values());
}

/**
 * Agrega por operadora para compor os totais.
 */
function agregarPorOperadora(vendas, statusFinal = STATUS_FINAL_FALLBACK, etapasBase = []) {
  const total = new Map();
  const tratando = new Map();
  const ativas = new Map();

  vendas.forEach(venda => {
    agruparChipsPorOperadora(venda).forEach(grupo => {
      const chave = grupo.operadora_id ?? 'sem_operadora';
      const inicializa = (mapa) => {
        if (!mapa.has(chave)) {
          mapa.set(chave, novaLinhaOperadora(grupo.operadora_id, grupo.operadora_nome, etapasBase, statusFinal));
        }
        return mapa.get(chave);
      };

      const categoria = categoriaServico(venda.servico_nome);
      const chips = Number(grupo.quantidade || 0);
      const ehContrato = venda.status_funil === statusFinal;

      const aplicar = (linha) => {
        linha.total_vendas += 1;
        if (ehContrato) {
          linha.contratos += 1;
          linha.ugrs += chips;
        }
        if (categoria === 'movel') linha.movel += 1;
        if (categoria === 'fixo') linha.fixo += 1;
        if (categoria === 'internet') linha.internet += 1;
        linha.novo += Number(grupo.novo || 0);
        linha.portabilidade += Number(grupo.portabilidade || 0);
        linha.receita += Number(grupo.valor_total || 0);
        somarEtapaLinha(linha, venda, chips, etapasBase, statusFinal);
        somarRetornoHistoricoLinha(linha, venda, chips);
      };

      aplicar(inicializa(total));

      const secao = classificarSecao(venda.status_funil, statusFinal);
      if (secao === 'tratando') aplicar(inicializa(tratando));
      else if (secao === 'ativas') aplicar(inicializa(ativas));
    });
  });

  const finalizar = (mapa) => Array.from(mapa.values())
    .map(linha => ({
      ...linha,
      receita: Number(linha.receita.toFixed(2)),
      etapas_funil: linha.etapas_funil.map(etapa => ({ ...etapa }))
    }))
    .sort((a, b) => b.receita - a.receita);

  return {
    total: finalizar(total),
    tratando: finalizar(tratando),
    ativas: finalizar(ativas)
  };
}

/**
 * Cria linha painel com os dados informados.
 */
function criarLinhaPainel(categoria) {
  return {
    categoria,
    label: labelCategoriaPainel(categoria),
    total_vendas: 0,
    tratando: 0,
    ativas: 0,
    retornos: 0,
    ugrs_total: 0,
    ugrs_ativas: 0,
    novo: 0,
    portabilidade: 0,
    receita: 0,
    comissao_estimada: 0,
    net_add: 0,
    etapas_funil: []
  };
}

/**
 * Monta painel gerencial a partir dos dados informados.
 */
async function montarPainelGerencial(vendas, statusFinal = STATUS_FINAL_FALLBACK) {
  const regrasComissao = await carregarRegrasComissaoAtivas();
  const etapas = await listarEtapasPainel();
  const etapasBase = [
    ...etapas,
    { codigo: 'retorno', nome: 'Retorno', etapa_final: false, retorno: true }
  ];
  const linhasChips = montarLinhasChips(vendas, regrasComissao);
  const comissaoPorVenda = linhasChips.reduce((acc, linha) => {
    if (linha.comissao === null) return acc;
    acc[linha.venda_id] = (acc[linha.venda_id] || 0) + Number(linha.comissao || 0);
    return acc;
  }, {});
  const painel = new Map();

  vendas.forEach(venda => {
    const categoria = categoriaPainel(venda.servico_nome);
    if (!painel.has(categoria)) {
      painel.set(categoria, criarLinhaPainel(categoria));
    }

    const linha = painel.get(categoria);
    const chips = quantidadeChipsVenda(venda);
    const ehAtiva = venda.status_funil === statusFinal;
    const ehRetorno = venda.status_funil === 'retorno';
    const teveRetornoCorrigido = vendaTeveRetornoCorrigido(venda);
    const ehTratando = venda.status_funil && !ehAtiva && !ehRetorno;

    linha.total_vendas += 1;
    linha.ugrs_total += chips;
    linha.novo += quantidadeChipsPorTipo(venda, 'novo');
    linha.portabilidade += quantidadeChipsPorTipo(venda, 'portabilidade');
    linha.receita += Number(venda.valor_total || 0);
    linha.comissao_estimada += Number(comissaoPorVenda[venda.id] || 0);

    if (ehAtiva) {
      linha.ativas += 1;
      linha.ugrs_ativas += chips;
    } else if (ehRetorno) {
      linha.retornos += 1;
    }

    if (!ehAtiva && !ehRetorno && ehTratando) {
      linha.tratando += 1;
    }

    const status = venda.status_funil || etapas[0]?.codigo || 'aprovacao';
    const etapaExistente = linha.etapas_funil.find(item => item.codigo === status);
    const etapa = etapaExistente || {
      codigo: status,
      nome: nomeEtapa(etapasBase, status),
      vendas: 0,
      ugrs: 0,
      retorno: status === 'retorno',
      etapa_final: status === statusFinal
    };

    etapa.vendas += 1;
    etapa.ugrs += chips;

    if (!etapaExistente) {
      linha.etapas_funil.push(etapa);
    }

    if (teveRetornoCorrigido) {
      const retornoHistoricoExistente = linha.etapas_funil.find(item => item.codigo === CODIGO_RETORNO_HISTORICO);
      const retornoHistorico = retornoHistoricoExistente || {
        codigo: CODIGO_RETORNO_HISTORICO,
        nome: nomeEtapa([], CODIGO_RETORNO_HISTORICO),
        vendas: 0,
        ugrs: 0,
        retorno: true,
        etapa_final: false
      };

      retornoHistorico.vendas += 1;
      retornoHistorico.ugrs += chips;

      if (!retornoHistoricoExistente) {
        linha.etapas_funil.push(retornoHistorico);
      }
    }
  });

  const ordem = ['movel', 'fixo', 'internet', 'outros'];

  return Array.from(painel.values())
    .map(linha => ({
      ...linha,
      receita: Number(linha.receita.toFixed(2)),
      comissao_estimada: Number(linha.comissao_estimada.toFixed(2)),
      net_add: linha.ugrs_ativas - linha.retornos,
      etapas_funil: [
        ...etapasBase
          .map(etapa => linha.etapas_funil.find(item => item.codigo === etapa.codigo) || {
            codigo: etapa.codigo,
            nome: etapa.nome,
            vendas: 0,
            ugrs: 0,
            retorno: Boolean(etapa.retorno),
            etapa_final: etapa.codigo === statusFinal || Boolean(etapa.etapa_final)
          }),
        ...linha.etapas_funil.filter(item => !etapasBase.some(etapa => etapa.codigo === item.codigo))
      ]
    }))
    .sort((a, b) => ordem.indexOf(a.categoria) - ordem.indexOf(b.categoria));
}

/**
 * Obtem resumo a partir dos dados informados.
 */
async function obterResumo(filtros = {}) {
  const { vendas: vendasRegistro, statusFinal } = await carregarVendasNoPeriodo(filtros, 'registro', { incluirRetornos: true });
  const { vendas: vendasPainel } = await carregarVendasNoPeriodo(filtros, 'registro', { incluirRetornos: true });
  const { vendas: vendasAtivacao } = await carregarVendasNoPeriodo(filtros, 'ativacao');
  const etapasBase = await listarEtapasPainel();
  const resumoRegistro = agregarPorOperadora(vendasRegistro, statusFinal, etapasBase);
  const resumoAtivacao = agregarPorOperadora(vendasAtivacao, statusFinal, etapasBase);
  const painel = await montarPainelGerencial(vendasPainel, statusFinal);

  return {
    periodo: {
      data_inicio: normalizarData(filtros.data_inicio),
      data_fim: normalizarData(filtros.data_fim)
    },
    painel,
    secoes: {
      total: resumoRegistro.total,
      tratando: resumoRegistro.tratando,
      ativas: resumoAtivacao.ativas
    }
  };
}

/**
 * Filtra por secao conforme os criterios informados.
 */
function filtrarPorSecao(vendas, secao, statusFinal = STATUS_FINAL_FALLBACK) {
  if (secao === 'tratando') {
    return vendas.filter(v => v.status_funil && v.status_funil !== statusFinal && v.status_funil !== 'retorno');
  }
  if (secao === 'ativas') {
    return vendas.filter(v => v.status_funil === statusFinal);
  }
  return vendas;
}

/**
 * Monta venda resumo a partir dos dados informados.
 */
function montarVendaResumo(venda, statusFinal = STATUS_FINAL_FALLBACK) {
  const categoria = categoriaServico(venda.servico_nome);
  const chipsNovos = quantidadeChipsPorTipo(venda, 'novo');
  const chipsPortabilidade = quantidadeChipsPorTipo(venda, 'portabilidade');

  return {
    id: venda.id,
    data_venda: venda.data_venda || venda.created_at || null,
    data_ativacao: venda.data_ativacao || null,
    data_fechamento: venda.status_funil === statusFinal
      ? (venda.data_ativacao || venda.data_venda || venda.created_at || null)
      : (venda.data_venda || venda.created_at || null),
    status_funil: venda.status_funil,
    motivo_retorno: venda.motivo_retorno || null,
    status_anterior_retorno: venda.status_anterior_retorno || null,
    retornou_em: venda.retornou_em || null,
    corrigido_em: venda.corrigido_em || null,
    valor_total: Number(venda.valor_total || 0),
    quantidade_linhas: Number(venda.quantidade_linhas || 0),
    chips_total: quantidadeChipsVenda(venda),
    dia_vencimento: venda.dia_vencimento || null,
    ddd: venda.ddd || null,
    gb: venda.gb || null,
    operadora: venda.operadora_id ? { id: venda.operadora_id, nome: venda.operadora_nome } : null,
    vendedora: venda.vendedora_id ? {
      id: venda.vendedora_id,
      nome: venda.vendedora_nome,
      email: venda.vendedora_email
    } : null,
    cliente: venda.cliente_id ? {
      id: venda.cliente_id,
      nome: venda.cliente_nome,
      razao_social: venda.cliente_razao_social,
      cnpj: venda.cliente_cnpj,
      fidelidade_fim: venda.cliente_fidelidade_fim
    } : null,
    tipo_venda: venda.tipo_venda_nome || null,
    servico: venda.servico_nome || null,
    categoria,
    tipo_servico_normalizado: chipsNovos > 0 && chipsPortabilidade > 0
      ? 'misto'
      : chipsPortabilidade > 0 ? 'portabilidade' : chipsNovos > 0 ? 'novo' : null,
    chips_novos: chipsNovos,
    chips_portabilidade: chipsPortabilidade,

  };
}

/**
 * Obtem detalhes a partir dos dados informados.
 */
async function obterDetalhes(filtros = {}) {
  const criterioData = filtros.secao === 'ativas' ? 'ativacao' : 'registro';
  const { vendas: todasVendas, statusFinal } = await carregarVendasNoPeriodo(filtros, criterioData, {
    incluirRetornos: filtros.secao === 'total'
  });
  const vendasSecao = filtrarPorSecao(todasVendas, filtros.secao, statusFinal);

  const filtradas = filtros.operadora_id
    ? vendasSecao.filter(v => Number(v.operadora_id) === Number(filtros.operadora_id))
    : vendasSecao;

  return filtradas
    .map(venda => montarVendaResumo(venda, statusFinal))
    .sort((a, b) => {
      const dataA = a.data_fechamento || '';
      const dataB = b.data_fechamento || '';
      return dataB.localeCompare(dataA);
    });
}

/**
 * Obtem detalhes chips a partir dos dados informados.
 */
async function obterDetalhesChips(filtros = {}) {
  const criterioData = filtros.secao === 'ativas' ? 'ativacao' : 'registro';
  const { vendas: todasVendas, statusFinal } = await carregarVendasNoPeriodo(filtros, criterioData, {
    incluirRetornos: filtros.secao === 'total'
  });
  const regrasComissao = await carregarRegrasComissaoAtivas();
  const vendasSecao = filtrarPorSecao(todasVendas, filtros.secao, statusFinal);
  const linhas = montarLinhasChips(vendasSecao, regrasComissao);
  const filtradas = filtros.operadora_id
    ? linhas.filter(linha => Number(linha.operadora?.id) === Number(filtros.operadora_id))
    : linhas;

  return montarRespostaLinhasChips(filtradas);
}

/**
 * Monta linhas chips a partir dos dados informados.
 */
function montarLinhasChips(vendas, regrasComissao = []) {
  const linhas = [];

  /**
   * Monta linha com regra a partir dos dados informados.
   */
  function montarLinhaComRegra(venda, chip) {
    const linha = montarLinhaChip(venda, chip);
    const regra = encontrarRegraComissao(regrasComissao, linha.valor_unitario, linha.operadora?.id);

    if (!regra) {
      return {
        ...linha,
        regra_comissao: null,
        comissao_integral: null,
        comissao_base: null,
        comissao_base_propria: null,
        comissao: null,
        sem_regra: true
      };
    }

    const comissaoIntegral = Number(regra.valor_comissao || 0);
    const comissaoBase = Number(regra.valor_comissao_base ?? regra.valor_comissao ?? 0);
    const comissaoBasePropria = Number(regra.valor_comissao_base_propria ?? regra.valor_comissao_base ?? regra.valor_comissao ?? 0);
    const prioridadeBaseDupla = regra.prioridade_base_dupla || 'base_propria';
    let comissaoAplicada = comissaoIntegral;
    let tipoComissao = 'integral';

    if (linha.cliente_base_propria && linha.cliente_base_operadora) {
      if (prioridadeBaseDupla === 'base_operadora') {
        comissaoAplicada = comissaoBase;
        tipoComissao = 'base_operadora';
      } else {
        comissaoAplicada = comissaoBasePropria;
        tipoComissao = 'base_propria';
      }
    } else if (linha.cliente_base_propria) {
      comissaoAplicada = comissaoBasePropria;
      tipoComissao = 'base_propria';
    } else if (linha.cliente_base_operadora) {
      comissaoAplicada = comissaoBase;
      tipoComissao = 'base_operadora';
    }

    return {
      ...linha,
      regra_comissao: montarRegraComissaoResumo(regra),
      comissao_integral: Number(comissaoIntegral.toFixed(2)),
      comissao_base: Number(comissaoBase.toFixed(2)),
      comissao_base_propria: Number(comissaoBasePropria.toFixed(2)),
      comissao: Number(comissaoAplicada.toFixed(2)),
      tipo_comissao: tipoComissao,
      sem_regra: false
    };
  }

  vendas.forEach(venda => {
    const chips = parseChips(venda.valores_unitarios_chips);
    const numerosAtivados = parseNumerosLinha(venda.numeros_ativados);
    const numerosPortados = parseNumerosLinha(venda.numeros_portados);

    if (chips.length === 0) {
      const linhasFallback = Number(venda.quantidade_linhas || 0) || 1;
      const valorFallback = Number(venda.valor_total || 0) / linhasFallback;
      const gigasFallback = gigasUnitarios(venda.gb, linhasFallback);

      for (let i = 0; i < linhasFallback; i++) {
        linhas.push(montarLinhaComRegra(venda, {
          chip_index: i + 1,
          numero_ativado: numerosAtivados[i] || null,
          numero_portado: numerosPortados[i] || null,
          gb: gigasFallback[i] || '',
          tipo_linha: tipoVendaNormalizado(venda.tipo_venda_nome) || 'novo',
          valor_unitario: valorFallback,
          vendedora_id: null
        }));
      }
      return;
    }

    let chipNumero = 1;
    chips.forEach(item => {
      const gigas = gigasUnitarios(item.gb, item.quantidade, venda.gb);

      for (let i = 0; i < item.quantidade; i++) {
        linhas.push(montarLinhaComRegra(venda, {
          chip_index: chipNumero,
          numero_ativado: numerosAtivados[chipNumero - 1] || null,
          numero_portado: numerosPortados[chipNumero - 1] || null,
          gb: gigas[i] || '',
          tipo_linha: item.tipo_linha,
          valor_unitario: item.valor_unitario,
          operadora_atual_id: item.operadora_atual_id,
          operadora_atual_nome: item.operadora_atual_nome,
          operadora_id: item.operadora_id,
          operadora_nome: item.operadora_nome,
          vendedora_id: item.vendedora_id
        }));
        chipNumero += 1;
      }
    });
  });

  return linhas.sort((a, b) => {
    const dataA = a.data_fechamento || '';
    const dataB = b.data_fechamento || '';
    const cmp = dataB.localeCompare(dataA);
    if (cmp !== 0) return cmp;
    return Number(a.venda_id) - Number(b.venda_id);
  });
}

/**
 * Monta resposta linhas chips a partir dos dados informados.
 */
function montarRespostaLinhasChips(linhasOrdenadas) {
  const totaisVendedora = new Map();

  linhasOrdenadas.forEach(linha => {
    if (linha.comissao === null) return;

    const vendedorasLinha = vendedorasComissaoLinha(linha);
    if (vendedorasLinha.length === 0) return;

    const comissaoPorVendedora = Number(linha.comissao || 0) / vendedorasLinha.length;
    const ugrPorVendedora = 1 / vendedorasLinha.length;

    vendedorasLinha.forEach(vendedora => {
      const chave = vendedora.id || 'sem_vendedora';
      const atual = totaisVendedora.get(chave) || {
        vendedora_id: vendedora.id || null,
        vendedora_nome: vendedora.nome || 'Sem vendedora',
        total_ugrs: 0,
        total_comissao: 0
      };

      atual.total_ugrs += ugrPorVendedora;
      atual.total_comissao += comissaoPorVendedora;
      totaisVendedora.set(chave, atual);
    });
  });

  return {
    linhas: linhasOrdenadas,
    totais_por_vendedora: Array.from(totaisVendedora.values())
      .map(item => ({
        ...item,
        total_ugrs: Number(item.total_ugrs.toFixed(2)),
        total_comissao: Number(item.total_comissao.toFixed(2))
      }))
      .sort((a, b) => b.total_comissao - a.total_comissao),
    total_geral: {
      chips: linhasOrdenadas.length,
      valor: Number(linhasOrdenadas.reduce((soma, l) => soma + Number(l.valor_unitario || 0), 0).toFixed(2)),
      comissao: Number(linhasOrdenadas.reduce((soma, l) => soma + Number(l.comissao || 0), 0).toFixed(2)),
      ugrs_sem_regra: linhasOrdenadas.filter(linha => linha.sem_regra).length
    }
  };
}

/**
 * Monta linha chip a partir dos dados informados.
 */
function montarLinhaChip(venda, chip) {
  const operadoraVendaId = chip.operadora_id ? Number(chip.operadora_id) : (venda.operadora_id ? Number(venda.operadora_id) : null);
  const operadoraVendaNome = chip.operadora_nome || (Number(venda.operadora_id) === operadoraVendaId ? venda.operadora_nome : null);
  const operadoraAtualClienteId = chip.operadora_atual_id
    ? Number(chip.operadora_atual_id)
    : (venda.cliente_operadora_atual_id ? Number(venda.cliente_operadora_atual_id) : null);
  const operadorasClienteIds = String(venda.cliente_operadoras_ids || '')
    .split(',')
    .map(id => Number(id))
    .filter(Boolean);
  const clienteBaseOperadora = Boolean(operadoraVendaId && (
    operadorasClienteIds.includes(operadoraVendaId)
    || (operadoraAtualClienteId && operadoraVendaId === operadoraAtualClienteId)
  ));
  const operadoraAtualExibicaoId = chip.operadora_atual_id
    ? operadoraAtualClienteId
    : (clienteBaseOperadora ? operadoraVendaId : operadoraAtualClienteId);
  const operadoraAtualExibicaoNome = chip.operadora_atual_nome
    || (clienteBaseOperadora ? operadoraVendaNome : venda.cliente_operadora_atual_nome);
  const clienteBasePropria = Boolean(venda.cliente_base_anterior_sistema);
  const vendedoras = normalizarVendedorasVenda(venda);
  const vendedoraChip = chip.vendedora_id
    ? vendedoras.find(item => Number(item.id) === Number(chip.vendedora_id))
    : null;

  return {
    venda_id: venda.id,
    chip_index: chip.chip_index,
    numero_ativado: chip.numero_ativado || null,
    numero_portado: chip.numero_portado || null,
    nome: venda.nome || null,
    razao_social: venda.razao_social || null,
    cnpj: venda.cnpj || null,
    email: venda.email || null,
    email_2: venda.email_2 || null,
    telefone: venda.telefone || null,
    fixo_ddd: venda.fixo_ddd || null,
    protocolo: venda.protocolo || null,
    login: venda.login || null,
    senha: venda.senha || null,
    numero_cliente_contrato: venda.numero_cliente_contrato || null,
    prioridade_funil: venda.prioridade_funil || null,
    nome_representante_legal: venda.nome_representante_legal || null,
    cpf_representante_legal: venda.cpf_representante_legal || null,
    telefone_representante_legal: venda.telefone_representante_legal || null,
    email_representante_legal: venda.email_representante_legal || null,
    nome_administrador: venda.nome_administrador || null,
    cpf_administrador: venda.cpf_administrador || null,
    telefone_administrador: venda.telefone_administrador || null,
    email_administrador: venda.email_administrador || null,
    nome_fechou_venda: venda.nome_fechou_venda || null,
    setor_funcao: venda.setor_funcao || null,
    data_venda: venda.data_venda || venda.created_at || null,
    data_ativacao: venda.data_ativacao || null,
    created_at: venda.created_at || null,
    updated_at: venda.updated_at || null,
    data_fechamento: venda.data_ativacao || venda.data_venda || venda.created_at || null,
    status_funil: venda.status_funil,
    ddd: venda.ddd || null,
    gb: chip.gb || null,
    quantidade_linhas: venda.quantidade_linhas || null,
    dia_vencimento: venda.dia_vencimento || null,
    tipo_linha: chip.tipo_linha || null,
    valor_unitario: Number(Number(chip.valor_unitario || 0).toFixed(2)),
    valor_total: Number(Number(venda.valor_total || 0).toFixed(2)),
    numeros_portados: venda.numeros_portados || null,
    numeros_ativados: venda.numeros_ativados || null,
    cliente_solicitou_servicos: venda.cliente_solicitou_servicos || null,
    cliente_solicitou_bloqueio_qtd: venda.cliente_solicitou_bloqueio_qtd || null,
    cliente_solicitou_cancelamento_qtd: venda.cliente_solicitou_cancelamento_qtd || null,
    cliente_solicitou_numeros: venda.cliente_solicitou_numeros || null,
    qc_feito_por: venda.qc_feito_por || null,
    promessa_cliente: venda.promessa_cliente || null,
    promessa_cumprida: venda.promessa_cumprida || null,
    observacoes: venda.observacoes || null,
    endereco: venda.endereco || null,
    numero_endereco: venda.numero_endereco || null,
    complemento: venda.complemento || null,
    bairro: venda.bairro || null,
    municipio: venda.municipio || null,
    uf: venda.uf || null,
    cep: venda.cep || null,
    endereco_real_divergente: Boolean(venda.endereco_real_divergente),
    endereco_real: venda.endereco_real || null,
    numero_endereco_real: venda.numero_endereco_real || null,
    complemento_real: venda.complemento_real || null,
    bairro_real: venda.bairro_real || null,
    municipio_real: venda.municipio_real || null,
    uf_real: venda.uf_real || null,
    cep_real: venda.cep_real || null,
    ponto_referencia: venda.ponto_referencia || null,
    tipo_local_cpf: venda.tipo_local_cpf || null,
    horario_aceite_inicio: venda.horario_aceite_inicio || null,
    horario_aceite_fim: venda.horario_aceite_fim || null,
    dia_aceite_inicio: venda.dia_aceite_inicio || null,
    dia_aceite_fim: venda.dia_aceite_fim || null,
    dia_aceite_fixo: venda.dia_aceite_fixo || null,
    horario_aceite_fixo: venda.horario_aceite_fixo || null,
    motivo_retorno: venda.motivo_retorno || null,
    status_anterior_retorno: venda.status_anterior_retorno || null,
    retornou_em: venda.retornou_em || null,
    corrigido_em: venda.corrigido_em || null,
    operadora: operadoraVendaId ? { id: operadoraVendaId, nome: operadoraVendaNome } : null,
    vendedora: vendedoraChip || (vendedoras.length === 1 ? vendedoras[0] : null),
    vendedoras,
    cliente: venda.cliente_id ? {
      id: venda.cliente_id,
      nome: venda.cliente_nome,
      razao_social: venda.cliente_razao_social,
      cnpj: venda.cliente_cnpj,
      fidelidade_fim: venda.cliente_fidelidade_fim,
      base_anterior_sistema: clienteBasePropria,
      operadora_atual: operadoraAtualExibicaoId ? {
        id: operadoraAtualExibicaoId,
        nome: operadoraAtualExibicaoNome
      } : null
    } : null,
    cliente_base_propria: clienteBasePropria,
    cliente_base_operadora: clienteBaseOperadora,
    tipo_repasse: clienteBasePropria && clienteBaseOperadora
      ? 'base_propria_operadora'
      : clienteBasePropria
        ? 'base_propria'
        : clienteBaseOperadora
          ? 'base_operadora'
          : 'cliente_novo_portabilidade',
    tipo_venda: venda.tipo_venda_nome || null,
    servico: venda.servico_nome || null
  };
}

/**
 * Obtem dossie venda a partir dos dados informados.
 */
async function obterDossieVenda(id, filtros = {}, usuarioId) {
  const venda = await vendaService.buscarVendaPorId(id, usuarioId);

  if (!venda) {
    return null;
  }

  const vendaFechamento = await carregarVendaFechamentoPorId(id);
  const regrasComissao = await carregarRegrasComissaoAtivas();
  const linhas = vendaFechamento ? montarLinhasChips([vendaFechamento], regrasComissao) : [];
  const totais = montarRespostaLinhasChips(linhas);
  const statusFinal = await obterCodigoEtapaFinal();
  const etapas = await listarEtapasPainel();
  const categoria = categoriaPainel(vendaFechamento?.servico_nome || venda.servico?.nome);

  return {
    venda,
    contexto: {
      secao: classificarSecao(venda.status_funil, statusFinal) || 'retorno',
      categoria,
      categoria_label: labelCategoriaPainel(categoria),
      periodo: {
        data_inicio: normalizarData(filtros.data_inicio),
        data_fim: normalizarData(filtros.data_fim)
      },
      status_final: statusFinal,
      status_funil_label: nomeEtapa(etapas, venda.status_funil),
      churn_aproximado: venda.status_funil === 'retorno'
    },
    linhas: totais.linhas,
    totais_por_vendedora: totais.totais_por_vendedora,
    total_geral: totais.total_geral
  };
}

/**
 * Monta linha exportacao venda a partir dos dados informados.
 */
function montarLinhaExportacaoVenda(venda, etapas = [], statusFinal = STATUS_FINAL_FALLBACK, grupo = null) {
  const quantidade = grupo ? grupo.quantidade : quantidadeChipsVenda(venda);
  const chipsNovos = grupo ? grupo.novo : quantidadeChipsPorTipo(venda, 'novo');
  const chipsPortabilidade = grupo ? grupo.portabilidade : quantidadeChipsPorTipo(venda, 'portabilidade');
  const status = nomeEtapa(etapas, venda.status_funil);
  const categoria = categoriaServico(venda.servico_nome);
  const vendedoras = normalizarVendedorasVenda(venda);
  const vendedoraGrupo = grupo?.vendedora_id
    ? vendedoras.find(item => Number(item.id) === Number(grupo.vendedora_id))
    : null;
  const valorTotal = grupo ? Number(grupo.valor_total || 0) : Number(venda.valor_total || 0);

  return {
    id: venda.id,
    razao_social: valorTexto(venda.razao_social || venda.cliente_razao_social || venda.nome || venda.cliente_nome),
    cnpj: valorTexto(venda.cnpj || venda.cliente_cnpj),
    classificacao_cliente: classificacaoClienteBasePlanilha(venda.cliente_da_base),
    cidade: valorTexto(venda.municipio),
    uf: valorTexto(venda.uf),
    quantidade,
    servico: valorTexto(venda.servico_nome),
    gigas: valorTexto(grupo?.gigas || venda.gb),
    categoria: categoria || 'outros',
    valor_total: Number(valorTotal.toFixed(2)),
    novo: chipsNovos,
    portabilidade: chipsPortabilidade,
    vendedora: vendedoraGrupo?.nome || vendedoras.map(item => item.nome).join(' / ') || valorTexto(venda.vendedora_nome),
    operadora: valorTexto(grupo?.operadora_nome || venda.operadora_nome),
    data_venda: dataParaExcel(venda.data_venda || venda.created_at),
    data_input: dataParaExcel(venda.criado_em || venda.created_at),
    data_ativacao: dataParaExcel(venda.data_ativacao),
    status,
    status_funil: valorTexto(venda.status_funil),
    etapa_final: venda.status_funil === statusFinal ? 'Sim' : 'Não',
    protocolo: valorTexto(venda.protocolo),
    numero_cliente_contrato: valorTexto(venda.numero_cliente_contrato),
    telefone: valorTexto(venda.telefone),
    email: valorTexto(venda.email),
    representante_legal: valorTexto(venda.nome_representante_legal),
    administrador: valorTexto(venda.nome_administrador),
    numeros_portados: valorTexto(venda.numeros_portados),
    numeros_ativados: valorTexto(venda.numeros_ativados),
    promessa_cliente: valorTexto(venda.promessa_cliente),
    promessa_cumprida: valorTexto(venda.promessa_cumprida),
    observacoes: valorTexto(venda.observacoes),
    motivo_retorno: valorTexto(venda.motivo_retorno)
  };
}

/**
 * Monta linhas exportacao venda a partir dos dados informados.
 */
function montarLinhasExportacaoVenda(venda, etapas = [], statusFinal = STATUS_FINAL_FALLBACK) {
  const chips = parseChips(venda.valores_unitarios_chips);

  if (chips.length === 0) {
    return [montarLinhaExportacaoVenda(venda, etapas, statusFinal)];
  }

  const grupos = new Map();
  chips.forEach(chip => {
    const operadoraId = chip.operadora_id ? Number(chip.operadora_id) : (venda.operadora_id ? Number(venda.operadora_id) : null);
    const chaveVendedora = chip.vendedora_id ? String(chip.vendedora_id) : 'sem_vendedora';
    const chave = `${chaveVendedora}:${operadoraId ?? 'sem_operadora'}`;
    const atual = grupos.get(chave) || {
      vendedora_id: chip.vendedora_id || null,
      operadora_id: operadoraId,
      operadora_nome: chip.operadora_nome || (Number(venda.operadora_id) === operadoraId ? venda.operadora_nome : null),
      quantidade: 0,
      valor_total: 0,
      novo: 0,
      portabilidade: 0,
      gigasSet: new Set()
    };
    const quantidade = Number(chip.quantidade || 0);
    const tipoLinha = chip.tipo_linha === 'portabilidade' ? 'portabilidade' : 'novo';

    atual.quantidade += quantidade;
    atual.valor_total += quantidade * Number(chip.valor_unitario || 0);
    atual.novo += tipoLinha === 'novo' ? quantidade : 0;
    atual.portabilidade += tipoLinha === 'portabilidade' ? quantidade : 0;
    if (chip.gb) atual.gigasSet.add(chip.gb);
    grupos.set(chave, atual);
  });

  return Array.from(grupos.values()).map(grupo => montarLinhaExportacaoVenda(venda, etapas, statusFinal, {
    ...grupo,
    valor_total: Number(grupo.valor_total.toFixed(2)),
    gigas: Array.from(grupo.gigasSet).join(', ')
  }));
}

/**
 * Aplica estilo cabecalho sobre a consulta ou conjunto informado.
 */
function aplicarEstiloCabecalho(worksheet) {
  const header = worksheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F2937' }
  };
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  header.height = 26;
  header.eachCell(cell => {
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
    };
  });
}

/**
 * Aplica estilo planilha sobre a consulta ou conjunto informado.
 */
function aplicarEstiloPlanilha(worksheet) {
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: worksheet.columnCount }
  };
  aplicarEstiloCabecalho(worksheet);

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.eachCell(cell => {
      cell.alignment = { vertical: 'middle', wrapText: false };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
      };
    });
  });
}

/** Retorna a definicao ordenada das colunas da exportacao de vendas do periodo. */
function montarColunasXlsxVendasPeriodo() {
  return [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'RAZAO SOCIAL', key: 'razao_social', width: 34 },
    { header: 'CNPJ', key: 'cnpj', width: 20 },
    { header: 'CLASSIFICAÇÃO DO CLIENTE', key: 'classificacao_cliente', width: 26 },
    { header: 'CIDADE', key: 'cidade', width: 18 },
    { header: 'UF', key: 'uf', width: 8 },
    { header: 'QUANTIDADE', key: 'quantidade', width: 13, style: { numFmt: FORMATO_INTEIRO_BR } },
    { header: 'SERVICO', key: 'servico', width: 18 },
    { header: 'GIGAS', key: 'gigas', width: 14 },
    { header: 'CATEGORIA', key: 'categoria', width: 14 },
    { header: 'VALOR TOTAL', key: 'valor_total', width: 14, style: { numFmt: FORMATO_MOEDA_BR } },
    { header: 'NOVO', key: 'novo', width: 10, style: { numFmt: FORMATO_INTEIRO_BR } },
    { header: 'PORTABILIDADE', key: 'portabilidade', width: 16, style: { numFmt: FORMATO_INTEIRO_BR } },
    { header: 'VENDEDORA', key: 'vendedora', width: 22 },
    { header: 'OPERADORA', key: 'operadora', width: 18 },
    { header: 'DATA DA VENDA', key: 'data_venda', width: 16 },
    { header: 'DATA INPUT', key: 'data_input', width: 16 },
    { header: 'DATA ATIVACAO', key: 'data_ativacao', width: 16 },
    { header: 'STATUS', key: 'status', width: 20 },
    { header: 'CODIGO STATUS', key: 'status_funil', width: 16 },
    { header: 'ETAPA FINAL', key: 'etapa_final', width: 13 },
    { header: 'PROTOCOLO', key: 'protocolo', width: 18 },
    { header: 'CLIENTE/CONTRATO', key: 'numero_cliente_contrato', width: 20 },
    { header: 'TELEFONE', key: 'telefone', width: 18 },
    { header: 'EMAIL', key: 'email', width: 28 },
    { header: 'REPRESENTANTE LEGAL', key: 'representante_legal', width: 26 },
    { header: 'ADMINISTRADOR', key: 'administrador', width: 24 },
    { header: 'NUMEROS PORTADOS', key: 'numeros_portados', width: 28 },
    { header: 'NUMEROS ATIVADOS', key: 'numeros_ativados', width: 28 },
    { header: 'PROMESSA CLIENTE', key: 'promessa_cliente', width: 26 },
    { header: 'PROMESSA CUMPRIDA', key: 'promessa_cumprida', width: 18 },
    { header: 'OBS', key: 'observacoes', width: 34 },
    { header: 'MOTIVO RETORNO', key: 'motivo_retorno', width: 28 }
  ];
}

/**
 * Gera xlsx vendas periodo a partir dos dados informados.
 */
async function gerarXlsxVendasPeriodo(filtros = {}) {
  const { vendas, statusFinal } = await carregarVendasNoPeriodo(filtros, 'registro', { incluirRetornos: true });
  const etapas = [
    ...(await listarEtapasPainel()),
    { codigo: 'retorno', nome: 'Retorno', etapa_final: false }
  ];
  const inicio = normalizarData(filtros.data_inicio);
  const fim = normalizarData(filtros.data_fim);
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Vendas');

  workbook.creator = 'Sistema Pos Venda';
  workbook.created = new Date();

  worksheet.columns = montarColunasXlsxVendasPeriodo();

  vendas
    .flatMap(venda => montarLinhasExportacaoVenda(venda, etapas, statusFinal))
    .sort((a, b) => (a.data_venda?.getTime?.() || 0) - (b.data_venda?.getTime?.() || 0) || Number(a.id) - Number(b.id))
    .forEach(linha => worksheet.addRow(linha));

  aplicarEstiloPlanilha(worksheet);

  worksheet.getColumn('valor_total').numFmt = FORMATO_MOEDA_BR;
  ['quantidade', 'novo', 'portabilidade'].forEach(key => {
    worksheet.getColumn(key).numFmt = FORMATO_INTEIRO_BR;
  });
  ['data_venda', 'data_input', 'data_ativacao'].forEach(key => {
    worksheet.getColumn(key).numFmt = 'dd/mm/yyyy';
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const nome = `vendas-${nomeArquivoSeguro(inicio || 'inicio')}-a-${nomeArquivoSeguro(fim || 'fim')}.xlsx`;

  return { buffer, nome };
}

module.exports = {
  obterResumo,
  obterDetalhes,
  obterDetalhesChips,
  obterDossieVenda,
  gerarXlsxVendasPeriodo,
  _internals: {
    agregarPorOperadora,
    categoriaPainel,
    categoriaServico,
    classificarSecao,
    encontrarRegraComissao,
    extrairNumerosGigas,
    filtrarPorSecao,
    formatarGigas,
    gigasUnitarios,
    labelCategoriaPainel,
    montarLinhaChip,
    montarLinhaExportacaoVenda,
    montarLinhasExportacaoVenda,
    montarLinhasChips,
    montarColunasXlsxVendasPeriodo,
    montarRegraComissaoResumo,
    montarRespostaLinhasChips,
    montarVendaResumo,
    nomeArquivoSeguro,
    normalizarData,
    normalizarServicoNome,
    normalizarVendedorasVenda,
    parseChips,
    parseNumerosLinha,
    quantidadeChipsPorTipo,
    quantidadeChipsVenda,
    tipoVendaNormalizado,
    vendaTeveRetorno,
    vendaTeveRetornoCorrigido
  }
};
