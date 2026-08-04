const Cliente = require('../models/Cliente');
const ClienteOperadora = require('../models/ClienteOperadora');
const Venda = require('../models/Venda');
const Usuario = require('../models/Usuario');
const Operadora = require('../models/Operadora');
const Busboy = require('busboy');
const ExcelJS = require('exceljs');
const notificacaoService = require('./notificacao.service');
const { usuarioTemPermissaoLocal } = require('../utils/permissoes');

const CAMPOS = [
  'nome',
  'razao_social',
  'cnpj',
  'responsavel_tipo',
  'responsavel_nome',
  'email',
  'whatsapp_ddd',
  'whatsapp_numero',
  'fixo_ddd',
  'fixo_numero',
  'fidelidade_fim',
  'operadora_atual_id',
  'valor_pago',
  'quantidade_chips',
  'base_anterior_sistema'
];

/**
 * Limpa valor e restaura o estado inicial.
 */
function limparValor(valor) {
  if (valor === undefined) return undefined;
  if (valor === '') return null;
  return valor;
}

/**
 * Normaliza data para uso interno consistente.
 */
function normalizarData(valor) {
  if (!valor) return null;

  const texto = String(valor).trim();

  if (!texto || texto === '1899-11-30' || texto === '30/11/1899') {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return texto;
  }

  const match = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);

  if (!match) return null;

  const [, dia, mes, ano] = match;
  const anoCompleto = ano.length === 2 ? `20${ano}` : ano;

  return `${anoCompleto}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
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
 * Adiciona um mes ao conjunto atual.
 */
function adicionarUmMes(data = new Date()) {
  const proxima = new Date(data);
  proxima.setMonth(proxima.getMonth() + 1);
  return proxima;
}

/**
 * Processa separar telefone conforme as regras do dominio.
 */
function separarTelefone(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');

  if (!digitos) {
    return { ddd: null, numero: null };
  }

  return {
    ddd: digitos.slice(0, 2) || null,
    numero: digitos.slice(2) || null
  };
}

/**
 * Normaliza valor monetario para uso interno consistente.
 */
function normalizarValorMonetario(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;

  const texto = String(valor).trim();
  if (!texto) return null;

  const normalizado = texto.includes(',')
    ? texto.replace(/\./g, '').replace(',', '.')
    : texto;
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
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
 * Sanitiza cnpj removendo caracteres nao esperados.
 */
function sanitizarCnpj(valor) {
  return String(valor || '').replace(/\D/g, '').slice(0, 14);
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
 * Sanitiza cpf removendo caracteres nao esperados.
 */
function sanitizarCpf(valor) {
  return String(valor || '').replace(/\D/g, '').slice(0, 11);
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
 * Formata cpf para exibicao ou envio.
 */
function formatarCpf(valor) {
  const digitos = sanitizarCpf(valor);
  if (digitos.length !== 11) return String(valor || '').trim();
  return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`;
}

/**
 * Valida digitos cnpj e retorna o resultado esperado.
 */
function validarDigitosCnpj(cnpj) {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;

  /**
   * Calcula digito com base nos valores informados.
   */
  const calcularDigito = (base) => {
    const pesos = base === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((total, peso, index) => total + Number(cnpj[index]) * peso, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  return calcularDigito(12) === Number(cnpj[12]) && calcularDigito(13) === Number(cnpj[13]);
}

/**
 * Valida digitos cpf e retorna o resultado esperado.
 */
function validarDigitosCpf(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;

  /**
   * Calcula o digito ou valor auxiliar usado na validacao.
   */
  const calc = (n) => {
    const soma = Array.from({ length: n }, (_, i) => Number(cpf[i]) * (n + 1 - i)).reduce((a, b) => a + b, 0);
    const r = (soma * 10) % 11;
    return r >= 10 ? 0 : r;
  };

  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

/**
 * Normaliza documento obrigatorio para uso interno consistente.
 */
function normalizarDocumentoObrigatorio(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');

  if (digitos.length === 14) {
    if (!validarDigitosCnpj(digitos)) {
      throw criarHttpError(400, 'CNPJ invalido.');
    }
    return {
      cnpj: formatarCnpj(digitos),
      cnpj_digitos: digitos
    };
  }

  if (digitos.length === 11) {
    if (!validarDigitosCpf(digitos)) {
      throw criarHttpError(400, 'CPF invalido.');
    }
    return {
      cnpj: formatarCpf(digitos),
      cnpj_digitos: digitos
    };
  }

  throw criarHttpError(400, 'Informe um CPF ou CNPJ valido.');
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
  if (valor.hyperlink && valor.text) return String(valor.text).trim();
  return String(valor).trim();
}

/**
 * Obtem valor linha a partir dos dados informados.
 */
function obterValorLinha(row, headerMap, coluna) {
  if (!coluna) return '';
  const index = headerMap.get(coluna);
  if (!index) return '';
  return textoCelula(row.getCell(index).value);
}

/**
 * Soma numero considerando os dados informados.
 */
function somarNumero(valor) {
  const numero = normalizarValorMonetario(valor);
  return numero === null ? 0 : numero;
}

/**
 * Normaliza inteiro para uso interno consistente.
 */
function normalizarInteiro(valor) {
  const numero = Number(String(valor || '').replace(/\D/g, ''));
  return Number.isFinite(numero) ? numero : 0;
}

/**
 * Normaliza inteiro opcional para uso interno consistente.
 */
function normalizarInteiroOpcional(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return null;
  return Math.max(Math.trunc(numero), 0);
}

/**
 * Normaliza operadoras cliente para uso interno consistente.
 */
function normalizarOperadorasCliente(dados = {}) {
  const fonte = Array.isArray(dados.operadoras_atuais)
    ? dados.operadoras_atuais
    : Array.isArray(dados.operadorasAtuais)
      ? dados.operadorasAtuais
      : null;

  const linhas = fonte || (
    dados.operadora_atual_id || dados.quantidade_chips !== undefined || dados.valor_pago !== undefined || dados.fidelidade_fim !== undefined
      ? [{
        operadora_id: dados.operadora_atual_id,
        quantidade_chips: dados.quantidade_chips,
        valor_pago: dados.valor_pago,
        fidelidade_fim: dados.fidelidade_fim
      }]
      : []
  );

  const porOperadora = new Map();

  linhas.forEach(item => {
    const operadoraId = Number(item?.operadora_id || item?.operadora?.id || item?.id_operadora);
    if (!Number.isFinite(operadoraId) || operadoraId <= 0) return;

    const atual = porOperadora.get(operadoraId) || {
      operadora_id: operadoraId,
      quantidade_chips: 0,
      valor_pago: 0,
      fidelidade_fim: null
    };
    const quantidade = normalizarInteiroOpcional(item.quantidade_chips);
    const valor = normalizarValorMonetario(item.valor_pago);
    const fidelidade = normalizarData(item.fidelidade_fim);

    if (quantidade !== null) {
      atual.quantidade_chips += quantidade;
    }

    if (valor !== null) {
      atual.valor_pago = Number((Number(atual.valor_pago || 0) + Number(valor)).toFixed(2));
    }

    if (fidelidade && (!atual.fidelidade_fim || fidelidade < atual.fidelidade_fim)) {
      atual.fidelidade_fim = fidelidade;
    }

    porOperadora.set(operadoraId, atual);
  });

  return Array.from(porOperadora.values()).map(item => ({
    ...item,
    quantidade_chips: item.quantidade_chips > 0 ? item.quantidade_chips : null,
    valor_pago: item.valor_pago > 0 ? item.valor_pago : null
  }));
}

/**
 * Processa ordenar operadoras cliente conforme as regras do dominio.
 */
function ordenarOperadorasCliente(operadoras = []) {
  return [...operadoras].sort((a, b) => (
    Number(a.id || 0) - Number(b.id || 0)
    || Number(a.operadora_id || 0) - Number(b.operadora_id || 0)
  ));
}

/**
 * Obtem resumo operadoras cliente a partir dos dados informados.
 */
function obterResumoOperadorasCliente(operadoras = []) {
  const ordenadas = ordenarOperadorasCliente(operadoras);
  const primeira = ordenadas[0] || null;
  const quantidade = ordenadas.reduce((total, item) => total + Number(item.quantidade_chips || 0), 0);
  const valor = ordenadas.reduce((total, item) => total + Number(item.valor_pago || 0), 0);
  const fidelidades = ordenadas
    .map(item => normalizarData(item.fidelidade_fim))
    .filter(Boolean)
    .sort();

  return {
    operadora_atual_id: primeira?.operadora_id || null,
    operadoraAtual: primeira?.operadora || null,
    quantidade_chips: quantidade > 0 ? quantidade : null,
    valor_pago: valor > 0 ? Number(valor.toFixed(2)) : null,
    fidelidade_fim: fidelidades[0] || null
  };
}

/**
 * Formata operadoras cliente para exibicao ou envio.
 */
function formatarOperadorasCliente(operadoras = []) {
  return ordenarOperadorasCliente(operadoras).map(item => ({
    id: item.id,
    cliente_id: item.cliente_id,
    operadora_id: item.operadora_id,
    operadora: item.operadora || null,
    quantidade_chips: item.quantidade_chips ?? null,
    valor_pago: item.valor_pago ?? null,
    fidelidade_fim: item.fidelidade_fim || null,
    aviso_fidelidade: montarAvisoFidelidade({ fidelidade_fim: item.fidelidade_fim })
  }));
}

/**
 * Sincroniza operadoras cliente com os dados atuais.
 */
async function sincronizarOperadorasCliente(clienteId, operadoras, trx = null) {
  const clienteIdNormalizado = Number(clienteId);
  const linhas = normalizarOperadorasCliente({ operadoras_atuais: operadoras });

  await ClienteOperadora.query(trx)
    .delete()
    .where('cliente_id', clienteIdNormalizado);

  if (linhas.length > 0) {
    await ClienteOperadora.query(trx).insert(linhas.map(item => ({
      ...item,
      cliente_id: clienteIdNormalizado,
      operadora_id: Number(item.operadora_id)
    })));
  }

  await atualizarResumoLegadoCliente(clienteIdNormalizado, trx);
}

/**
 * Atualiza resumo legado cliente com os dados informados.
 */
async function atualizarResumoLegadoCliente(clienteId, trx = null) {
  const clienteIdNormalizado = Number(clienteId);
  const operadoras = await ClienteOperadora.query(trx)
    .where('cliente_id', clienteIdNormalizado)
    .withGraphFetched('operadora')
    .orderBy('id', 'asc');
  const resumo = obterResumoOperadorasCliente(operadoras);

  await Cliente.query(trx).patchAndFetchById(clienteIdNormalizado, {
    operadora_atual_id: resumo.operadora_atual_id,
    quantidade_chips: resumo.quantidade_chips,
    valor_pago: resumo.valor_pago,
    fidelidade_fim: resumo.fidelidade_fim,
    updated_at: new Date()
  });

  return resumo;
}

/**
 * Processa escolher texto conforme as regras do dominio.
 */
function escolherTexto(...valores) {
  return valores.find(valor => String(valor || '').trim()) || '';
}

/**
 * Processa complementar campo conforme as regras do dominio.
 */
function complementarCampo(payload, cliente, campo, valor) {
  if (cliente[campo] === null || cliente[campo] === undefined || cliente[campo] === '') {
    payload[campo] = valor || null;
  }
}

/**
 * Cria http error com os dados informados.
 */
function criarHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
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
 * Processa ler arquivo multipart conforme as regras do dominio.
 */
function lerArquivoMultipart(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers });
    const partes = {};
    const chunks = [];
    let arquivo = null;

    busboy.on('field', (name, value) => {
      partes[name] = value;
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

      const filename = String(arquivo.filename || '').toLowerCase();
      if (!filename.endsWith('.xlsx')) {
        reject(criarHttpError(400, 'Envie um arquivo .xlsx.'));
        return;
      }

      resolve({
        arquivo: {
          ...arquivo,
          buffer: Buffer.concat(chunks)
        },
        campos: partes
      });
    });

    req.pipe(busboy);
  });
}

