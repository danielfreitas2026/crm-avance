const db = require('../database/connection');
const crypto = require('crypto');
const Cliente = require('../models/Cliente');
const Venda = require('../models/Venda');
const VendaAntiga = require('../models/VendaAntiga');
const VendaAntigaBusca = require('../models/VendaAntigaBusca');
const Usuario = require('../models/Usuario');
const { restaurarZerosCnpj, sanitizarCnpj, validarDigitosCpf } = require('./cnpj.service');
const {
  criarHttpError,
  lerArquivoMultipart,
  lerWorkbook,
  primeiraAbaComCabecalho,
  detectarCabecalhos,
  montarAmostras,
  normalizarTexto,
  sugerirColuna,
  textoCelula
} = require('../utils/planilha-xlsx');

const LIMITE_LINHAS = Number(process.env.VENDAS_ANTIGAS_LIMITE_LINHAS || 100000);
const CHUNK = 500;
const LIMITE_DETALHES_INVALIDOS = 200;
const PALAVRAS_CABECALHO_CNPJ = ['cnpj', 'cpf/cnpj', 'documento'];

function sqlSomenteDigitos(coluna) {
  return `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${coluna}, '.', ''), '/', ''), '-', ''), '(', ''), ')', ''), ' ', '')`;
}

/**
 * Descobre que documento a celula contem. CPF entra como documento proprio
 * e CNPJ numerico vindo do Excel pode perder zeros a esquerda.
 */
function classificarDocumento(valor) {
  const crus = String(valor || '').replace(/\D/g, '');

  if (crus.length === 11 && validarDigitosCpf(crus)) {
    return { tipo: 'cpf', digitos: crus };
  }

  const cnpj = restaurarZerosCnpj(crus);
  if (cnpj) {
    return { tipo: 'cnpj', digitos: cnpj };
  }

  return { tipo: 'sem_documento', digitos: '' };
}

/**
 * Normaliza a razao social para uso como chave de deduplicacao. Nao remove
 * sufixos societarios (LTDA/ME/EIRELI): empresas distintas poderiam se fundir.
 * Trunca em 180 porque `chave_dedup` e um indice unico de 191 em utf8mb4.
 */
function normalizarRazaoSocial(valor) {
  return normalizarTexto(valor).replace(/\s+/g, ' ').trim().slice(0, 180);
}

function linhaImportavel(classificacao, razaoSocial) {
  if (classificacao.tipo === 'cnpj' || classificacao.tipo === 'cpf') return true;
  const razao = normalizarRazaoSocial(razaoSocial);
  return Boolean(razao);
}

/**
 * Chave estavel por linha de planilha. CNPJ repetido representa venda repetida,
 * entao o documento nao pode mais ser a chave de consolidacao.
 */
function montarChaveLinha(arquivoNome, abaNome, rowIndex, classificacao, razaoSocial, dataVenda) {
  const base = [
    String(arquivoNome || '').trim().toLowerCase(),
    String(abaNome || '').trim().toLowerCase(),
    rowIndex,
    classificacao.tipo,
    classificacao.digitos || '',
    normalizarRazaoSocial(razaoSocial),
    dataVenda || ''
  ].join('|');
  return `linha:${crypto.createHash('sha1').update(base).digest('hex')}`;
}

