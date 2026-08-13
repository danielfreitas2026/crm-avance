const crypto = require('crypto');
const Busboy = require('busboy');
/**
 * Servico de preview e importacao de vendas de empresas por planilha.
 */
const ExcelJS = require('exceljs');
const Cliente = require('../models/Cliente');
const ClienteOperadora = require('../models/ClienteOperadora');
const Venda = require('../models/Venda');
const VendaHistorico = require('../models/VendaHistorico');
const Usuario = require('../models/Usuario');
const Operadora = require('../models/Operadora');
const TipoVenda = require('../models/TipoVenda');
const Servico = require('../models/Servico');
const TipoProduto = require('../models/TipoProduto');

const ORIGEM_IMPORTACAO = 'controle_vendas_empresas';

/** Retorna o dia operacional corrente do CRM. */
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

const COLUNAS_PADRAO = {
  razao_social: 'RAZAO SOCIAL',
  cnpj: 'CNPJ',
  cidade: 'CIDADE',
  uf: 'UF',
  quantidade: 'QUANTIDADE',
  produto: 'PRODUTO (MOVEL / FIXO / FIBRA)',
  valor: 'VALOR',
  receita: 'RECEITA CONTRATADA',
  novo: 'NOVO',
  portabilidade: 'PORTABILIDADE',
  consultor: 'CONSULTOR',
  data_venda: 'DATA DA VENDA',
  data_input: 'DATA INPUT',
  data_aceite: 'DATA ACEITE',
  status: 'STATUS',
  data_ativacao: 'DATA DA ATIVAÇÃO',
  operadora: 'OPERADORA',
  observacoes: 'OBS',
  fidelidade: 'TEM FIDELIDADE S/N',
  cliente_ciente: 'FOI PASSADO P CLIENTE',
  fechado_rl: 'FECHADO COM RL ',
  fechado_terceiros: 'FECHADO COM TERCEIROS',
  whatsapp: 'NÚMERO WHATSAPP',
  rl: 'RL',
  email: 'E-MAIL',
  promessa: 'PROMESSA DE CANCELAMENTO/ATUALIZAÇÃO/BLOQUEIO?',
  promessa_data_prevista: 'DATA PREVISTA DO PEDIDO DE CANCELAMENTO/ATUALIZAÇÃO/BLOQUEIO',
  promessa_data_realizada: 'DATA DO CANCELAMENTO/ATUALIZAÇÃO/BLOQUEIO REALIZADO',
  obs_interna: 'OBS DEBORA (NÃO ALTERAR)'
};

const CAMPOS_MAPEAMENTO = [
  { name: 'razao_social', label: 'Cliente: razao social', required: true },
  { name: 'cnpj', label: 'Cliente: CNPJ', required: true },
  { name: 'cidade', label: 'Cliente/Venda: cidade' },
  { name: 'uf', label: 'Cliente/Venda: UF' },
  { name: 'quantidade', label: 'Venda: quantidade' },
  { name: 'produto', label: 'Venda: produto', required: true },
  { name: 'valor', label: 'Venda: valor unitario' },
  { name: 'receita', label: 'Venda: receita contratada' },
  { name: 'novo', label: 'Venda: quantidade novo' },
  { name: 'portabilidade', label: 'Venda: quantidade portabilidade' },
  { name: 'consultor', label: 'Venda: consultora', required: true },
  { name: 'data_venda', label: 'Venda: data da venda', required: true },
  { name: 'data_input', label: 'Venda: data input' },
  { name: 'data_aceite', label: 'Venda: data aceite' },
  { name: 'status', label: 'Venda: status' },
  { name: 'data_ativacao', label: 'Venda: data ativacao' },
  { name: 'operadora', label: 'Venda: operadora' },
  { name: 'observacoes', label: 'Venda: observacoes' },
  { name: 'fidelidade', label: 'Cliente: fidelidade' },
  { name: 'cliente_ciente', label: 'Venda: cliente ciente' },
  { name: 'fechado_rl', label: 'Venda: fechado com RL' },
  { name: 'fechado_terceiros', label: 'Venda: fechado com terceiros' },
  { name: 'whatsapp', label: 'Cliente: WhatsApp' },
  { name: 'rl', label: 'Cliente: representante legal' },
  { name: 'email', label: 'Cliente: e-mail' },
  { name: 'promessa', label: 'Venda: promessa/solicitacao' },
  { name: 'promessa_data_prevista', label: 'Venda: data prevista solicitacao' },
  { name: 'promessa_data_realizada', label: 'Venda: data realizada solicitacao' },
  { name: 'obs_interna', label: 'Venda: observacao interna' }
];

/**
 * Cria http error com os dados informados.
 */
function criarHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * Normaliza texto para uso interno consistente.
 */
function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Retorna texto celula no formato esperado pelo fluxo.
 */
function textoCelula(valor) {
  if (valor === null || valor === undefined) return '';
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (typeof valor !== 'object') return String(valor).trim();
  if (Array.isArray(valor.richText)) {
    return valor.richText.map(item => item.text || '').join('').trim();
  }
  if (valor.text) return String(valor.text).trim();
  if (valor.result !== undefined) return textoCelula(valor.result);
  return String(valor).trim();
}

/**
 * Sanitiza cnpj removendo caracteres nao esperados.
 */
function sanitizarCnpj(valor) {
  return String(valor || '').replace(/\D/g, '').slice(0, 14);
}

/**
 * Formata cnpj para exibicao ou envio.
 */