/**
 * Processa ler workbook conforme as regras do dominio.
 */
async function lerWorkbook(buffer) {
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
    throw criarHttpError(400, 'Não foi possível identificar cabeçalhos na primeira linha.');
  }

  return colunas;
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

  const razaoSocial = achar('razao social', 'razão social');

  return {
    cnpj: achar('cnpj'),
    nome: razaoSocial,
    razao_social: razaoSocial,
    responsavel_nome: achar('rl', 'responsavel', 'responsável'),
    email: achar('e-mail', 'email'),
    whatsapp: achar('numero whatsapp', 'número whatsapp', 'whatsapp'),
    fixo: achar('fixo', 'telefone fixo'),
    quantidade_chips: achar('quantidade', 'qtd'),
    valor_pago: achar('receita contratada', 'valor'),
    operadora_atual: achar('operadora')
  };
}

/**
 * Monta amostras a partir dos dados informados.
 */
function montarAmostras(worksheet, colunas) {
  const amostras = [];
  const limite = Math.min(worksheet.rowCount, 6);

  for (let rowIndex = 2; rowIndex <= limite; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    const dados = {};
    colunas.forEach(coluna => {
      dados[coluna.nome] = textoCelula(row.getCell(coluna.index).value);
    });
    amostras.push({ row_index: rowIndex, dados });
  }

  return amostras;
}

/**
 * Gera uma pre-visualizacao da planilha de importacao da base anterior.
 *
 * @param {Object} req - Requisicao multipart com arquivo XLSX.
 * @returns {Promise.<Object>} Dados para conferencia do mapeamento.
 */
async function previewImportacaoBaseAnterior(req) {
  const { arquivo } = await lerArquivoMultipart(req);
  const worksheet = await lerWorkbook(arquivo.buffer);
  const colunas = obterCabecalhos(worksheet);

  return {
    arquivo: arquivo.filename,
    aba: worksheet.name,
    total_linhas: Math.max(worksheet.rowCount - 1, 0),
    colunas,
    sugestoes: sugerirMapeamento(colunas),
    amostras: montarAmostras(worksheet, colunas)
  };
}

/**
 * Monta mapa operadoras a partir dos dados informados.
 */
async function montarMapaOperadoras(trx = null) {
  const operadoras = await Operadora.query(trx).select('id', 'nome');
  return new Map(operadoras.map(operadora => [normalizarTexto(operadora.nome), operadora]));
}

/**
 * Consolida linhas importacao em uma estrutura unica.
 */
function consolidarLinhasImportacao(worksheet, mapeamento, operadorasPorNome) {
  const colunas = obterCabecalhos(worksheet);
  const headerMap = new Map(colunas.map(coluna => [coluna.nome, coluna.index]));
  const resultado = {
    linhas_lidas: Math.max(worksheet.rowCount - 1, 0),
    linhas_ignoradas: 0,
    cnpjs_unicos: 0,
    operadoras_nao_encontradas: [],
    erros: []
  };
  const porCnpj = new Map();
  const operadorasNaoEncontradas = new Set();

  for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    const cnpjDigitos = sanitizarCnpj(obterValorLinha(row, headerMap, mapeamento.cnpj));

    if (cnpjDigitos.length !== 14) {
      resultado.linhas_ignoradas += 1;
      resultado.erros.push({
        row_index: rowIndex,
        message: 'Linha ignorada por CNPJ ausente ou incompleto.'
      });
      continue;
    }

    const atual = porCnpj.get(cnpjDigitos) || {
      cnpj_digitos: cnpjDigitos,
      cnpj: formatarCnpj(cnpjDigitos),
      nome: '',
      razao_social: '',
      responsavel_nome: '',
      email: '',
      whatsapp: '',
      fixo: '',
      quantidade_chips: 0,
      valor_pago: 0,
      operadora_atual_id: null,
      operadoras_atuais: []
    };

    atual.nome = escolherTexto(atual.nome, obterValorLinha(row, headerMap, mapeamento.nome));
    atual.razao_social = escolherTexto(atual.razao_social, obterValorLinha(row, headerMap, mapeamento.razao_social));
    atual.responsavel_nome = escolherTexto(atual.responsavel_nome, obterValorLinha(row, headerMap, mapeamento.responsavel_nome));
    atual.email = escolherTexto(atual.email, obterValorLinha(row, headerMap, mapeamento.email));
    atual.whatsapp = escolherTexto(atual.whatsapp, obterValorLinha(row, headerMap, mapeamento.whatsapp));
    atual.fixo = escolherTexto(atual.fixo, obterValorLinha(row, headerMap, mapeamento.fixo));
    const quantidadeLinha = normalizarInteiro(obterValorLinha(row, headerMap, mapeamento.quantidade_chips));
    const valorLinha = somarNumero(obterValorLinha(row, headerMap, mapeamento.valor_pago));
    atual.quantidade_chips += quantidadeLinha;
    atual.valor_pago += valorLinha;

    const operadoraTexto = obterValorLinha(row, headerMap, mapeamento.operadora_atual);
    if (operadoraTexto) {
      const operadora = operadorasPorNome.get(normalizarTexto(operadoraTexto));
      if (operadora) {
        atual.operadora_atual_id = atual.operadora_atual_id || operadora.id;
        const operadoraAtual = atual.operadoras_atuais.find(item => Number(item.operadora_id) === Number(operadora.id));
        if (operadoraAtual) {
          operadoraAtual.quantidade_chips = Number(operadoraAtual.quantidade_chips || 0) + quantidadeLinha;
          operadoraAtual.valor_pago = Number((Number(operadoraAtual.valor_pago || 0) + valorLinha).toFixed(2));
        } else {
          atual.operadoras_atuais.push({
            operadora_id: operadora.id,
            quantidade_chips: quantidadeLinha,
            valor_pago: Number(valorLinha.toFixed(2)),
            fidelidade_fim: null
          });
        }
      } else {
        operadorasNaoEncontradas.add(operadoraTexto);
      }
    }

    porCnpj.set(cnpjDigitos, atual);
  }

  resultado.cnpjs_unicos = porCnpj.size;
  resultado.operadoras_nao_encontradas = Array.from(operadorasNaoEncontradas);
  return { clientes: Array.from(porCnpj.values()), resultado };
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
 * Monta payload importacao a partir dos dados informados.
 */
