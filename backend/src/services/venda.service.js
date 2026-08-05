/**
 * Servico principal de vendas, funil, relatorios, importacoes e pos-venda.
 */
const Venda = require('../models/Venda');
const VendaHistorico = require('../models/VendaHistorico');
const Usuario = require('../models/Usuario');
const FunilEtapa = require('../models/FunilEtapa');
const Cliente = require('../models/Cliente');
const ClienteOperadora = require('../models/ClienteOperadora');
const clienteService = require('./cliente.service');
const vendaArquivoService = require('./venda-arquivo.service');
const vendaNotificacaoParadaService = require('./venda-notificacao-parada.service');
const vendaNotificacaoRetornoService = require('./venda-notificacao-retorno.service');
const vendaNotificacaoCancelamentoService = require('./venda-notificacao-cancelamento.service');
const vendaAprovacaoService = require('./venda-aprovacao.service');
const notificacaoService = require('./notificacao.service');
const { renderEmailVenda } = require('./venda-email-template.service');
const dashboardIntegracaoService = require('./dashboard-integracao.service');
const telegramService = require('./telegram.service');
const { parseUtcDateTime } = require('../utils/datetime');
const { listarPermissoesEfetivas, usuarioTemPermissaoLocal } = require('../utils/permissoes');
const ExcelJS = require('exceljs');

const CAMPOS = [
  'nome',
  'telefone',
  'email',
  'email_2',
  'nome_representante_legal',
  'fixo_ddd',
  'nome_fechou_venda',
  'cpf_representante_legal',
  'setor_funcao',
  'produto_fechado',
  'tipo_venda_id',
  'servico_id',
  'quantidade_linhas',
  'ddd',
  'numeros_portados',
  'numeros_ativados',
  'gb',
  'valores_unitarios_chips',
  'cliente_da_base',
  'possui_doc_na_casa',
  'cliente_solicitou_servicos',
  'cliente_solicitou_bloqueio_qtd',
  'cliente_solicitou_cancelamento_qtd',
  'cliente_solicitou_numeros',
  'cliente_solicitou_resolvido',
  'cliente_solicitou_resolvido_em',
  'cliente_solicitou_protocolo_atendimento',
  'cliente_solicitou_observacao',
  'ponto_referencia',
  'tipo_local_cpf',
  'razao_social',
  'cnpj',
  'data_venda',
  'data_ativacao',
  'qc_feito_por',
  'promessa_cliente',
  'promessa_cumprida',
  'observacoes',
  'cliente_id',
  'dia_vencimento',
  'endereco',
  'numero_endereco',
  'complemento',
  'bairro',
  'municipio',
  'uf',
  'cep',
  'endereco_real_divergente',
  'cep_real',
  'endereco_real',
  'numero_endereco_real',
  'complemento_real',
  'bairro_real',
  'municipio_real',
  'uf_real',
  'horario_aceite_voz',
  'horario_aceite_inicio',
  'horario_aceite_fim',
  'dia_aceite_inicio',
  'dia_aceite_fim',
  'dia_aceite_fixo',
  'horario_aceite_fixo',
  'responsavel_recebimento',
  'rg_responsavel_recebimento',
  'responsavel_recebimento_2',
  'rg_responsavel_recebimento_2',
  'responsavel_recebimento_3',
  'rg_responsavel_recebimento_3',
  'nome_administrador',
  'cpf_administrador',
  'rg_administrador',
  'data_nascimento_administrador',
  'email_representante_legal',
  'telefone_representante_legal',
  'rg_representante_legal',
  'data_nascimento_representante_legal',
  'email_administrador',
  'telefone_administrador',
  'protocolo',
  'login',
  'senha',
  'numero_cliente_contrato',
  'operadora_id',
  'operadora_atual_id',
  'vendedora_id',
  'status_funil',
  'prioridade_funil',
  'status_anterior_retorno',
  'motivo_retorno',
  'nota_correcao_retorno',
  'retornou_em',
  'corrigido_em'
];

const FUNIL_STATUS = ['aprovacao', 'ativacao', 'envio', 'entrega', 'confirmacao', 'concluido', 'retorno'];
const STATUS_CANCELADA_FILTRO = '__cancelada';

const FUNIL_STATUS_LABELS = {
  aprovacao: 'Aprovacao',
  ativacao: 'Ativacao',
  envio: 'Envio / Logistica',
  entrega: 'Entrega',
  confirmacao: 'Confirmacao do cliente',
  concluido: 'Concluido',
  retorno: 'Retorno recebido'
};

const PERMISSAO_AUTO_POS_VENDA = 'vendas_auto_pos_venda';
const PERMISSAO_LIMITAR_VENDAS_ULTIMOS_6_MESES = 'vendas_limitar_ultimos_6_meses';
const MESES_LIMITE_VENDAS_RECENTES = 6;
const DIAS_OCULTAR_CONCLUIDAS_FUNIL = 14;
const FUNIL_PRIORIDADES = ['alta', 'media', 'baixa'];
const PROMESSA_CUMPRIDA_OPCOES = ['pendente', 'sim', 'nao'];
const CLIENTE_SOLICITOU_RESOLVIDO_OPCOES = ['sim', 'nao'];

/**
 * Limpa valor e restaura o estado inicial.
 */
function limparValor(valor) {
  if (valor === undefined) return undefined;
  if (valor === '') return null;
  return valor;
}

/**
 * Normaliza ids filtro para uso interno consistente.
 */
function normalizarIdsFiltro(valor) {
  const valores = Array.isArray(valor) ? valor : String(valor || '').split(',');
  return Array.from(new Set(
    valores
      .map(item => Number(item))
      .filter(item => Number.isInteger(item) && item > 0)
  ));
}

/**
 * Obtem tipo linha por nome tipo venda a partir dos dados informados.
 */
function obterTipoLinhaPorNomeTipoVenda(nome) {
  const texto = normalizarTextoBusca(nome);
  if (texto.includes('porta')) return 'portabilidade';
  if (texto.includes('novo')) return 'novo';
  return '';
}

/**
 * Obtem tipo linha filtro tipo venda a partir dos dados informados.
 */
async function obterTipoLinhaFiltroTipoVenda(tipoVendaId) {
  const id = Number(tipoVendaId);
  if (!Number.isInteger(id) || id <= 0) return '';

  const tipoVenda = await Venda.knex()('tipos_venda')
    .select('nome')
    .where('id', id)
    .first();

  return obterTipoLinhaPorNomeTipoVenda(tipoVenda?.nome);
}

/**
 * Aplica filtro tipo linha chips sobre a consulta ou conjunto informado.
 */
function aplicarFiltroTipoLinhaChips(builder, tipoLinha) {
  const coluna = "REPLACE(COALESCE(valores_unitarios_chips, ''), ' ', '')";
  const tipo = String(tipoLinha || '').trim();

  builder
    .orWhereRaw(`${coluna} like ?`, [`%"tipo_linha":"${tipo}"%`])
    .orWhereRaw(`${coluna} like ?`, [`%"tipo":"${tipo}"%`])
    .orWhereRaw(`${coluna} like ?`, [`%"categoria":"${tipo}"%`]);
}

/**
 * Aplica filtro tipo venda sobre a consulta ou conjunto informado.
 */
async function aplicarFiltroTipoVenda(query, tipoVendaId) {
  const id = Number(tipoVendaId);
  if (!Number.isInteger(id) || id <= 0) return;

  const tipoLinhaFallback = await obterTipoLinhaFiltroTipoVenda(id);

  query.where(builder => {
    builder.where('tipo_venda_id', id);

    if (!tipoLinhaFallback) return;

    builder.orWhere(fallbackBuilder => {
      fallbackBuilder.whereNull('tipo_venda_id');
      fallbackBuilder.where(chipsBuilder => {
        aplicarFiltroTipoLinhaChips(chipsBuilder, tipoLinhaFallback);

        if (tipoLinhaFallback === 'novo') {
          chipsBuilder
            .orWhereNull('valores_unitarios_chips')
            .orWhere('valores_unitarios_chips', '');
        }
      });
    });
  });
}

/**
 * Processa apenas digitos conforme as regras do dominio.
 */
function apenasDigitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}

/**
 * Processa sql somente digitos conforme as regras do dominio.
 */
function sqlSomenteDigitos(coluna) {
  return `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${coluna}, '.', ''), '/', ''), '-', ''), '(', ''), ')', ''), ' ', '')`;
}

/**
 * Aplica busca geral vendas sobre a consulta ou conjunto informado.
 */
function aplicarBuscaGeralVendas(query, valor) {
  const busca = `%${String(valor || '').trim()}%`;
  const digitos = apenasDigitos(valor);

  if (!String(valor || '').trim()) return;

  query.where((builder) => {
    builder
      .where('nome', 'like', busca)
      .orWhere('telefone', 'like', busca)
      .orWhere('email', 'like', busca)
      .orWhere('produto_fechado', 'like', busca)
      .orWhere('razao_social', 'like', busca)
      .orWhere('cnpj', 'like', busca)
      .orWhere('protocolo', 'like', busca)
      .orWhere('municipio', 'like', busca)
      .orWhereExists(
        Venda.knex()
          .select(1)
          .from('clientes as c_busca')
          .whereRaw('c_busca.id = vendas.cliente_id')
          .where((clienteBuilder) => {
            clienteBuilder
              .where('c_busca.nome', 'like', busca)
              .orWhere('c_busca.razao_social', 'like', busca)
              .orWhere('c_busca.cnpj', 'like', busca);

            if (digitos) {
              clienteBuilder.orWhereRaw(`${sqlSomenteDigitos('c_busca.cnpj')} like ?`, [`%${digitos}%`]);
            }
          })
      )
      .orWhereExists(
        Venda.knex()
          .select(1)
          .from('tipos_venda as tv_busca')
          .whereRaw('tv_busca.id = vendas.tipo_venda_id')
          .where('tv_busca.nome', 'like', busca)
      )
      .orWhereExists(
        Venda.knex()
          .select(1)
          .from('servicos as s_busca')
          .whereRaw('s_busca.id = vendas.servico_id')
          .where('s_busca.nome', 'like', busca)
      )
      .orWhereExists(
        Venda.knex()
          .select(1)
          .from('usuarios as u_busca')
          .whereRaw('u_busca.id = vendas.vendedora_id')
          .where('u_busca.nome', 'like', busca)
      )
      .orWhereExists(
        Venda.knex()
          .select(1)
          .from('venda_vendedoras as vv_busca')
          .join('usuarios as uvv_busca', 'uvv_busca.id', 'vv_busca.usuario_id')
          .whereRaw('vv_busca.venda_id = vendas.id')
          .where('uvv_busca.nome', 'like', busca)
      );

    if (digitos) {
      builder
        .orWhereRaw(`${sqlSomenteDigitos('telefone')} like ?`, [`%${digitos}%`])
        .orWhereRaw(`${sqlSomenteDigitos('cnpj')} like ?`, [`%${digitos}%`])
        .orWhereRaw(`${sqlSomenteDigitos('cliente_excluido_permanentemente_cnpj')} like ?`, [`%${digitos}%`])
        .orWhereRaw(`${sqlSomenteDigitos('protocolo')} like ?`, [`%${digitos}%`]);
    }
  });
}

/**
 * Aplica busca campo vendas sobre a consulta ou conjunto informado.
 */
async function aplicarBuscaCampoVendas(query, filtros = {}) {
  const campo = String(filtros.busca_campo || '').trim();
  const valor = String(filtros.busca_valor || '').trim();

  if (!campo || !valor) return;

  if (campo === 'protocolo') {
    const digitos = apenasDigitos(valor);
    if (!digitos) return;

    query.whereRaw(`${sqlSomenteDigitos('protocolo')} like ?`, [`%${digitos}%`]);
    return;
  }

  if (campo === 'cliente') {
    query.where(builder => {
      builder
        .where('nome', 'like', `%${valor}%`)
        .orWhere('razao_social', 'like', `%${valor}%`)
        .orWhere('cliente_excluido_permanentemente_nome', 'like', `%${valor}%`)
        .orWhereExists(
          Venda.knex()
            .select(1)
            .from('clientes as c_campo')
            .whereRaw('c_campo.id = vendas.cliente_id')
            .where(campoBuilder => {
              campoBuilder
                .where('c_campo.nome', 'like', `%${valor}%`)
                .orWhere('c_campo.razao_social', 'like', `%${valor}%`);
            })
        );
    });
    return;
  }

  if (campo === 'telefone') {
    const digitos = apenasDigitos(valor);
    if (!digitos) return;

    query.whereRaw(`${sqlSomenteDigitos('telefone')} like ?`, [`%${digitos}%`]);
    return;
  }

  if (campo === 'cnpj') {
    const digitos = apenasDigitos(valor);
    if (!digitos) return;

    query.where(builder => {
      builder
        .whereRaw(`${sqlSomenteDigitos('cnpj')} like ?`, [`%${digitos}%`])
        .orWhereRaw(`${sqlSomenteDigitos('cliente_excluido_permanentemente_cnpj')} like ?`, [`%${digitos}%`])
        .orWhereExists(
          Venda.knex()
            .select(1)
            .from('clientes as c_cnpj')
            .whereRaw('c_cnpj.id = vendas.cliente_id')
            .whereRaw(`${sqlSomenteDigitos('c_cnpj.cnpj')} like ?`, [`%${digitos}%`])
        );
    });
    return;
  }

  if (campo === 'cidade') {
    query.where('municipio', 'like', `%${valor}%`);
    return;
  }

  if (campo === 'tipo_venda') {
    const ids = normalizarIdsFiltro(valor);
    if (ids.length === 1) await aplicarFiltroTipoVenda(query, ids[0]);
    return;
  }

  if (campo === 'produto') {
    const ids = normalizarIdsFiltro(valor);
    if (ids.length === 1) {
      query.where('servico_id', ids[0]);
    } else if (ids.length > 1) {
      query.whereIn('servico_id', ids);
    }
  }
}

/**
 * Normaliza data para uso interno consistente.
 */
