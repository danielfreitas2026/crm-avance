/**
 * Servico de geracao da planilha Claro a partir dos dados de uma venda.
 */
const path   = require('path');
const fs     = require('fs');
const ExcelJS = require('exceljs');
const { _internals } = require('./venda-email-template.service');

const { parseItensChips, parsePortados } = _internals;
const { FORMATO_MOEDA_BR, numeroPlanilha } = require('../utils/formato-planilha');

const RED    = 'FF0000';
const WHITE  = 'FFFFFF';
const YELLOW = 'FFE699';
const LGRAY  = 'F2F2F2';
const GRAY   = 'BFBFBF';

/**
 * Retorna logo path no formato esperado pelo fluxo.
 */
const LOGO_PATH = (() => {
  const png = path.join(__dirname, '../assets/claro-logo.png');
  const jpg = path.join(__dirname, '../assets/claro-logo.jpg');
  return fs.existsSync(png) ? png : jpg;
})();

/**
 * Converte o valor para texto seguro.
 */
function txt(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

/**
 * Normaliza telefone para exibicao ou envio.
 */
function fone(numero) {
  let v = txt(numero);
  if (v.startsWith('+55')) v = v.slice(3);
  return v.replace(/[()\-\s]/g, '');
}

/**
 * Normaliza CNPJ para exibicao ou envio.
 */
function cnpj(v) {
  return txt(v).replace(/\D/g, '');
}

/**
 * Aplica fill na planilha gerada.
 */
function fill(hex) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex } };
}

/**
 * Aplica border na planilha gerada.
 */
function border() {
  const s = { style: 'thin' };
  return { top: s, bottom: s, left: s, right: s };
}

/**
 * Aplica font na planilha gerada.
 */
function font(opts = {}) {
  return {
    name: 'Calibri',
    size: opts.size || 11,
    bold: !!opts.bold,
    italic: !!opts.italic,
    color: { argb: 'FF' + (opts.color || '000000') },
  };
}

/**
 * Aplica align na planilha gerada.
 */
function align(h = 'left', wrap = false) {
  return { horizontal: h, vertical: 'middle', wrapText: wrap };
}

/**
 * Aplica w na planilha gerada.
 */
function w(ws, row, col, value = '', opts = {}) {
  const cell = ws.getCell(row, col);
  cell.value = value !== '' ? value : null;
  cell.font = font(opts);
  cell.alignment = align(opts.align || 'left', !!opts.wrap);
  cell.border = border();
  if (opts.bg) cell.fill = fill(opts.bg);
  if (opts.numFmt) cell.numFmt = opts.numFmt;
  return cell;
}

/**
 * Aplica merge na planilha gerada.
 */
function merge(ws, r1, c1, r2, c2) {
  ws.mergeCells(r1, c1, r2, c2);
}

/**
 * Retorna campo duplo no formato esperado pelo fluxo.
 */
function campoDuplo(ws, row, lbl1, val1, lbl2, val2, optsVal1 = {}, optsVal2 = {}) {
  ws.getRow(row).height = 16;
  w(ws, row, 1, lbl1, { bold: true, bg: GRAY });
  merge(ws, row, 2, row, 3);
  w(ws, row, 2, val1, optsVal1);
  w(ws, row, 4, lbl2, { bold: true, bg: GRAY });
  merge(ws, row, 5, row, 6);
  w(ws, row, 5, val2, optsVal2);
}

/**
 * Retorna campo simples no formato esperado pelo fluxo.
 */
function campoSimples(ws, row, lbl, val) {
  ws.getRow(row).height = 16;
  w(ws, row, 1, lbl, { bg: GRAY });
  merge(ws, row, 2, row, 6);
  w(ws, row, 2, val);
}

/**
 * Expande precos em linhas ou colunas detalhadas.
 */
function expandirPrecos(valoresUnitariosChips, valorTotal, qtd) {
  const itens = parseItensChips(valoresUnitariosChips);
  if (itens.length > 0) {
    const prices = [];
    for (const item of itens) {
      for (let i = 0; i < item.quantidade; i++) {
        prices.push(item.valorUnitario || null);
      }
    }
    return prices;
  }

  const total = parseFloat(String(valorTotal || '').replace(/R\$\s*/i, '').replace(/\./g, '').replace(',', '.'));
  if (total && qtd) {
    const unit = total / qtd;
    return Array(qtd).fill(unit);
  }
  return Array(qtd).fill(null);
}