function montarPayloadImportacao(dados, clienteExistente = null) {
  const telefoneWhatsapp = separarTelefone(dados.whatsapp);
  const telefoneFixo = separarTelefone(dados.fixo);
  const nome = escolherTexto(dados.nome, dados.razao_social, dados.cnpj);
  const payload = {
    base_anterior_sistema: true
  };

  if (dados.quantidade_chips > 0) {
    payload.quantidade_chips = dados.quantidade_chips;
  }

  if (dados.valor_pago > 0) {
    payload.valor_pago = Number(dados.valor_pago.toFixed(2));
  }

  if (clienteExistente) {
    complementarCampo(payload, clienteExistente, 'nome', nome);
    complementarCampo(payload, clienteExistente, 'razao_social', dados.razao_social);
    complementarCampo(payload, clienteExistente, 'cnpj', dados.cnpj);
    complementarCampo(payload, clienteExistente, 'cnpj_digitos', dados.cnpj_digitos);
    complementarCampo(payload, clienteExistente, 'responsavel_nome', dados.responsavel_nome);
    complementarCampo(payload, clienteExistente, 'email', dados.email);
    complementarCampo(payload, clienteExistente, 'whatsapp_ddd', telefoneWhatsapp.ddd);
    complementarCampo(payload, clienteExistente, 'whatsapp_numero', telefoneWhatsapp.numero);
    complementarCampo(payload, clienteExistente, 'fixo_ddd', telefoneFixo.ddd);
    complementarCampo(payload, clienteExistente, 'fixo_numero', telefoneFixo.numero);
    complementarCampo(payload, clienteExistente, 'operadora_atual_id', dados.operadora_atual_id);
    return payload;
  }

  return {
    ...payload,
    nome,
    razao_social: dados.razao_social || null,
    cnpj: dados.cnpj,
    cnpj_digitos: dados.cnpj_digitos,
    responsavel_tipo: 'rl',
    responsavel_nome: dados.responsavel_nome || null,
    email: dados.email || null,
    whatsapp_ddd: telefoneWhatsapp.ddd,
    whatsapp_numero: telefoneWhatsapp.numero,
    fixo_ddd: telefoneFixo.ddd,
    fixo_numero: telefoneFixo.numero,
    operadora_atual_id: dados.operadora_atual_id || null
  };
}

/**
 * Importa ou complementa clientes a partir de planilha da base anterior.
 *
 * @param {Object} req - Requisicao multipart com arquivo e mapeamento.
 * @param {number|string} usuarioId - Usuario responsavel pela importacao.
 * @returns {Promise<Object>} Resumo de clientes criados, atualizados e ignorados.
 */
async function importarBaseAnterior(req, usuarioId) {
  const { arquivo, campos } = await lerArquivoMultipart(req);
  const mapeamento = parseMapeamento(campos.mapeamento);

  if (!mapeamento.cnpj) {
    throw criarHttpError(400, 'Selecione a coluna de CNPJ.');
  }

  const worksheet = await lerWorkbook(arquivo.buffer);

  return Cliente.transaction(async trx => {
    const operadorasPorNome = await montarMapaOperadoras(trx);
    const { clientes, resultado } = consolidarLinhasImportacao(worksheet, mapeamento, operadorasPorNome);
    const existentes = await Cliente.query(trx).whereNotNull('cnpj');
    const existentesPorCnpj = new Map(existentes.map(cliente => [sanitizarCnpj(cliente.cnpj), cliente]));

    resultado.criados = 0;
    resultado.atualizados = 0;

    for (const dados of clientes) {
      const existente = existentesPorCnpj.get(dados.cnpj_digitos);
      if (existente) {
        await Cliente.query(trx).patchAndFetchById(existente.id, {
          ...montarPayloadImportacao(dados, existente),
          updated_at: new Date()
        });
        if (dados.operadoras_atuais?.length > 0) {
          await sincronizarOperadorasCliente(existente.id, dados.operadoras_atuais, trx);
        }
        resultado.atualizados += 1;
        continue;
      }

      const criado = await Cliente.query(trx).insertAndFetch({
        ...montarPayloadImportacao(dados),
        criado_por_id: usuarioId
      });
      await sincronizarOperadorasCliente(criado.id, dados.operadoras_atuais, trx);
      existentesPorCnpj.set(dados.cnpj_digitos, criado);
      resultado.criados += 1;
    }

    return {
      arquivo: arquivo.filename,
      aba: worksheet.name,
      ...resultado
    };
  });
}

/**
 * Monta payload a partir dos dados informados.
 */
function montarPayload(dados) {
  const dadosNormalizados = { ...dados };

  if (dados.whatsapp !== undefined) {
    const whatsapp = separarTelefone(dados.whatsapp);
    dadosNormalizados.whatsapp_ddd = whatsapp.ddd;
    dadosNormalizados.whatsapp_numero = whatsapp.numero;
  }

  if (dados.fixo !== undefined) {
    const fixo = separarTelefone(dados.fixo);
    dadosNormalizados.fixo_ddd = fixo.ddd;
    dadosNormalizados.fixo_numero = fixo.numero;
  }

  const payload = {};

  CAMPOS.forEach((campo) => {
    const valor = limparValor(dadosNormalizados[campo]);

    if (valor !== undefined) {
      payload[campo] = valor;
    }
  });

  if (payload.nome !== undefined && payload.nome !== null) {
    payload.nome = String(payload.nome).trim();
  }

  if (payload.cnpj !== undefined) {
    const documentoNormalizado = normalizarDocumentoObrigatorio(payload.cnpj);
    payload.cnpj = documentoNormalizado.cnpj;
    payload.cnpj_digitos = documentoNormalizado.cnpj_digitos;
  }

  if (!payload.responsavel_tipo) {
    payload.responsavel_tipo = 'rl';
  }

  if (!['adm', 'rl'].includes(payload.responsavel_tipo)) {
    throw new Error('Tipo do responsável inválido.');
  }

  if (payload.operadora_atual_id !== undefined && payload.operadora_atual_id !== null) {
    payload.operadora_atual_id = Number(payload.operadora_atual_id);
  }

  if (payload.quantidade_chips !== undefined && payload.quantidade_chips !== null) {
    payload.quantidade_chips = Number(payload.quantidade_chips);
  }

  if (payload.valor_pago !== undefined) {
    payload.valor_pago = normalizarValorMonetario(payload.valor_pago);
  }

  if (payload.base_anterior_sistema !== undefined) {
    payload.base_anterior_sistema = Boolean(payload.base_anterior_sistema);
  }

  if (payload.fidelidade_fim !== undefined) {
    payload.fidelidade_fim = normalizarData(payload.fidelidade_fim);
  }

  return payload;
}

/**
 * Busca cliente duplicado por cnpj conforme os parametros informados.
 */
async function buscarClienteDuplicadoPorCnpj(cnpjDigitos, ignorarId = null, trx = null) {
  if (!cnpjDigitos) return null;

  const query = Cliente.query(trx)
    .select('id', 'nome', 'razao_social', 'cnpj', 'excluido_em')
    .where(builder => {
      builder
        .where('cnpj_digitos', cnpjDigitos)
        .orWhereRaw(`${sqlSomenteDigitos('cnpj')} = ?`, [cnpjDigitos]);
    });

  if (ignorarId) {
    query.whereNot('id', Number(ignorarId));
  }

  return query.first();
}