function formatarCnpj(valor) {
  const d = sanitizarCnpj(valor);
  if (d.length !== 14) return String(valor || '').trim();
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function formatarCpf(digitos) {
  if (digitos.length !== 11) return digitos;
  return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`;
}

/**
 * Documento legivel de um registro ja gravado, seja CNPJ ou CPF.
 */
function formatarDocumento(registro) {
  if (registro.documento_tipo === 'cpf') return formatarCpf(registro.documento_digitos || '');
  if (registro.cnpj) return registro.cnpj;
  if (registro.cnpj_digitos) return formatarCnpj(registro.cnpj_digitos);
  return null;
}

/**
 * Tenta converter um texto de celula em data (YYYY-MM-DD). Retorna null se nao reconhecer.
 */
function parseDataVenda(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return null;

  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const br = texto.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (br) {
    const dia = br[1].padStart(2, '0');
    const mes = br[2].padStart(2, '0');
    let ano = br[3];
    if (ano.length === 2) ano = Number(ano) > 50 ? `19${ano}` : `20${ano}`;
    return `${ano}-${mes}-${dia}`;
  }

  return null;
}

function adicionarMesesDataISO(valor, meses) {
  const dataBase = parseDataVenda(valor);
  if (!dataBase) return null;

  const [ano, mes, dia] = dataBase.split('-').map(Number);
  const mesBaseZero = mes - 1;
  const mesAlvoZero = mesBaseZero + Number(meses || 0);
  const anoAlvo = ano + Math.floor(mesAlvoZero / 12);
  const mesFinalZero = ((mesAlvoZero % 12) + 12) % 12;
  const ultimoDiaMesAlvo = new Date(Date.UTC(anoAlvo, mesFinalZero + 1, 0)).getUTCDate();
  const diaFinal = Math.min(dia, ultimoDiaMesAlvo);

  return new Date(Date.UTC(anoAlvo, mesFinalZero, diaFinal)).toISOString().slice(0, 10);
}

function quantidadeChipsVendaSistema(venda) {
  if (typeof venda.valores_unitarios_chips === 'string' && venda.valores_unitarios_chips.trim()) {
    try {
      const itens = JSON.parse(venda.valores_unitarios_chips);
      if (Array.isArray(itens)) {
        const total = itens.reduce((soma, item) => soma + Number(item?.quantidade || 0), 0);
        if (total > 0) return total;
      }
    } catch {
      // Mantem fallback para quantidade_linhas.
    }
  }

  const quantidadeLinhas = Number(venda.quantidade_linhas || 0);
  return quantidadeLinhas > 0 ? quantidadeLinhas : null;
}

function parseQuantidadeChips(valor) {
  const texto = String(valor ?? '').trim();
  if (!texto) return null;

  const normalizado = texto.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  if (!normalizado) return null;

  const numero = Number(normalizado);
  if (!Number.isFinite(numero) || numero < 0) return null;

  return Math.floor(numero);
}

function normalizarNomeAba(valor) {
  return String(valor || '').trim().toLowerCase();
}

function parseAbasSelecionadas(valor) {
  if (!valor) return null;

  try {
    const abas = JSON.parse(valor);
    if (!Array.isArray(abas)) {
      throw new Error('Formato invalido');
    }

    return abas
      .map(aba => String(aba || '').trim())
      .filter(Boolean);
  } catch {
    throw criarHttpError(400, 'Selecao de abas invalida.');
  }
}

function filtrarWorksheets(workbook, nomesSelecionados = null) {
  if (!nomesSelecionados) return workbook.worksheets;

  const selecionadas = new Set(nomesSelecionados.map(normalizarNomeAba).filter(Boolean));
  const worksheets = workbook.worksheets.filter(worksheet => selecionadas.has(normalizarNomeAba(worksheet.name)));

  if (selecionadas.size === 0 || worksheets.length === 0) {
    throw criarHttpError(400, 'Selecione ao menos uma aba valida para importar.');
  }

  return worksheets;
}

function detectarCabecalhoCnpj(worksheet) {
  return detectarCabecalhos(worksheet, { palavrasChave: PALAVRAS_CABECALHO_CNPJ });
}

function prepararAba(worksheet) {
  const cabecalho = detectarCabecalhoCnpj(worksheet);
  return {
    worksheet,
    colunas: cabecalho.colunas,
    linhaCabecalho: cabecalho.linhaCabecalho,
    linhas: Math.max(worksheet.rowCount - cabecalho.linhaCabecalho, 0)
  };
}

function tokensBusca(valor) {
  return normalizarTexto(valor)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function colunaCorrespondeBusca(coluna, busca) {
  const termo = normalizarTexto(busca);
  if (!termo) return false;

  const nome = normalizarTexto(coluna?.nome);
  if (!nome) return false;
  if (nome === termo || nome.includes(termo)) return true;

  const tokens = tokensBusca(busca);
  return tokens.length > 0 && tokens.every(token => nome.includes(token));
}

function resolverColuna(colunas, busca) {
  if (!busca) return null;
  return colunas.find(coluna => colunaCorrespondeBusca(coluna, busca)) || null;
}

/**
 * Preview da planilha: cabecalhos, amostras e colunas sugeridas para o mapeamento.
 * Considera TODAS as abas (cada aba costuma representar um mes com as mesmas colunas):
 * usa a primeira aba com cabecalho como referencia e soma as linhas de todas as abas.
 */
async function previewPlanilha(req) {
  const { arquivo } = await lerArquivoMultipart(req);
  const workbook = await lerWorkbook(arquivo.buffer);
  const { worksheet, colunas, linhaCabecalho } = primeiraAbaComCabecalho(workbook, { palavrasChave: PALAVRAS_CABECALHO_CNPJ });

  const abas = workbook.worksheets.map(aba => {
    try {
      const preparada = prepararAba(aba);
      return {
        nome: aba.name,
        linhas: preparada.linhas,
        linha_cabecalho: preparada.linhaCabecalho,
        colunas: preparada.colunas
      };
    } catch {
      return {
        nome: aba.name,
        linhas: 0,
        linha_cabecalho: null,
        colunas: []
      };
    }
  });
  const totalLinhas = abas.reduce((soma, aba) => soma + aba.linhas, 0);

  return {
    arquivo: arquivo.filename,
    aba: worksheet.name,
    linha_cabecalho: linhaCabecalho,
    abas,
    total_abas: abas.length,
    total_linhas: totalLinhas,
    limite_linhas: LIMITE_LINHAS,
    colunas,
    sugestoes: {
      cnpj: sugerirColuna(colunas, ['cnpj', 'cpf/cnpj', 'documento']),
      razao_social: sugerirColuna(colunas, ['razao', 'razao social', 'empresa']),
      data_venda: sugerirColuna(colunas, ['data da venda', 'data venda', 'data']),
      operadora: sugerirColuna(colunas, ['operadora', 'operadoras']),
      responsavel_nome: sugerirColuna(colunas, ['responsavel', 'nome responsavel', 'nome do responsavel', 'contato']),
      telefone: sugerirColuna(colunas, ['terminal', 'telefone', 'fone', 'celular', 'whatsapp', 'contato telefone']),
      quantidade_chips: sugerirColuna(colunas, ['quantidade de chips', 'qtd chips', 'chips', 'quantidade', 'qtd', 'ctns'])
    },
    amostras: montarAmostras(worksheet, colunas, 5, linhaCabecalho)
  };
}

/**
 * Importa a planilha para a base de vendas antigas fazendo upsert por linha.
 * campos.mapeamento = { cnpj, razao_social, data_venda, operadora, responsavel_nome, telefone, quantidade_chips } -> nomes de coluna.
 */
async function importarPlanilha(req, usuarioId) {
  const { arquivo, campos } = await lerArquivoMultipart(req);

  let mapeamento = {};
  try {
    mapeamento = campos.mapeamento ? JSON.parse(campos.mapeamento) : {};
  } catch {
    throw criarHttpError(400, 'Mapeamento de colunas invalido.');
  }

  if (!mapeamento.cnpj) {
    throw criarHttpError(400, 'Selecione a coluna que contem o CNPJ.');
  }

  const workbook = await lerWorkbook(arquivo.buffer);
  const worksheets = filtrarWorksheets(workbook, parseAbasSelecionadas(campos.abas));
  const abasPreparadas = worksheets
    .map(worksheet => {
      try {
        return prepararAba(worksheet);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (abasPreparadas.length === 0) {
    throw criarHttpError(400, 'Nenhuma aba selecionada possui cabecalho de CNPJ valido.');
  }

  // As abas selecionadas compartilham as mesmas colunas (cada aba = um mes).
  const totalLinhas = abasPreparadas.reduce((soma, aba) => soma + aba.linhas, 0);
  if (totalLinhas > LIMITE_LINHAS) {
    throw criarHttpError(400, `A planilha excede o limite de ${LIMITE_LINHAS} linhas.`);
  }

  const lote = `${(arquivo.filename || 'planilha').replace(/\.xlsx$/i, '')}-${new Date().toISOString().slice(0, 19)}`;

  const registrosPorChave = new Map();
  const invalidosDetalhes = [];
  let invalidos = 0;
  let duplicados = 0;
  let semCnpj = 0;

  for (const { worksheet, colunas, linhaCabecalho } of abasPreparadas) {
    const colunasResolvidas = {
      cnpj: resolverColuna(colunas, mapeamento.cnpj),
      razao_social: resolverColuna(colunas, mapeamento.razao_social),
      data_venda: resolverColuna(colunas, mapeamento.data_venda),
      operadora: resolverColuna(colunas, mapeamento.operadora),
      responsavel_nome: resolverColuna(colunas, mapeamento.responsavel_nome),
      telefone: resolverColuna(colunas, mapeamento.telefone),
      quantidade_chips: resolverColuna(colunas, mapeamento.quantidade_chips)
    };

    if (!colunasResolvidas.cnpj) {
      throw criarHttpError(400, `Nao foi encontrada coluna de CNPJ na aba "${worksheet.name}" usando o texto "${mapeamento.cnpj}".`);
    }

    const mapeados = new Set(Object.values(colunasResolvidas).filter(Boolean).map(coluna => coluna.nome));
    const valorColuna = (row, coluna) => {
      if (!coluna) return '';
      return textoCelula(row.getCell(coluna.index).value);
    };
    const valorColunaOuFixo = (row, coluna, valorFixo) => {
      const valor = valorColuna(row, coluna);
      if (valor) return valor;
      return coluna ? '' : String(valorFixo || '').trim();
    };

    for (let rowIndex = linhaCabecalho + 1; rowIndex <= worksheet.rowCount; rowIndex += 1) {
      const row = worksheet.getRow(rowIndex);
      const valorDocumento = valorColuna(row, colunasResolvidas.cnpj);
      const razaoSocial = valorColuna(row, colunasResolvidas.razao_social) || null;

      const classificacao = classificarDocumento(valorDocumento);
      const dataVenda = parseDataVenda(valorColuna(row, colunasResolvidas.data_venda));
      const chave = linhaImportavel(classificacao, razaoSocial)
        ? montarChaveLinha(arquivo.filename, worksheet.name, rowIndex, classificacao, razaoSocial, dataVenda)
        : null;

      if (!chave) {
        invalidos += 1;
        if (invalidosDetalhes.length < LIMITE_DETALHES_INVALIDOS) {
          invalidosDetalhes.push({
            aba: worksheet.name,
            linha: rowIndex,
            valor: valorDocumento,
            motivo: colunasResolvidas.razao_social
              ? 'Sem CNPJ/CPF e sem razao social'
              : 'Sem CNPJ/CPF e coluna de razao social nao mapeada'
          });
        }
        continue;
      }

      if (classificacao.tipo !== 'cnpj') {
        semCnpj += 1;
      }

      const extras = { Aba: worksheet.name };
      colunas.forEach(coluna => {
        if (mapeados.has(coluna.nome)) return;
        const texto = textoCelula(row.getCell(coluna.index).value);
        if (texto) extras[coluna.nome] = texto;
      });

      const ehCnpj = classificacao.tipo === 'cnpj';
      registrosPorChave.set(chave, {
        chave_dedup: chave,
        cnpj: ehCnpj ? formatarCnpj(classificacao.digitos) : null,
        cnpj_digitos: ehCnpj ? classificacao.digitos : null,
        documento_digitos: classificacao.digitos || null,
        documento_tipo: classificacao.tipo,
        razao_social: razaoSocial,
        data_venda: dataVenda,
        operadora: valorColunaOuFixo(row, colunasResolvidas.operadora, mapeamento.operadora) || null,
        responsavel_nome: valorColuna(row, colunasResolvidas.responsavel_nome) || null,
        telefone: valorColuna(row, colunasResolvidas.telefone) || null,
        quantidade_chips: parseQuantidadeChips(valorColuna(row, colunasResolvidas.quantidade_chips)),
        dados_extras: JSON.stringify(extras),
        lote,
        importado_por_id: usuarioId || null,
        importado_em: db.fn.now(),
        updated_at: db.fn.now()
      });
    }
  }

  const registros = Array.from(registrosPorChave.values());
  const unicos = registros.length;
  const ignorados = invalidos + duplicados;

  if (unicos === 0) {
    return {
      total: totalLinhas,
      unicos,
      inseridos: 0,
      atualizados: 0,
      ignorados,
      invalidos,
      invalidos_detalhes: invalidosDetalhes,
      duplicados,
      sem_cnpj: semCnpj,
      lote
    };
  }

  // Descobre quantos ja existem para separar inseridos de atualizados.
  const chavesLista = registros.map(r => r.chave_dedup);
  const jaExistentes = new Set();
  for (let i = 0; i < chavesLista.length; i += CHUNK) {
    const fatia = chavesLista.slice(i, i + CHUNK);
    const linhas = await db('vendas_antigas').whereIn('chave_dedup', fatia).select('chave_dedup');
    linhas.forEach(l => jaExistentes.add(l.chave_dedup));
  }

  await db.transaction(async trx => {
    for (let i = 0; i < registros.length; i += CHUNK) {
      const fatia = registros.slice(i, i + CHUNK);
      await trx('vendas_antigas')
        .insert(fatia)
        .onConflict('chave_dedup')
        .merge(['cnpj', 'cnpj_digitos', 'documento_digitos', 'documento_tipo', 'razao_social', 'data_venda', 'operadora', 'responsavel_nome', 'telefone', 'quantidade_chips', 'dados_extras', 'lote', 'importado_por_id', 'importado_em', 'updated_at']);
    }
  });

  const atualizados = jaExistentes.size;
  return {
    total: totalLinhas,
    unicos,
    inseridos: unicos - atualizados,
    atualizados,
    ignorados,
    invalidos,
    invalidos_detalhes: invalidosDetalhes,
    duplicados,
    sem_cnpj: semCnpj,
    lote
  };
}

function montarMapeamentoAutomaticoClientesAntigos(colunas) {
  return {
    cnpj: sugerirColuna(colunas, ['cnpj', 'cpf/cnpj', 'documento']),
    razao_social: sugerirColuna(colunas, ['razao', 'razao social', 'empresa', 'nome']),
    data_venda: sugerirColuna(colunas, ['data da venda', 'data venda', 'data']),
    operadora: sugerirColuna(colunas, ['operadora', 'operadoras']),
    responsavel_nome: sugerirColuna(colunas, ['responsavel', 'nome responsavel', 'nome do responsavel', 'contato']),
    telefone: sugerirColuna(colunas, ['terminal', 'telefone', 'fone', 'celular', 'whatsapp', 'contato telefone']),
    quantidade_chips: sugerirColuna(colunas, ['quantidade de chips', 'qtd chips', 'chips', 'quantidade', 'qtd', 'ctns'])
  };
}

async function importarColecaoPlanilhas(planilhas, opcoes = {}) {
  const usuarioId = opcoes.usuarioId;
  const arquivoNome = opcoes.arquivoNome || 'mailing';
  const planilhasValidas = (planilhas || []).filter(planilha => Array.isArray(planilha?.colunas) && Array.isArray(planilha?.linhas));

  if (!planilhasValidas.length) {
    throw criarHttpError(400, 'Nenhuma planilha valida para importar na base antiga.');
  }

  const totalLinhas = planilhasValidas.reduce((soma, planilha) => soma + planilha.linhas.length, 0);
  if (totalLinhas > LIMITE_LINHAS) {
    throw criarHttpError(400, `A planilha excede o limite de ${LIMITE_LINHAS} linhas.`);
  }

  const primeiraComColunas = planilhasValidas.find(planilha => planilha.colunas.length > 0);
  const mapeamento = {
    ...montarMapeamentoAutomaticoClientesAntigos(primeiraComColunas?.colunas || []),
    ...(opcoes.mapeamento || {})
  };

  if (!mapeamento.cnpj) {
    throw criarHttpError(400, 'Nao foi possivel identificar a coluna de CNPJ para importar na base antiga.');
  }

  const lote = `${String(arquivoNome || 'mailing').replace(/\.(xlsx|csv)$/i, '')}-${new Date().toISOString().slice(0, 19)}`;
  const registrosPorChave = new Map();
  const invalidosDetalhes = [];
  let invalidos = 0;
  let duplicados = 0;
  let semCnpj = 0;

  for (const planilha of planilhasValidas) {
    const colunas = planilha.colunas;
    const colunasResolvidas = {
      cnpj: resolverColuna(colunas, mapeamento.cnpj),
      razao_social: resolverColuna(colunas, mapeamento.razao_social),
      data_venda: resolverColuna(colunas, mapeamento.data_venda),
      operadora: resolverColuna(colunas, mapeamento.operadora),
      responsavel_nome: resolverColuna(colunas, mapeamento.responsavel_nome),
      telefone: resolverColuna(colunas, mapeamento.telefone),
      quantidade_chips: resolverColuna(colunas, mapeamento.quantidade_chips)
    };

    if (!colunasResolvidas.cnpj) {
      throw criarHttpError(400, `Nao foi encontrada coluna de CNPJ em "${planilha.nome}" usando o texto "${mapeamento.cnpj}".`);
    }

    const mapeados = new Set(Object.values(colunasResolvidas).filter(Boolean).map(coluna => coluna.nome));
    const valorColuna = (linha, coluna) => {
      if (!coluna) return '';
      return textoCelula(linha?.[coluna.nome]);
    };
    const valorColunaOuFixo = (linha, coluna, valorFixo) => {
      const valor = valorColuna(linha, coluna);
      if (valor) return valor;
      return coluna ? '' : String(valorFixo || '').trim();
    };

    for (let index = 0; index < planilha.linhas.length; index += 1) {
      const linha = planilha.linhas[index] || {};
      const rowIndex = Number(linha.__rowIndex || index + 2);
      const valorDocumento = valorColuna(linha, colunasResolvidas.cnpj);
      const razaoSocial = valorColuna(linha, colunasResolvidas.razao_social) || null;
      const classificacao = classificarDocumento(valorDocumento);
      const dataVenda = parseDataVenda(valorColuna(linha, colunasResolvidas.data_venda));
      const chave = linhaImportavel(classificacao, razaoSocial)
        ? montarChaveLinha(arquivoNome, planilha.nome, rowIndex, classificacao, razaoSocial, dataVenda)
        : null;

      if (!chave) {
        invalidos += 1;
        if (invalidosDetalhes.length < LIMITE_DETALHES_INVALIDOS) {
          invalidosDetalhes.push({
            aba: planilha.nome,
            linha: rowIndex,
            valor: valorDocumento,
            motivo: colunasResolvidas.razao_social
              ? 'Sem CNPJ/CPF e sem razao social'
              : 'Sem CNPJ/CPF e coluna de razao social nao mapeada'
          });
        }
        continue;
      }

      if (classificacao.tipo !== 'cnpj') semCnpj += 1;

      const extras = { Aba: planilha.nome };
      colunas.forEach(coluna => {
        if (mapeados.has(coluna.nome)) return;
        const texto = textoCelula(linha[coluna.nome]);
        if (texto) extras[coluna.nome] = texto;
      });

      const ehCnpj = classificacao.tipo === 'cnpj';
      registrosPorChave.set(chave, {
        chave_dedup: chave,
        cnpj: ehCnpj ? formatarCnpj(classificacao.digitos) : null,
        cnpj_digitos: ehCnpj ? classificacao.digitos : null,
        documento_digitos: classificacao.digitos || null,
        documento_tipo: classificacao.tipo,
        razao_social: razaoSocial,
        data_venda: dataVenda,
        operadora: valorColunaOuFixo(linha, colunasResolvidas.operadora, mapeamento.operadora) || null,
        responsavel_nome: valorColuna(linha, colunasResolvidas.responsavel_nome) || null,
        telefone: valorColuna(linha, colunasResolvidas.telefone) || null,
        quantidade_chips: parseQuantidadeChips(valorColuna(linha, colunasResolvidas.quantidade_chips)),
        dados_extras: JSON.stringify(extras),
        lote,
        importado_por_id: usuarioId || null,
        importado_em: db.fn.now(),
        updated_at: db.fn.now()
      });
    }
  }

  const registros = Array.from(registrosPorChave.values());
  const unicos = registros.length;
  const ignorados = invalidos + duplicados;

  if (unicos === 0) {
    return { total: totalLinhas, unicos, inseridos: 0, atualizados: 0, ignorados, invalidos, invalidos_detalhes: invalidosDetalhes, duplicados, sem_cnpj: semCnpj, lote };
  }

  const chavesLista = registros.map(r => r.chave_dedup);
  const jaExistentes = new Set();
  for (let i = 0; i < chavesLista.length; i += CHUNK) {
    const fatia = chavesLista.slice(i, i + CHUNK);
    const linhas = await db('vendas_antigas').whereIn('chave_dedup', fatia).select('chave_dedup');
    linhas.forEach(l => jaExistentes.add(l.chave_dedup));
  }

  await db.transaction(async trx => {
    for (let i = 0; i < registros.length; i += CHUNK) {
      const fatia = registros.slice(i, i + CHUNK);
      await trx('vendas_antigas')
        .insert(fatia)
        .onConflict('chave_dedup')
        .merge(['cnpj', 'cnpj_digitos', 'documento_digitos', 'documento_tipo', 'razao_social', 'data_venda', 'operadora', 'responsavel_nome', 'telefone', 'quantidade_chips', 'dados_extras', 'lote', 'importado_por_id', 'importado_em', 'updated_at']);
    }
  });

  const atualizados = jaExistentes.size;
  return { total: totalLinhas, unicos, inseridos: unicos - atualizados, atualizados, ignorados, invalidos, invalidos_detalhes: invalidosDetalhes, duplicados, sem_cnpj: semCnpj, lote };
}
/**
 * Projecao enxuta de uma venda antiga para a tela de busca.
 */
function projetarVenda(registro) {
  return {
    id: registro.id,
    cnpj: formatarDocumento(registro),
    documento_tipo: registro.documento_tipo || 'cnpj',
    razao_social: registro.razao_social || null,
    data_venda: registro.data_venda || null,
    operadora: registro.operadora || null,
    responsavel_nome: registro.responsavel_nome || null,
    telefone: registro.telefone || null,
    fidelidade_fim: adicionarMesesDataISO(registro.data_venda, 24),
    quantidade_chips: registro.quantidade_chips ?? null
  };
}

function normalizarTextoCampo(valor, limite = 255) {
  const texto = String(valor ?? '').trim();
  return texto ? texto.slice(0, limite) : null;
}

function normalizarDataCampo(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const data = parseDataVenda(valor);
  if (!data) {
    throw criarHttpError(400, 'Data da venda invalida.');
  }
  return data;
}

function montarDocumentoAtualizado(valor) {
  const texto = String(valor ?? '').trim();
  if (!texto) {
    return {
      cnpj: null,
      cnpj_digitos: null,
      documento_digitos: null,
      documento_tipo: 'sem_documento'
    };
  }

  const classificacao = classificarDocumento(texto);
  if (classificacao.tipo === 'sem_documento') {
    throw criarHttpError(400, 'Documento invalido. Informe um CPF, CNPJ ou deixe em branco.');
  }

  const ehCnpj = classificacao.tipo === 'cnpj';
  return {
    cnpj: ehCnpj ? formatarCnpj(classificacao.digitos) : null,
    cnpj_digitos: ehCnpj ? classificacao.digitos : null,
    documento_digitos: classificacao.digitos,
    documento_tipo: classificacao.tipo
  };
}

async function atualizar(id, dados = {}, { registrarAuditoria } = {}) {
  const venda = await VendaAntiga.query().findById(id);
  if (!venda) {
    throw criarHttpError(404, 'Venda antiga nao encontrada.');
  }

  const patch = {
    razao_social: normalizarTextoCampo(dados.razao_social),
    data_venda: normalizarDataCampo(dados.data_venda),
    operadora: normalizarTextoCampo(dados.operadora),
    responsavel_nome: normalizarTextoCampo(dados.responsavel_nome),
    telefone: normalizarTextoCampo(dados.telefone, 80),
    quantidade_chips: parseQuantidadeChips(dados.quantidade_chips),
    updated_at: db.fn.now()
  };

  Object.assign(patch, montarDocumentoAtualizado(dados.cnpj));

  if (!patch.documento_digitos && !patch.razao_social) {
    throw criarHttpError(400, 'Informe ao menos um documento valido ou a razao social.');
  }

  return VendaAntiga.transaction(async trx => {
    const anterior = await VendaAntiga.query(trx).findById(id).forUpdate();
    if (!anterior) throw criarHttpError(404, 'Venda antiga nao encontrada.');
    const atualizado = await VendaAntiga.query(trx).patchAndFetchById(id, patch);
    if (registrarAuditoria) await registrarAuditoria({ ...anterior }, { ...atualizado }, trx);
    return projetarVenda(atualizado);
  });
}

async function excluir(id) {
  const total = await VendaAntiga.query().deleteById(id);
  if (!total) {
    throw criarHttpError(404, 'Venda antiga nao encontrada.');
  }

  return { id: Number(id), excluido: true };
}
function formatarDocumentoCliente(registro) {
  const digitos = String(registro.cnpj_digitos || '').replace(/\D/g, '');
  if (digitos.length === 11) return formatarCpf(digitos);
  if (digitos.length === 14) return formatarCnpj(digitos);
  return registro.cnpj || null;
}

function formatarTelefoneClienteSistema(cliente = {}) {
  const whatsapp = [cliente.whatsapp_ddd, cliente.whatsapp_numero]
    .map(parte => String(parte || '').trim())
    .filter(Boolean)
    .join('');
  const fixo = [cliente.fixo_ddd, cliente.fixo_numero]
    .map(parte => String(parte || '').trim())
    .filter(Boolean)
    .join('');

  return whatsapp || fixo || null;
}

function projetarVendaClienteSistema(venda) {
  const dataVenda = venda.data_venda || null;
  const cliente = venda.cliente || {};
  return {
    id: venda.id,
    cliente_id: venda.cliente_id || null,
    nome: venda.nome || cliente.nome || null,
    razao_social: venda.razao_social || cliente.razao_social || null,
    cnpj: venda.cnpj || formatarDocumentoCliente(cliente),
    data_venda: dataVenda,
    operadora: venda.operadora?.nome || null,
    responsavel_nome: venda.nome_representante_legal || cliente.responsavel_nome || null,
    telefone: venda.telefone || formatarTelefoneClienteSistema(cliente),
    fidelidade_fim: adicionarMesesDataISO(dataVenda, 24),
    quantidade_chips: quantidadeChipsVendaSistema(venda)
  };
}

async function buscarClienteIdsNormais({ termo }) {
  const query = Cliente.query()
    .select('id')
    .whereNull('excluido_em');
  const like = `%${termo}%`;
  const digitos = String(termo || '').replace(/\D/g, '');

  query.where(builder => {
    builder
      .where('nome', 'like', like)
      .orWhere('razao_social', 'like', like)
      .orWhere('cnpj', 'like', like)
      .orWhere('responsavel_nome', 'like', like)
      .orWhere('email', 'like', like);

    if (digitos) {
      builder
        .orWhere('cnpj_digitos', 'like', `%${digitos}%`)
        .orWhereRaw(`${sqlSomenteDigitos('cnpj')} like ?`, [`%${digitos}%`])
        .orWhereRaw("CONCAT(COALESCE(whatsapp_ddd, ''), COALESCE(whatsapp_numero, '')) like ?", [`%${digitos}%`])
        .orWhereRaw("CONCAT(COALESCE(fixo_ddd, ''), COALESCE(fixo_numero, '')) like ?", [`%${digitos}%`]);
    }
  });

  return (await query).map(cliente => Number(cliente.id)).filter(Boolean);
}
async function buscarVendasClientesNormais({ termo, page, perPage }) {
  const clienteIds = await buscarClienteIdsNormais({ termo });
  const like = `%${termo}%`;
  const digitos = String(termo || '').replace(/\D/g, '');

  const pagina = await Venda.query()
    .select('id', 'cliente_id', 'nome', 'razao_social', 'cnpj', 'data_venda', 'operadora_id', 'nome_representante_legal', 'telefone', 'quantidade_linhas', 'valores_unitarios_chips')
    .whereNull('vendas.excluido_em')
    .whereNotNull('vendas.cliente_id')
    .whereExists(
      Venda.knex()
        .select(1)
        .from('clientes as cliente_busca')
        .whereRaw('cliente_busca.id = vendas.cliente_id')
        .whereNull('cliente_busca.excluido_em')
    )
    .where(builder => {
      if (clienteIds.length > 0) builder.whereIn('cliente_id', clienteIds);

      builder
        .orWhere('nome', 'like', like)
        .orWhere('razao_social', 'like', like)
        .orWhere('cnpj', 'like', like)
        .orWhere('nome_representante_legal', 'like', like)
        .orWhere('telefone', 'like', like)
        .orWhereExists(
          Venda.knex()
            .select(1)
            .from('operadoras as op_busca')
            .whereRaw('op_busca.id = vendas.operadora_id')
            .where('op_busca.nome', 'like', like)
        );

      if (digitos) {
        builder
          .orWhereRaw(`${sqlSomenteDigitos('vendas.cnpj')} like ?`, [`%${digitos}%`])
          .orWhereRaw(`${sqlSomenteDigitos('vendas.telefone')} like ?`, [`%${digitos}%`])
          .orWhereRaw(`${sqlSomenteDigitos('vendas.fixo_ddd')} like ?`, [`%${digitos}%`])
          .orWhereRaw(`${sqlSomenteDigitos('vendas.telefone_representante_legal')} like ?`, [`%${digitos}%`])
          .orWhereRaw(`${sqlSomenteDigitos('vendas.telefone_administrador')} like ?`, [`%${digitos}%`]);
      }
    })
    .withGraphFetched('[cliente, operadora]')
    .modifyGraph('cliente', builder => {
      builder.select('id', 'nome', 'razao_social', 'cnpj', 'cnpj_digitos', 'responsavel_nome', 'whatsapp_ddd', 'whatsapp_numero', 'fixo_ddd', 'fixo_numero');
    })
    .modifyGraph('operadora', builder => {
      builder.select('id', 'nome');
    })
    .orderBy('data_venda', 'desc')
    .orderBy('id', 'desc')
    .page(page - 1, perPage);

  return {
    data: pagina.results.map(projetarVendaClienteSistema),
    total: pagina.total
  };
}

async function resolverNomeUsuario(usuario) {
  if (!usuario?.id) return null;
  const dono = await Usuario.query().findById(usuario.id).select('nome');
  return dono?.nome || usuario.email || null;
}

function aplicarBuscaVendasAntigas(query, { termo, digitos }) {
  const like = `%${termo}%`;
  query.where(builder => {
    builder
      .where('razao_social', 'like', like)
      .orWhere('nome_fantasia', 'like', like)
      .orWhere('cnpj', 'like', like)
      .orWhere('operadora', 'like', like)
      .orWhere('responsavel_nome', 'like', like)
      .orWhere('telefone', 'like', like)
      .orWhere('lote', 'like', like);

    if (digitos) {
      builder
        .orWhere('cnpj_digitos', 'like', `%${digitos}%`)
        .orWhere('documento_digitos', 'like', `%${digitos}%`)
        .orWhereRaw(`${sqlSomenteDigitos('cnpj')} like ?`, [`%${digitos}%`])
        .orWhereRaw(`${sqlSomenteDigitos('telefone')} like ?`, [`%${digitos}%`]);
    }
  });
}
/**
 * Busca por documento (CNPJ/CPF, match exato) ou por razao social (LIKE parcial,
 * paginado). Registra o historico da consulta nos dois casos.
 */
async function buscar(termoBruto, usuario, filtros = {}) {
  const termo = String(termoBruto || '').trim();
  const digitosCrus = termo.replace(/\D/g, '');
  const somenteDocumento = termo.replace(/[0-9.\-/\s]/g, '') === '';

  const page = Math.max(Number(filtros.page) || 1, 1);
  const perPage = Math.min(Math.max(Number(filtros.per_page) || 20, 1), 100);

  // Documento so quando o texto nao tem letras: "12 de maio" nao e um CNPJ.
  const classificacao = somenteDocumento ? classificarDocumento(termo) : { tipo: 'sem_documento', digitos: '' };
  const porDocumento = classificacao.tipo !== 'sem_documento';

  if (!porDocumento) {
    if (termo.length < 3) {
      throw criarHttpError(400, 'Informe ao menos 3 caracteres para buscar por CNPJ, CPF, telefone, razao social ou outros dados.');
    }
  }

  let venda = null;
  let resultados = [];
  let total = 0;
  const vendasClientesBusca = await buscarVendasClientesNormais({ termo, page, perPage });

  const pagina = VendaAntiga.query();
  aplicarBuscaVendasAntigas(pagina, { termo, digitos: digitosCrus });
  pagina
    .orderBy('data_venda', 'desc')
    .orderBy('razao_social', 'asc')
    .orderBy('id', 'desc');

  const resultadoPagina = await pagina.page(page - 1, perPage);
  resultados = resultadoPagina.results.map(projetarVenda);
  total = resultadoPagina.total;
  venda = resultados[0] || null;
  const encontrado = resultados.length > 0 || vendasClientesBusca.data.length > 0;

  await VendaAntigaBusca.query().insert({
    usuario_id: usuario?.id || null,
    usuario_nome: await resolverNomeUsuario(usuario),
    termo,
    tipo_busca: porDocumento ? classificacao.tipo : 'nome',
    cnpj_digitos: classificacao.tipo === 'cnpj' ? classificacao.digitos : null,
    cnpj_formatado: classificacao.tipo === 'cnpj' ? formatarCnpj(classificacao.digitos) : null,
    encontrou: encontrado,
    buscado_em: db.fn.now()
  });

  return {
    tipo: porDocumento ? 'documento' : 'nome',
    encontrado,
    venda,
    resultados,
    total,
    vendas_clientes: vendasClientesBusca.data,
    total_vendas_clientes: vendasClientesBusca.total,
    page,
    per_page: perPage
  };
}

/**
 * Lista paginada do historico de buscas (mais recentes primeiro).
 */
async function listarHistorico(filtros = {}) {
  const page = Math.max(Number(filtros.page) || 1, 1);
  const perPage = Math.min(Math.max(Number(filtros.per_page) || 20, 1), 100);

  const query = VendaAntigaBusca.query()
    .select(
      'vendas_antigas_buscas.*'
    )
    .orderBy('buscado_em', 'desc');

  const busca = String(filtros.busca || '').trim();
  if (busca) {
    const digitos = busca.replace(/\D/g, '');
    query.where(builder => {
      builder.where('usuario_nome', 'like', `%${busca}%`)
        .orWhere('termo', 'like', `%${busca}%`);
      if (digitos) builder.orWhere('cnpj_digitos', 'like', `%${digitos}%`);
    });
  }

  const resultado = await query.page(page - 1, perPage);

  return {
    data: resultado.results,
    total: resultado.total,
    page,
    per_page: perPage
  };
}

module.exports = {
  previewPlanilha,
  importarPlanilha,
  importarColecaoPlanilhas,
  buscar,
  atualizar,
  excluir,
  listarHistorico,
  _internals: {
    classificarDocumento,
    montarChaveLinha,
    parseQuantidadeChips,
    adicionarMesesDataISO,
    formatarTelefoneClienteSistema
  }
};