function formatarCnpj(valor) {
  const digitos = sanitizarCnpj(valor);
  if (digitos.length !== 14) return String(valor || '').trim();
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`;
}

/**
 * Processa separar telefone conforme as regras do dominio.
 */
function separarTelefone(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');

  if (!digitos) {
    return { ddd: null, numero: null, completo: null };
  }

  return {
    ddd: digitos.slice(0, 2) || null,
    numero: digitos.slice(2) || null,
    completo: digitos
  };
}

/**
 * Converte valor monetario para o formato interno esperado.
 */
function parseValorMonetario(valor) {
  if (valor === undefined || valor === null || valor === '') return 0;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;

  const texto = String(valor)
    .replace(/\s/g, '')
    .replace(/^R\$/i, '');

  if (!texto) return 0;

  if (texto.includes(',')) {
    return Number(texto.replace(/\./g, '').replace(',', '.')) || 0;
  }

  return Number(texto) || 0;
}

/**
 * Converte inteiro para o formato interno esperado.
 */
function parseInteiro(valor) {
  if (valor === undefined || valor === null || valor === '') return 0;
  if (typeof valor === 'number') return Number.isFinite(valor) ? Math.trunc(valor) : 0;
  return Number(String(valor).replace(/\D/g, '')) || 0;
}

/**
 * Normaliza data para uso interno consistente.
 */
function normalizarData(valor) {
  if (!valor) return null;

  const texto = valor instanceof Date
    ? [
        valor.getUTCFullYear(),
        String(valor.getUTCMonth() + 1).padStart(2, '0'),
        String(valor.getUTCDate()).padStart(2, '0')
      ].join('-')
    : String(valor).trim();

  const iso = texto.slice(0, 10);
  const isoMatch = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (isoMatch) {
    const [, ano, mes, dia] = isoMatch;
    const data = new Date(`${ano}-${mes}-${dia}T00:00:00`);
    const valida = data.getFullYear() === Number(ano)
      && data.getMonth() + 1 === Number(mes)
      && data.getDate() === Number(dia);
    return valida && Number(ano) >= 1900 ? iso : null;
  }

  const brMatch = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!brMatch) return null;

  const [, dia, mes, ano] = brMatch;
  const anoCompleto = ano.length === 2 ? `20${ano}` : ano;
  const data = new Date(`${anoCompleto}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}T00:00:00`);
  const valida = data.getFullYear() === Number(anoCompleto)
    && data.getMonth() + 1 === Number(mes)
    && data.getDate() === Number(dia);

  return valida && Number(anoCompleto) >= 1900
    ? `${anoCompleto}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`
    : null;
}

/**
 * Formata date time sql para exibicao ou envio.
 */
function formatarDateTimeSQL(data = new Date()) {
  /**
   * Preenche valores numericos com zero a esquerda.
   */
  const pad = value => String(value).padStart(2, '0');

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
 * Processa ler arquivo multipart conforme as regras do dominio.
 */
function lerArquivoMultipart(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers });
    const chunks = [];
    const campos = {};
    let arquivo = null;

    busboy.on('field', (name, value) => {
      campos[name] = value;
    });

    busboy.on('file', (name, file, info) => {
      arquivo = {
        fieldname: name,
        filename: info.filename,
        mimeType: info.mimeType
      };

      file.on('data', chunk => chunks.push(chunk));
      file.on('limit', () => reject(criarHttpError(400, 'Arquivo excede o limite permitido.')));
    });

    busboy.on('error', reject);
    busboy.on('finish', () => {
      if (!arquivo || chunks.length === 0) {
        reject(criarHttpError(400, 'Envie uma planilha XLSX.'));
        return;
      }

      if (!String(arquivo.filename || '').toLowerCase().endsWith('.xlsx')) {
        reject(criarHttpError(400, 'Envie um arquivo .xlsx.'));
        return;
      }

      resolve({
        ...arquivo,
        buffer: Buffer.concat(chunks),
        campos
      });
    });

    req.pipe(busboy);
  });
}

/**
 * Renderiza ler worksheet.
 */
async function lerWorksheet(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];

  if (!worksheet) {
    throw criarHttpError(400, 'A planilha nao possui abas.');
  }

  return worksheet;
}

/**
 * Obtem cabecalhos a partir dos dados informados.
 */
function obterCabecalhos(worksheet) {
  const headerRow = worksheet.getRow(1);
  const colunas = [];

  for (let col = 1; col <= worksheet.columnCount; col += 1) {
    const nome = textoCelula(headerRow.getCell(col).value);
    if (nome) {
      colunas.push({ nome, index: col });
    }
  }

  if (colunas.length === 0) {
    throw criarHttpError(400, 'Nao foi possivel identificar cabecalhos na primeira linha.');
  }

  return colunas;
}

/**
 * Converte mapeamento para o formato interno esperado.
 */
function parseMapeamento(valor) {
  if (!valor) return {};
  if (typeof valor === 'object') return valor;
  try {
    return JSON.parse(valor);
  } catch {
    return {};
  }
}

/**
 * Processa sugerir mapeamento conforme as regras do dominio.
 */
function sugerirMapeamento(colunas) {
  const porTexto = new Map(colunas.map(coluna => [normalizarTexto(coluna.nome), coluna.nome]));

  /**
   * Processa achar conforme as regras do dominio.
   */
  function achar(...termos) {
    const termosNorm = termos.map(normalizarTexto);
    for (const [texto, nome] of porTexto.entries()) {
      if (termosNorm.some(termo => texto === termo || texto.includes(termo))) {
        return nome;
      }
    }
    return '';
  }

  return {
    razao_social: achar('razao social', 'razao'),
    cnpj: achar('cnpj'),
    cidade: achar('cidade', 'municipio'),
    uf: achar('uf', 'estado'),
    quantidade: achar('quantidade', 'qtd'),
    produto: achar('produto'),
    valor: achar('valor unitario', 'valor'),
    receita: achar('receita contratada', 'receita'),
    novo: achar('novo'),
    portabilidade: achar('portabilidade'),
    consultor: achar('consultor', 'consultora', 'vendedora', 'vendedor'),
    data_venda: achar('data da venda', 'data venda'),
    data_input: achar('data input', 'input'),
    data_aceite: achar('data aceite', 'aceite'),
    status: achar('status', 'situacao'),
    data_ativacao: achar('data da ativacao', 'data ativacao', 'ativacao'),
    operadora: achar('operadora'),
    observacoes: achar('obs', 'observacoes', 'observacao'),
    fidelidade: achar('fidelidade'),
    cliente_ciente: achar('passado p cliente', 'cliente ciente', 'foi passado'),
    fechado_rl: achar('fechado com rl'),
    fechado_terceiros: achar('fechado com terceiros'),
    whatsapp: achar('numero whatsapp', 'whatsapp'),
    rl: achar('rl', 'representante legal'),
    email: achar('e-mail', 'email'),
    promessa: achar('promessa', 'cancelamento/atualizacao/bloqueio'),
    promessa_data_prevista: achar('data prevista'),
    promessa_data_realizada: achar('data do cancelamento', 'data realizada'),
    obs_interna: achar('obs debora', 'obs interna')
  };
}

/**
 * Resolve mapeamento a partir do contexto atual.
 */
function resolverMapeamento(worksheet, mapeamento = {}) {
  const colunas = obterCabecalhos(worksheet);
  const sugestoes = sugerirMapeamento(colunas);
  const nomesColunas = new Set(colunas.map(coluna => coluna.nome));
  const resolvido = {};

  CAMPOS_MAPEAMENTO.forEach(campo => {
    const informado = mapeamento[campo.name];
    const sugerido = sugestoes[campo.name];
    const padrao = colunas.find(coluna => normalizarTexto(coluna.nome) === normalizarTexto(COLUNAS_PADRAO[campo.name]))?.nome;
    resolvido[campo.name] = nomesColunas.has(informado)
      ? informado
      : (nomesColunas.has(sugerido) ? sugerido : (padrao || ''));
  });

  return { colunas, sugestoes: resolvido, mapeamento: resolvido };
}

/**
 * Monta header map a partir dos dados informados.
 */
function montarHeaderMap(worksheet) {
  return new Map(obterCabecalhos(worksheet).map(coluna => [normalizarTexto(coluna.nome), coluna.index]));
}

/**
 * Retorna valor linha no formato esperado pelo fluxo.
 */
function valorLinha(row, headerMap, coluna) {
  const index = headerMap.get(normalizarTexto(coluna));
  if (!index) return '';
  return textoCelula(row.getCell(index).value);
}

/**
 * Obtem data linha a partir dos dados informados.
 */
function obterDataLinha(row, headerMap, coluna) {
  const index = headerMap.get(normalizarTexto(coluna));
  if (!index) return null;
  const value = row.getCell(index).value;
  return normalizarData(value instanceof Date ? value : textoCelula(value));
}

/**
 * Processa escolher texto conforme as regras do dominio.
 */
function escolherTexto(...valores) {
  return valores.find(valor => String(valor || '').trim()) || '';
}

/**
 * Mapeia por nome para o formato usado pela aplicacao.
 */
function mapPorNome(linhas) {
  return new Map(linhas.map(item => [normalizarTexto(item.nome), item]));
}

/**
 * Monta referencias a partir dos dados informados.
 */
async function montarReferencias(trx = null) {
  const [usuarios, operadoras, tiposVenda, servicos, tiposProduto] = await Promise.all([
    Usuario.query(trx).select('id', 'nome', 'email', 'ativo').where('ativo', true),
    Operadora.query(trx).select('id', 'nome'),
    TipoVenda.query(trx).select('id', 'nome'),
    Servico.query(trx).select('id', 'nome'),
    TipoProduto.query(trx).select('id', 'nome')
  ]);

  return {
    usuariosPorNome: mapPorNome(usuarios),
    operadorasPorNome: mapPorNome(operadoras),
    tiposPorNome: mapPorNome(tiposVenda),
    servicosPorNome: mapPorNome(servicos),
    tiposProdutoPorNome: mapPorNome(tiposProduto)
  };
}

/**
 * Garante tipos produto antes de continuar o fluxo.
 */
async function garantirTiposProduto(produtos, referencias, trx) {
  const nomes = Array.from(new Set(
    produtos
      .map(produto => String(produto || '').trim())
      .filter(Boolean)
  ));

  let proximaOrdem = await TipoProduto.query(trx).max('ordem as max').first();
  proximaOrdem = Number(proximaOrdem?.max || 0) + 1;
  const criados = [];

  for (const nome of nomes) {
    const chave = normalizarTexto(nome);
    if (referencias.tiposProdutoPorNome.has(chave)) {
      continue;
    }

    const existente = await TipoProduto.query(trx)
      .whereRaw('LOWER(nome) = ?', [nome.toLowerCase()])
      .first();

    if (existente) {
      referencias.tiposProdutoPorNome.set(chave, existente);
      continue;
    }

    const criado = await TipoProduto.query(trx).insertAndFetch({
      nome,
      ativo: true,
      ordem: proximaOrdem
    });
    proximaOrdem += 1;
    referencias.tiposProdutoPorNome.set(chave, criado);
    criados.push(criado.nome);
  }

  return criados;
}

/**
 * Resolve tipo linha a partir do contexto atual.
 */
function resolverTipoLinha({ novo, portabilidade }) {
  const qtdPortabilidade = parseInteiro(portabilidade);
  const qtdNovo = parseInteiro(novo);
  return qtdPortabilidade > 0 && qtdNovo === 0 ? 'portabilidade' : 'novo';
}

/**
 * Resolve tipo venda id a partir do contexto atual.
 */
function resolverTipoVendaId(grupo, tiposPorNome) {
  const temPortabilidade = grupo.itensChips.some(item => item.tipo_linha === 'portabilidade');
  const todosPortabilidade = temPortabilidade && grupo.itensChips.every(item => item.tipo_linha === 'portabilidade');
  const tipo = todosPortabilidade ? 'portabilidade' : 'novo';
  return tiposPorNome.get(tipo)?.id || null;
}

/**
 * Resolve servico id a partir do contexto atual.
 */
function resolverServicoId(produto, servicosPorNome) {
  const texto = normalizarTexto(produto);

  if (texto.includes('movel')) {
    return servicosPorNome.get('telefonia movel')?.id || null;
  }

  if (texto.includes('fibra') || texto.includes('internet')) {
    return servicosPorNome.get('internet')?.id || null;
  }

  if (texto.includes('fixo')) {
    return servicosPorNome.get('telefonia fixa')?.id || null;
  }

  return null;
}

/**
 * Resolve status funil a partir do contexto atual.
 */
function resolverStatusFunil(status) {
  const texto = normalizarTexto(status);

  if (!texto || texto.includes('cancel')) {
    return { status_funil: null, prioridade_funil: 'media', enviada: false };
  }

  if (
    texto.includes('ativado')
    || texto.includes('faturado')
    || texto.includes('instalado')
    || texto.includes('entregue')
  ) {
    return { status_funil: 'concluido', prioridade_funil: 'media', enviada: true };
  }

  if (texto.includes('aceite') || texto.includes('input') || texto.includes('libera')) {
    return { status_funil: 'aprovacao', prioridade_funil: 'media', enviada: true };
  }

  return { status_funil: null, prioridade_funil: 'media', enviada: false };
}

/**
 * Monta cliente solicitou a partir dos dados informados.
 */
function montarClienteSolicitou(linha) {
  const texto = normalizarTexto(linha.promessa);
  const servicos = [];

  if (texto.includes('bloque')) servicos.push('bloqueio');
  if (texto.includes('cancel')) servicos.push('cancelamento');

  if (servicos.length === 0) {
    return {};
  }

  const resolvido = linha.promessaDataRealizada ? 'sim' : 'nao';

  return {
    cliente_solicitou_servicos: JSON.stringify(servicos),
    cliente_solicitou_bloqueio_qtd: servicos.includes('bloqueio') ? 1 : null,
    cliente_solicitou_cancelamento_qtd: servicos.includes('cancelamento') ? 1 : null,
    cliente_solicitou_resolvido: resolvido,
    cliente_solicitou_resolvido_em: linha.promessaDataRealizada || null,
    cliente_solicitou_observacao: [linha.promessa, linha.promessaDataPrevista ? `Data prevista: ${linha.promessaDataPrevista}` : '']
      .filter(Boolean)
      .join('\n') || null
  };
}

/**
 * Monta observacoes a partir dos dados informados.
 */
function montarObservacoes(grupo) {
  const partes = [];
  const status = grupo.status ? `Status planilha: ${grupo.status}` : '';
  const dataInput = grupo.dataInput ? `Data input: ${grupo.dataInput}` : '';
  const dataAceite = grupo.dataAceite ? `Data aceite: ${grupo.dataAceite}` : '';
  const fidelidade = grupo.fidelidade ? `Fidelidade planilha: ${grupo.fidelidade}` : '';
  const ciente = grupo.clienteCiente ? `Passado para cliente: ${grupo.clienteCiente}` : '';
  const fechadoRl = grupo.fechadoRl ? `Fechado com RL: ${grupo.fechadoRl}` : '';
  const fechadoTerceiros = grupo.fechadoTerceiros ? `Fechado com terceiros: ${grupo.fechadoTerceiros}` : '';

  partes.push(status, dataInput, dataAceite, fidelidade, ciente, fechadoRl, fechadoTerceiros);
  partes.push(...grupo.observacoes);
  partes.push(...grupo.obsInternas.map(obs => `Obs interna: ${obs}`));

  return Array.from(new Set(partes.filter(Boolean))).join('\n') || null;
}

/**
 * Cria chave importacao com os dados informados.
 */
function criarChaveImportacao(grupo) {
  const base = {
    cnpj: grupo.cnpjDigitos,
    data_venda: grupo.dataVenda,
    produto: normalizarTexto(grupo.produto),
    status: normalizarTexto(grupo.status),
    operadora: normalizarTexto(grupo.operadora),
    consultores: grupo.vendedorasIds,
    itens: grupo.itensChips.map(item => ({
      quantidade: item.quantidade,
      tipo_linha: item.tipo_linha,
      valor_unitario: item.valor_unitario,
      vendedora_id: item.vendedora_id || null
    }))
  };

  return crypto.createHash('sha1').update(JSON.stringify(base)).digest('hex');
}

/**
 * Verifica se linha vazia atende a condicao esperada.
 */
function linhaVazia(linha) {
  return !linha.cnpjDigitos && !linha.razaoSocial && !linha.consultor && !linha.produto;
}

/**
 * Processa ler linhas planilha conforme as regras do dominio.
 */
function lerLinhasPlanilha(worksheet, mapeamento = null, agora = new Date()) {
  const headerMap = montarHeaderMap(worksheet);
  const mapa = mapeamento || resolverMapeamento(worksheet).mapeamento;
  const linhas = [];
  const erros = [];

  for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    const linha = {
      rowIndex,
      razaoSocial: valorLinha(row, headerMap, mapa.razao_social),
      cnpj: valorLinha(row, headerMap, mapa.cnpj),
      cidade: valorLinha(row, headerMap, mapa.cidade),
      uf: valorLinha(row, headerMap, mapa.uf),
      quantidade: parseInteiro(valorLinha(row, headerMap, mapa.quantidade)),
      produto: valorLinha(row, headerMap, mapa.produto),
      valor: parseValorMonetario(valorLinha(row, headerMap, mapa.valor)),
      receita: parseValorMonetario(valorLinha(row, headerMap, mapa.receita)),
      novo: valorLinha(row, headerMap, mapa.novo),
      portabilidade: valorLinha(row, headerMap, mapa.portabilidade),
      consultor: valorLinha(row, headerMap, mapa.consultor),
      dataVenda: obterDataLinha(row, headerMap, mapa.data_venda),
      dataInput: obterDataLinha(row, headerMap, mapa.data_input),
      dataAceite: obterDataLinha(row, headerMap, mapa.data_aceite),
      status: valorLinha(row, headerMap, mapa.status),
      dataAtivacao: obterDataLinha(row, headerMap, mapa.data_ativacao),
      operadora: valorLinha(row, headerMap, mapa.operadora),
      observacoes: valorLinha(row, headerMap, mapa.observacoes),
      fidelidade: valorLinha(row, headerMap, mapa.fidelidade),
      clienteCiente: valorLinha(row, headerMap, mapa.cliente_ciente),
      fechadoRl: valorLinha(row, headerMap, mapa.fechado_rl),
      fechadoTerceiros: valorLinha(row, headerMap, mapa.fechado_terceiros),
      whatsapp: valorLinha(row, headerMap, mapa.whatsapp),
      rl: valorLinha(row, headerMap, mapa.rl),
      email: valorLinha(row, headerMap, mapa.email),
      promessa: valorLinha(row, headerMap, mapa.promessa),
      promessaDataPrevista: obterDataLinha(row, headerMap, mapa.promessa_data_prevista),
      promessaDataRealizada: obterDataLinha(row, headerMap, mapa.promessa_data_realizada),
      obsInterna: valorLinha(row, headerMap, mapa.obs_interna)
    };

    linha.cnpjDigitos = sanitizarCnpj(linha.cnpj);

    if (linhaVazia(linha)) {
      continue;
    }

    if (linha.cnpjDigitos.length !== 14) {
      erros.push({ row_index: rowIndex, message: 'Linha ignorada por CNPJ ausente ou incompleto.' });
      continue;
    }

    if (!linha.dataVenda) {
      erros.push({ row_index: rowIndex, message: 'Linha ignorada por data da venda ausente ou inválida.' });
      continue;
    }

    if (linha.dataVenda >= obterDataAtualSaoPaulo(agora)) {
      erros.push({ row_index: rowIndex, message: 'Linha ignorada: a data da venda antiga deve ser anterior ao dia atual.' });
      continue;
    }

    linhas.push(linha);
  }

  return { linhas, erros };
}

/**
 * Agrupa linhas para consumo posterior.
 */
function agruparLinhas(linhas, referencias) {
  const grupos = new Map();
  const clientesPorCnpj = new Map();
  const avisos = {
    consultores_nao_encontrados: new Set(),
    operadoras_nao_encontradas: new Set(),
    produtos_a_cadastrar: new Set(),
    status_planilha: new Set()
  };

  linhas.forEach(linha => {
    const consultor = referencias.usuariosPorNome.get(normalizarTexto(linha.consultor));
    const operadora = referencias.operadorasPorNome.get(normalizarTexto(linha.operadora));
    const servicoId = resolverServicoId(linha.produto, referencias.servicosPorNome);
    const tipoProduto = referencias.tiposProdutoPorNome.get(normalizarTexto(linha.produto));

    if (linha.consultor && !consultor) avisos.consultores_nao_encontrados.add(linha.consultor);
    if (linha.operadora && !operadora) avisos.operadoras_nao_encontradas.add(linha.operadora);
    if (linha.produto && !tipoProduto) avisos.produtos_a_cadastrar.add(linha.produto);
    if (linha.status) avisos.status_planilha.add(linha.status);

    const clienteAtual = clientesPorCnpj.get(linha.cnpjDigitos) || {
      cnpj_digitos: linha.cnpjDigitos,
      cnpj: formatarCnpj(linha.cnpjDigitos),
      nome: '',
      razao_social: '',
      responsavel_nome: '',
      email: '',
      whatsapp: '',
      quantidade_chips: 0,
      valor_pago: 0,
      operadora_atual_id: null,
      operadoras_atuais: []
    };

    clienteAtual.nome = escolherTexto(clienteAtual.nome, linha.razaoSocial, linha.cnpj);
    clienteAtual.razao_social = escolherTexto(clienteAtual.razao_social, linha.razaoSocial);
    clienteAtual.responsavel_nome = escolherTexto(clienteAtual.responsavel_nome, linha.rl, linha.fechadoRl);
    clienteAtual.email = escolherTexto(clienteAtual.email, linha.email);
    clienteAtual.whatsapp = escolherTexto(clienteAtual.whatsapp, linha.whatsapp);
    clienteAtual.quantidade_chips += linha.quantidade;
    clienteAtual.valor_pago += linha.receita || (linha.valor * linha.quantidade);
    clienteAtual.operadora_atual_id = clienteAtual.operadora_atual_id || operadora?.id || null;
    if (operadora?.id) {
      const atual = clienteAtual.operadoras_atuais.find(item => Number(item.operadora_id) === Number(operadora.id));
      const valorLinha = linha.receita || (linha.valor * linha.quantidade);
      if (atual) {
        atual.quantidade_chips = Number(atual.quantidade_chips || 0) + linha.quantidade;
        atual.valor_pago = Number((Number(atual.valor_pago || 0) + valorLinha).toFixed(2));
      } else {
        clienteAtual.operadoras_atuais.push({
          operadora_id: operadora.id,
          quantidade_chips: linha.quantidade,
          valor_pago: Number(valorLinha.toFixed(2)),
          fidelidade_fim: null
        });
      }
    }
    clientesPorCnpj.set(linha.cnpjDigitos, clienteAtual);

    const chaveGrupo = [
      linha.cnpjDigitos,
      linha.dataVenda || '',
      normalizarTexto(linha.produto),
      normalizarTexto(linha.status),
      normalizarTexto(linha.operadora),
      normalizarTexto(linha.email),
      String(linha.whatsapp || '').replace(/\D/g, '')
    ].join('|');

    const grupo = grupos.get(chaveGrupo) || {
      key: chaveGrupo,
      rowIndex: linha.rowIndex,
      linhas: [],
      cnpjDigitos: linha.cnpjDigitos,
      cnpj: formatarCnpj(linha.cnpjDigitos),
      nome: linha.razaoSocial || linha.cnpj,
      razaoSocial: linha.razaoSocial,
      cidade: linha.cidade,
      uf: String(linha.uf || '').slice(0, 2).toUpperCase(),
      produto: linha.produto,
      status: linha.status,
      dataVenda: linha.dataVenda,
      dataInput: linha.dataInput,
      dataAceite: linha.dataAceite,
      dataAtivacao: linha.dataAtivacao,
      operadora: linha.operadora,
      operadoraId: operadora?.id || null,
      tipoProdutoId: tipoProduto?.id || null,
      servicoId,
      telefone: separarTelefone(linha.whatsapp).completo,
      email: linha.email || null,
      rl: linha.rl || linha.fechadoRl || null,
      fidelidade: linha.fidelidade,
      clienteCiente: linha.clienteCiente,
      fechadoRl: linha.fechadoRl,
      fechadoTerceiros: linha.fechadoTerceiros,
      observacoes: [],
      obsInternas: [],
      promessa: linha.promessa,
      promessaDataPrevista: linha.promessaDataPrevista,
      promessaDataRealizada: linha.promessaDataRealizada,
      itensChips: [],
      vendedorasIds: []
    };

    const quantidade = linha.quantidade || parseInteiro(linha.novo) || parseInteiro(linha.portabilidade) || 1;
    const valorUnitario = linha.valor || (linha.receita && quantidade ? linha.receita / quantidade : 0);

    if (quantidade > 0 && valorUnitario > 0) {
      grupo.itensChips.push({
        quantidade,
        gb: '',
        tipo_linha: resolverTipoLinha(linha),
        valor_unitario: Number(valorUnitario.toFixed(2)),
        ...(consultor?.id ? { vendedora_id: consultor.id } : {})
      });
    }

    if (consultor?.id && !grupo.vendedorasIds.includes(consultor.id)) {
      grupo.vendedorasIds.push(consultor.id);
    }

    if (linha.observacoes) grupo.observacoes.push(linha.observacoes);
    if (linha.obsInterna) grupo.obsInternas.push(linha.obsInterna);
    grupo.linhas.push(linha.rowIndex);
    grupos.set(chaveGrupo, grupo);
  });

  return {
    clientes: Array.from(clientesPorCnpj.values()),
    grupos: Array.from(grupos.values()),
    avisos: Object.fromEntries(Object.entries(avisos).map(([chave, valor]) => [chave, Array.from(valor)]))
  };
}

/**
 * Monta amostras a partir dos dados informados.
 */
function montarAmostras(grupos, limite = 5) {
  return grupos.slice(0, limite).map(grupo => ({
    linhas: grupo.linhas,
    cliente: grupo.razaoSocial || grupo.nome,
    cnpj: grupo.cnpj,
    data_venda: grupo.dataVenda,
    produto: grupo.produto,
    status: grupo.status,
    vendedoras_total: grupo.vendedorasIds.length,
    chips: grupo.itensChips.reduce((acc, item) => acc + item.quantidade, 0),
    valor_total: Number(grupo.itensChips.reduce((acc, item) => acc + item.quantidade * item.valor_unitario, 0).toFixed(2))
  }));
}

/**
 * Monta preview a partir dos dados informados.
 */
async function montarPreview(arquivo) {
  const worksheet = await lerWorksheet(arquivo.buffer);
  const mapeamentoInfo = resolverMapeamento(worksheet, parseMapeamento(arquivo.campos?.mapeamento));
  const referencias = await montarReferencias();
  const { linhas, erros } = lerLinhasPlanilha(worksheet, mapeamentoInfo.mapeamento);
  const { clientes, grupos, avisos } = agruparLinhas(linhas, referencias);
  const chaves = grupos.map(criarChaveImportacao);
  const existentes = chaves.length > 0
    ? await Venda.query()
      .where('origem_importacao', ORIGEM_IMPORTACAO)
      .whereIn('chave_importacao', chaves)
      .select('chave_importacao')
    : [];
  const existentesSet = new Set(existentes.map(item => item.chave_importacao));

  return {
    arquivo: arquivo.filename,
    aba: worksheet.name,
    total_linhas: Math.max(worksheet.rowCount - 1, 0),
    linhas_validas: linhas.length,
    linhas_ignoradas: erros.length,
    cnpjs_unicos: clientes.length,
    vendas_detectadas: grupos.length,
    vendas_ja_importadas: chaves.filter(chave => existentesSet.has(chave)).length,
    vendas_para_criar: chaves.filter(chave => !existentesSet.has(chave)).length,
    colunas: mapeamentoInfo.colunas,
    campos_mapeamento: CAMPOS_MAPEAMENTO,
    sugestoes: mapeamentoInfo.sugestoes,
    mapeamento: mapeamentoInfo.mapeamento,
    avisos,
    erros: erros.slice(0, 20),
    amostras: montarAmostras(grupos)
  };
}

/**
 * Monta payload cliente a partir dos dados informados.
 */
function montarPayloadCliente(dados, existente = null) {
  const telefone = separarTelefone(dados.whatsapp);
  const payload = {
    base_anterior_sistema: true
  };

  if (dados.quantidade_chips > 0) {
    payload.quantidade_chips = dados.quantidade_chips;
  }

  if (dados.valor_pago > 0) {
    payload.valor_pago = Number(dados.valor_pago.toFixed(2));
  }

  const campos = {
    nome: escolherTexto(dados.nome, dados.razao_social, dados.cnpj),
    razao_social: dados.razao_social || null,
    cnpj: dados.cnpj,
    cnpj_digitos: dados.cnpj_digitos,
    responsavel_tipo: 'rl',
    responsavel_nome: dados.responsavel_nome || null,
    email: dados.email || null,
    whatsapp_ddd: telefone.ddd,
    whatsapp_numero: telefone.numero,
    operadora_atual_id: dados.operadora_atual_id || null
  };

  if (!existente) {
    return { ...payload, ...campos };
  }

  Object.entries(campos).forEach(([campo, valor]) => {
    if (campo === 'responsavel_tipo') return;
    if (existente[campo] === null || existente[campo] === undefined || existente[campo] === '') {
      payload[campo] = valor;
    }
  });

  return payload;
}

/**
 * Sincroniza operadoras cliente importado com os dados atuais.
 */
async function sincronizarOperadorasClienteImportado(clienteId, operadoras, trx) {
  if (!Array.isArray(operadoras) || operadoras.length === 0) return;

  const clienteIdNormalizado = Number(clienteId);

  await ClienteOperadora.query(trx)
    .delete()
    .where('cliente_id', clienteIdNormalizado);

  const linhas = operadoras
    .filter(item => item.operadora_id)
    .map(item => ({
      cliente_id: clienteIdNormalizado,
      operadora_id: Number(item.operadora_id),
      quantidade_chips: item.quantidade_chips ? Number(item.quantidade_chips) : null,
      valor_pago: item.valor_pago ? Number(item.valor_pago) : null,
      fidelidade_fim: item.fidelidade_fim || null
    }));

  if (linhas.length > 0) {
    await ClienteOperadora.query(trx).insert(linhas);
  }
}

/**
 * Sincroniza clientes com os dados atuais.
 */
async function sincronizarClientes(clientes, usuarioId, trx) {
  const existentes = await Cliente.query(trx).whereNotNull('cnpj_digitos');
  const existentesPorCnpj = new Map(existentes.map(cliente => [cliente.cnpj_digitos, cliente]));
  const clientesPorCnpj = new Map();
  const resultado = { clientes_criados: 0, clientes_atualizados: 0 };

  for (const dados of clientes) {
    const existente = existentesPorCnpj.get(dados.cnpj_digitos);

    if (existente) {
      const payload = montarPayloadCliente(dados, existente);
      if (Object.keys(payload).length > 0) {
        const atualizado = await Cliente.query(trx).patchAndFetchById(existente.id, {
          ...payload,
          updated_at: new Date()
        });
        await sincronizarOperadorasClienteImportado(existente.id, dados.operadoras_atuais, trx);
        clientesPorCnpj.set(dados.cnpj_digitos, atualizado);
        resultado.clientes_atualizados += 1;
      } else {
        await sincronizarOperadorasClienteImportado(existente.id, dados.operadoras_atuais, trx);
        clientesPorCnpj.set(dados.cnpj_digitos, existente);
      }
      continue;
    }

    const criado = await Cliente.query(trx).insertAndFetch({
      ...montarPayloadCliente(dados),
      criado_por_id: usuarioId
    });
    await sincronizarOperadorasClienteImportado(criado.id, dados.operadoras_atuais, trx);
    existentesPorCnpj.set(dados.cnpj_digitos, criado);
    clientesPorCnpj.set(dados.cnpj_digitos, criado);
    resultado.clientes_criados += 1;
  }

  return { clientesPorCnpj, resultado };
}

/**
 * Monta payload venda a partir dos dados informados.
 */
function montarPayloadVenda(grupo, referencias, cliente, usuarioId, arquivo) {
  const status = resolverStatusFunil(grupo.status);
  const valorTotal = Number(grupo.itensChips.reduce((acc, item) => acc + item.quantidade * item.valor_unitario, 0).toFixed(2));
  const quantidadeLinhas = grupo.itensChips.reduce((acc, item) => acc + item.quantidade, 0);
  const vendedoraId = grupo.vendedorasIds[0] || usuarioId;
  const dataEnvio = grupo.dataInput || grupo.dataAceite || grupo.dataVenda;
  const dataAtivacao = grupo.dataAtivacao || (status.status_funil === 'concluido' ? grupo.dataAceite : null);
  const promessa = montarClienteSolicitou({
    promessa: grupo.promessa,
    promessaDataPrevista: grupo.promessaDataPrevista,
    promessaDataRealizada: grupo.promessaDataRealizada
  });

  return {
    nome: grupo.nome || cliente?.nome || grupo.cnpj,
    telefone: grupo.telefone,
    email: grupo.email,
    nome_representante_legal: grupo.rl,
    nome_fechou_venda: grupo.fechadoTerceiros || grupo.fechadoRl || grupo.rl,
    produto_fechado: grupo.produto || null,
    quantidade_linhas: quantidadeLinhas || null,
    valores_unitarios_chips: grupo.itensChips.length > 0 ? JSON.stringify(grupo.itensChips) : null,
    valor_total: valorTotal || null,
    razao_social: grupo.razaoSocial || null,
    cnpj: grupo.cnpj,
    data_venda: grupo.dataVenda,
    venda_antiga: true,
    data_ativacao: dataAtivacao,
    observacoes: montarObservacoes(grupo),
    municipio: grupo.cidade || null,
    uf: grupo.uf || null,
    cliente_id: cliente?.id || null,
    operadora_id: grupo.operadoraId,
    operadora_atual_id: grupo.operadoraId || cliente?.operadora_atual_id || null,
    tipo_venda_id: resolverTipoVendaId(grupo, referencias.tiposPorNome),
    tipo_produto_id: grupo.tipoProdutoId,
    servico_id: grupo.servicoId,
    vendedora_id: vendedoraId,
    status_funil: status.status_funil,
    prioridade_funil: status.prioridade_funil,
    criado_por_id: usuarioId,
    criado_em: formatarDateTimeSQL(),
    ultima_atividade_em: formatarDateTimeSQL(),
    enviada_pos_venda_em: status.enviada && dataEnvio ? `${dataEnvio} 00:00:00` : null,
    enviada_pos_venda_por_id: status.enviada ? usuarioId : null,
    origem_importacao: ORIGEM_IMPORTACAO,
    chave_importacao: criarChaveImportacao(grupo),
    arquivo_importacao: arquivo.filename,
    linha_importacao: grupo.rowIndex,
    ...promessa
  };
}

/**
 * Salva vendedoras com os dados informados.
 */
async function salvarVendedoras(vendaId, vendedorasIds, trx) {
  const ids = Array.from(new Set(vendedorasIds.map(Number).filter(Boolean)));

  if (ids.length === 0) return;

  await trx('venda_vendedoras').insert(ids.map((usuarioId, index) => ({
    venda_id: vendaId,
    usuario_id: usuarioId,
    ordem: index + 1
  })));
}

/**
 * Registra historico importacao no historico ou log.
 */
async function registrarHistoricoImportacao(vendaId, usuarioId, grupo, trx) {
  await VendaHistorico.query(trx).insert({
    venda_id: vendaId,
    usuario_id: usuarioId,
    acao: 'venda.importada_planilha_empresas',
    status_anterior: null,
    status_novo: grupo.status || null,
    observacao: 'Venda importada da planilha de controle de empresas',
    dados: JSON.stringify({
      origem_importacao: ORIGEM_IMPORTACAO,
      linhas: grupo.linhas,
      status_planilha: grupo.status
    }),
    created_at: formatarDateTimeSQL()
  });
}

/**
 * Importa  a partir dos dados recebidos.
 */
async function importar(req, usuarioId) {
  const arquivo = await lerArquivoMultipart(req);
  const worksheet = await lerWorksheet(arquivo.buffer);
  const mapeamentoInfo = resolverMapeamento(worksheet, parseMapeamento(arquivo.campos?.mapeamento));
  const { linhas, erros } = lerLinhasPlanilha(worksheet, mapeamentoInfo.mapeamento);

  return Venda.transaction(async trx => {
    const referenciasTrx = await montarReferencias(trx);
    const produtosCadastrados = await garantirTiposProduto(linhas.map(linha => linha.produto), referenciasTrx, trx);
    const { clientes: clientesTrx, grupos: gruposTrx, avisos: avisosTrx } = agruparLinhas(linhas, referenciasTrx);
    const { clientesPorCnpj, resultado: resultadoClientes } = await sincronizarClientes(clientesTrx, usuarioId, trx);
    const chaves = gruposTrx.map(criarChaveImportacao);
    const existentes = chaves.length > 0
      ? await Venda.query(trx)
        .where('origem_importacao', ORIGEM_IMPORTACAO)
        .whereIn('chave_importacao', chaves)
        .select('chave_importacao')
      : [];
    const existentesSet = new Set(existentes.map(item => item.chave_importacao));

    const resultado = {
      arquivo: arquivo.filename,
      aba: worksheet.name,
      linhas_lidas: Math.max(worksheet.rowCount - 1, 0),
      linhas_validas: linhas.length,
      linhas_ignoradas: erros.length,
      cnpjs_unicos: clientesTrx.length,
      vendas_detectadas: gruposTrx.length,
      vendas_criadas: 0,
      vendas_ignoradas_duplicadas: 0,
      produtos_cadastrados: produtosCadastrados,
      mapeamento: mapeamentoInfo.mapeamento,
      erros: erros.slice(0, 50),
      avisos: avisosTrx,
      ...resultadoClientes
    };

    for (const grupo of gruposTrx) {
      const chaveImportacao = criarChaveImportacao(grupo);

      if (existentesSet.has(chaveImportacao)) {
        resultado.vendas_ignoradas_duplicadas += 1;
        continue;
      }

      const cliente = clientesPorCnpj.get(grupo.cnpjDigitos);
      const payload = montarPayloadVenda(grupo, referenciasTrx, cliente, usuarioId, arquivo);
      const venda = await Venda.query(trx).insertAndFetch(payload);
      const vendedorasIds = grupo.vendedorasIds.length > 0 ? grupo.vendedorasIds : [payload.vendedora_id];

      await salvarVendedoras(venda.id, vendedorasIds, trx);
      await registrarHistoricoImportacao(venda.id, usuarioId, grupo, trx);
      existentesSet.add(chaveImportacao);
      resultado.vendas_criadas += 1;
    }

    return resultado;
  });
}

/**
 * Renderiza preview com os dados informados.
 */
async function preview(req) {
  const arquivo = await lerArquivoMultipart(req);
  return montarPreview(arquivo);
}

module.exports = {
  preview,
  importar,
  _internals: {
    agruparLinhas,
    criarChaveImportacao,
    lerLinhasPlanilha,
    normalizarData,
    obterDataAtualSaoPaulo,
    resolverMapeamento,
    resolverServicoId,
    resolverStatusFunil,
    resolverTipoLinha
  }
};