/**
 * Valida CPF/CNPJ e informa se ja existe cliente com o mesmo documento.
 *
 * @param {string} documento - CPF ou CNPJ bruto.
 * @param {Object} [opcoes={}] - Cliente ignorado em edicoes.
 * @returns {Promise.<Object>} Resultado de disponibilidade.
 */
async function verificarDocumentoCliente(documento, opcoes = {}) {
  const documentoNormalizado = normalizarDocumentoObrigatorio(documento);
  const cliente = await buscarClienteDuplicadoPorCnpj(
    documentoNormalizado.cnpj_digitos,
    opcoes.ignorarId
  );

  if (!cliente) {
    return {
      existe: false,
      documento: documentoNormalizado.cnpj,
      cnpj_digitos: documentoNormalizado.cnpj_digitos
    };
  }

  return {
    existe: true,
    documento: documentoNormalizado.cnpj,
    cnpj_digitos: documentoNormalizado.cnpj_digitos,
    cliente: {
      id: cliente.id,
      nome: cliente.nome,
      razao_social: cliente.razao_social,
      cnpj: cliente.cnpj,
      excluido: Boolean(cliente.excluido_em)
    }
  };
}

/**
 * Processa lancar erro cnpj duplicado conforme as regras do dominio.
 */
function lancarErroCnpjDuplicado(cliente) {
  const nome = cliente.razao_social || cliente.nome || `#${cliente.id}`;
  const sufixo = cliente.excluido_em
    ? ' O cliente está na lixeira; restaure-o para usar este documento.'
    : '';

  throw criarHttpError(409, `Ja existe um cliente cadastrado com este documento (${nome}).${sufixo}`);
}

/**
 * Busca escopo clientes conforme os parametros informados.
 */
async function buscarEscopoClientes(usuarioId) {
  const usuario = await Usuario.query()
    .findById(usuarioId)
    .withGraphFetched('role');

  if (!usuario || !usuario.ativo) {
    return { podeVerTodos: false, podeVerProprios: false, podeAtribuirConsultoras: false };
  }

  return {
    podeVerTodos: usuarioTemPermissaoLocal(usuario, 'clientes_ver_todos'),
    podeVerProprios: usuarioTemPermissaoLocal(usuario, 'clientes_ver_proprios'),
    podeAtribuirConsultoras: usuarioTemPermissaoLocal(usuario, 'clientes_atribuir_vendedora')
  };
}


/**
 * Aplica escopo clientes sobre a consulta ou conjunto informado.
 */
function aplicarEscopoClientes(query, usuarioId, escopo) {
  if (escopo.podeVerTodos) {
    return query;
  }

  if (!escopo.podeVerProprios) {
    query.whereRaw('1 = 0');
    return query;
  }

  query.where(builder => {
    builder.where('criado_por_id', usuarioId)
      .orWhereExists(
        Cliente.knex().select(Cliente.knex().raw('1'))
          .from('cliente_consultoras as cc')
          .whereRaw('cc.cliente_id = clientes.id')
          .where('cc.usuario_id', usuarioId)
      );
  });
  return query;
}

/**
 * Monta aviso fidelidade a partir dos dados informados.
 */
function montarAvisoFidelidade(cliente) {
  if (!cliente.fidelidade_fim || cliente.fidelidade_fim === '1899-11-30') {
    return null;
  }

  const hoje = new Date();
  const fim = new Date(cliente.fidelidade_fim);
  hoje.setHours(0, 0, 0, 0);
  fim.setHours(0, 0, 0, 0);

  const diasRestantes = Math.ceil((fim.getTime() - hoje.getTime()) / 86400000);

  if (diasRestantes > 30) {
    return {
      dias_restantes: diasRestantes,
      deve_avisar: false,
      nivel: null
    };
  }

  return {
    dias_restantes: diasRestantes,
    deve_avisar: true,
    nivel: diasRestantes < 0 ? 'vencida' : diasRestantes === 0 ? 'hoje' : diasRestantes <= 10 ? 'urgente' : 'proximo'
  };
}

/**
 * Retorna valor data excel no formato esperado pelo fluxo.
 */
function valorDataExcel(valor) {
  const texto = valor instanceof Date
    ? [
        valor.getUTCFullYear(),
        String(valor.getUTCMonth() + 1).padStart(2, '0'),
        String(valor.getUTCDate()).padStart(2, '0')
      ].join('-')
    : String(valor || '').trim().slice(0, 10);
  const data = /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : normalizarData(valor);
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
 * Formata telefone exportacao para exibicao ou envio.
 */
function formatarTelefoneExportacao(ddd, numero) {
  const d = String(ddd || '').trim();
  const n = String(numero || '').trim();
  if (!d && !n) return '';
  return d ? `(${d}) ${n}` : n;
}

/**
 * Formata operadoras exportacao para exibicao ou envio.
 */
function formatarOperadorasExportacao(cliente) {
  const operadoras = cliente.operadoras_atuais || cliente.operadorasAtuais || [];
  if (operadoras.length > 0) {
    return operadoras
      .map(item => item.operadora?.nome)
      .filter(Boolean)
      .join(', ');
  }

  return cliente.operadoraAtual?.nome || '';
}

/**
 * Gera arquivo XLSX com clientes visiveis ao usuario e filtros aplicados.
 *
 * @param {Object} [filtros={}] - Filtros de listagem/exportacao.
 * @param {number|string} usuarioId - Usuario usado para aplicar escopo de acesso.
 * @returns {Promise.<Object>} Conteudo e nome sugerido do arquivo.
 */
async function gerarXlsxClientes(filtros = {}, usuarioId) {
  const filtrosExportacao = { ...filtros };
  delete filtrosExportacao.page;
  delete filtrosExportacao.per_page;

  const clientes = await listarClientes(filtrosExportacao, usuarioId);
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Clientes');

  workbook.creator = 'Sistema Pos Venda';
  workbook.created = new Date();

  worksheet.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'CLIENTE', key: 'nome', width: 34 },
    { header: 'RAZAO SOCIAL', key: 'razao_social', width: 34 },
    { header: 'CNPJ/CPF', key: 'cnpj', width: 20 },
    { header: 'RESPONSAVEL TIPO', key: 'responsavel_tipo', width: 18 },
    { header: 'RESPONSAVEL', key: 'responsavel_nome', width: 28 },
    { header: 'EMAIL', key: 'email', width: 30 },
    { header: 'WHATSAPP', key: 'whatsapp', width: 18 },
    { header: 'FIXO', key: 'fixo', width: 18 },
    { header: 'OPERADORAS', key: 'operadoras', width: 32 },
    { header: 'CHIPS', key: 'quantidade_chips', width: 10 },
    { header: 'VALOR PAGO', key: 'valor_pago', width: 14, style: { numFmt: 'R$ #,##0.00' } },
    { header: 'FIDELIDADE FIM', key: 'fidelidade_fim', width: 16, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'BASE ANTERIOR', key: 'base_anterior_sistema', width: 16 },
    { header: 'REGISTRADO POR', key: 'criado_por', width: 22 },
    { header: 'CRIADO EM', key: 'created_at', width: 16, style: { numFmt: 'dd/mm/yyyy' } }
  ];

  clientes.forEach(cliente => {
    worksheet.addRow({
      id: cliente.id,
      nome: cliente.nome || '',
      razao_social: cliente.razao_social || '',
      cnpj: cliente.cnpj || '',
      responsavel_tipo: cliente.responsavel_tipo === 'adm' ? 'ADM' : 'RL',
      responsavel_nome: cliente.responsavel_nome || '',
      email: cliente.email || '',
      whatsapp: formatarTelefoneExportacao(cliente.whatsapp_ddd, cliente.whatsapp_numero),
      fixo: formatarTelefoneExportacao(cliente.fixo_ddd, cliente.fixo_numero),
      operadoras: formatarOperadorasExportacao(cliente),
      quantidade_chips: cliente.quantidade_chips ?? null,
      valor_pago: cliente.valor_pago === null || cliente.valor_pago === undefined ? null : Number(cliente.valor_pago),
      fidelidade_fim: valorDataExcel(cliente.fidelidade_fim),
      base_anterior_sistema: cliente.base_anterior_sistema ? 'Sim' : 'Nao',
      criado_por: cliente.criador?.nome || '',
      created_at: valorDataExcel(cliente.created_at)
    });
  });

  aplicarEstiloExportacao(worksheet);
  worksheet.getColumn('valor_pago').numFmt = 'R$ #,##0.00';
  worksheet.getColumn('fidelidade_fim').numFmt = 'dd/mm/yyyy';
  worksheet.getColumn('created_at').numFmt = 'dd/mm/yyyy';

  const buffer = await workbook.xlsx.writeBuffer();
  const data = new Date().toISOString().slice(0, 10);
  return { buffer, nome: `clientes-${nomeArquivoSeguro(data)}.xlsx` };
}