/**
 * Retorna gb com sufixo no formato esperado pelo fluxo.
 */
function gbComSufixo(valor) {
  const gb = txt(valor).replace(/\D/g, '');
  return gb ? `${gb}GB` : '';
}

/**
 * Retorna plano claro no formato esperado pelo fluxo.
 */
function planoClaro(gb, produto) {
  const gbTexto = gbComSufixo(gb);
  return gbTexto ? `CLARO PÓS - ${gbTexto}` : `CLARO PÓS - ${txt(produto)}`;
}

/**
 * Expande planos em linhas ou colunas detalhadas.
 */
function expandirPlanos(valoresUnitariosChips, gbPadrao, produto, qtd) {
  const itens = parseItensChips(valoresUnitariosChips, gbPadrao);
  if (itens.length > 0) {
    const planos = [];
    for (const item of itens) {
      const plano = planoClaro(item.gb || gbPadrao, produto);
      for (let i = 0; i < item.quantidade; i++) {
        planos.push(plano);
      }
    }
    return planos;
  }

  return Array(qtd).fill(planoClaro(gbPadrao, produto));
}

/**
 * Expande linhas chips em linhas ou colunas detalhadas.
 */
function expandirLinhasChips(valoresUnitariosChips, gbPadrao, produto, valorTotal, qtd) {
  const itens = parseItensChips(valoresUnitariosChips, gbPadrao);
  if (itens.length > 0) {
    const linhas = [];
    for (const item of itens) {
      for (let i = 0; i < item.quantidade; i++) {
        linhas.push({
          plano: planoClaro(item.gb || gbPadrao, produto),
          preco: item.valorUnitario || null,
          tipoLinha: item.tipoLinha || 'novo'
        });
      }
    }
    return linhas;
  }

  const precos = expandirPrecos(null, valorTotal, qtd);
  return expandirPlanos(null, gbPadrao, produto, qtd).map((plano, index) => ({
    plano,
    preco: precos[index] ?? null,
    tipoLinha: 'novo'
  }));
}

/**
 * Monta endereco a partir dos dados informados.
 */
function montarEndereco(venda) {
  const partes = [
    txt(venda.endereco),
    txt(venda.numero_endereco),
    txt(venda.complemento),
    txt(venda.bairro),
    txt(venda.municipio) + (venda.uf ? `/${txt(venda.uf)}` : ''),
    txt(venda.cep)
  ].filter(Boolean);
  return partes.join(', ');
}

/**
 * Retorna operadora portabilidade no formato esperado pelo fluxo.
 */
function operadoraPortabilidade(venda) {
  return txt(
    venda.cliente?.operadoraAtual?.nome
    || venda.cliente?.operadora_atual_nome
    || venda.operadora_atual_nome
  );
}

/**
 * Gera xlsx claro a partir dos dados informados.
 */