function normalizarData(valor) {
  if (!valor) return null;

  const texto = valor instanceof Date
    ? [
        valor.getFullYear(),
        String(valor.getMonth() + 1).padStart(2, '0'),
        String(valor.getDate()).padStart(2, '0')
      ].join('-')
    : String(valor).trim();
  const textoISO = texto.slice(0, 10);
  const dataISO = textoISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const match = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);

  if (dataISO) {
    const [, ano, mes, dia] = dataISO;
    const data = new Date(`${ano}-${mes}-${dia}T00:00:00`);
    const dataValida = data.getFullYear() === Number(ano)
      && data.getMonth() + 1 === Number(mes)
      && data.getDate() === Number(dia);

    return dataValida && Number(ano) >= 1900 ? textoISO : null;
  }

  if (!match) return null;

  const [, dia, mes, ano] = match;
  const anoCompleto = ano.length === 2 ? `20${ano}` : ano;
  const data = new Date(`${anoCompleto}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}T00:00:00`);
  const dataValida = data.getFullYear() === Number(anoCompleto)
    && data.getMonth() + 1 === Number(mes)
    && data.getDate() === Number(dia);

  if (!dataValida || Number(anoCompleto) < 1900) {
    return null;
  }

  return `${anoCompleto}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
}

/**
 * Retorna a data atual no fuso horario operacional do CRM.
 */
function obterDataAtualSaoPaulo(data = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(data);
  const valores = Object.fromEntries(partes.map(({ type, value }) => [type, value]));
  return `${valores.year}-${valores.month}-${valores.day}`;
}

/**
 * Impede o cadastro de vendas em uma data posterior ao dia atual.
 */
function validarDataVendaNaoFutura(dataVenda, agora = new Date()) {
  if (!dataVenda || dataVenda <= obterDataAtualSaoPaulo(agora)) {
    return;
  }

  const error = new Error('A data da venda não pode ser futura.');
  error.statusCode = 400;
  throw error;
}

/**
 * Vendas com data anterior a mais de dois dias nao devem gerar aviso no Telegram.
 * Datas futuras ou ausentes permanecem notificaveis.
 */
function vendaDeveNotificarTelegram(venda, agora = new Date()) {
  const dataVenda = normalizarData(venda?.data_venda);
  if (!dataVenda) return true;

  const hoje = obterDataAtualSaoPaulo(agora);
  const inicioHoje = Date.parse(`${hoje}T00:00:00Z`);
  const inicioDataVenda = Date.parse(`${dataVenda}T00:00:00Z`);
  const diferencaEmDias = (inicioHoje - inicioDataVenda) / (24 * 60 * 60 * 1000);

  return diferencaEmDias <= 2;
}

/**
 * Formata date time sql para exibicao ou envio.
 */
function formatarDateTimeSQL(data = new Date()) {
  /**
   * Preenche valores numericos com zero a esquerda.
   */
  const pad = (value) => String(value).padStart(2, '0');

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
 * Monta dados historico a partir dos dados informados.
 */
function montarDadosHistorico(dados = {}) {
  return JSON.stringify(dados);
}

/**
 * Registra historico venda no historico ou log.
 */
async function registrarHistoricoVenda({
  vendaId,
  usuarioId,
  acao,
  statusAnterior = null,
  statusNovo = null,
  observacao = null,
  dados = {},
  createdAt = formatarDateTimeSQL(),
  trx
}) {
  return VendaHistorico.query(trx).insert({
    venda_id: Number(vendaId),
    usuario_id: usuarioId ? Number(usuarioId) : null,
    acao,
    status_anterior: statusAnterior,
    status_novo: statusNovo,
    observacao,
    dados: montarDadosHistorico(dados),
    created_at: createdAt
  });
}

/**
 * Copia notas cliente para venda para o destino esperado.
 */
async function copiarNotasClienteParaVenda({ clienteId, vendaId, createdAt, trx }) {
  if (!clienteId || !vendaId) return 0;

  const notasCliente = await trx('entidade_notas')
    .where({
      entidade_tipo: 'cliente',
      entidade_id: Number(clienteId)
    })
    .select('usuario_id', 'titulo', 'conteudo');

  if (notasCliente.length === 0) {
    return 0;
  }

  await trx('entidade_notas').insert(notasCliente.map(nota => ({
    entidade_tipo: 'venda',
    entidade_id: Number(vendaId),
    usuario_id: nota.usuario_id,
    titulo: nota.titulo,
    conteudo: nota.conteudo,
    created_at: createdAt,
    updated_at: createdAt
  })));

  return notasCliente.length;
}

/**
 * Converte valor monetario para o formato interno esperado.
 */
function parseValorMonetario(valor) {
  if (valor === undefined || valor === null || valor === '') return 0;

  if (typeof valor === 'number') {
    return valor;
  }

  const texto = String(valor)
    .replace(/\s/g, '')
    .replace(/^R\$/i, '');

  if (texto.includes(',')) {
    return Number(texto.replace(/\./g, '').replace(',', '.')) || 0;
  }

  return Number(texto) || 0;
}

/**
 * Normaliza gigas para uso interno consistente.
 */
function normalizarGigas(valor) {
  return String(valor || '').replace(/\D/g, '').slice(0, 4);
}

/**
 * Normaliza tipo linha chip para uso interno consistente.
 */
function normalizarTipoLinhaChip(valor) {
  const texto = String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  return texto.includes('porta') ? 'portabilidade' : 'novo';
}

/**
 * Normaliza texto busca para uso interno consistente.
 */
function normalizarTextoBusca(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Normaliza itens chips para uso interno consistente.
 */
function normalizarItensChips(valor) {
  if (!valor) return [];

  if (Array.isArray(valor)) {
    return valor
      .map(item => ({
        quantidade: Number(item.quantidade || 0),
        gb: normalizarGigas(item.gb),
        tipo_linha: normalizarTipoLinhaChip(item.tipo_linha || item.tipo || item.categoria),
        valor_unitario: parseValorMonetario(item.valor_unitario),
        ...(item.operadora_atual_id ? { operadora_atual_id: Number(item.operadora_atual_id) } : {}),
        ...(item.operadora_atual_nome ? { operadora_atual_nome: String(item.operadora_atual_nome).trim() } : {}),
        ...(item.operadora_id ? { operadora_id: Number(item.operadora_id) } : {}),
        ...(item.operadora_nome ? { operadora_nome: String(item.operadora_nome).trim() } : {}),
        ...(item.vendedora_id ? { vendedora_id: Number(item.vendedora_id) } : {})
      }))
      .filter(item => item.quantidade > 0 && item.valor_unitario > 0);
  }

  if (typeof valor === 'string') {
    try {
      const parsed = JSON.parse(valor);
      return normalizarItensChips(parsed);
    } catch {
      return valor
        .split(/\r?\n/)
        .map(linha => linha.trim())
        .filter(Boolean)
        .map(linha => {
          const match = linha.match(/^(\d+)\s*x\s*([\d.,]+)$/i);

          if (!match) return null;

          return {
            quantidade: Number(match[1]),
            gb: '',
            tipo_linha: 'novo',
            valor_unitario: parseValorMonetario(match[2])
          };
        })
        .filter(Boolean);
    }
  }

  return [];
}

/**
 * Calcula total chips com base nos valores informados.
 */
function calcularTotalChips(itens) {
  const total = itens.reduce((acc, item) => {
    return acc + (Number(item.quantidade || 0) * Number(item.valor_unitario || 0));
  }, 0);

  return Number(total.toFixed(2));
}

/**
 * Soma quantidade itens chips considerando os dados informados.
 */
function somarQuantidadeItensChips(itens) {
  return itens.reduce((acc, item) => acc + Number(item.quantidade || 0), 0);
}

/**
 * Resume gigas itens chips para exibicao ou envio.
 */
function resumirGigasItensChips(itens) {
  return Array.from(new Set(
    itens
      .map(item => normalizarGigas(item.gb))
      .filter(Boolean)
  )).join(', ');
}

/**
 * Normaliza ids vendedoras para uso interno consistente.
 */
function normalizarIdsVendedoras(vendedoras) {
  if (!Array.isArray(vendedoras)) return [];

  return Array.from(new Set(
    vendedoras
      .map(item => {
        if (item && typeof item === 'object') {
          return Number(item.id || item.usuario_id || item.vendedora_id);
        }

        return Number(item);
      })
      .filter(Number.isInteger)
      .filter(id => id > 0)
  ));
}

/**
 * Valida vendedoras nos chips e retorna o resultado esperado.
 */
function validarVendedorasNosChips(payload, vendedorasIds = []) {
  if (vendedorasIds.length <= 1) return;
  if (payload.valores_unitarios_chips === undefined) return;

  const itens = normalizarItensChips(payload.valores_unitarios_chips);
  const vendedorasSet = new Set(vendedorasIds.map(id => Number(id)));
  const usadas = new Set();

  itens.forEach(item => {
    if (!item.vendedora_id) return;
    if (!vendedorasSet.has(Number(item.vendedora_id))) {
      throw new Error('Cada chip deve ser atribuido a uma das vendedoras selecionadas na venda.');
    }
    usadas.add(Number(item.vendedora_id));
  });

  const faltantes = vendedorasIds.filter(id => !usadas.has(Number(id)));

  if (faltantes.length > 0) {
    throw new Error('Atribua pelo menos um chip para cada vendedora da venda.');
  }
}

/**
 * Verifica se conjuntos iguais atende a condicao esperada.
 */
function conjuntosIguais(a = [], b = []) {
  const setA = new Set(a.map(Number));
  const setB = new Set(b.map(Number));

  if (setA.size !== setB.size) return false;
  return Array.from(setA).every(item => setB.has(item));
}

/**
 * Valida permissao compartilhar venda e retorna o resultado esperado.
 */
async function validarPermissaoCompartilharVenda({ usuarioId, vendedorasIds = [], vendaId = null }) {
  if (!Array.isArray(vendedorasIds)) return;

  // Liberdade total: pode atribuir qualquer vendedor e se excluir da venda
  const podeAtribuirQualquer = await usuarioTemPermissao(usuarioId, 'vendas_atribuir_qualquer_vendedor');
  if (podeAtribuirQualquer) return;

  if (vendaId) {
    const atuais = await Venda.knex()('venda_vendedoras')
      .where('venda_id', vendaId)
      .pluck('usuario_id');

    if (conjuntosIguais(atuais, vendedorasIds)) {
      return;
    }
  }

  const idsDiferentesDoUsuario = vendedorasIds.filter(id => Number(id) !== Number(usuarioId));

  if (idsDiferentesDoUsuario.length === 0) return;

  const podeCompartilhar = await usuarioTemPermissao(usuarioId, 'compartilhar_venda');
  if (!podeCompartilhar) {
    const error = new Error('Você não tem permissão para compartilhar vendas com outras vendedoras.');
    error.statusCode = 403;
    throw error;
  }

  // compartilhar_venda: pode adicionar outros, mas deve se manter na venda
  const incluiSiMesmo = vendedorasIds.some(id => Number(id) === Number(usuarioId));
  if (!incluiSiMesmo) {
    const error = new Error('Você precisa da permissão "Atribuir qualquer vendedor" para registrar vendas sem se incluir.');
    error.statusCode = 403;
    throw error;
  }
}

const CLIENTE_SOLICITOU_SERVICOS = ['bloqueio', 'cancelamento', 'nenhum_servico'];
const CLIENTE_SOLICITOU_ACOES = ['bloqueio', 'cancelamento'];

/**
 * Normaliza cliente solicitou servicos para uso interno consistente.
 */
function normalizarClienteSolicitouServicos(valor) {
  if (!valor) return [];

  let lista = valor;

  if (typeof valor === 'string') {
    try {
      lista = JSON.parse(valor);
    } catch {
      lista = valor.split(/\r?\n|[,;]/);
    }
  }

  if (!Array.isArray(lista)) return [];

  const servicos = lista
    .map(item => String(item || '').trim())
    .filter(item => CLIENTE_SOLICITOU_SERVICOS.includes(item));

  return servicos.includes('nenhum_servico')
    ? ['nenhum_servico']
    : CLIENTE_SOLICITOU_ACOES.filter(item => servicos.includes(item));
}

/**
 * Valida campos obrigatorios cadastro venda e retorna o resultado esperado.
 */
function validarCamposObrigatoriosCadastroVenda(payload, dados) {
  if (!Number.isInteger(payload.cliente_id) || payload.cliente_id <= 0) {
    throw new Error('Selecione um cliente para cadastrar a venda.');
  }

  if (!Number.isInteger(payload.operadora_id) || payload.operadora_id <= 0) {
    throw new Error('Selecione a operadora para cadastrar a venda.');
  }

  if (!Number.isInteger(payload.servico_id) || payload.servico_id <= 0) {
    throw new Error('Selecione o produto para cadastrar a venda.');
  }

  if (normalizarClienteSolicitouServicos(dados.cliente_solicitou_servicos).length === 0) {
    throw new Error('Informe o que o cliente solicitou (Bloqueio, Cancelamento ou Nenhum serviço).');
  }
}

/**
 * Normaliza numeros lista para uso interno consistente.
 */
function normalizarNumerosLista(valor) {
  if (!valor) return [];

  let lista = valor;

  if (typeof valor === 'string') {
    try {
      lista = JSON.parse(valor);
    } catch {
      lista = valor.split(/\r?\n|[,;]/);
    }
  }

  if (!Array.isArray(lista)) return [];

  return lista
    .map(item => String(item || '').trim())
    .filter(item => item.replace(/\D/g, '').length > 2);
}

/**
 * Normaliza cliente solicitou numeros para uso interno consistente.
 */
function normalizarClienteSolicitouNumeros(valor) {
  if (!valor) return { bloqueio: [], cancelamento: [] };

  let dados = valor;

  if (typeof valor === 'string') {
    try {
      dados = JSON.parse(valor);
    } catch {
      return { bloqueio: [], cancelamento: [] };
    }
  }

  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    return { bloqueio: [], cancelamento: [] };
  }

  return {
    bloqueio: normalizarNumerosLista(dados.bloqueio),
    cancelamento: normalizarNumerosLista(dados.cancelamento)
  };
}

/**
 * Monta payload a partir dos dados informados.
 */
function montarPayload(dados) {
  const payload = {};

  CAMPOS.forEach((campo) => {
    const valor = limparValor(dados[campo]);

    if (valor !== undefined) {
      payload[campo] = valor;
    }
  });

  if (payload.nome !== undefined && payload.nome !== null) {
    payload.nome = String(payload.nome).trim();
  }

  if (payload.vendedora_id !== undefined && payload.vendedora_id !== null) {
    payload.vendedora_id = Number(payload.vendedora_id);
  }

  if (payload.operadora_id !== undefined && payload.operadora_id !== null) {
    payload.operadora_id = Number(payload.operadora_id);
  }

  if (payload.operadora_atual_id !== undefined && payload.operadora_atual_id !== null) {
    payload.operadora_atual_id = Number(payload.operadora_atual_id);
  }

  if (payload.cliente_id !== undefined && payload.cliente_id !== null) {
    payload.cliente_id = Number(payload.cliente_id);
  }

  if (payload.tipo_venda_id !== undefined && payload.tipo_venda_id !== null) {
    payload.tipo_venda_id = Number(payload.tipo_venda_id);
  }

  if (payload.servico_id !== undefined && payload.servico_id !== null) {
    payload.servico_id = Number(payload.servico_id);
  }

  if (payload.quantidade_linhas !== undefined && payload.quantidade_linhas !== null) {
    payload.quantidade_linhas = Number(payload.quantidade_linhas);
  }

  if (payload.dia_vencimento !== undefined && payload.dia_vencimento !== null) {
    payload.dia_vencimento = Number(payload.dia_vencimento);
  }

  if (payload.endereco_real_divergente !== undefined) {
    payload.endereco_real_divergente = Boolean(payload.endereco_real_divergente);
  }

  if (payload.cliente_da_base !== undefined && payload.cliente_da_base !== null) {
    payload.cliente_da_base = payload.cliente_da_base === true || Number(payload.cliente_da_base) === 1;
  }

  if (payload.possui_doc_na_casa !== undefined && payload.possui_doc_na_casa !== null) {
    payload.possui_doc_na_casa = payload.possui_doc_na_casa === true || Number(payload.possui_doc_na_casa) === 1;
  }

  if (payload.promessa_cumprida !== undefined && payload.promessa_cumprida !== null) {
    const valor = String(payload.promessa_cumprida || '').trim().toLowerCase();
    payload.promessa_cumprida = PROMESSA_CUMPRIDA_OPCOES.includes(valor) ? valor : null;
  }

  if (dados.cliente_solicitou_servicos !== undefined) {
    const servicos = normalizarClienteSolicitouServicos(dados.cliente_solicitou_servicos);
    const nenhumServico = servicos.includes('nenhum_servico');
    const numeros = normalizarClienteSolicitouNumeros(dados.cliente_solicitou_numeros);

    payload.cliente_solicitou_servicos = servicos.length > 0 ? JSON.stringify(servicos) : null;
    payload.cliente_solicitou_bloqueio_qtd = !nenhumServico && servicos.includes('bloqueio')
      ? Number(dados.cliente_solicitou_bloqueio_qtd || 0) || null
      : null;
    payload.cliente_solicitou_cancelamento_qtd = !nenhumServico && servicos.includes('cancelamento')
      ? Number(dados.cliente_solicitou_cancelamento_qtd || 0) || null
      : null;
    payload.cliente_solicitou_numeros = !nenhumServico && CLIENTE_SOLICITOU_ACOES.some(acao => servicos.includes(acao))
      ? JSON.stringify({
        bloqueio: servicos.includes('bloqueio') ? numeros.bloqueio : [],
        cancelamento: servicos.includes('cancelamento') ? numeros.cancelamento : []
      })
      : null;

    const resolvido = String(dados.cliente_solicitou_resolvido || '').trim().toLowerCase();
    const resolvidoValido = !nenhumServico && CLIENTE_SOLICITOU_RESOLVIDO_OPCOES.includes(resolvido);

    payload.cliente_solicitou_resolvido = resolvidoValido ? resolvido : null;
    payload.cliente_solicitou_resolvido_em = resolvidoValido && resolvido === 'sim'
      ? normalizarData(dados.cliente_solicitou_resolvido_em)
      : null;
    payload.cliente_solicitou_protocolo_atendimento = resolvidoValido && resolvido === 'sim'
      ? (String(dados.cliente_solicitou_protocolo_atendimento || '').trim() || null)
      : null;
    payload.cliente_solicitou_observacao = resolvidoValido && resolvido === 'sim'
      ? (String(dados.cliente_solicitou_observacao || '').trim() || null)
      : null;
  }

  const itensChips = normalizarItensChips(dados.valores_unitarios_chips);

  if (dados.valores_unitarios_chips !== undefined) {
    const quantidadeItens = somarQuantidadeItensChips(itensChips);
    const quantidadeLinhas = Number(payload.quantidade_linhas || dados.quantidade_linhas || 0);

    if (quantidadeLinhas > 0 && quantidadeItens > quantidadeLinhas) {
      throw new Error('A quantidade de chips nao pode ser maior que a quantidade de linhas fechadas.');
    }

    payload.valores_unitarios_chips = itensChips.length > 0 ? JSON.stringify(itensChips) : null;
    payload.valor_total = calcularTotalChips(itensChips);
    payload.gb = resumirGigasItensChips(itensChips) || payload.gb || null;
  }

  if (payload.data_venda !== undefined) {
    payload.data_venda = normalizarData(payload.data_venda);
  }

  if (payload.data_ativacao !== undefined) {
    payload.data_ativacao = normalizarData(payload.data_ativacao);
  }

  if (payload.numeros_ativados !== undefined && !payload.data_ativacao) {
    payload.numeros_ativados = null;
  }

  if (payload.prioridade_funil !== undefined) {
    const prioridadeNormalizada = String(payload.prioridade_funil || '').trim().toLowerCase();
    payload.prioridade_funil = FUNIL_PRIORIDADES.includes(prioridadeNormalizada)
      ? prioridadeNormalizada
      : 'media';
  }

  return payload;
}

/**
 * Aplica dados cliente na venda sobre a consulta ou conjunto informado.
 */
function aplicarDadosClienteNaVenda(payload, cliente) {
  if (!cliente) {
    return payload;
  }

  const telefoneWhatsapp = [cliente.whatsapp_ddd, cliente.whatsapp_numero]
    .filter(Boolean)
    .join('');
  const telefoneFixo = [cliente.fixo_ddd, cliente.fixo_numero]
    .filter(Boolean)
    .join('');
  const operadoraAtualId = resolverOperadoraAtualCliente(cliente, payload.operadora_id, payload.operadora_atual_id);

  // Quando o documento do cliente for um CPF (11 digitos), espelha no campo de CPF do responsavel.
  const documentoDigitos = String(cliente.cnpj || '').replace(/\D/g, '');
  const cpfDoCliente = documentoDigitos.length === 11 ? cliente.cnpj : null;

  return {
    ...payload,
    nome: payload.nome || cliente.nome,
    razao_social: payload.razao_social || cliente.razao_social,
    cnpj: payload.cnpj || cliente.cnpj,
    email: payload.email || cliente.email,
    telefone: payload.telefone || telefoneWhatsapp || null,
    fixo_ddd: payload.fixo_ddd || telefoneFixo || null,
    nome_representante_legal: payload.nome_representante_legal || (
      cliente.responsavel_tipo === 'rl' ? cliente.responsavel_nome : null
    ),
    cpf_representante_legal: payload.cpf_representante_legal || (
      cliente.responsavel_tipo === 'rl' ? cpfDoCliente : null
    ),
    email_representante_legal: payload.email_representante_legal || (
      cliente.responsavel_tipo === 'rl' ? cliente.email : null
    ),
    telefone_representante_legal: payload.telefone_representante_legal || (
      cliente.responsavel_tipo === 'rl' ? (telefoneWhatsapp || null) : null
    ),
    nome_administrador: payload.nome_administrador || (
      cliente.responsavel_tipo === 'adm' ? cliente.responsavel_nome : null
    ),
    cpf_administrador: payload.cpf_administrador || (
      cliente.responsavel_tipo === 'adm' ? cpfDoCliente : null
    ),
    email_administrador: payload.email_administrador || (
      cliente.responsavel_tipo === 'adm' ? cliente.email : null
    ),
    telefone_administrador: payload.telefone_administrador || (
      cliente.responsavel_tipo === 'adm' ? (telefoneWhatsapp || null) : null
    ),
    operadora_atual_id: payload.operadora_atual_id || operadoraAtualId || null
  };
}

/**
 * Resolve operadora atual cliente a partir do contexto atual.
 */
function resolverOperadoraAtualCliente(cliente, operadoraVendaId, valorAtual = null) {
  if (valorAtual) return Number(valorAtual);

  const operadoras = cliente.operadoras_atuais || cliente.operadorasAtuais || [];
  const operadoraVenda = operadoraVendaId ? Number(operadoraVendaId) : null;
  const match = operadoraVenda
    ? operadoras.find(item => Number(item.operadora_id || item.operadora?.id) === operadoraVenda)
    : null;

  if (match) return Number(match.operadora_id || match.operadora?.id);

  return cliente.operadora_atual_id || cliente.operadoraAtual?.id || null;
}

/**
 * Normaliza paginacao para uso interno consistente.
 */
function normalizarPaginacao(filtros = {}) {
  const opcoesPorPagina = new Set([20, 50, 100]);
  const page = Math.max(Number.parseInt(filtros.page, 10) || 1, 1);
  const perPageInformado = Number.parseInt(filtros.per_page, 10);
  const perPage = opcoesPorPagina.has(perPageInformado) ? perPageInformado : 20;
  return { page, perPage };
}

/**
 * Busca escopo vendas conforme os parametros informados.
 */
async function buscarEscopoVendas(usuarioId) {
  const usuario = await Usuario.query()
    .findById(usuarioId)
    .withGraphFetched('role');

  if (!usuario || !usuario.ativo) {
    return { podeVerTodas: false, podeVerProprias: false };
  }

  return {
    podeVerTodas: usuarioTemPermissaoLocal(usuario, 'vendas_ver_todas'),
    podeVerProprias: usuarioTemPermissaoLocal(usuario, 'vendas_ver_proprias'),
    podeVerCompartilhadas: usuarioTemPermissaoLocal(usuario, 'ver_vendas_compartilhadas'),
    limitarUltimos6Meses: usuarioTemPermissaoLocal(usuario, PERMISSAO_LIMITAR_VENDAS_ULTIMOS_6_MESES)
  };
}

/**
 * Busca cliente para payload venda conforme os parametros informados.
 */
async function buscarClienteParaPayloadVenda(clienteId, usuarioId, vendaAtual = null) {
  if (!clienteId) return null;

  if (vendaAtual && Number(vendaAtual.cliente_id) === Number(clienteId)) {
    return Cliente.query()
      .findById(clienteId)
      .whereNull('excluido_em');
  }

  return clienteService.buscarClientePorId(clienteId, usuarioId);
}

/**
 * Busca permissoes usuario conforme os parametros informados.
 */
async function buscarPermissoesUsuario(usuarioId) {
  const usuario = await Usuario.query()
    .findById(usuarioId)
    .withGraphFetched('role');

  if (!usuario || !usuario.ativo) {
    return { admin: false, permissoes: [] };
  }

  return {
    admin: usuario.role?.nome === 'admin',
    permissoes: await listarPermissoesEfetivas(usuario)
  };
}

/**
 * Verifica se usuario tem permissao atende a condicao esperada.
 */
async function usuarioTemPermissao(usuarioId, permissao) {
  const usuario = await Usuario.query()
    .findById(usuarioId)
    .withGraphFetched('role');

  return usuarioTemPermissaoLocal(usuario, permissao);
}

/**
 * Verifica se protocolo preenchido atende a condicao esperada.
 */
function protocoloPreenchido(valor) {
  return String(valor || '').trim();
}

/**
 * Valida protocolo cliente e retorna o resultado esperado.
 */
async function validarProtocoloCliente(payload, usuarioId, vendaAtual = null) {
  const protocoloFoiEnviado = Object.prototype.hasOwnProperty.call(payload, 'protocolo');
  const clienteFoiEnviado = Object.prototype.hasOwnProperty.call(payload, 'cliente_id');

  if (!protocoloFoiEnviado && !clienteFoiEnviado) {
    return;
  }

  const protocoloAnterior = protocoloPreenchido(vendaAtual?.protocolo);
  const protocoloAtual = protocoloFoiEnviado
    ? protocoloPreenchido(payload.protocolo)
    : protocoloAnterior;

  if (vendaAtual && protocoloAnterior && protocoloAtual !== protocoloAnterior) {
    const permissoes = await buscarPermissoesUsuario(usuarioId);

    if (!permissoes.admin) {
      const error = new Error('Apenas ADM pode alterar ou apagar o protocolo do cliente.');
      error.statusCode = 403;
      throw error;
    }
  }

  // Protocolo pertence a venda. Outras vendas do mesmo cliente podem ter protocolos próprios.
}

/**
 * Aplica escopo vendas sobre a consulta ou conjunto informado.
 */
function aplicarEscopoVendas(query, usuarioId, escopo, alias = '') {
  /**
   * Retorna campo no formato esperado pelo fluxo.
   */
  const campo = (nome) => alias ? `${alias}.${nome}` : nome;
  const tabelaVendas = alias || 'vendas';

  if (escopo.podeVerTodas) {
    return query;
  }

  if (!escopo.podeVerProprias && !escopo.podeVerCompartilhadas) {
    query.whereRaw('1 = 0');
    return query;
  }

  query.where((builder) => {
    if (escopo.podeVerProprias) {
      builder
        .where(campo('criado_por_id'), usuarioId)
        .orWhere(campo('vendedora_id'), usuarioId);
    }

    if (escopo.podeVerCompartilhadas) {
      const metodo = escopo.podeVerProprias ? 'orWhereExists' : 'whereExists';
      builder[metodo](
        Venda.knex()
          .select(1)
          .from('venda_vendedoras as vv_scope')
          .whereRaw(`vv_scope.venda_id = ${tabelaVendas}.id`)
          .where('vv_scope.usuario_id', usuarioId)
      );
    }
  });

  return query;
}

/**
 * Retorna data referencia venda sql no formato esperado pelo fluxo.
 */
function dataReferenciaVendaSQL(alias = 'v') {
  return `COALESCE(NULLIF(NULLIF(${alias}.data_venda, '0000-00-00'), '1899-11-30'), NULLIF(DATE(${alias}.criado_em), '0000-00-00'), DATE(${alias}.created_at))`;
}

/**
 * Formata data iso para exibicao ou envio.
 */
function formatarDataISO(data) {
  return [
    data.getFullYear(),
    String(data.getMonth() + 1).padStart(2, '0'),
    String(data.getDate()).padStart(2, '0')
  ].join('-');
}

/**
 * Adiciona dias ao conjunto atual.
 */
function adicionarDias(data, dias) {
  const novaData = new Date(data);
  novaData.setDate(novaData.getDate() + dias);
  return novaData;
}

/**
 * Cria data local iso com os dados informados.
 */
function criarDataLocalISO(dataISO) {
  const normalizada = normalizarData(dataISO);
  if (!normalizada) return null;

  const [ano, mes, dia] = normalizada.split('-').map(Number);
  return new Date(ano, mes - 1, dia);
}

/**
 * Adiciona meses data iso ao conjunto atual.
 */
function adicionarMesesDataISO(dataISO, meses) {
  const data = criarDataLocalISO(dataISO);
  if (!data) return null;

  const diaOriginal = data.getDate();
  const destino = new Date(data);

  destino.setDate(1);
  destino.setMonth(destino.getMonth() + Number(meses || 0));

  const ultimoDiaMes = new Date(destino.getFullYear(), destino.getMonth() + 1, 0).getDate();
  destino.setDate(Math.min(diaOriginal, ultimoDiaMes));

  return formatarDataISO(destino);
}

/**
 * Obtem data minima para usuarios limitados a vendas recentes.
 */
function obterDataLimiteVendasRecentes(referencia = new Date()) {
  const dataReferencia = parseUtcDateTime(referencia) || new Date();
  return adicionarMesesDataISO(formatarDataISO(dataReferencia), -MESES_LIMITE_VENDAS_RECENTES);
}

/**
 * Obtem data limite concluida antiga a partir dos dados informados.
 */
function obterDataLimiteConcluidaAntiga(referencia = new Date()) {
  const dataReferencia = parseUtcDateTime(referencia) || new Date();
  return adicionarDias(dataReferencia, -DIAS_OCULTAR_CONCLUIDAS_FUNIL);
}

/**
 * Obtem ultima atividade funil a partir dos dados informados.
 */
function obterUltimaAtividadeFunil(venda = {}) {
  return parseUtcDateTime(venda.ultima_atividade_em)
    || parseUtcDateTime(venda.updated_at)
    || parseUtcDateTime(venda.created_at);
}

/**
 * Verifica se venda deve aparecer no funil atende a condicao esperada.
 */
function vendaDeveAparecerNoFunil(venda = {}, etapaFinal = 'concluido', referencia = new Date()) {
  if (venda.status_funil !== etapaFinal) return true;

  const ultimaAtividade = obterUltimaAtividadeFunil(venda);
  if (!ultimaAtividade) return true;

  return ultimaAtividade > obterDataLimiteConcluidaAntiga(referencia);
}

/**
 * Resolve periodo relatorio a partir do contexto atual.
 */
function resolverPeriodoRelatorio(filtros = {}) {
  const hoje = new Date();
  const periodo = filtros.periodo || 'mes_atual';
  let inicio;
  let fim;

  if (periodo === 'hoje') {
    inicio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    fim = inicio;
  } else if (periodo === 'semana_atual') {
    const diaSemana = hoje.getDay();
    const diasDesdeSegunda = diaSemana === 0 ? 6 : diaSemana - 1;
    inicio = adicionarDias(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()), -diasDesdeSegunda);
    fim = hoje;
  } else if (periodo === 'ultimos_30_dias') {
    inicio = adicionarDias(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()), -29);
    fim = hoje;
  } else if (periodo === 'personalizado') {
    const inicioCustom = normalizarData(filtros.data_inicio);
    const fimCustom = normalizarData(filtros.data_fim);

    inicio = inicioCustom ? new Date(`${inicioCustom}T00:00:00`) : new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    fim = fimCustom ? new Date(`${fimCustom}T00:00:00`) : hoje;
  } else {
    inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    fim = hoje;
  }

  if (inicio > fim) {
    const temporaria = inicio;
    inicio = fim;
    fim = temporaria;
  }

  return {
    tipo: periodo,
    dataInicio: formatarDataISO(inicio),
    dataFim: formatarDataISO(fim),
    dataFimExclusiva: formatarDataISO(adicionarDias(fim, 1))
  };
}

/**
 * Obtem quantidade chips venda a partir dos dados informados.
 */
function obterQuantidadeChipsVenda(venda) {
  let totalItens = 0;

  if (Array.isArray(venda.valores_unitarios_chips)) {
    totalItens = venda.valores_unitarios_chips.reduce((total, item) => total + Number(item.quantidade || 0), 0);
  } else if (typeof venda.valores_unitarios_chips === 'string' && venda.valores_unitarios_chips.trim()) {
    try {
      const itens = JSON.parse(venda.valores_unitarios_chips);
      totalItens = Array.isArray(itens)
        ? itens.reduce((total, item) => total + Number(item.quantidade || 0), 0)
        : 0;
    } catch {
      totalItens = normalizarItensChips(venda.valores_unitarios_chips)
        .reduce((total, item) => total + Number(item.quantidade || 0), 0);
    }
  }

  if (totalItens > 0) {
    return totalItens;
  }

  const quantidadeLinhas = Number(venda.quantidade_linhas || 0);

  return quantidadeLinhas > 0 ? quantidadeLinhas : 1;
}

/**
 * Obtem resumo vendedora relatorio a partir dos dados informados.
 */
function obterResumoVendedoraRelatorio(venda, vendedoraId, usuariosPorId = new Map()) {
  const id = vendedoraId ? Number(vendedoraId) : null;
  const usuario = id ? usuariosPorId.get(id) : null;
  const ehVendedoraPrincipal = id && Number(venda.vendedora_id) === id;

  return {
    id,
    nome: usuario?.nome || (ehVendedoraPrincipal ? venda.vendedora_nome : null) || 'Sem vendedor',
    email: usuario?.email || (ehVendedoraPrincipal ? venda.vendedora_email : null) || ''
  };
}

/**
 * Monta atribuicoes vendedoras venda a partir dos dados informados.
 */
function montarAtribuicoesVendedorasVenda(venda, usuariosPorId = new Map()) {
  const mapa = new Map();
  const itensChips = normalizarItensChips(venda.valores_unitarios_chips);
  const fallbackVendedoraId = venda.vendedora_id ? Number(venda.vendedora_id) : null;

  /**
   * Adiciona  ao conjunto atual.
   */
  function adicionar(vendedoraId, valor, chips) {
    const resumo = obterResumoVendedoraRelatorio(venda, vendedoraId, usuariosPorId);
    const chave = resumo.id || 'sem_vendedor';
    const atual = mapa.get(chave) || {
      id: resumo.id,
      nome: resumo.nome,
      email: resumo.email,
      valor: 0,
      chips: 0
    };

    atual.valor += Number(valor || 0);
    atual.chips += Number(chips || 0);
    mapa.set(chave, atual);
  }

  if (itensChips.length > 0) {
    itensChips.forEach(item => {
      const quantidade = Number(item.quantidade || 0);
      const valor = quantidade * Number(item.valor_unitario || 0);
      adicionar(item.vendedora_id ? Number(item.vendedora_id) : fallbackVendedoraId, valor, quantidade);
    });
  } else {
    adicionar(fallbackVendedoraId, Number(venda.valor_total || 0), obterQuantidadeChipsVenda(venda));
  }

  return Array.from(mapa.values()).map(item => ({
    ...item,
    valor: Number(item.valor.toFixed(2))
  }));
}

/**
 * Obtem atribuicao vendedora venda a partir dos dados informados.
 */
function obterAtribuicaoVendedoraVenda(venda, vendedoraId, usuariosPorId = new Map()) {
  const id = Number(vendedoraId);
  return montarAtribuicoesVendedorasVenda(venda, usuariosPorId)
    .find(item => item.id && Number(item.id) === id) || null;
}

/**
 * Filtra vendas relatorio por vendedora conforme os criterios informados.
 */
function filtrarVendasRelatorioPorVendedora(vendas = [], vendedoraId, usuariosPorId = new Map()) {
  if (!vendedoraId) return vendas;

  return vendas
    .map(venda => {
      const atribuicao = obterAtribuicaoVendedoraVenda(venda, vendedoraId, usuariosPorId);
      if (!atribuicao) return null;

      return {
        ...venda,
        valor_total: atribuicao.valor,
        quantidade_linhas: atribuicao.chips,
        valores_unitarios_chips: [{
          quantidade: atribuicao.chips,
          valor_unitario: atribuicao.chips > 0 ? atribuicao.valor / atribuicao.chips : 0,
          vendedora_id: atribuicao.id
        }],
        vendedora_id: atribuicao.id,
        vendedora_nome: atribuicao.nome,
        vendedora_email: atribuicao.email
      };
    })
    .filter(Boolean);
}

/**
 * Monta dados sincronizacao cliente venda a partir dos dados informados.
 */
function montarDadosSincronizacaoClienteVenda(venda, dataConclusao = new Date()) {
  const clienteId = Number(venda?.cliente_id || 0);
  const operadoraVendidaId = Number(venda?.operadora_id || 0);

  if (!clienteId || !operadoraVendidaId) {
    return null;
  }

  const dataBase = normalizarData(venda.data_ativacao)
    || normalizarData(dataConclusao)
    || formatarDataISO(new Date());
  const valorTotal = Number(venda.valor_total || 0);

  return {
    clienteId,
    operadoraVendidaId,
    quantidadeChips: obterQuantidadeChipsVenda(venda),
    valorPago: Number.isFinite(valorTotal) ? Number(valorTotal.toFixed(2)) : 0,
    fidelidadeFim: adicionarMesesDataISO(dataBase, 24),
    dataBase
  };
}

/**
 * Atualiza resumo legado cliente apos venda com os dados informados.
 */
async function atualizarResumoLegadoClienteAposVenda(clienteId, operadoraPreferencialId, trx) {
  const operadoras = await ClienteOperadora.query(trx)
    .where('cliente_id', clienteId)
    .orderBy('id', 'asc');
  const quantidade = operadoras.reduce((total, item) => total + Number(item.quantidade_chips || 0), 0);
  const valor = operadoras.reduce((total, item) => total + Number(item.valor_pago || 0), 0);
  const fidelidades = operadoras
    .map(item => normalizarData(item.fidelidade_fim))
    .filter(Boolean)
    .sort();
  const operadoraPreferencialExiste = operadoras.some(item => Number(item.operadora_id) === Number(operadoraPreferencialId));

  await Cliente.query(trx).patchAndFetchById(clienteId, {
    operadora_atual_id: operadoraPreferencialExiste ? Number(operadoraPreferencialId) : (operadoras[0]?.operadora_id || null),
    quantidade_chips: quantidade > 0 ? quantidade : null,
    valor_pago: valor > 0 ? Number(valor.toFixed(2)) : null,
    fidelidade_fim: fidelidades[0] || null,
    updated_at: new Date()
  });
}

/**
 * Sincroniza cliente com venda concluida com os dados atuais.
 */
async function sincronizarClienteComVendaConcluida(venda, dataConclusao, trx) {
  const dados = montarDadosSincronizacaoClienteVenda(venda, dataConclusao);

  if (!dados) {
    return null;
  }

  const existente = await ClienteOperadora.query(trx)
    .where({
      cliente_id: Number(dados.clienteId),
      operadora_id: Number(dados.operadoraVendidaId)
    })
    .first();
  const payload = {
    quantidade_chips: dados.quantidadeChips,
    valor_pago: dados.valorPago,
    fidelidade_fim: dados.fidelidadeFim,
    updated_at: new Date()
  };

  if (existente) {
    await ClienteOperadora.query(trx).patchAndFetchById(existente.id, payload);
  } else {
    await ClienteOperadora.query(trx).insert({
      cliente_id: Number(dados.clienteId),
      operadora_id: Number(dados.operadoraVendidaId),
      ...payload
    });
  }

  await atualizarResumoLegadoClienteAposVenda(dados.clienteId, dados.operadoraVendidaId, trx);

  return dados.clienteId;
}

/**
 * Sincroniza notificacao fidelidade cliente com os dados atuais.
 */
async function sincronizarNotificacaoFidelidadeCliente(clienteId) {
  if (!clienteId) return;

  try {
    await notificacaoService.sincronizarFidelidadeCliente(clienteId);
  } catch (error) {
    console.error('Erro ao sincronizar notificacao de fidelidade do cliente:', error);
  }
}

/**
 * Soma valor vendas considerando os dados informados.
 */
function somarValorVendas(vendas = []) {
  return Number(vendas.reduce((total, venda) => total + Number(venda.valor_total || 0), 0).toFixed(2));
}

/**
 * Monta resumo agrupado a partir dos dados informados.
 */
function montarResumoAgrupado(mapa) {
  return Array.from(mapa.values())
    .map(item => ({
      ...item,
      valor: Number(item.valor.toFixed(2))
    }))
    .sort((a, b) => b.valor - a.valor);
}

/**
 * Monta resumo fases a partir dos dados informados.
 */
function montarResumoFases(vendas = []) {
  const statusEncontrados = Array.from(new Set(
    vendas
      .map(venda => venda.status_funil || 'aprovacao')
      .filter(Boolean)
  ));
  const statusOrdenados = [
    ...FUNIL_STATUS,
    ...statusEncontrados.filter(status => !FUNIL_STATUS.includes(status))
  ];
  const fasesMap = new Map(statusOrdenados.map(status => [
    status,
    {
      id: status,
      nome: FUNIL_STATUS_LABELS[status] || status,
      valor: 0,
      vendas: 0,
      chips: 0,
      retorno: status === 'retorno'
    }
  ]));

  vendas.forEach(venda => {
    const status = venda.status_funil || 'aprovacao';
    const fase = fasesMap.get(status) || {
      id: status,
      nome: FUNIL_STATUS_LABELS[status] || status,
      valor: 0,
      vendas: 0,
      chips: 0,
      retorno: status === 'retorno'
    };

    fase.valor += Number(venda.valor_total || 0);
    fase.vendas += 1;
    fase.chips += obterQuantidadeChipsVenda(venda);
    fasesMap.set(status, fase);
  });

  return Array.from(fasesMap.values()).map(fase => ({
    ...fase,
    valor: Number(fase.valor.toFixed(2))
  }));
}

/**
 * Lista etapas funil ordenadas conforme os filtros e parametros informados.
 */
async function listarEtapasFunilOrdenadas() {
  try {
    const etapas = await FunilEtapa.query()
      .where('ativo', true)
      .orderBy('ordem', 'asc')
      .orderBy('nome', 'asc');

    if (etapas.length > 0) {
      return etapas.map(etapa => ({
        id: etapa.codigo,
        nome: etapa.nome,
        ordem: etapa.ordem,
        etapa_final: Boolean(etapa.etapa_final),
        bloqueia_avanco: Boolean(etapa.bloqueia_avanco),
        retorno: false
      }));
    }
  } catch {
    return FUNIL_STATUS
      .filter(status => status !== 'retorno')
      .map((status, index) => ({
        id: status,
        nome: FUNIL_STATUS_LABELS[status] || status,
        ordem: index + 1,
        bloqueia_avanco: false,
        retorno: false
      }));
  }

  return FUNIL_STATUS
    .filter(status => status !== 'retorno')
    .map((status, index) => ({
      id: status,
      nome: FUNIL_STATUS_LABELS[status] || status,
      etapa_final: status === 'concluido',
      ordem: index + 1,
      bloqueia_avanco: false,
      retorno: false
    }));
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

    return etapa?.codigo || 'concluido';
  } catch {
    return 'concluido';
  }
}

/**
 * Executa a acao de solicitar pacote se venda finalizada mantendo o estado da tela consistente.
 */
async function solicitarPacoteSeVendaFinalizada(venda, usuarioId, etapaFinal = null) {
  const codigoFinal = etapaFinal || await obterCodigoEtapaFinal();

  if (venda?.status_funil !== codigoFinal) {
    return;
  }

  vendaArquivoService.solicitarPacoteVenda(venda.id, usuarioId, { validarAcesso: false })
    .catch(error => {
      console.error('Erro ao solicitar pacote de arquivos da venda:', error);
    });
}

/**
 * Retorna status preenche data ativacao no formato esperado pelo fluxo.
 */
async function statusPreencheDataAtivacao(status, etapaFinal) {
  return Boolean(status && status === etapaFinal);
}

/**
 * Envia venda criada automaticamente para pos venda para processamento.
 */
async function enviarVendaCriadaAutomaticamenteParaPosVenda(venda, usuarioId, agora, trx) {
  return enviarVendaParaPosVendaLiberada(venda, usuarioId, agora, trx, { envioAutomatico: true });
}

/**
 * Envia venda para pos venda liberada para processamento.
 */
async function enviarVendaParaPosVendaLiberada(venda, usuarioId, agora, trx, opcoes = {}) {
  const etapas = await listarEtapasFunilOrdenadas();
  const primeiraEtapa = etapas[0]?.id || 'aprovacao';
  const envioAutomatico = Boolean(opcoes.envioAutomatico);
  const atualizada = await Venda.query(trx).patchAndFetchById(venda.id, {
    status_funil: primeiraEtapa,
    prioridade_funil: venda.prioridade_funil || 'media',
    enviada_pos_venda_em: agora,
    enviada_pos_venda_por_id: usuarioId,
    ultima_atividade_em: agora,
    updated_at: agora
  });

  await registrarHistoricoVenda({
    vendaId: venda.id,
    usuarioId,
    acao: 'venda.enviada_pos_venda',
    statusAnterior: venda.status_funil || null,
    statusNovo: primeiraEtapa,
    observacao: envioAutomatico
      ? 'Venda enviada automaticamente ao pos-venda'
      : 'Venda enviada ao pos-venda',
    dados: {
      status_funil: primeiraEtapa,
      enviada_pos_venda_em: agora,
      ...(envioAutomatico ? { envio_automatico: true } : {})
    },
    createdAt: agora,
    trx
  });

  return atualizada;
}

/**
 * Monta resumo fases dinamico a partir dos dados informados.
 */
async function montarResumoFasesDinamico(vendas = []) {
  const etapas = await listarEtapasFunilOrdenadas();
  const statusBase = [...etapas.map(etapa => etapa.id), 'retorno'];
  const statusEncontrados = Array.from(new Set(
    vendas
      .map(venda => venda.status_funil || etapas[0]?.id || 'aprovacao')
      .filter(Boolean)
  ));
  const statusOrdenados = [
    ...statusBase,
    ...statusEncontrados.filter(status => !statusBase.includes(status))
  ];
  const nomes = {
    ...FUNIL_STATUS_LABELS,
    ...Object.fromEntries(etapas.map(etapa => [etapa.id, etapa.nome]))
  };
  const fasesMap = new Map(statusOrdenados.map(status => [
    status,
    {
      id: status,
      nome: nomes[status] || status,
      valor: 0,
      vendas: 0,
      chips: 0,
      retorno: status === 'retorno'
    }
  ]));

  vendas.forEach(venda => {
    const status = venda.status_funil || etapas[0]?.id || 'aprovacao';
    const fase = fasesMap.get(status) || {
      id: status,
      nome: nomes[status] || status,
      valor: 0,
      vendas: 0,
      chips: 0,
      retorno: status === 'retorno'
    };

    fase.valor += Number(venda.valor_total || 0);
    fase.vendas += 1;
    fase.chips += obterQuantidadeChipsVenda(venda);
    fasesMap.set(status, fase);
  });

  return Array.from(fasesMap.values()).map(fase => ({
    ...fase,
    valor: Number(fase.valor.toFixed(2))
  }));
}

/**
 * Verifica se usuario pode acessar venda atende a condicao esperada.
 */
async function usuarioPodeAcessarVenda(id, usuarioId, opcoes = {}) {
  const escopo = await buscarEscopoVendas(usuarioId);

  if (escopo.podeVerTodas) {
    return true;
  }

  if (!escopo.podeVerProprias && !escopo.podeVerCompartilhadas) {
    return false;
  }

  const query = Venda.query()
    .findById(id)
    .select('id', 'criado_por_id', 'vendedora_id');

  if (!opcoes.incluirLixeira) {
    query.whereNull('excluido_em');
  }

  const venda = await query;

  if (escopo.podeVerProprias && (
    Number(venda?.criado_por_id) === Number(usuarioId)
    || Number(venda?.vendedora_id) === Number(usuarioId)
  )) {
    return true;
  }

  if (!escopo.podeVerCompartilhadas) {
    return false;
  }

  const vinculo = await Venda.knex()('venda_vendedoras')
    .where('venda_id', id)
    .where('usuario_id', usuarioId)
    .first();

  return Boolean(vinculo);
}

/**
 * Verifica se usuario pode editar venda atende a condicao esperada.
 */
async function usuarioPodeEditarVenda(id, usuarioId, opcoes = {}) {
  const permissoes = await buscarPermissoesUsuario(usuarioId);

  if (await usuarioTemPermissao(usuarioId, 'vendas_editar')) {
    return usuarioPodeAcessarVenda(id, usuarioId, opcoes);
  }

  const venda = await Venda.query()
    .findById(id)
    .select('id', 'criado_por_id', 'vendedora_id', 'excluido_em');

  if (!venda || (!opcoes.incluirLixeira && venda.excluido_em)) {
    return false;
  }

  if (!permissoes.permissoes.includes('editar_vendas_compartilhadas')) {
    return false;
  }

  const vinculo = await Venda.knex()('venda_vendedoras')
    .where('venda_id', id)
    .where('usuario_id', usuarioId)
    .first();

  return Boolean(vinculo);
}

/**
 * Lista vendas conforme os filtros e parametros informados.
 */
async function listarVendas(filtros = {}, usuarioId) {
  const escopo = await buscarEscopoVendas(usuarioId);
  const query = Venda.query()
    .select('vendas.*')
    .select(Venda.knex().raw(
      '(SELECT COUNT(*) FROM venda_arquivos va WHERE va.venda_id = vendas.id AND va.excluido_em IS NULL) as total_arquivos'
    ))
    .withGraphFetched('[cliente.[operadoraAtual, operadorasAtuais.operadora], vendedora, vendedoras, origemSondador, origemLead, operadora, tipoVenda, servico, criador, historico, aprovacaoSolicitacoes]')
    .modifyGraph('vendedora', builder => builder.select('id', 'nome', 'email', 'foto_perfil'))
    .modifyGraph('vendedoras', builder => builder.select('usuarios.id', 'usuarios.nome', 'usuarios.email', 'usuarios.foto_perfil').orderBy('venda_vendedoras.ordem', 'asc'))
    .modifyGraph('origemSondador', builder => builder.select('id', 'nome'))
    .modifyGraph('origemLead', builder => builder.select('id', 'primeira_ligacao_avaliacao', 'primeira_ligacao_avaliada_em'))
    .modifyGraph('historico', builder => builder.select('id', 'venda_id', 'status_novo', 'created_at').whereNotNull('status_novo').orderBy('created_at', 'asc').orderBy('id', 'asc'))
    .modifyGraph('aprovacaoSolicitacoes', builder => builder.select('id', 'venda_id', 'status', 'motivos', 'observacao_decisao', 'created_at').whereNot('status', 'obsoleta').orderBy('id', 'desc'))
    .whereNull('excluido_em')
    .orderBy('data_venda', 'desc')
    .orderBy('id', 'desc');

  aplicarEscopoVendas(query, usuarioId, escopo);

  if (filtros.busca) {
    aplicarBuscaGeralVendas(query, filtros.busca);
  }

  await aplicarBuscaCampoVendas(query, filtros);

  if (filtros.vendedora_id) {
    const vendedoraId = Number(filtros.vendedora_id);
    query.where(builder => {
      builder
        .where('vendedora_id', vendedoraId)
        .orWhereExists(
          Venda.knex()
            .select(1)
            .from('venda_vendedoras as vv_filter')
            .whereRaw('vv_filter.venda_id = vendas.id')
            .where('vv_filter.usuario_id', vendedoraId)
        );
    });
  }

  if (filtros.cliente_id) {
    query.where('cliente_id', Number(filtros.cliente_id));
  }

  if (filtros.operadora_id) {
    query.where('operadora_id', Number(filtros.operadora_id));
  }

  if (filtros.tipo_venda_id) {
    await aplicarFiltroTipoVenda(query, filtros.tipo_venda_id);
  }

  if (filtros.servico_id) {
    const servicoIds = normalizarIdsFiltro(filtros.servico_id);
    if (servicoIds.length === 1) {
      query.where('servico_id', servicoIds[0]);
    } else if (servicoIds.length > 1) {
      query.whereIn('servico_id', servicoIds);
    }
  }

  if (filtros.status_funil === STATUS_CANCELADA_FILTRO) {
    query.whereNotNull('cancelada_em');
  } else if (filtros.status_funil) {
    query.where('status_funil', filtros.status_funil);
  }

  if (filtros.enviadas_pos_venda !== undefined) {
    const somenteEnviadas = ['1', 'true', true, 1].includes(filtros.enviadas_pos_venda);

    if (somenteEnviadas) {
      query.whereNotNull('enviada_pos_venda_em');
    } else {
      query.whereNull('enviada_pos_venda_em');
    }
  }

  if (filtros.data_inicio) {
    query.where('data_venda', '>=', normalizarData(filtros.data_inicio));
  }

  if (filtros.data_fim) {
    query.where('data_venda', '<=', normalizarData(filtros.data_fim));
  }

  if (escopo.limitarUltimos6Meses) {
    query.where('data_venda', '>=', obterDataLimiteVendasRecentes());
  }

  if (filtros.valor_min) {
    query.where('valor_total', '>=', parseValorMonetario(filtros.valor_min));
  }

  if (filtros.valor_max) {
    query.where('valor_total', '<=', parseValorMonetario(filtros.valor_max));
  }

  if (filtros.protocolo) {
    query.where('protocolo', 'like', `%${filtros.protocolo}%`);
  }

  if (filtros.uf) {
    query.where('uf', filtros.uf);
  }

  if (filtros.municipio) {
    query.where('municipio', 'like', `%${filtros.municipio}%`);
  }

  if (filtros.prioridade_funil) {
    query.where('prioridade_funil', filtros.prioridade_funil);
  }

  if (['1', 'true', true, 1].includes(filtros.ocultar_concluidas_antigas)) {
    const etapaFinal = await obterCodigoEtapaFinal();
    query.where(builder => {
      builder
        .whereNot('status_funil', etapaFinal)
        .orWhereNull('status_funil')
        .orWhereRaw(
          'COALESCE(ultima_atividade_em, updated_at, created_at) > DATE_SUB(NOW(), INTERVAL ? DAY)',
          [DIAS_OCULTAR_CONCLUIDAS_FUNIL]
        );
    });
  }

  const paginar = filtros.page !== undefined || filtros.per_page !== undefined;
  const { page, perPage } = normalizarPaginacao(filtros);

  if (paginar) {
    const result = await query.page(page - 1, perPage);
    return { data: result.results, total: result.total };
  }

  return query;
}

/**
 * Retorna valor data excel no formato esperado pelo fluxo.
 */
function valorDataExcel(valor) {
  const data = normalizarData(valor);
  if (!data) return null;

  const [ano, mes, dia] = data.split('-').map(Number);
  if (!ano || !mes || !dia) return null;

  return new Date(Date.UTC(ano, mes - 1, dia));
}

/**
 * Retorna nome arquivo seguro no formato esperado pelo fluxo.
 */
function nomeArquivoSeguro(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'exportacao';
}

/**
 * Aplica estilo exportacao sobre a consulta ou conjunto informado.
 */
function aplicarEstiloExportacao(worksheet) {
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: worksheet.columnCount }
  };

  const header = worksheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F2937' }
  };
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

  worksheet.eachRow((row, rowNumber) => {
    row.eachCell(cell => {
      cell.alignment = { vertical: 'middle', wrapText: rowNumber === 1 };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
      };
    });
  });
}

/**
 * Retorna nomes vendedoras exportacao no formato esperado pelo fluxo.
 */
function nomesVendedorasExportacao(venda) {
  const nomes = Array.isArray(venda.vendedoras)
    ? venda.vendedoras.map(item => item.nome).filter(Boolean)
    : [];

  if (nomes.length > 0) return nomes.join(', ');
  return venda.vendedora?.nome || '';
}

/**
 * Retorna status venda exportacao no formato esperado pelo fluxo.
 */
function statusVendaExportacao(venda) {
  if (venda.cancelada_em) return 'Cancelada';
  return venda.status_funil || '';
}

/**
 * Gera xlsx vendas a partir dos dados informados.
 */
async function gerarXlsxVendas(filtros = {}, usuarioId) {
  const filtrosExportacao = { ...filtros };
  delete filtrosExportacao.page;
  delete filtrosExportacao.per_page;

  const vendas = await listarVendas(filtrosExportacao, usuarioId);
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Vendas');

  workbook.creator = 'Sistema Pos Venda';
  workbook.created = new Date();

  worksheet.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'CLIENTE', key: 'cliente', width: 34 },
    { header: 'RAZAO SOCIAL', key: 'razao_social', width: 34 },
    { header: 'CNPJ/CPF', key: 'cnpj', width: 20 },
    { header: 'VENDEDORA(S)', key: 'vendedoras', width: 28 },
    { header: 'OPERADORA', key: 'operadora', width: 18 },
    { header: 'TIPO', key: 'tipo', width: 18 },
    { header: 'PRODUTO', key: 'produto', width: 20 },
    { header: 'LINHAS', key: 'quantidade_linhas', width: 10 },
    { header: 'GB', key: 'gb', width: 12 },
    { header: 'VALOR', key: 'valor_total', width: 14, style: { numFmt: 'R$ #,##0.00' } },
    { header: 'VENCIMENTO', key: 'dia_vencimento', width: 12 },
    { header: 'DATA VENDA', key: 'data_venda', width: 16, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'DATA ATIVACAO', key: 'data_ativacao', width: 16, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'STATUS', key: 'status', width: 18 },
    { header: 'PRIORIDADE', key: 'prioridade', width: 14 },
    { header: 'PROTOCOLO', key: 'protocolo', width: 18 },
    { header: 'UF', key: 'uf', width: 8 },
    { header: 'MUNICIPIO', key: 'municipio', width: 20 },
    { header: 'TELEFONE', key: 'telefone', width: 18 },
    { header: 'EMAIL', key: 'email', width: 30 },
    { header: 'REGISTRADO POR', key: 'criado_por', width: 22 },
    { header: 'CRIADO EM', key: 'created_at', width: 16, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'ENVIADA POS-VENDA', key: 'enviada_pos_venda_em', width: 18, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'CANCELADA EM', key: 'cancelada_em', width: 16, style: { numFmt: 'dd/mm/yyyy' } }
  ];

  vendas.forEach(venda => {
    worksheet.addRow({
      id: venda.id,
      cliente: venda.nome || venda.cliente?.nome || '',
      razao_social: venda.razao_social || venda.cliente?.razao_social || '',
      cnpj: venda.cnpj || venda.cliente?.cnpj || '',
      vendedoras: nomesVendedorasExportacao(venda),
      operadora: venda.operadora?.nome || '',
      tipo: venda.tipoVenda?.nome || '',
      produto: venda.servico?.nome || venda.produto_fechado || '',
      quantidade_linhas: venda.quantidade_linhas ?? null,
      gb: venda.gb || '',
      valor_total: venda.valor_total === null || venda.valor_total === undefined ? null : Number(venda.valor_total),
      dia_vencimento: venda.dia_vencimento ?? null,
      data_venda: valorDataExcel(venda.data_venda),
      data_ativacao: valorDataExcel(venda.data_ativacao),
      status: statusVendaExportacao(venda),
      prioridade: venda.prioridade_funil || '',
      protocolo: venda.protocolo || '',
      uf: venda.uf || '',
      municipio: venda.municipio || '',
      telefone: venda.telefone || '',
      email: venda.email || '',
      criado_por: venda.criador?.nome || '',
      created_at: valorDataExcel(venda.criado_em || venda.created_at),
      enviada_pos_venda_em: valorDataExcel(venda.enviada_pos_venda_em),
      cancelada_em: valorDataExcel(venda.cancelada_em)
    });
  });

  aplicarEstiloExportacao(worksheet);
  worksheet.getColumn('valor_total').numFmt = 'R$ #,##0.00';
  ['data_venda', 'data_ativacao', 'created_at', 'enviada_pos_venda_em', 'cancelada_em'].forEach(key => {
    worksheet.getColumn(key).numFmt = 'dd/mm/yyyy';
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const data = new Date().toISOString().slice(0, 10);
  return { buffer, nome: `vendas-${nomeArquivoSeguro(data)}.xlsx` };
}

/**
 * Obtem referencias clientes a partir dos dados informados.
 */
async function obterReferenciasClientes(usuarioId) {
  const escopo = await buscarEscopoVendas(usuarioId);
  const etapaFinal = await obterCodigoEtapaFinal();
  const knex = Venda.knex();
  /**
   * Monta base a partir dos dados informados.
   */
  const montarBase = () => {
    const query = Venda.query().whereNull('excluido_em');
    aplicarEscopoVendas(query, usuarioId, escopo);
    return query;
  };

  const porChave = new Map();
  /**
   * Adiciona  ao conjunto atual.
   */
  const adicionar = (chave, linha) => {
    if (!chave) return;
    porChave.set(chave, {
      chave,
      total: Number(linha.total || 0),
      em_andamento_total: Number(linha.em_andamento_total || 0)
    });
  };

  const camposAgregados = [
    knex.raw('COUNT(*) as total'),
    knex.raw('SUM(CASE WHEN status_funil = ? THEN 0 ELSE 1 END) as em_andamento_total', [etapaFinal])
  ];

  const porCliente = await montarBase()
    .whereNotNull('cliente_id')
    .select('cliente_id')
    .select(camposAgregados)
    .groupBy('cliente_id');

  porCliente.forEach(linha => adicionar(`cliente:${linha.cliente_id}`, linha));

  const porCnpj = await montarBase()
    .whereNotNull('cnpj')
    .whereNot('cnpj', '')
    .select(knex.raw("REPLACE(REPLACE(REPLACE(REPLACE(cnpj, '.', ''), '/', ''), '-', ''), ' ', '') as cnpj_chave"))
    .select(camposAgregados)
    .groupBy('cnpj_chave');

  porCnpj.forEach(linha => adicionar(linha.cnpj_chave ? `cnpj:${linha.cnpj_chave}` : '', linha));

  const porNome = await montarBase()
    .whereNull('cliente_id')
    .where(builder => builder.whereNotNull('nome').orWhereNotNull('razao_social'))
    .select(knex.raw("LOWER(TRIM(COALESCE(NULLIF(nome, ''), NULLIF(razao_social, ''), ''))) as nome_chave"))
    .select(camposAgregados)
    .groupBy('nome_chave');

  porNome.forEach(linha => adicionar(linha.nome_chave ? `nome:${linha.nome_chave}` : '', linha));

  return Array.from(porChave.values());
}

/**
 * Processa verificar ids vendas ativas conforme as regras do dominio.
 */
async function verificarIdsVendasAtivas(ids = [], usuarioId) {
  const vendaIds = Array.from(new Set(ids.map(Number).filter(Number.isInteger).filter(id => id > 0)));

  if (vendaIds.length === 0) {
    return [];
  }

  const escopo = await buscarEscopoVendas(usuarioId);
  const query = Venda.query()
    .select('id')
    .whereIn('id', vendaIds)
    .whereNull('excluido_em');

  aplicarEscopoVendas(query, usuarioId, escopo);
  const linhas = await query;
  return linhas.map(linha => Number(linha.id)).filter(Boolean);
}

/**
 * Obtem contexto dashboard a partir dos dados informados.
 */
async function obterContextoDashboard({ usuarioId, vendaIds = [] }) {
  const [clientes, referenciasClientes, vendasAtivasIds, vendasRetorno] = await Promise.all([
    clienteService.listarClientesSelect({ limite: 300 }, usuarioId),
    obterReferenciasClientes(usuarioId),
    verificarIdsVendasAtivas(vendaIds, usuarioId),
    listarVendasRetornoResumo(usuarioId)
  ]);

  return {
    clientes,
    referencias_clientes: referenciasClientes,
    vendas_ativas_ids: vendasAtivasIds,
    vendas_retorno: vendasRetorno
  };
}

/**
 * Lista vendas retorno resumo conforme os filtros e parametros informados.
 */
async function listarVendasRetornoResumo(usuarioId) {
  const escopo = await buscarEscopoVendas(usuarioId);
  const query = Venda.query()
    .select(
      'id',
      'nome',
      'razao_social',
      'cnpj',
      'status_funil',
      'motivo_retorno',
      'retornou_em',
      'ultima_atividade_em',
      'updated_at',
      'cliente_id',
      'vendedora_id',
      'criado_por_id'
    )
    .withGraphFetched('[cliente, vendedora]')
    .modifyGraph('cliente', builder => builder.select('id', 'nome', 'razao_social', 'cnpj'))
    .modifyGraph('vendedora', builder => builder.select('id', 'nome', 'email', 'foto_perfil'))
    .whereNull('excluido_em')
    .where('status_funil', 'retorno')
    .orderBy('retornou_em', 'desc')
    .orderBy('id', 'desc')
    .limit(100);

  aplicarEscopoVendas(query, usuarioId, escopo);
  return query;
}

/**
 * Obtem resumo dashboard a partir dos dados informados.
 */
async function obterResumoDashboard(usuarioId) {
  const escopo = await buscarEscopoVendas(usuarioId);
  const dataReferencia = dataReferenciaVendaSQL('v');
  const etapaFinal = await obterCodigoEtapaFinal();
  const hoje = new Date();
  const inicioHoje = [
    hoje.getFullYear(),
    String(hoje.getMonth() + 1).padStart(2, '0'),
    String(hoje.getDate()).padStart(2, '0')
  ].join('-');

  const queryHoje = Venda.query().alias('v');
  aplicarEscopoVendas(queryHoje, usuarioId, escopo, 'v');

  const vendasHoje = await queryHoje
    .whereNull('v.excluido_em')
    .whereNot('v.status_funil', 'retorno')
    .whereRaw(`${dataReferencia} = ?`, [inicioHoje])
    .select(
      Venda.raw('COUNT(*) as vendas_dia'),
      Venda.raw('COALESCE(SUM(COALESCE(v.valor_total, 0)), 0) as valor_dia'),
      Venda.raw('SUM(CASE WHEN v.status_funil = ? THEN 1 ELSE 0 END) as concluidas_dia', [etapaFinal])
    )
    .first();

  const queryPipeline = Venda.query().alias('v');
  aplicarEscopoVendas(queryPipeline, usuarioId, escopo, 'v');

  const pipeline = await queryPipeline
    .whereNull('v.excluido_em')
    .whereNotIn('v.status_funil', [etapaFinal, 'retorno'])
    .select(
      Venda.raw('COUNT(*) as pipeline_count'),
      Venda.raw('COALESCE(SUM(COALESCE(v.valor_total, 0)), 0) as pipeline')
    )
    .first();

  const queryRetornos = Venda.query().alias('v');
  aplicarEscopoVendas(queryRetornos, usuarioId, escopo, 'v');

  const retornos = await queryRetornos
    .whereNull('v.excluido_em')
    .where('v.status_funil', 'retorno')
    .select(
      'v.id',
      'v.valor_total',
      'v.valores_unitarios_chips',
      'v.quantidade_linhas'
    );

  const chipsRetornados = retornos.reduce((total, venda) => total + obterQuantidadeChipsVenda(venda), 0);
  const perdaRetornos = retornos.reduce((total, venda) => total + Number(venda.valor_total || 0), 0);

  return {
    vendasDia: Number(vendasHoje?.vendas_dia || 0),
    valorDia: Number(vendasHoje?.valor_dia || 0),
    concluidasDia: Number(vendasHoje?.concluidas_dia || 0),
    pipeline: Number(pipeline?.pipeline || 0),
    pipelineCount: Number(pipeline?.pipeline_count || 0),
    retornos: chipsRetornados,
    perda: Number(perdaRetornos.toFixed(2))
  };
}

/**
 * Constroi query relatorio com os filtros informados.
 */
function construirQueryRelatorio({ dataInicio, dataFimExclusiva, dataReferencia }) {
  const query = Venda.query()
    .alias('v')
    .leftJoin('operadoras as o', 'v.operadora_id', 'o.id')
    .leftJoin('usuarios as u', 'v.vendedora_id', 'u.id')
    .whereNull('v.excluido_em')
    .whereRaw(`${dataReferencia} >= ?`, [dataInicio])
    .whereRaw(`${dataReferencia} < ?`, [dataFimExclusiva])
    .select(
      'v.id',
      'v.status_funil',
      'v.valor_total',
      'v.valores_unitarios_chips',
      'v.quantidade_linhas',
      'v.operadora_id',
      'v.vendedora_id',
      'v.motivo_retorno',
      'o.nome as operadora_nome',
      'u.nome as vendedora_nome',
      'u.email as vendedora_email',
      Venda.raw(`${dataReferencia} as data_referencia`)
    );

  return query;
}

/**
 * Carrega usuarios atribuicoes relatorio e atualiza o estado relacionado.
 */
async function carregarUsuariosAtribuicoesRelatorio(vendas = []) {
  const ids = new Set();

  vendas.forEach(venda => {
    if (venda.vendedora_id) ids.add(Number(venda.vendedora_id));
    normalizarItensChips(venda.valores_unitarios_chips).forEach(item => {
      if (item.vendedora_id) ids.add(Number(item.vendedora_id));
    });
  });

  if (ids.size === 0) return new Map();

  const usuarios = await Usuario.query()
    .select('id', 'nome', 'email')
    .whereIn('id', Array.from(ids));

  return new Map(usuarios.map(usuario => [Number(usuario.id), usuario]));
}

/**
 * Resolve periodo anterior a partir do contexto atual.
 */
function resolverPeriodoAnterior(periodo) {
  const inicio = criarDataLocalISO(periodo.dataInicio);
  const fim = criarDataLocalISO(periodo.dataFim);
  if (!inicio || !fim) return null;

  const duracaoDias = Math.round((fim - inicio) / 86400000) + 1;
  const fimAnterior = adicionarDias(inicio, -1);
  const inicioAnterior = adicionarDias(fimAnterior, -(duracaoDias - 1));

  return {
    dataInicio: formatarDataISO(inicioAnterior),
    dataFim: formatarDataISO(fimAnterior),
    dataFimExclusiva: formatarDataISO(adicionarDias(fimAnterior, 1))
  };
}

/**
 * Agrega vendas periodo para compor os totais.
 */
function agregarVendasPeriodo(vendas, etapaFinal) {
  const vendasAndamento = vendas.filter(venda => ![etapaFinal, 'retorno'].includes(venda.status_funil));
  const vendasConcluidas = vendas.filter(venda => venda.status_funil === etapaFinal);
  const vendasRetorno = vendas.filter(venda => venda.status_funil === 'retorno');
  const vendasValidas = vendas.filter(venda => venda.status_funil !== 'retorno');
  const chipsRetornados = vendasRetorno.reduce((total, venda) => total + obterQuantidadeChipsVenda(venda), 0);
  const chipsVendidos = vendas.reduce((total, venda) => total + obterQuantidadeChipsVenda(venda), 0);
  const valorTotalValidas = somarValorVendas(vendasValidas);

  return {
    vendasAndamento,
    vendasConcluidas,
    vendasRetorno,
    vendasValidas,
    cards: {
      vendasAndamento: {
        quantidade: vendasAndamento.length,
        valor: somarValorVendas(vendasAndamento)
      },
      concluidas: {
        quantidade: vendasConcluidas.length,
        valor: somarValorVendas(vendasConcluidas)
      },
      perdaRetorno: {
        quantidade: vendasRetorno.length,
        valor: somarValorVendas(vendasRetorno),
        chips: chipsRetornados
      },
      taxaRetorno: {
        percentual: chipsVendidos > 0 ? Number(((chipsRetornados / chipsVendidos) * 100).toFixed(1)) : 0,
        chipsRetornados,
        chipsVendidos
      }
    },
    resumoPeriodo: {
      totalVendas: vendasValidas.length,
      valorTotal: valorTotalValidas,
      ticketMedio: vendasValidas.length > 0
        ? Number((valorTotalValidas / vendasValidas.length).toFixed(2))
        : 0
    }
  };
}

/**
 * Monta serie diaria relatorio a partir dos dados informados.
 */
function montarSerieDiariaRelatorio(vendas, periodo) {
  const mapa = new Map();

  vendas.forEach(venda => {
    const dia = normalizarData(venda.data_referencia);
    if (!dia) return;

    const registro = mapa.get(dia) || { receita: 0, quantidade: 0, retornos: 0 };
    if (venda.status_funil !== 'retorno') {
      registro.receita += Number(venda.valor_total || 0);
    }
    registro.quantidade += 1;
    if (venda.status_funil === 'retorno') registro.retornos += 1;
    mapa.set(dia, registro);
  });

  const serie = [];
  const inicio = criarDataLocalISO(periodo.dataInicio);
  const fim = criarDataLocalISO(periodo.dataFim);
  if (!inicio || !fim) return serie;

  for (let cursor = new Date(inicio); cursor <= fim; cursor = adicionarDias(cursor, 1)) {
    const dia = formatarDataISO(cursor);
    const registro = mapa.get(dia) || { receita: 0, quantidade: 0, retornos: 0 };
    serie.push({
      data: dia,
      receita: Number(registro.receita.toFixed(2)),
      quantidade: registro.quantidade,
      retornos: registro.retornos
    });
  }

  return serie;
}

/**
 * Monta motivos retorno relatorio a partir dos dados informados.
 */
function montarMotivosRetornoRelatorio(vendasRetorno) {
  const mapa = new Map();

  vendasRetorno.forEach(venda => {
    const motivoBruto = (venda.motivo_retorno || '').trim();
    const motivo = motivoBruto || 'Não informado';
    mapa.set(motivo, (mapa.get(motivo) || 0) + 1);
  });

  return Array.from(mapa.entries())
    .map(([motivo, quantidade]) => ({ motivo, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade);
}

/**
 * Obtem relatorios vendas a partir dos dados informados.
 */
async function obterRelatoriosVendas(filtros = {}) {
  const periodo = resolverPeriodoRelatorio(filtros);
  const periodoAnterior = resolverPeriodoAnterior(periodo);
  const dataReferencia = dataReferenciaVendaSQL('v');
  const etapaFinal = await obterCodigoEtapaFinal();
  const vendedoraId = filtros.vendedora_id ? Number(filtros.vendedora_id) : null;

  const [vendasPeriodo, vendasAnterioresPeriodo] = await Promise.all([
    construirQueryRelatorio({
      dataInicio: periodo.dataInicio,
      dataFimExclusiva: periodo.dataFimExclusiva,
      dataReferencia
    }),
    periodoAnterior
      ? construirQueryRelatorio({
          dataInicio: periodoAnterior.dataInicio,
          dataFimExclusiva: periodoAnterior.dataFimExclusiva,
          dataReferencia
        })
      : Promise.resolve([])
  ]);

  const usuariosPorId = await carregarUsuariosAtribuicoesRelatorio([
    ...vendasPeriodo,
    ...vendasAnterioresPeriodo
  ]);
  const vendas = filtrarVendasRelatorioPorVendedora(vendasPeriodo, vendedoraId, usuariosPorId);
  const vendasAnteriores = filtrarVendasRelatorioPorVendedora(vendasAnterioresPeriodo, vendedoraId, usuariosPorId);

  const atual = agregarVendasPeriodo(vendas, etapaFinal);
  const anterior = agregarVendasPeriodo(vendasAnteriores, etapaFinal);

  const porOperadoraMap = new Map();
  const rankingMap = new Map();

  atual.vendasValidas.forEach(venda => {
    const valor = Number(venda.valor_total || 0);
    const chips = obterQuantidadeChipsVenda(venda);
    const operadoraId = venda.operadora_id ? Number(venda.operadora_id) : null;
    const chaveOperadora = operadoraId || 'sem_operadora';
    const operadoraAtual = porOperadoraMap.get(chaveOperadora) || {
      id: operadoraId,
      nome: venda.operadora_nome || 'Sem operadora',
      valor: 0,
      vendas: 0,
      chips: 0
    };

    operadoraAtual.valor += valor;
    operadoraAtual.vendas += 1;
    operadoraAtual.chips += chips;
    porOperadoraMap.set(chaveOperadora, operadoraAtual);

    montarAtribuicoesVendedorasVenda(venda, usuariosPorId).forEach(atribuicao => {
      const chaveVendedor = atribuicao.id || 'sem_vendedor';
      const vendedorAtual = rankingMap.get(chaveVendedor) || {
        id: atribuicao.id,
        nome: atribuicao.nome,
        email: atribuicao.email,
        valor: 0,
        vendas: 0,
        chips: 0,
        retornos: 0
      };

      vendedorAtual.valor += atribuicao.valor;
      vendedorAtual.vendas += 1;
      vendedorAtual.chips += atribuicao.chips;
      rankingMap.set(chaveVendedor, vendedorAtual);
    });
  });

  atual.vendasRetorno.forEach(venda => {
    montarAtribuicoesVendedorasVenda(venda, usuariosPorId).forEach(atribuicao => {
      const chaveVendedor = atribuicao.id || 'sem_vendedor';
      const vendedorAtual = rankingMap.get(chaveVendedor) || {
        id: atribuicao.id,
        nome: atribuicao.nome,
        email: atribuicao.email,
        valor: 0,
        vendas: 0,
        chips: 0,
        retornos: 0
      };

      vendedorAtual.retornos += 1;
      rankingMap.set(chaveVendedor, vendedorAtual);
    });
  });

  return {
    periodo: {
      tipo: periodo.tipo,
      data_inicio: periodo.dataInicio,
      data_fim: periodo.dataFim
    },
    filtros: {
      vendedora_id: vendedoraId
    },
    cards: atual.cards,
    resumoPeriodo: atual.resumoPeriodo,
    comparativo: {
      concluidas: { valor: anterior.cards.concluidas.valor },
      taxaRetorno: { percentual: anterior.cards.taxaRetorno.percentual },
      vendasAndamento: { quantidade: anterior.cards.vendasAndamento.quantidade },
      ticketMedio: anterior.resumoPeriodo.ticketMedio,
      totalVendas: anterior.resumoPeriodo.totalVendas
    },
    serieDiaria: montarSerieDiariaRelatorio(vendas, periodo),
    motivosRetorno: montarMotivosRetornoRelatorio(atual.vendasRetorno),
    vendasPorFase: await montarResumoFasesDinamico(vendas),
    porOperadora: montarResumoAgrupado(porOperadoraMap),
    rankingVendedores: montarResumoAgrupado(rankingMap)
  };
}

/**
 * Salva vendedoras com os dados informados.
 */
async function salvarVendedoras(vendaId, vendedorasIds, trx) {
  await trx('venda_vendedoras').where('venda_id', vendaId).delete();
  if (!vendedorasIds || vendedorasIds.length === 0) return null;
  const rows = vendedorasIds.map((uid, i) => ({
    venda_id: vendaId,
    usuario_id: Number(uid),
    ordem: i + 1
  }));
  await trx('venda_vendedoras').insert(rows);
  return Number(vendedorasIds[0]);
}

/**
 * Garante acesso ao cliente para todas as consultoras responsáveis por uma venda.
 * O vínculo é aditivo: removê-lo é uma decisão explícita no cadastro do cliente.
 */
async function vincularClienteAsVendedoras(clienteId, vendedorasIds, trx) {
  const clienteIdNormalizado = Number(clienteId);
  const ids = Array.from(new Set((vendedorasIds || []).map(Number)
    .filter(id => Number.isInteger(id) && id > 0)));

  if (!clienteIdNormalizado || ids.length === 0) return;

  await trx('cliente_consultoras')
    .insert(ids.map(usuario_id => ({ cliente_id: clienteIdNormalizado, usuario_id })))
    .onConflict(['cliente_id', 'usuario_id'])
    .ignore();
}

/**
 * Busca venda por id conforme os parametros informados.
 */
async function buscarVendaPorId(id, usuarioId) {
  const escopo = usuarioId ? await buscarEscopoVendas(usuarioId) : { podeVerTodas: true };
  const query = Venda.query()
    .findById(id)
    .whereNull('excluido_em')
    .withGraphFetched('[cliente.[operadoraAtual, operadorasAtuais.operadora], vendedora, vendedoras, origemSondador, origemLead, operadora, tipoVenda, servico, criador, historico.usuario, aprovacaoSolicitacoes]')
    .modifyGraph('vendedora', builder => builder.select('id', 'nome', 'email', 'foto_perfil'))
    .modifyGraph('vendedoras', builder => builder.select('usuarios.id', 'usuarios.nome', 'usuarios.email', 'usuarios.foto_perfil').orderBy('venda_vendedoras.ordem', 'asc'))
    .modifyGraph('origemSondador', builder => builder.select('id', 'nome'))
    .modifyGraph('origemLead', builder => builder.select('id', 'primeira_ligacao_avaliacao', 'primeira_ligacao_avaliada_em'))
    .modifyGraph('historico', builder => builder.orderBy('created_at', 'desc').orderBy('id', 'desc'))
    .modifyGraph('historico.usuario', builder => builder.select('id', 'nome', 'email', 'foto_perfil'))
    .modifyGraph('aprovacaoSolicitacoes', builder => builder.orderBy('id', 'desc'));

  if (usuarioId) {
    aplicarEscopoVendas(query, usuarioId, escopo);
  }

  const venda = await query;
  if (!venda) return null;

  try {
    venda.integracao_dashboard = await dashboardIntegracaoService.obterResumoSincronizacao(venda.id);
  } catch (error) {
    console.error(`Erro ao obter status da integracao do dashboard para venda ${venda.id}:`, error.message);
    venda.integracao_dashboard = null;
  }

  return venda;
}

/**
 * Gera email template venda a partir dos dados informados.
 */
async function gerarEmailTemplateVenda(id, usuarioId) {
  const venda = await buscarVendaPorId(id, usuarioId);

  if (!venda) {
    return null;
  }

  return renderEmailVenda(venda);
}

/**
 * Cria venda com os dados informados.
 */
async function criarVenda(dados, usuarioId) {
  const agora = formatarDateTimeSQL();
  const origemLeadLinhaId = Number(dados.origem_lead_linha_id || 0) || null;
  const vendedorasIds = normalizarIdsVendedoras(dados.vendedoras);
  let payload = montarPayload(dados);
  const deveEnviarAutomaticamente = await usuarioTemPermissao(usuarioId, PERMISSAO_AUTO_POS_VENDA);

  validarDataVendaNaoFutura(payload.data_venda);

  delete payload.data_ativacao;
  delete payload.numeros_ativados;

  if (vendedorasIds.length > 0) {
    payload.vendedora_id = vendedorasIds[0];
  }

  validarCamposObrigatoriosCadastroVenda(payload, dados);

  if (!Number.isInteger(payload.vendedora_id) || payload.vendedora_id <= 0) {
    throw new Error('Selecione pelo menos uma vendedora para cadastrar a venda.');
  }

  await validarPermissaoCompartilharVenda({
    usuarioId,
    vendedorasIds: vendedorasIds.length > 0 ? vendedorasIds : [payload.vendedora_id].filter(Boolean)
  });

  validarVendedorasNosChips(payload, vendedorasIds);

  if (payload.cliente_id) {
    const cliente = await buscarClienteParaPayloadVenda(payload.cliente_id, usuarioId);

    if (!cliente) {
      throw new Error('Cliente não encontrado.');
    }

    payload = aplicarDadosClienteNaVenda(payload, cliente);
  }

  await validarProtocoloCliente(payload, usuarioId);

  const venda = await Venda.transaction(async trx => {
    let leadOrigem = null;
    if (origemLeadLinhaId) {
      leadOrigem = await trx('lead_linhas')
        .where({ id: origemLeadLinhaId, atribuido_para_id: Number(usuarioId) })
        .where('futuro_cliente', true)
        .whereNull('futuro_cliente_excluido_em')
        .whereNull('venda_id')
        .where(builder => builder.whereNull('status_operacional').orWhereNot('status_operacional', 'vendido'))
        .first();
      if (!leadOrigem) {
        throw new Error('Futuro cliente nao encontrado, ja vendido ou atribuido a outro consultor.');
      }
    }
    if (!leadOrigem && payload.cliente_id) {
      const clienteOrigem = await trx('clientes').where('id', payload.cliente_id).first('origem_lead_linha_id');
      if (clienteOrigem?.origem_lead_linha_id) {
        leadOrigem = await trx('lead_linhas').where('id', clienteOrigem.origem_lead_linha_id).first();
      }
    }

    const venda = await Venda.query(trx).insertAndFetch({
      ...payload,
      origem_lead_linha_id: leadOrigem?.id || null,
      origem_sondador_id: leadOrigem?.futuro_cliente_marcado_por_id || null,
      status_funil: null,
      criado_por_id: usuarioId,
      criado_em: agora,
      ultima_atividade_em: agora
    });

    await registrarHistoricoVenda({
      vendaId: venda.id,
      usuarioId,
      acao: 'venda.criada',
      statusNovo: venda.status_funil || null,
      observacao: 'Venda cadastrada',
      dados: {
        venda_id: venda.id,
        status_funil: venda.status_funil || null
      },
      createdAt: agora,
      trx
    });

    if (vendedorasIds.length > 0) {
      await salvarVendedoras(venda.id, vendedorasIds, trx);
    }

    await vincularClienteAsVendedoras(
      payload.cliente_id,
      vendedorasIds.length > 0 ? vendedorasIds : [payload.vendedora_id],
      trx
    );

    if (payload.cliente_id) {
      await copiarNotasClienteParaVenda({
        clienteId: payload.cliente_id,
        vendaId: venda.id,
        createdAt: agora,
        trx
      });
    }

    if (leadOrigem) {
      if (payload.cliente_id) {
        await trx('clientes').where('id', payload.cliente_id).update({
          origem_lead_linha_id: leadOrigem.id,
          origem_sondador_id: leadOrigem.futuro_cliente_marcado_por_id,
          updated_at: new Date()
        });
      }
      await trx('lead_linhas').where('id', leadOrigem.id).update({
        venda_id: venda.id,
        cliente_id: payload.cliente_id || null,
        etapa_atual: 'venda',
        status_operacional: 'vendido',
        updated_at: new Date()
      });
      await trx('lead_atribuicoes')
        .where({ lead_linha_id: leadOrigem.id, usuario_id: Number(usuarioId), etapa: 'venda' })
        .orderBy('id', 'desc')
        .limit(1)
        .update({
          status: 'vendido',
          finalizado_em: agora,
          acao_registrada_em: agora,
          acao_registrada_tipo: 'venda_registrada',
          updated_at: new Date()
        });
      await trx('notificacoes')
        .where('source_key', `futuro_cliente_distribuido:${leadOrigem.id}`)
        .update({ ativa: false, updated_at: new Date() });
    }

    await dashboardIntegracaoService.registrarVendaPendente(venda, trx);

    if (deveEnviarAutomaticamente) {
      return enviarVendaCriadaAutomaticamenteParaPosVenda(venda, usuarioId, agora, trx);
    }

    return venda;
  });

  // Edicoes usam atualizarVenda e nunca passam por este bloco. A marca so e gravada
  // depois de o Telegram confirmar o envio, para que uma configuracao ausente nao
  // bloqueie uma tentativa futura.
  if (!venda.telegram_notificada_em && vendaDeveNotificarTelegram(venda, new Date())) {
    try {
      const vendaParaTelegram = await Venda.query()
        .findById(venda.id)
        .withGraphFetched('[cliente, vendedora, vendedoras, origemSondador, operadora, operadoraAtual, tipoProduto, tipoVenda, servico, criador]');
      const resultadoTelegram = await telegramService.enviarVenda(vendaParaTelegram || venda);

      if (resultadoTelegram.enviado) {
        await Venda.query()
          .patch({ telegram_notificada_em: agora })
          .findById(venda.id)
          .whereNull('telegram_notificada_em');
      }
    } catch (error) {
      // A indisponibilidade do Telegram nao pode desfazer o cadastro da venda.
      console.error('Erro ao notificar nova venda no Telegram:', {
        vendaId: venda.id,
        message: error.message
      });
    }
  }

  venda.integracao_dashboard = await dashboardIntegracaoService.enviarVendaCriada(venda.id);
  return venda;
}

/**
 * Reenvia manualmente ao dashboard uma venda nova que tenha falhado na primeira tentativa.
 */
async function reenviarVendaParaDashboard(id, usuarioId) {
  const permitido = await usuarioPodeEditarVenda(id, usuarioId);
  if (!permitido) return { status: 'not_found' };

  const resultado = await dashboardIntegracaoService.reenviarVendaManualmente(id);
  if (resultado?.status === 'nao_elegivel') return { status: 'not_eligible' };

  return { status: 'ok', integracao_dashboard: resultado };
}

/**
 * Atualiza venda com os dados informados.
 */
async function atualizarVenda(id, dados, usuarioId) {
  const permitido = await usuarioPodeEditarVenda(id, usuarioId);

  if (!permitido) {
    return null;
  }

  const vendaAtual = await Venda.query()
    .findById(id)
    .select('id', 'cliente_id', 'protocolo', 'status_funil', 'enviada_pos_venda_em', 'excluido_em');

  if (!vendaAtual || vendaAtual.excluido_em) {
    return null;
  }

  const usuarioPodeOperarPosVenda = await usuarioTemPermissao(usuarioId, 'pos_venda');

  if (vendaAtual.enviada_pos_venda_em && !usuarioPodeOperarPosVenda) {
    const error = new Error('Venda já enviada ao pós-venda. Apenas usuários com permissão de pós-venda podem editar.');
    error.statusCode = 403;
    throw error;
  }

  const agora = formatarDateTimeSQL();
  const vendedorasIds = Array.isArray(dados.vendedoras) ? normalizarIdsVendedoras(dados.vendedoras) : null;
  let payload = montarPayload(dados);
  const etapaFinal = await obterCodigoEtapaFinal();
  const vendaEstaNaEtapaFinal = vendaAtual.status_funil === etapaFinal;

  validarDataVendaNaoFutura(payload.data_venda);

  if (!vendaAtual.enviada_pos_venda_em) {
    delete payload.status_funil;
    delete payload.status_anterior_retorno;
  }

  if (!vendaEstaNaEtapaFinal) {
    delete payload.data_ativacao;
    delete payload.numeros_ativados;
  }

  if (vendedorasIds && vendedorasIds.length > 0) {
    payload.vendedora_id = vendedorasIds[0];
  }

  if (payload.vendedora_id !== undefined && payload.vendedora_id !== null && (!Number.isInteger(payload.vendedora_id) || payload.vendedora_id <= 0)) {
    throw new Error('Selecione pelo menos uma vendedora valida para atualizar a venda.');
  }

  if (vendedorasIds !== null) {
    await validarPermissaoCompartilharVenda({
      usuarioId,
      vendedorasIds,
      vendaId: id
    });
  } else if (payload.vendedora_id !== undefined && payload.vendedora_id !== null) {
    await validarPermissaoCompartilharVenda({
      usuarioId,
      vendedorasIds: [payload.vendedora_id],
      vendaId: id
    });
  }

  if (vendedorasIds && vendedorasIds.length > 0) {
    validarVendedorasNosChips(payload, vendedorasIds);
  }

  if (payload.cliente_id) {
    const cliente = await buscarClienteParaPayloadVenda(payload.cliente_id, usuarioId, vendaAtual);

    if (!cliente) {
      throw new Error('Cliente não encontrado.');
    }

    payload = aplicarDadosClienteNaVenda(payload, cliente);
  }

  await validarProtocoloCliente(payload, usuarioId, vendaAtual);

  const vendaAtualizada = await Venda.transaction(async trx => {
    const venda = await Venda.query(trx).patchAndFetchById(id, {
      ...payload,
      ultima_atividade_em: agora,
      updated_at: agora
    });

    if (vendedorasIds !== null) {
      await salvarVendedoras(id, vendedorasIds, trx);
    }

    if (venda.cliente_id && (Object.prototype.hasOwnProperty.call(payload, 'cliente_id') || vendedorasIds !== null)) {
      const vendedorasParaVincular = vendedorasIds !== null
        ? vendedorasIds
        : await trx('venda_vendedoras').where('venda_id', id).pluck('usuario_id');
      await vincularClienteAsVendedoras(venda.cliente_id, [venda.vendedora_id, ...vendedorasParaVincular], trx);
    }

    if (
      Object.prototype.hasOwnProperty.call(payload, 'cliente_id')
      || vendedorasIds !== null
    ) {
      await vendaAprovacaoService.validarEnvioPosVenda(id, usuarioId, {}, trx);
    }

    return venda;
  });

  vendaAtualizada.integracao_dashboard = await dashboardIntegracaoService.sincronizarVendaAtualizada(vendaAtualizada.id);
  await solicitarPacoteSeVendaFinalizada(vendaAtualizada, usuarioId);

  return vendaAtualizada;
}

/**
 * Valida status funil e retorna o resultado esperado.
 */
async function validarStatusFunil(status) {
  if (status === 'retorno') {
    return true;
  }

  const etapas = await listarEtapasFunilOrdenadas();
  return etapas.some(etapa => etapa.id === status);
}

/**
 * Impede que a venda avance de uma etapa barreira com etapas de conferencia pendentes.
 * Retorna a mensagem de bloqueio, ou null quando a movimentacao e permitida.
 */
async function validarBarreiraConferencia(venda, statusDestino) {
  if (statusDestino === 'retorno' || venda.status_funil === 'retorno') {
    return null;
  }

  const etapasFunil = await listarEtapasFunilOrdenadas();
  const origem = etapasFunil.find(etapa => etapa.id === venda.status_funil);
  const destino = etapasFunil.find(etapa => etapa.id === statusDestino);

  if (!origem?.bloqueia_avanco) {
    return null;
  }

  // A barreira so vale para avanco: voltar atras continua liberado.
  if (!destino || Number(destino.ordem) <= Number(origem.ordem)) {
    return null;
  }

  // Require tardio: venda-etapa.service depende de venda-arquivo.service, que importa este modulo.
  const { etapasPendentes } = require('./venda-etapa.service');

  const vendaComOperadora = await Venda.query().findById(venda.id).withGraphFetched('operadora');
  const pendentes = etapasPendentes(vendaComOperadora);

  if (pendentes.length === 0) {
    return null;
  }

  return `Conclua as etapas de conferência antes de avançar: ${pendentes.map(etapa => etapa.titulo).join(', ')}.`;
}

/**
 * Atualiza status venda com os dados informados.
 */
async function atualizarStatusVenda(id, dados, usuarioId) {
  const permitido = await usuarioPodeAcessarVenda(id, usuarioId);

  if (!permitido) {
    return { status: 'not_found' };
  }

  const venda = await Venda.query().findById(id);

  if (!venda || venda.excluido_em) {
    return { status: 'not_found' };
  }

  if (venda.cancelada_em) {
    return { status: 'invalid', message: 'Venda cancelada não pode ser movimentada no funil.' };
  }

  if (!venda.enviada_pos_venda_em) {
    return { status: 'invalid', message: 'Envie a venda ao pós-venda antes de movimentar no funil.' };
  }

  const agora = formatarDateTimeSQL();
  const etapaFinal = await obterCodigoEtapaFinal();
  const status = dados.status_funil;
  const observacao = String(dados.observacao || '').trim();
  const prioridadeInformada = dados.prioridade_funil !== undefined
    ? String(dados.prioridade_funil || '').trim().toLowerCase()
    : undefined;
  const prioridade = prioridadeInformada === undefined
    ? venda.prioridade_funil || 'media'
    : prioridadeInformada;

  const retornoVoltandoParaOrigem = venda.status_funil === 'retorno' && status === (venda.status_anterior_retorno || 'aprovacao');

  if (!retornoVoltandoParaOrigem && !await usuarioTemPermissao(usuarioId, 'pos_venda')) {
    return { status: 'forbidden', message: 'Apenas usuários com permissão de pós-venda podem movimentar vendas no funil.' };
  }

  if (!retornoVoltandoParaOrigem && !await validarStatusFunil(status)) {
    return { status: 'invalid', message: 'Status do funil inválido.' };
  }

  if (!FUNIL_PRIORIDADES.includes(prioridade)) {
    return { status: 'invalid', message: 'Prioridade do funil invalida.' };
  }

  const bloqueioBarreira = await validarBarreiraConferencia(venda, status);

  if (bloqueioBarreira) {
    return { status: 'invalid', message: bloqueioBarreira };
  }

  if (status === 'retorno') {
    const motivo = String(dados.motivo_retorno || venda.motivo_retorno || '').trim();

    if (!motivo) {
      return { status: 'invalid', message: 'Informe o motivo do retorno.' };
    }

    if (venda.status_funil === 'retorno') {
      const vendaAtualizada = await Venda.transaction(async trx => {
        const atualizada = await Venda.query(trx).patchAndFetchById(id, {
          motivo_retorno: motivo,
          prioridade_funil: prioridade,
          ultima_atividade_em: agora,
          updated_at: agora
        });

        await registrarHistoricoVenda({
          vendaId: id,
          usuarioId,
          acao: 'venda.retorno_observacao_atualizada',
          statusAnterior: 'retorno',
          statusNovo: 'retorno',
          observacao: observacao || null,
          dados: {
            motivo_retorno: motivo,
            observacao
          },
          createdAt: agora,
          trx
        });

        return atualizada;
      });

      return { status: 'ok', venda: vendaAtualizada };
    }

    const statusAnterior = venda.status_funil && venda.status_funil !== 'retorno'
      ? venda.status_funil
      : (venda.status_anterior_retorno || 'aprovacao');

    const vendaAtualizada = await Venda.transaction(async trx => {
      const atualizada = await Venda.query(trx).patchAndFetchById(id, {
        status_funil: 'retorno',
        prioridade_funil: prioridade,
        status_anterior_retorno: statusAnterior,
        motivo_retorno: motivo,
        nota_correcao_retorno: null,
        retornou_em: agora,
        corrigido_em: null,
        ultima_atividade_em: agora,
        updated_at: agora
      });

      await registrarHistoricoVenda({
        vendaId: id,
        usuarioId,
        acao: 'venda.retorno_registrado',
        statusAnterior,
        statusNovo: 'retorno',
        observacao: observacao || motivo,
        dados: {
          motivo_retorno: motivo,
          observacao
        },
        createdAt: agora,
        trx
      });

      await vendaNotificacaoParadaService.desativarNotificacaoVendaParada(id, statusAnterior, trx);

      await vendaNotificacaoRetornoService.criarOuAtualizarNotificacaoRetorno({
        venda: atualizada,
        statusAnterior,
        motivo,
        usuarioId,
        trx
      });

      return atualizada;
    });

    await solicitarPacoteSeVendaFinalizada(vendaAtualizada, usuarioId, etapaFinal);
    return { status: 'ok', venda: vendaAtualizada };
  }

  if (venda.status_funil === 'retorno') {
    const nota = String(dados.nota_correcao_retorno || '').trim();

    if (!nota) {
      return { status: 'invalid', message: 'Informe o que foi corrigido.' };
    }

    const destino = venda.status_anterior_retorno || 'aprovacao';

    let clienteSincronizadoId = null;
    const vendaAtualizada = await Venda.transaction(async trx => {
      const dadosAtualizacao = {
        status_funil: destino,
        prioridade_funil: prioridade,
        nota_correcao_retorno: nota,
        corrigido_em: agora,
        ultima_atividade_em: agora,
        updated_at: agora
      };

      if (destino === etapaFinal && !venda.data_ativacao) {
        dadosAtualizacao.data_ativacao = normalizarData(dados.data_ativacao) || agora.slice(0, 10);
      }

      const atualizada = await Venda.query(trx).patchAndFetchById(id, dadosAtualizacao);

      await registrarHistoricoVenda({
        vendaId: id,
        usuarioId,
        acao: 'venda.retorno_corrigido',
        statusAnterior: 'retorno',
        statusNovo: destino,
        observacao: nota,
        dados: {
          nota_correcao_retorno: nota
        },
        createdAt: agora,
        trx
      });

      await vendaNotificacaoRetornoService.desativarNotificacaoRetorno(id, trx);

      if (destino === etapaFinal) {
        clienteSincronizadoId = await sincronizarClienteComVendaConcluida(atualizada, agora, trx);
      }

      return atualizada;
    });

    await sincronizarNotificacaoFidelidadeCliente(clienteSincronizadoId);
    return { status: 'ok', venda: vendaAtualizada };
  }

  let clienteSincronizadoId = null;
  const vendaAtualizada = await Venda.transaction(async trx => {
    const dadosAtualizacao = {
      status_funil: status,
      prioridade_funil: prioridade,
      ultima_atividade_em: agora,
      updated_at: agora
    };

    if (await statusPreencheDataAtivacao(status, etapaFinal) && !venda.data_ativacao) {
      dadosAtualizacao.data_ativacao = normalizarData(dados.data_ativacao) || agora.slice(0, 10);
    }

    const atualizada = await Venda.query(trx).patchAndFetchById(id, {
      ...dadosAtualizacao
    });

    await registrarHistoricoVenda({
      vendaId: id,
      usuarioId,
      acao: status !== venda.status_funil
        ? 'venda.status_atualizado'
        : prioridade !== (venda.prioridade_funil || 'media')
          ? 'venda.prioridade_atualizada'
          : 'venda.observacao_adicionada',
      statusAnterior: venda.status_funil || null,
      statusNovo: status,
      observacao: observacao || null,
      dados: {
        status_funil: status,
        status_anterior: venda.status_funil || null,
        prioridade_funil: prioridade,
        prioridade_anterior: venda.prioridade_funil || 'media',
        observacao
      },
      createdAt: agora,
      trx
    });

    if (status !== venda.status_funil) {
      await vendaNotificacaoParadaService.desativarNotificacaoVendaParada(id, venda.status_funil, trx);
      if (!await statusEhFinal(status)) {
        await vendaNotificacaoParadaService.registrarEntradaEstagio(id, status, new Date(agora), trx);
      }
    }

    if (status === etapaFinal) {
      clienteSincronizadoId = await sincronizarClienteComVendaConcluida(atualizada, agora, trx);
    }

    return atualizada;
  });

  await sincronizarNotificacaoFidelidadeCliente(clienteSincronizadoId);
  await solicitarPacoteSeVendaFinalizada(vendaAtualizada, usuarioId, etapaFinal);
  return { status: 'ok', venda: vendaAtualizada };
}

/**
 * Envia venda para pos venda para processamento.
 */
async function enviarVendaParaPosVenda(id, usuarioId, dados = {}) {
  const permitido = await usuarioPodeEditarVenda(id, usuarioId);

  if (!permitido) {
    return { status: 'not_found' };
  }

  const venda = await Venda.query().findById(id);

  if (!venda || venda.excluido_em) {
    return { status: 'not_found' };
  }

  if (venda.enviada_pos_venda_em) {
    return { status: 'already_sent', venda };
  }

  const agora = formatarDateTimeSQL();
  const podeEnviarSemAprovacao = await usuarioTemPermissao(usuarioId, PERMISSAO_AUTO_POS_VENDA);

  const vendaAtualizada = await Venda.transaction(async trx => {
    if (!podeEnviarSemAprovacao) {
      const validacaoAprovacao = await vendaAprovacaoService.validarEnvioPosVenda(id, usuarioId, dados, trx);

      if (validacaoAprovacao.status !== 'liberada') {
        return validacaoAprovacao;
      }
    }

    return enviarVendaParaPosVendaLiberada(venda, usuarioId, agora, trx);

  });

  if (vendaAtualizada?.status && vendaAtualizada.status !== 'liberada') {
    return vendaAtualizada;
  }

  return { status: 'ok', venda: vendaAtualizada };
}

/**
 * Normaliza venda ids para uso interno consistente.
 */
function normalizarVendaIds(ids) {
  return [...new Set([ids]
    .flat()
    .map(item => Number(item))
    .filter(Boolean))];
}

/**
 * Busca source keys notificacoes venda conforme os parametros informados.
 */
async function buscarSourceKeysNotificacoesVenda(vendaIds, trx) {
  const sourceKeys = [];

  vendaIds.forEach(vendaId => {
    sourceKeys.push(`venda_retorno:${vendaId}`);
  });

  const [notas, solicitacoes] = await Promise.all([
    trx('entidade_notas')
      .select('id')
      .where('entidade_tipo', 'venda')
      .whereIn('entidade_id', vendaIds),
    trx('venda_aprovacao_solicitacoes')
      .select('id')
      .whereIn('venda_id', vendaIds)
  ]);

  notas.forEach(nota => {
    sourceKeys.push(`nota_retorno_pre:${nota.id}`);
    sourceKeys.push(`nota_retorno_due:${nota.id}`);
  });

  solicitacoes.forEach(solicitacao => {
    sourceKeys.push(`venda_aprovacao:${solicitacao.id}`);
  });

  return sourceKeys;
}

/**
 * Exclui notificacoes vendas conforme a regra de negocio.
 */
async function excluirNotificacoesVendas(vendaIdsEntrada, trx) {
  const vendaIds = normalizarVendaIds(vendaIdsEntrada);
  if (vendaIds.length === 0) return 0;

  const sourceKeys = await buscarSourceKeysNotificacoesVenda(vendaIds, trx);

  const notificacoes = await trx('notificacoes')
    .select('id')
    .where(builder => {
      builder.where(function () {
        this.where('entidade', 'vendas').whereIn('entidade_id', vendaIds);
      });

      if (sourceKeys.length > 0) {
        builder.orWhereIn('source_key', sourceKeys);
      }

      vendaIds.forEach(vendaId => {
        builder
          .orWhere('source_key', 'like', `venda_parada_funil:${vendaId}:%`);
      });
    });

  const notificacaoIds = notificacoes.map(notificacao => Number(notificacao.id)).filter(Boolean);

  if (notificacaoIds.length > 0) {
    await trx('notificacao_destinatarios')
      .whereIn('notificacao_id', notificacaoIds)
      .delete();

    await trx('notificacoes')
      .whereIn('id', notificacaoIds)
      .delete();
  }

  await trx('venda_notificacao_parada')
    .whereIn('venda_id', vendaIds)
    .delete();

  return notificacaoIds.length;
}

/**
 * Exclui venda conforme a regra de negocio.
 */
async function excluirVenda(id, usuarioId) {
  const permitido = await usuarioPodeAcessarVenda(id, usuarioId);

  if (!permitido) {
    return 0;
  }

  // A exclusao local so acontece depois que os lancamentos externos forem removidos.
  // Assim, uma indisponibilidade do dashboard nao deixa uma venda visivel apenas la.
  await dashboardIntegracaoService.excluirVendaNoDashboard(id);

  const agora = new Date();

  return Venda.transaction(async trx => {
    const atualizados = await trx('vendas')
      .where('id', id)
      .whereNull('excluido_em')
      .update({
        excluido_em: formatarDateTimeSQL(agora),
        excluir_definitivo_em: formatarDateTimeSQL(adicionarUmMes(agora)),
        excluido_por_id: usuarioId,
        updated_at: formatarDateTimeSQL(agora)
      });

    if (atualizados) {
      await excluirNotificacoesVendas(id, trx);
    }

    return atualizados;
  });
}

/**
 * Adiciona um mes ao conjunto atual.
 */
function adicionarUmMes(data = new Date()) {
  const proxima = new Date(data);
  proxima.setMonth(proxima.getMonth() + 1);
  return proxima;
}

/**
 * Limpa vendas vencidas da lixeira e restaura o estado inicial.
 */
async function limparVendasVencidasDaLixeira() {
  return Venda.transaction(async trx => {
    const vendas = await trx('vendas')
      .select('id')
      .whereNotNull('excluido_em')
      .where('excluir_definitivo_em', '<=', formatarDateTimeSQL());

    const vendaIds = vendas.map(venda => Number(venda.id)).filter(Boolean);
    if (vendaIds.length === 0) return 0;

    await excluirNotificacoesVendas(vendaIds, trx);

    return trx('vendas')
      .whereIn('id', vendaIds)
      .whereNotNull('excluido_em')
      .delete();
  });
}

/**
 * Lista vendas lixeira conforme os filtros e parametros informados.
 */
async function listarVendasLixeira(filtros = {}, usuarioId) {
  await limparVendasVencidasDaLixeira();

  const escopo = await buscarEscopoVendas(usuarioId);
  const query = Venda.query()
    .withGraphFetched('[cliente.[operadoraAtual, operadorasAtuais.operadora], vendedora, operadora, tipoVenda, servico, criador, excluidoPor]')
    .modifyGraph('vendedora', builder => builder.select('id', 'nome', 'email', 'foto_perfil'))
    .whereNotNull('excluido_em')
    .orderBy('excluido_em', 'desc')
    .orderBy('id', 'desc');

  aplicarEscopoVendas(query, usuarioId, escopo);

  if (filtros.busca) {
    const busca = `%${filtros.busca}%`;

    query.where((builder) => {
      builder
        .where('nome', 'like', busca)
        .orWhere('telefone', 'like', busca)
        .orWhere('email', 'like', busca)
        .orWhere('produto_fechado', 'like', busca)
        .orWhere('razao_social', 'like', busca)
        .orWhere('cnpj', 'like', busca)
        .orWhere('municipio', 'like', busca);
    });
  }

  if (filtros.vendedora_id) {
    query.where('vendedora_id', Number(filtros.vendedora_id));
  }

  return query;
}

/**
 * Restaura venda quando a regra de negocio permite.
 */
async function restaurarVenda(id, usuarioId) {
  const permitido = await usuarioPodeAcessarVenda(id, usuarioId, { incluirLixeira: true });

  if (!permitido) {
    return null;
  }

  await dashboardIntegracaoService.restaurarVendaNoDashboard(id);

  const atualizados = await Venda.knex()('vendas')
    .where('id', id)
    .whereNotNull('excluido_em')
    .update({
      excluido_em: null,
      excluir_definitivo_em: null,
      excluido_por_id: null,
      updated_at: formatarDateTimeSQL()
    });

  if (!atualizados) {
    return null;
  }

  return buscarVendaPorId(id, usuarioId);
}

/**
 * Exclui venda definitivo conforme a regra de negocio.
 */
async function excluirVendaDefinitivo(id, usuarioId) {
  const permitido = await usuarioPodeAcessarVenda(id, usuarioId, { incluirLixeira: true });

  if (!permitido) {
    return 0;
  }

  return Venda.transaction(async trx => {
    await excluirNotificacoesVendas(id, trx);

    return trx('vendas')
      .where('id', id)
      .whereNotNull('excluido_em')
      .delete();
  });
}

/**
 * Lista vendedoras conforme os filtros e parametros informados.
 */
async function listarVendedoras(usuarioId) {
  const podeCompartilhar = usuarioId
    ? (
      await usuarioTemPermissao(usuarioId, 'compartilhar_venda')
      || await usuarioTemPermissao(usuarioId, 'clientes_atribuir_vendedora')
      || await usuarioTemPermissao(usuarioId, 'vendas_atribuir_qualquer_vendedor')
    )
    : true;
  const query = Usuario.query()
    .select('id', 'nome', 'email', 'ativo')
    .where('ativo', true)
    .orderBy('nome', 'asc');

  if (!podeCompartilhar && usuarioId) {
    query.where('id', usuarioId);
  }

  return query;
}

/**
 * Verifica se status eh final atende a condicao esperada.
 */
async function statusEhFinal(status) {
  const codigoFinal = await obterCodigoEtapaFinal();
  return status === codigoFinal;
}

/**
 * Conta vendas concluidas por cliente conforme os dados informados.
 */
async function contarVendasConcluidasPorCliente() {
  let codigosFinais;
  try {
    const etapas = await FunilEtapa.query().where('etapa_final', true).where('ativo', true);
    codigosFinais = etapas.length ? etapas.map(e => e.codigo) : ['concluido'];
  } catch {
    codigosFinais = ['concluido'];
  }

  const linhas = await Venda.knex()('vendas')
    .whereNull('excluido_em')
    .whereNotNull('cliente_id')
    .whereIn('status_funil', codigosFinais)
    .groupBy('cliente_id')
    .select('cliente_id')
    .count('id as total');

  return linhas.reduce((acc, linha) => {
    acc[linha.cliente_id] = Number(linha.total);
    return acc;
  }, {});
}

/**
 * Processa cancelar venda conforme as regras do dominio.
 */
async function cancelarVenda(id, { motivo, usuarioId }) {
  const motivoLimpo = String(motivo || '').trim();

  if (!motivoLimpo) {
    return { status: 'invalid', message: 'Informe o motivo do cancelamento.' };
  }

  if (!await usuarioTemPermissao(usuarioId, 'vendas_cancelar')) {
    return { status: 'forbidden', message: 'Voce nao tem permissao para cancelar vendas.' };
  }

  const permitido = await usuarioPodeAcessarVenda(id, usuarioId);

  if (!permitido) {
    return { status: 'not_found' };
  }

  const venda = await Venda.query().findById(id);

  if (!venda || venda.excluido_em) {
    return { status: 'not_found' };
  }

  if (venda.cancelada_em) {
    return { status: 'invalid', message: 'Venda ja esta cancelada.' };
  }

  const agora = formatarDateTimeSQL();

  const vendaAtualizada = await Venda.transaction(async trx => {
    const atualizada = await Venda.query(trx).patchAndFetchById(id, {
      cancelada_em: agora,
      cancelada_por_id: usuarioId,
      motivo_cancelamento: motivoLimpo,
      ultima_atividade_em: agora,
      updated_at: agora
    });

    await registrarHistoricoVenda({
      vendaId: id,
      usuarioId,
      acao: 'venda.cancelada',
      statusAnterior: venda.status_funil || null,
      statusNovo: venda.status_funil || null,
      observacao: motivoLimpo,
      dados: { motivo_cancelamento: motivoLimpo },
      createdAt: agora,
      trx
    });

    await vendaNotificacaoCancelamentoService.criarNotificacaoCancelamento({
      venda: atualizada,
      motivo: motivoLimpo,
      usuarioId,
      trx
    });

    return atualizada;
  });

  return { status: 'ok', venda: vendaAtualizada };
}

/**
 * Processa reverter cancelamento venda conforme as regras do dominio.
 */
async function reverterCancelamentoVenda(id, usuarioId, dados = {}) {
  if (!await usuarioTemPermissao(usuarioId, 'vendas_reverter_cancelamento')) {
    return { status: 'forbidden', message: 'Voce nao tem permissao para reverter o cancelamento.' };
  }

  const permitido = await usuarioPodeAcessarVenda(id, usuarioId);

  if (!permitido) {
    return { status: 'not_found' };
  }

  const venda = await Venda.query().findById(id);

  if (!venda || venda.excluido_em) {
    return { status: 'not_found' };
  }

  if (!venda.cancelada_em) {
    return { status: 'invalid', message: 'Venda nao esta cancelada.' };
  }

  const observacao = String(dados.observacao || '').trim() || null;
  const agora = formatarDateTimeSQL();

  const vendaAtualizada = await Venda.transaction(async trx => {
    const atualizada = await Venda.query(trx).patchAndFetchById(id, {
      cancelada_em: null,
      cancelada_por_id: null,
      motivo_cancelamento: null,
      ultima_atividade_em: agora,
      updated_at: agora
    });

    await registrarHistoricoVenda({
      vendaId: id,
      usuarioId,
      acao: 'venda.cancelamento_revertido',
      statusAnterior: venda.status_funil || null,
      statusNovo: venda.status_funil || null,
      observacao,
      dados: {
        motivo_cancelamento_anterior: venda.motivo_cancelamento,
        observacao
      },
      createdAt: agora,
      trx
    });

    await vendaNotificacaoCancelamentoService.desativarNotificacaoCancelamento(id, trx);

    return atualizada;
  });

  return { status: 'ok', venda: vendaAtualizada };
}

module.exports = {
  listarVendas,
  obterReferenciasClientes,
  gerarXlsxVendas,
  listarVendasRetornoResumo,
  obterContextoDashboard,
  listarVendasLixeira,
  obterResumoDashboard,
  obterRelatoriosVendas,
  buscarVendaPorId,
  gerarEmailTemplateVenda,
  criarVenda,
  reenviarVendaParaDashboard,
  atualizarVenda,
  atualizarStatusVenda,
  cancelarVenda,
  reverterCancelamentoVenda,
  enviarVendaParaPosVenda,
  excluirVenda,
  restaurarVenda,
  excluirVendaDefinitivo,
  listarVendedoras,
  contarVendasConcluidasPorCliente,
  _internals: {
    aplicarDadosClienteNaVenda,
    adicionarMesesDataISO,
    calcularTotalChips,
    limparValor,
    montarDadosSincronizacaoClienteVenda,
    montarAtribuicoesVendedorasVenda,
    montarPayload,
    normalizarClienteSolicitouNumeros,
    normalizarClienteSolicitouServicos,
    normalizarData,
    obterDataAtualSaoPaulo,
    validarDataVendaNaoFutura,
    vendaDeveNotificarTelegram,
    normalizarGigas,
    normalizarIdsVendedoras,
    normalizarItensChips,
    normalizarNumerosLista,
    normalizarTipoLinhaChip,
    obterTipoLinhaPorNomeTipoVenda,
    obterDataLimiteConcluidaAntiga,
    obterAtribuicaoVendedoraVenda,
    obterQuantidadeChipsVenda,
    obterUltimaAtividadeFunil,
    parseValorMonetario,
    filtrarVendasRelatorioPorVendedora,
    resumirGigasItensChips,
    somarQuantidadeItensChips,
    validarVendedorasNosChips,
    vendaDeveAparecerNoFunil
  }
};