/**
 * Formata cliente para exibicao ou envio.
 */
function formatarCliente(cliente) {
  if (!cliente) return cliente;

  const json = typeof cliente.toJSON === 'function' ? cliente.toJSON() : cliente;
  const operadorasAtuais = formatarOperadorasCliente(json.operadorasAtuais || json.operadoras_atuais || []);
  const resumo = obterResumoOperadorasCliente(operadorasAtuais);

  return {
    ...json,
    operadorasAtuais: operadorasAtuais,
    operadoras_atuais: operadorasAtuais,
    operadora_atual_id: resumo.operadora_atual_id ?? json.operadora_atual_id ?? null,
    operadoraAtual: resumo.operadoraAtual || json.operadoraAtual || null,
    quantidade_chips: resumo.quantidade_chips ?? json.quantidade_chips ?? null,
    valor_pago: resumo.valor_pago ?? json.valor_pago ?? null,
    fidelidade_fim: resumo.fidelidade_fim ?? json.fidelidade_fim ?? null,
    aviso_fidelidade: montarAvisoFidelidade({ fidelidade_fim: resumo.fidelidade_fim ?? json.fidelidade_fim })
  };
}

/**
 * Monta resumo notas clientes a partir dos dados informados.
 */
async function montarResumoNotasClientes(clientes, usuarioId) {
  const ids = clientes.map(cliente => Number(cliente.id)).filter(Boolean);

  if (ids.length === 0) {
    return new Map();
  }

  const linhas = await Cliente.knex()('entidade_notas')
    .where('entidade_tipo', 'cliente')
    .where('usuario_id', Number(usuarioId))
    .whereIn('entidade_id', ids)
    .groupBy('entidade_id')
    .select('entidade_id')
    .count('id as notas_total')
    .select(Cliente.knex().raw('SUM(CASE WHEN retorno_agendado_para IS NULL THEN 0 ELSE 1 END) as notas_com_retorno_total'))
    .select(Cliente.knex().raw('SUM(CASE WHEN retorno_agendado_para <= NOW() THEN 1 ELSE 0 END) as notas_retorno_vencido_total'))
    .min('retorno_agendado_para as proximo_retorno_agendado_para')
    .select(Cliente.knex().raw('MIN(CASE WHEN retorno_agendado_para <= NOW() THEN retorno_agendado_para ELSE NULL END) as proximo_retorno_vencido_para'));

  return new Map(linhas.map(linha => ([
    Number(linha.entidade_id),
    {
      notas_total: Number(linha.notas_total || 0),
      notas_com_retorno_total: Number(linha.notas_com_retorno_total || 0),
      notas_retorno_vencido_total: Number(linha.notas_retorno_vencido_total || 0),
      proximo_retorno_agendado_para: linha.proximo_retorno_agendado_para || null,
      proximo_retorno_vencido_para: linha.proximo_retorno_vencido_para || null
    }
  ])));
}

/**
 * Monta resumo vendas clientes a partir dos dados informados.
 */
async function montarResumoVendasClientes(clientes) {
  const ids = clientes.map(cliente => Number(cliente.id)).filter(Boolean);

  if (ids.length === 0) {
    return new Map();
  }

  const linhas = await Cliente.knex()('vendas')
    .whereIn('cliente_id', ids)
    .groupBy('cliente_id')
    .select('cliente_id')
    .count('id as vendas_total');

  return new Map(linhas.map(linha => [
    Number(linha.cliente_id),
    Number(linha.vendas_total || 0)
  ]));
}

/**
 * Adiciona resumo notas clientes ao conjunto atual.
 */
async function adicionarResumoNotasClientes(clientes, usuarioId) {
  const resumoPorCliente = await montarResumoNotasClientes(clientes, usuarioId);

  return clientes.map(cliente => ({
    ...cliente,
    notas_resumo: resumoPorCliente.get(Number(cliente.id)) || {
      notas_total: 0,
      notas_com_retorno_total: 0,
      notas_retorno_vencido_total: 0,
      proximo_retorno_agendado_para: null,
      proximo_retorno_vencido_para: null
    }
  }));
}

/**
 * Adiciona resumo vendas relacionadas ao conjunto atual.
 */
async function adicionarResumoVendasRelacionadas(clientes) {
  const resumoPorCliente = await montarResumoVendasClientes(clientes);

  return clientes.map(cliente => ({
    ...cliente,
    vendas_relacionadas_total: resumoPorCliente.get(Number(cliente.id)) || 0
  }));
}

/**
 * Aplica busca clientes sobre a consulta ou conjunto informado.
 */
function aplicarBuscaClientes(query, termo) {
  const busca = `%${termo}%`;
  const cnpjDigitos = sanitizarCnpj(termo);
  const telefoneDigitos = apenasDigitos(termo);

  query.where((builder) => {
    builder
      .where('nome', 'like', busca)
      .orWhere('razao_social', 'like', busca)
      .orWhere('cnpj', 'like', busca)
      .orWhere('email', 'like', busca)
      .orWhere('responsavel_nome', 'like', busca);

    if (cnpjDigitos) {
      builder.orWhere('cnpj_digitos', 'like', `%${cnpjDigitos}%`);
    }

    if (telefoneDigitos) {
      builder
        .orWhereRaw("CONCAT(COALESCE(whatsapp_ddd, ''), COALESCE(whatsapp_numero, '')) like ?", [`%${telefoneDigitos}%`])
        .orWhereRaw("CONCAT(COALESCE(fixo_ddd, ''), COALESCE(fixo_numero, '')) like ?", [`%${telefoneDigitos}%`]);
    }
  });
}

/**
 * Aplica busca campo clientes sobre a consulta ou conjunto informado.
 */
function aplicarBuscaCampoClientes(query, filtros = {}) {
  const campo = String(filtros.busca_campo || '').trim();
  const valor = String(filtros.busca_valor || '').trim();

  if (!campo || !valor) return;

  if (campo === 'cliente') {
    query.where(builder => {
      builder
        .where('nome', 'like', `%${valor}%`)
        .orWhere('razao_social', 'like', `%${valor}%`);
    });
    return;
  }

  if (campo === 'documento' || campo === 'cnpj') {
    const digitos = apenasDigitos(valor);
    if (!digitos) return;

    query.where(builder => {
      builder
        .where('cnpj_digitos', 'like', `%${digitos}%`)
        .orWhereRaw(`${sqlSomenteDigitos('cnpj')} like ?`, [`%${digitos}%`]);
    });
    return;
  }

  if (campo === 'telefone') {
    const digitos = apenasDigitos(valor);
    if (!digitos) return;

    query.where(builder => {
      builder
        .whereRaw("CONCAT(COALESCE(whatsapp_ddd, ''), COALESCE(whatsapp_numero, '')) like ?", [`%${digitos}%`])
        .orWhereRaw("CONCAT(COALESCE(fixo_ddd, ''), COALESCE(fixo_numero, '')) like ?", [`%${digitos}%`])
        .orWhereRaw(`${sqlSomenteDigitos('whatsapp_numero')} like ?`, [`%${digitos}%`])
        .orWhereRaw(`${sqlSomenteDigitos('fixo_numero')} like ?`, [`%${digitos}%`]);
    });
    return;
  }

  if (campo === 'email') {
    query.where('email', 'like', `%${valor}%`);
    return;
  }

  if (campo === 'responsavel') {
    query.where('responsavel_nome', 'like', `%${valor}%`);
  }
}

/**
 * Processa subquery soma chips cliente conforme as regras do dominio.
 */
function subquerySomaChipsCliente() {
  return Cliente.knex().raw(`(
    SELECT COALESCE(SUM(co.quantidade_chips), 0)
    FROM cliente_operadoras co
    WHERE co.cliente_id = clientes.id
  )`);
}

/**
 * Aplica filtro fidelidade operadoras sobre a consulta ou conjunto informado.
 */