async function gerarXlsxClaro(venda) {
  const portados     = parsePortados(venda.numeros_portados);
  const qtdLinhas    = Number(venda.quantidade_linhas || 0) || portados.length;
  const razaoSocial  = txt(venda.razao_social || venda.cliente?.razao_social || venda.cliente?.nome);
  const cnpjFormatado = cnpj(venda.cnpj || venda.cliente?.cnpj);
  const produto      = txt(venda.produto_fechado);
  const chipRows     = expandirLinhasChips(venda.valores_unitarios_chips, venda.gb, produto, venda.valor_total, qtdLinhas);
  const qtdPortados  = Math.max(portados.length, chipRows.filter(item => item.tipoLinha === 'portabilidade').length);
  const operadoraOrigem = operadoraPortabilidade(venda);
  const ddd          = txt(venda.ddd);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`CHEKLIST PADRÃO - ${razaoSocial}`.slice(0, 31));

  // larguras das colunas
  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 16;
  ws.getColumn(3).width = 16;
  ws.getColumn(4).width = 22;
  ws.getColumn(5).width = 16;
  ws.getColumn(6).width = 20;

  // Linha 1 — espaço topo
  ws.getRow(1).height = 6;

  // Linha 2 — cabeçalho
  ws.getRow(2).height = 26;
  merge(ws, 2, 1, 2, 2);
  if (fs.existsSync(LOGO_PATH)) {
    const ext = LOGO_PATH.endsWith('.png') ? 'png' : 'jpeg';
    const logoId = wb.addImage({ filename: LOGO_PATH, extension: ext });
    ws.addImage(logoId, {
      tl: { col: 0, row: 1.12 },
      ext: { width: 130, height: 26 }
    });
  } else {
    const cellLogo = ws.getCell(2, 1);
    cellLogo.value = 'Claro Brasil';
    cellLogo.font  = font({ bold: true, color: RED, size: 14 });
    cellLogo.alignment = align('left');
  }

  merge(ws, 2, 3, 2, 5);
  const cellTitle = ws.getCell(2, 3);
  cellTitle.value = 'CHECK LIST MÓVEL';
  cellTitle.font  = font({ bold: true, size: 14 });
  cellTitle.alignment = align('center');

  // Linhas 3-4 — espaço
  ws.getRow(3).height = 6;
  ws.getRow(4).height = 6;

  // Linha 5 — Razão social + CNPJ
  campoDuplo(ws, 5, 'RAZÃO SOCIAL :', razaoSocial, 'CNPJ :', cnpjFormatado);

  // Linha 6 — Telefone fixo
  campoSimples(ws, 6, 'TEL. FIXO:', fone(venda.fixo_ddd));

  // Linha 7 — Representante legal + CPF
  campoDuplo(ws, 7,
    'Representante legal:', txt(venda.nome_representante_legal),
    'CPF :', txt(venda.cpf_representante_legal),
    { bold: true, color: RED }, {});

  // Linha 8 — E-mail + Celular
  campoDuplo(ws, 8,
    'E-MAIL (quem assina o contrato)', txt(venda.email_representante_legal || venda.email),
    'CEL. ', fone(venda.telefone),
    { color: RED }, {});

  // Linha 9 — Administrador + CPF
  campoDuplo(ws, 9,
    'ADMINISTRADOR:', txt(venda.nome_administrador),
    'CPF :', txt(venda.cpf_administrador),
    { bold: true, color: RED }, {});

  // Linha 10 — e-mail/cel do administrador
  campoDuplo(ws, 10, 'E-MAIL', txt(venda.email_administrador), 'CEL:', fone(venda.telefone_administrador),
    { color: RED }, {});

  // Linha 11 — Endereço
  campoSimples(ws, 11, 'ENDEREÇO:', montarEndereco(venda));

  // Linha 12 — Resp. recebimento 1
  ws.getRow(12).height = 16;
  w(ws, 12, 1, 'Resp. recebimento 1:', { bg: YELLOW });
  merge(ws, 12, 2, 12, 3);
  w(ws, 12, 2, txt(venda.responsavel_recebimento), { bold: true, color: RED });
  w(ws, 12, 4, 'RG:', { bg: YELLOW });
  merge(ws, 12, 5, 12, 6);
  w(ws, 12, 5, txt(venda.rg_responsavel_recebimento));

  // Linhas 13-14 — Resp. recebimento 2 e 3
  ws.getRow(13).height = 16;
  w(ws, 13, 1, 'Resp. recebimento 2:', { bg: YELLOW });
  merge(ws, 13, 2, 13, 3);
  w(ws, 13, 2, txt(venda.responsavel_recebimento_2));
  w(ws, 13, 4, 'RG:', { bg: YELLOW });
  merge(ws, 13, 5, 13, 6);
  w(ws, 13, 5, txt(venda.rg_responsavel_recebimento_2));

  ws.getRow(14).height = 16;
  w(ws, 14, 1, 'Resp. recebimento 3:', { bg: YELLOW });
  merge(ws, 14, 2, 14, 3);
  w(ws, 14, 2, txt(venda.responsavel_recebimento_3));
  w(ws, 14, 4, 'RG:', { bg: YELLOW });
  merge(ws, 14, 5, 14, 6);
  w(ws, 14, 5, txt(venda.rg_responsavel_recebimento_3));

  // Linha 15 — Vencimento + Cliente NET/EBT
  ws.getRow(15).height = 16;
  w(ws, 15, 1, 'Venc. Fatura:', { bold: true, bg: GRAY });
  merge(ws, 15, 2, 15, 3);
  w(ws, 15, 2, txt(venda.dia_vencimento));
  w(ws, 15, 4, 'Cliente NET/EBT:', { bold: true, bg: GRAY });
  w(ws, 15, 5, '( )Não / SIM (informar n° cliente):');
  w(ws, 15, 6, '');

  // Linha 16 — espaço
  ws.getRow(16).height = 6;

  // Linha 17 — desconto + DDD
  ws.getRow(17).height = 20;
  merge(ws, 17, 1, 17, 3);
  w(ws, 17, 1,
    'Desconto por volume ( )R$5,00  ( )R$10,00   /   Aceita outra cor de aparelho: ( )Sim  ( X )Não',
    { wrap: true });

  const dddsFixos = new Set(['21', '22', '24']);
  let dddTxt;
  if (dddsFixos.has(ddd)) {
    dddTxt = `DDD das linhas novas  (${ddd === '21' ? 'X' : ' '})21  (${ddd === '22' ? 'X' : ' '})22  (${ddd === '24' ? 'X' : ' '})24  /  ( ) Outros Estado (informar DDD):`;
  } else if (ddd) {
    dddTxt = `DDD das linhas novas  ( )21  ( )22  ( )24  /  ( X ) Outros Estado (informar DDD): ${ddd}`;
  } else {
    dddTxt = 'DDD das linhas novas  ( )21  ( )22  ( )24  /  ( ) Outros Estado (informar DDD):';
  }
  merge(ws, 17, 4, 17, 6);
  w(ws, 17, 4, dddTxt, { wrap: true });

  // Linha 18 — espaço
  ws.getRow(18).height = 6;

  // Linha 19 — cabeçalho da tabela (vermelho)
  ws.getRow(19).height = 30;
  const cabecalhos = [
    [1, 1, 'Plano+Bônus'],
    [2, 2, 'Valor do plano'],
    [3, 3, 'Aparelho ou Simcard Avulso'],
    [4, 4, 'Valor unitário/ KIT'],
    [5, 5, 'Operadora (caso seja portabilidade PJ)'],
    [6, 6, 'Portabilidade e/ou TTPF/PJ com DDD\n(Informar número do simcard nos casos de TTPF)'],
  ];
  for (const [c1, c2, label] of cabecalhos) {
    if (c1 !== c2) merge(ws, 19, c1, 19, c2);
    w(ws, 19, c1, label, { bold: true, bg: RED, color: WHITE, align: 'center', wrap: true });
  }

  // Linhas 20+ — dados dos chips
  const dataRows = [];
  let portadoIndex = 0;
  chipRows.forEach((chip, index) => {
    const portabilidade = chip.tipoLinha === 'portabilidade' || index >= chipRows.length - qtdPortados;
    const numeroPortado = portabilidade ? (portados[portadoIndex++] || '') : '';
    const preco = numeroPlanilha(chip.preco);
    dataRows.push([chip.plano, preco, 'Avulso', preco, portabilidade ? operadoraOrigem : '', numeroPortado]);
  });
  while (dataRows.length < 10) {
    dataRows.push(['', null, '', null, '', '']);
  }

  for (let i = 0; i < dataRows.length; i++) {
    const r = 20 + i;
    const [plano, vPlano, aparel, vUnit, oper, porto] = dataRows[i];
    const bgRow = i % 2 === 0 ? LGRAY : WHITE;
    ws.getRow(r).height = 15;

    w(ws, r, 1, plano, { bg: bgRow });
    w(ws, r, 2, vPlano, { bg: bgRow, numFmt: vPlano !== null ? FORMATO_MOEDA_BR : undefined });
    w(ws, r, 3, aparel, { bg: bgRow });
    w(ws, r, 4, vUnit,  { bg: bgRow, numFmt: vUnit  !== null ? FORMATO_MOEDA_BR : undefined });
    w(ws, r, 5, oper,   { bg: bgRow });
    w(ws, r, 6, porto,  { bg: bgRow });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return buffer;
}

module.exports = { gerarXlsxClaro };