function aplicarFiltroFidelidadeOperadoras(query, tipo) {
  const knex = Cliente.knex();

  if (tipo === 'sem') {
    query.whereNotExists(
      knex.select(knex.raw('1'))
        .from('cliente_operadoras as co')
        .whereRaw('co.cliente_id = clientes.id')
        .whereNotNull('co.fidelidade_fim')
        .whereNot('co.fidelidade_fim', '1899-11-30')
    );
    return;
  }

  query.whereExists(function () {
    this.select(knex.raw('1'))
      .from('cliente_operadoras as co')
      .whereRaw('co.cliente_id = clientes.id')
      .whereNotNull('co.fidelidade_fim')
      .whereNot('co.fidelidade_fim', '1899-11-30');

    if (tipo === 'alerta') {
      this.whereRaw('co.fidelidade_fim <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)');
    } else if (tipo === 'vencida') {
      this.whereRaw('co.fidelidade_fim < CURDATE()');
    } else if (tipo === 'ativa') {
      this.whereRaw('co.fidelidade_fim >= CURDATE()');
    }
  });
}

/**
 * Lista clientes ativos respeitando escopo de permissoes, filtros e paginacao.
 *
 * @param {Object} [filtros={}] - Filtros de busca, campos, operadora, fidelidade e paginacao.
 * @param {number|string} usuarioId - Usuario logado.
 * @returns {Promise<Array|{ data: Array, total: number }>} Clientes formatados.
 */
async function listarClientes(filtros = {}, usuarioId) {
  const escopo = await buscarEscopoClientes(usuarioId);
  const paginar = filtros.page !== undefined || filtros.per_page !== undefined;
  const { page, perPage } = normalizarPaginacao(filtros);

  const query = Cliente.query()
    .withGraphFetched('[operadoraAtual, operadorasAtuais.operadora, criador, consultoras]')
    .modifyGraph('consultoras', builder => builder.select('id', 'nome', 'email'))
    .whereNull('excluido_em');

  aplicarEscopoClientes(query, usuarioId, escopo);

  if (filtros.cliente_id) {
    query.where('id', Number(filtros.cliente_id));
  }

  if (filtros.busca) {
    aplicarBuscaClientes(query, filtros.busca);
  }

  aplicarBuscaCampoClientes(query, filtros);

  if (filtros.operadora_atual_id) {
    query.whereExists(
      Cliente.knex().select(Cliente.knex().raw('1'))
        .from('cliente_operadoras as co')
        .whereRaw('co.cliente_id = clientes.id')
        .where('co.operadora_id', Number(filtros.operadora_atual_id))
    );
  }

  if (['adm', 'rl'].includes(filtros.responsavel_tipo)) {
    query.where('responsavel_tipo', filtros.responsavel_tipo);
  }

  if (filtros.chips_min) {
    query.where(subquerySomaChipsCliente(), '>=', Number(filtros.chips_min));
  }

  if (filtros.chips_max) {
    query.where(subquerySomaChipsCliente(), '<=', Number(filtros.chips_max));
  }

  if (filtros.base_anterior_sistema === 'true' || filtros.base_anterior_sistema === '1') {
    query.where('base_anterior_sistema', true);
  }

  if (filtros.base_anterior_sistema === 'false' || filtros.base_anterior_sistema === '0') {
    query.where('base_anterior_sistema', false);
  }

  if (filtros.avisos_fidelidade || filtros.fidelidade === 'alerta') {
    aplicarFiltroFidelidadeOperadoras(query, 'alerta');
  } else if (filtros.fidelidade === 'sem') {
    aplicarFiltroFidelidadeOperadoras(query, 'sem');
  } else if (filtros.fidelidade === 'vencida') {
    aplicarFiltroFidelidadeOperadoras(query, 'vencida');
  } else if (filtros.fidelidade === 'ativa') {
    aplicarFiltroFidelidadeOperadoras(query, 'ativa');
  }

  if (filtros.retorno === 'vencido' && usuarioId) {
    query.whereExists(
      Cliente.knex().select(Cliente.knex().raw('1')).from('entidade_notas')
        .where('entidade_tipo', 'cliente')
        .where('usuario_id', Number(usuarioId))
        .whereRaw('entidade_id = clientes.id')
        .whereRaw('retorno_agendado_para <= NOW()')
    );
  }

  if (filtros.fidelidade === 'alerta') {
    query.orderByRaw(`(
      SELECT MIN(co.fidelidade_fim)
      FROM cliente_operadoras co
      WHERE co.cliente_id = clientes.id
        AND co.fidelidade_fim IS NOT NULL
        AND co.fidelidade_fim <> '1899-11-30'
    ) asc`);
  } else {
    query.orderBy('nome', 'asc');
  }

  if (paginar) {
    const result = await query.page(page - 1, perPage);
    const clientes = await adicionarResumoNotasClientes(result.results.map(formatarCliente), usuarioId);
    return { data: clientes, total: result.total };
  }

  return adicionarResumoNotasClientes((await query).map(formatarCliente), usuarioId);
}

/**
 * Lista clientes ativos em formato leve para seletores.
 *
 * @param {Object} [filtros={}] - Filtros de busca e limite.
 * @param {number|string} usuarioId - Usuario logado.
 * @returns {Promise<Array>} Clientes formatados para selecao.
 */
async function listarClientesSelect(filtros = {}, usuarioId) {
  const escopo = await buscarEscopoClientes(usuarioId);
  const limite = Math.min(Math.max(Number.parseInt(filtros.limite, 10) || 300, 1), 500);
  const query = Cliente.query()
    .select(
      'id',
      'nome',
      'razao_social',
      'cnpj',
      'responsavel_tipo',
      'responsavel_nome',
      'email',
      'whatsapp_ddd',
      'whatsapp_numero',
      'fixo_ddd',
      'fixo_numero',
      'fidelidade_fim',
      'operadora_atual_id',
      'valor_pago',
      'quantidade_chips',
      'base_anterior_sistema',
      'criado_por_id'
    )
    .withGraphFetched('[operadoraAtual, operadorasAtuais.operadora, consultoras]')
    .modifyGraph('consultoras', builder => builder.select('id', 'nome', 'email'))
    .whereNull('excluido_em')
    .orderBy('nome', 'asc')
    .limit(limite);

  aplicarEscopoClientes(query, usuarioId, escopo);

  if (filtros.busca) {
    aplicarBuscaClientes(query, filtros.busca);
  }

  return (await query).map(formatarCliente);
}

/**
 * Busca um cliente ativo pelo ID, aplicando escopo quando houver usuario.
 *
 * @param {number|string} id - Identificador do cliente.
 * @param {number|string} [usuarioId] - Usuario logado para validar acesso.
 * @returns {Promise<Object|null>} Cliente formatado ou null.
 */
async function buscarClientePorId(id, usuarioId) {
  const escopo = usuarioId ? await buscarEscopoClientes(usuarioId) : { podeVerTodos: true };
  const query = Cliente.query()
    .findById(id)
    .whereNull('excluido_em')
    .withGraphFetched('[operadoraAtual, operadorasAtuais.operadora, criador, consultoras]')
    .modifyGraph('consultoras', builder => builder.select('id', 'nome', 'email'));

  if (usuarioId) {
    aplicarEscopoClientes(query, usuarioId, escopo);
  }

  return formatarCliente(await query);
}

/**
 * Verifica se o usuario pode acessar um cliente ativo ou na lixeira.
 *
 * @param {number|string} id - Identificador do cliente.
 * @param {number|string} usuarioId - Usuario logado.
 * @param {Object} [opcoes={}] - Permite validar registros excluidos logicamente.
 * @returns {Promise<boolean>} Verdadeiro quando o acesso e permitido.
 */
async function usuarioPodeAcessarCliente(id, usuarioId, opcoes = {}) {
  const escopo = await buscarEscopoClientes(usuarioId);

  if (escopo.podeVerTodos) {
    return true;
  }

  if (!escopo.podeVerProprios) {
    return false;
  }

  const query = Cliente.query()
    .findById(id)
    .select('id', 'criado_por_id');

  if (!opcoes.incluirLixeira) {
    query.whereNull('excluido_em');
  }

  const cliente = await query;

  if (Number(cliente?.criado_por_id) === Number(usuarioId)) return true;

  return Boolean(await Cliente.knex()('cliente_consultoras')
    .where({ cliente_id: id, usuario_id: usuarioId })
    .first());
}

/** Normaliza e valida a lista de consultoras vinculadas a um cliente. */
async function normalizarConsultoraIds(ids) {
  if (!Array.isArray(ids)) {
    const error = new Error('consultora_ids deve ser uma lista de identificadores.');
    error.statusCode = 400;
    throw error;
  }

  const normalizados = ids.map(Number);
  if (normalizados.some(id => !Number.isInteger(id) || id <= 0) || new Set(normalizados).size !== normalizados.length) {
    const error = new Error('Informe consultoras válidas, sem duplicidades.');
    error.statusCode = 400;
    throw error;
  }

  const ativos = normalizados.length ? await Usuario.query().whereIn('id', normalizados).where('ativo', true).select('id') : [];
  if (ativos.length !== normalizados.length) {
    const error = new Error('Uma ou mais consultoras não existem ou estão inativas.');
    error.statusCode = 400;
    throw error;
  }
  return normalizados;
}

/** Substitui, transacionalmente, os vínculos de consultoras do cliente. */
async function atualizarConsultorasCliente(id, consultoraIds, usuarioId) {
  const escopo = await buscarEscopoClientes(usuarioId);
  if (!escopo.podeAtribuirConsultoras) {
    const error = new Error('Você não tem permissão para vincular consultoras a clientes.');
    error.statusCode = 403;
    throw error;
  }

  const ids = await normalizarConsultoraIds(consultoraIds);
  const cliente = await Cliente.transaction(async trx => {
    const existente = await Cliente.query(trx).findById(id).whereNull('excluido_em');
    if (!existente) return null;
    await trx('cliente_consultoras').where('cliente_id', id).delete();
    if (ids.length) {
      await trx('cliente_consultoras').insert(ids.map(usuario_id => ({ cliente_id: Number(id), usuario_id })));
    }
    return formatarCliente(await Cliente.query(trx).findById(id)
      .withGraphFetched('[operadoraAtual, operadorasAtuais.operadora, criador, consultoras]')
      .modifyGraph('consultoras', builder => builder.select('id', 'nome', 'email')));
  });

  if (cliente) await notificacaoService.sincronizarFidelidadeCliente(cliente.id);
  return cliente;
}

/**
 * Cria cliente, sincroniza operadoras e notificacoes de fidelidade.
 *
 * @param {Object} dados - Dados do formulario de cliente.
 * @param {number|string} usuarioId - Usuario criador.
 * @returns {Promise<Object>} Cliente criado e formatado.
 */
async function criarCliente(dados, usuarioId) {
  const payload = montarPayload(dados);
  const recebeuConsultoras = Object.prototype.hasOwnProperty.call(dados, 'consultora_ids');
  const consultoraIds = recebeuConsultoras ? await normalizarConsultoraIds(dados.consultora_ids) : [];
  if (recebeuConsultoras && !(await buscarEscopoClientes(usuarioId)).podeAtribuirConsultoras) {
    const error = new Error('Você não tem permissão para vincular consultoras a clientes.');
    error.statusCode = 403;
    throw error;
  }
  const duplicado = await buscarClienteDuplicadoPorCnpj(payload.cnpj_digitos);

  if (duplicado) {
    lancarErroCnpjDuplicado(duplicado);
  }

  const cliente = await Cliente.transaction(async trx => {
    const criado = await Cliente.query(trx).insertAndFetch({
      ...payload,
      criado_por_id: usuarioId
    });

    if (consultoraIds.length) {
      await trx('cliente_consultoras').insert(consultoraIds.map(usuario_id => ({ cliente_id: criado.id, usuario_id })));
    }

    await sincronizarOperadorasCliente(criado.id, dados.operadoras_atuais || dados.operadorasAtuais || normalizarOperadorasCliente(dados), trx);
    return formatarCliente(await Cliente.query(trx)
      .findById(criado.id)
      .withGraphFetched('[operadoraAtual, operadorasAtuais.operadora, criador, consultoras]')
      .modifyGraph('consultoras', builder => builder.select('id', 'nome', 'email')));
  });

  await notificacaoService.sincronizarFidelidadeCliente(cliente.id);

  return cliente;
}

/**
 * Atualiza cliente existente, validando acesso e duplicidade de documento.
 *
 * @param {number|string} id - Identificador do cliente.
 * @param {Object} dados - Campos atualizados.
 * @param {number|string} usuarioId - Usuario logado.
 * @returns {Promise<Object|null>} Cliente atualizado ou null quando inacessivel/inexistente.
 */
async function atualizarCliente(id, dados, usuarioId) {
  const permitido = await usuarioPodeAcessarCliente(id, usuarioId);

  if (!permitido) {
    return null;
  }

  const payload = montarPayload(dados);
  const recebeuConsultoras = Object.prototype.hasOwnProperty.call(dados, 'consultora_ids');
  const consultoraIds = recebeuConsultoras ? await normalizarConsultoraIds(dados.consultora_ids) : [];
  if (recebeuConsultoras && !(await buscarEscopoClientes(usuarioId)).podeAtribuirConsultoras) {
    const error = new Error('Você não tem permissão para vincular consultoras a clientes.');
    error.statusCode = 403;
    throw error;
  }
  const duplicado = await buscarClienteDuplicadoPorCnpj(payload.cnpj_digitos, id);

  if (duplicado) {
    lancarErroCnpjDuplicado(duplicado);
  }

  const cliente = await Cliente.transaction(async trx => {
    const atualizado = await Cliente.query(trx).patchAndFetchById(id, {
      ...payload,
      updated_at: new Date()
    });

    if (!atualizado) return null;

    if (recebeuConsultoras) {
      await trx('cliente_consultoras').where('cliente_id', id).delete();
      if (consultoraIds.length) {
        await trx('cliente_consultoras').insert(consultoraIds.map(usuario_id => ({ cliente_id: Number(id), usuario_id })));
      }
    }

    if (dados.operadoras_atuais !== undefined || dados.operadorasAtuais !== undefined
      || dados.operadora_atual_id !== undefined || dados.quantidade_chips !== undefined
      || dados.valor_pago !== undefined || dados.fidelidade_fim !== undefined) {
      await sincronizarOperadorasCliente(id, dados.operadoras_atuais || dados.operadorasAtuais || normalizarOperadorasCliente(dados), trx);
    }

    return formatarCliente(await Cliente.query(trx)
      .findById(id)
      .withGraphFetched('[operadoraAtual, operadorasAtuais.operadora, criador, consultoras]')
      .modifyGraph('consultoras', builder => builder.select('id', 'nome', 'email')));
  });

  if (cliente) {
    await notificacaoService.sincronizarFidelidadeCliente(cliente.id);
  }

  return cliente;
}


/**
 * Move cliente para a lixeira e remove notificacoes relacionadas.
 *
 * @param {number|string} id - Identificador do cliente.
 * @param {number|string} usuarioId - Usuario responsavel pela exclusao.
 * @returns {Promise<number>} Quantidade de registros atualizados.
 */
async function excluirCliente(id, usuarioId) {
  const permitido = await usuarioPodeAcessarCliente(id, usuarioId);

  if (!permitido) {
    return 0;
  }

  const agora = new Date();

  return Cliente.transaction(async trx => {
    const atualizados = await trx('clientes')
      .where('id', id)
      .whereNull('excluido_em')
      .update({
        excluido_em: formatarDateTimeSQL(agora),
        excluir_definitivo_em: formatarDateTimeSQL(adicionarUmMes(agora)),
        excluido_por_id: usuarioId,
        updated_at: formatarDateTimeSQL(agora)
      });

    if (atualizados) {
      await excluirNotificacoesClientes(id, trx);
    }

    return atualizados;
  });
}

/**
 * Normaliza cliente ids para uso interno consistente.
 */
function normalizarClienteIds(ids) {
  return [...new Set([ids]
    .flat()
    .map(item => Number(item))
    .filter(Boolean))];
}

/**
 * Busca source keys notificacoes cliente conforme os parametros informados.
 */
async function buscarSourceKeysNotificacoesCliente(clienteIds, trx) {
  const notas = await trx('entidade_notas')
    .select('id')
    .where('entidade_tipo', 'cliente')
    .whereIn('entidade_id', clienteIds);

  const sourceKeys = [];

  notas.forEach(nota => {
    sourceKeys.push(`nota_retorno_pre:${nota.id}`);
    sourceKeys.push(`nota_retorno_due:${nota.id}`);
  });

  return sourceKeys;
}

/**
 * Exclui notificacoes clientes conforme a regra de negocio.
 */
async function excluirNotificacoesClientes(clienteIdsEntrada, trx) {
  const clienteIds = normalizarClienteIds(clienteIdsEntrada);
  if (clienteIds.length === 0) return 0;

  const sourceKeys = await buscarSourceKeysNotificacoesCliente(clienteIds, trx);

  const notificacoes = await trx('notificacoes')
    .select('id')
    .where(builder => {
      builder.where(function () {
        this.where('entidade', 'clientes').whereIn('entidade_id', clienteIds);
      });

      if (sourceKeys.length > 0) {
        builder.orWhereIn('source_key', sourceKeys);
      }

      clienteIds.forEach(clienteId => {
        builder
          .orWhere('source_key', `cliente_fidelidade:${clienteId}`)
          .orWhere('source_key', 'like', `cliente_fidelidade:${clienteId}:%`);
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

  return notificacaoIds.length;
}

/**
 * Conta vendas relacionadas cliente conforme os dados informados.
 */
async function contarVendasRelacionadasCliente(clienteId, trx = null) {
  const resultado = await Venda.query(trx)
    .where('cliente_id', clienteId)
    .count('id as total')
    .first();

  return Number(resultado?.total || 0);
}

/**
 * Limpa clientes vencidos da lixeira e restaura o estado inicial.
 */
async function limparClientesVencidosDaLixeira() {
  return Cliente.transaction(async trx => {
    const agora = formatarDateTimeSQL();
    const clientes = await Cliente.query(trx)
      .select('id', 'nome', 'razao_social', 'cnpj')
      .whereNotNull('excluido_em')
      .where('excluir_definitivo_em', '<=', agora);

    const clientesSemVendas = [];
    for (const cliente of clientes) {
      const totalVendas = await contarVendasRelacionadasCliente(cliente.id, trx);
      if (totalVendas === 0) {
        clientesSemVendas.push(cliente);
      }
    }

    if (clientesSemVendas.length === 0) {
      return 0;
    }

    await excluirNotificacoesClientes(clientesSemVendas.map(cliente => cliente.id), trx);

    return Cliente.query(trx)
      .delete()
      .whereIn('id', clientesSemVendas.map(cliente => cliente.id));
  });
}

/**
 * Lista clientes da lixeira e limpa automaticamente registros vencidos sem vendas.
 *
 * @param {Object} [filtros={}] - Filtros de busca.
 * @param {number|string} usuarioId - Usuario logado.
 * @returns {Promise<Array>} Clientes excluidos logicamente.
 */
async function listarClientesLixeira(filtros = {}, usuarioId) {
  await limparClientesVencidosDaLixeira();

  const escopo = await buscarEscopoClientes(usuarioId);
  const query = Cliente.query()
    .withGraphFetched('[operadoraAtual, operadorasAtuais.operadora, criador, consultoras, excluidoPor]')
    .modifyGraph('consultoras', builder => builder.select('id', 'nome', 'email'))
    .whereNotNull('excluido_em')
    .orderBy('excluido_em', 'desc')
    .orderBy('id', 'desc');

  aplicarEscopoClientes(query, usuarioId, escopo);

  if (filtros.busca) {
    aplicarBuscaClientes(query, filtros.busca);
  }

  return adicionarResumoVendasRelacionadas((await query).map(formatarCliente));
}

/**
 * Restaura um cliente da lixeira quando o usuario possui acesso.
 *
 * @param {number|string} id - Identificador do cliente.
 * @param {number|string} usuarioId - Usuario logado.
 * @returns {Promise<Object|null>} Cliente restaurado ou null.
 */
async function restaurarCliente(id, usuarioId) {
  const permitido = await usuarioPodeAcessarCliente(id, usuarioId, { incluirLixeira: true });

  if (!permitido) {
    return null;
  }

  const atualizados = await Cliente.knex()('clientes')
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

  return buscarClientePorId(id, usuarioId);
}

/**
 * Exclui definitivamente um cliente da lixeira, opcionalmente removendo vendas relacionadas.
 *
 * @param {number|string} id - Identificador do cliente.
 * @param {number|string} usuarioId - Usuario logado.
 * @param {Object} [opcoes={}] - Confirma remocao de vendas vinculadas.
 * @returns {Promise<number>} Quantidade de clientes excluidos.
 * @throws {Error} Quando existem vendas relacionadas e a exclusao delas nao foi confirmada.
 */
async function excluirClienteDefinitivo(id, usuarioId, opcoes = {}) {
  const permitido = await usuarioPodeAcessarCliente(id, usuarioId, { incluirLixeira: true });

  if (!permitido) {
    return 0;
  }

  const excluirVendasRelacionadas = Boolean(opcoes.excluirVendasRelacionadas);

  return Cliente.transaction(async trx => {
    const cliente = await Cliente.query(trx)
      .findById(id)
      .whereNotNull('excluido_em')
      .select('id', 'nome', 'razao_social', 'cnpj');

    if (!cliente) {
      return 0;
    }

    const totalVendasRelacionadas = await contarVendasRelacionadasCliente(id, trx);

    if (totalVendasRelacionadas > 0 && !excluirVendasRelacionadas) {
      const error = criarHttpError(
        409,
        `Este cliente possui ${totalVendasRelacionadas} venda(s) relacionada(s). Exclua as vendas antes ou confirme a exclusao delas junto com o cliente.`
      );
      error.totalVendasRelacionadas = totalVendasRelacionadas;
      throw error;
    }

    const vendasRelacionadas = Venda.query(trx).where('cliente_id', id);

    if (totalVendasRelacionadas > 0 && excluirVendasRelacionadas) {
      await vendasRelacionadas.delete();
    }

    await excluirNotificacoesClientes(id, trx);

    return Cliente.query(trx)
      .delete()
      .where('id', id)
      .whereNotNull('excluido_em');
  });
}

/**
 * Remove em lote clientes marcados como base anterior.
 *
 * @param {Object} [opcoes={}] - Define se vendas vinculadas tambem serao removidas.
 * @returns {Promise.<Object>} Resumo da limpeza.
 */
async function limparClientesBaseAnterior(opcoes = {}) {
  return Cliente.transaction(async trx => {
    const clientes = await Cliente.query(trx)
      .select('id', 'nome', 'razao_social', 'cnpj')
      .where('base_anterior_sistema', true);
    if (clientes.length === 0) {
      return { excluidos: 0, vendas_excluidas: 0 };
    }

    const excluirVendasRelacionadas = Boolean(opcoes.excluirVendasRelacionadas);
    const clienteIdsTodos = clientes.map(cliente => Number(cliente.id)).filter(Boolean);
    let vendasExcluidas = 0;
    let clienteIds = clienteIdsTodos;

    if (excluirVendasRelacionadas && clienteIdsTodos.length > 0) {
      vendasExcluidas = await Venda.query(trx)
        .whereIn('cliente_id', clienteIdsTodos)
        .delete();
    } else {
      const clientesSemVendas = [];
      for (const cliente of clientes) {
        const totalVendas = await contarVendasRelacionadasCliente(cliente.id, trx);
        if (totalVendas === 0) {
          clientesSemVendas.push(cliente);
        }
      }

      if (clientesSemVendas.length === 0) {
        return { excluidos: 0, vendas_excluidas: 0, ignorados_com_vendas: clientes.length };
      }

      clienteIds = clientesSemVendas.map(cliente => Number(cliente.id)).filter(Boolean);
    }

    await excluirNotificacoesClientes(clienteIds, trx);

    const notas = await trx('entidade_notas')
      .select('id')
      .where('entidade_tipo', 'cliente')
      .whereIn('entidade_id', clienteIds);
    const notaIds = notas.map(nota => Number(nota.id)).filter(Boolean);

    if (notaIds.length > 0) {
      await trx('entidade_notas')
        .whereIn('id', notaIds)
        .delete();
    }

    const excluidos = await Cliente.query(trx)
      .whereIn('id', clienteIds)
      .delete();

    return {
      excluidos,
      vendas_excluidas: vendasExcluidas,
      ignorados_com_vendas: excluirVendasRelacionadas ? 0 : clientes.length - clienteIds.length
    };
  });
}

module.exports = {
  listarClientes,
  listarClientesSelect,
  listarClientesLixeira,
  verificarDocumentoCliente,
  buscarClientePorId,
  criarCliente,
  atualizarCliente,
  excluirCliente,
  restaurarCliente,
  excluirClienteDefinitivo,
  limparClientesBaseAnterior,
  usuarioPodeAcessarCliente,
  atualizarConsultorasCliente,
  previewImportacaoBaseAnterior,
  importarBaseAnterior,
  gerarXlsxClientes
};
