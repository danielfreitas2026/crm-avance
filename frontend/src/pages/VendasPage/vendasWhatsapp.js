import { formatarNomeServico } from '../../utils/servicos';

export const DOCUMENTOS_FALTANTES_WHATSAPP = [
  'RG do representante legal',
  'RG do administrador',
  'RG do responsável pelo recebimento',
  'Documento da empresa',
  'Fatura',
  'Contrato social',
  'Comprovante de endereco'
];

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizarTipoLinha(valor, fallback = 'novo') {
  const texto = normalizarTexto(valor);
  if (texto.includes('porta')) return 'portabilidade';
  if (texto.includes('novo')) return 'novo';
  return fallback;
}

function normalizarItensChips(itens) {
  if (Array.isArray(itens)) return itens;
  if (!itens || typeof itens !== 'string') return [];

  try {
    const itensConvertidos = JSON.parse(itens);
    return Array.isArray(itensConvertidos) ? itensConvertidos : [];
  } catch {
    return itens
      .split(/\r?\n/)
      .map(linha => linha.trim().match(/^(\d+)\s*x\s*([\d.,]+)$/i))
      .filter(Boolean)
      .map(match => ({ quantidade: match[1], valor_unitario: match[2], tipo_linha: 'novo' }));
  }
}

function formatarMoeda(valor) {
  if (valor === null || valor === undefined || valor === '') return '-';
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function parseValor(valor) {
  if (valor === undefined || valor === null || valor === '') return 0;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  return Number(String(valor).replace(/\./g, '').replace(',', '.')) || 0;
}

function formatarCnpj(valor) {
  const digitos = String(valor || '').replace(/\D/g, '').slice(0, 14);
  if (digitos.length <= 2) return digitos;
  if (digitos.length <= 5) return `${digitos.slice(0, 2)}.${digitos.slice(2)}`;
  if (digitos.length <= 8) return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5)}`;
  if (digitos.length <= 12) return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8)}`;
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`;
}

function formatarData(valor) {
  const texto = valor instanceof Date
    ? [valor.getFullYear(), String(valor.getMonth() + 1).padStart(2, '0'), String(valor.getDate()).padStart(2, '0')].join('-')
    : String(valor || '').slice(0, 10);
  const match = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '-';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function resumirTiposLinha(itens) {
  const tipos = normalizarItensChips(itens)
    .map(item => normalizarTipoLinha(item.tipo_linha || item.tipo || item.categoria) === 'portabilidade' ? 'Portabilidade' : 'Novo');
  return Array.from(new Set(tipos)).join(', ');
}

function obterTipoVenda(venda) {
  return venda.tipoVenda?.nome || resumirTiposLinha(venda.valores_unitarios_chips) || venda.produto_fechado || '-';
}

function obterCategoriaProduto(venda) {
  const texto = normalizarTexto([venda.servico?.nome, venda.produto_fechado, venda.tipoVenda?.nome].filter(Boolean).join(' '));
  if (texto.includes('internet') || texto.includes('banda larga') || texto.includes('fibra')) return 'Internet';
  if (texto.includes('fixo') || texto.includes('telefone fixo')) return 'Fixo';
  if (texto.includes('movel') || texto.includes('chip') || texto.includes('celular') || texto.includes('linha')) return 'Móvel';
  return formatarNomeServico(venda.servico?.nome) || venda.produto_fechado || '-';
}

function obterVendedoras(venda) {
  const nomes = Array.isArray(venda.vendedoras) && venda.vendedoras.length > 0
    ? venda.vendedoras.map(item => item?.nome).filter(Boolean)
    : [venda.vendedora?.nome].filter(Boolean);
  return nomes.length > 0 ? nomes.join(', ') : '-';
}

function obterDocumentosFaltantesMensagem(venda) {
  const faltantes = [];
  if (venda.nome_representante_legal && !venda.rg_representante_legal) faltantes.push('RG do representante legal');
  if (venda.nome_administrador && !venda.rg_administrador) faltantes.push('RG do administrador');
  [
    { nome: venda.responsavel_recebimento, rg: venda.rg_responsavel_recebimento },
    { nome: venda.responsavel_recebimento_2, rg: venda.rg_responsavel_recebimento_2 },
    { nome: venda.responsavel_recebimento_3, rg: venda.rg_responsavel_recebimento_3 }
  ].forEach((responsavel, index) => {
    if (responsavel.nome && !responsavel.rg) faltantes.push(`RG do responsável pelo recebimento ${index + 1}`);
  });
  if (venda.cnpj && !venda.razao_social && !venda.cliente?.razao_social) faltantes.push('documento da empresa');
  return faltantes.length > 0 ? faltantes.join(', ') : '[preencher se faltar RG, doc da empresa, fatura...]';
}

export function obterDocumentosFaltantesPadrao(venda = {}) {
  const texto = obterDocumentosFaltantesMensagem(venda);
  if (!texto || texto.startsWith('[')) return [];
  return texto.split(',').map(item => item.trim()).filter(Boolean);
}

function formatarResumoVenda(venda) {
  const itens = normalizarItensChips(venda.valores_unitarios_chips)
    .filter(item => Number(item.quantidade || 0) > 0 || item.valor_unitario || item.gb || item.tipo_linha);
  const tipo = resumirTiposLinha(itens) || obterTipoVenda(venda);
  const quantidade = venda.quantidade_linhas
    || itens.reduce((total, item) => total + Number(item.quantidade || 0), 0)
    || '-';
  if (itens.length === 0) {
    const giga = venda.gb ? ` x ${venda.gb}GB` : '';
    return `${tipo} - ${quantidade} linha(s) - 1 x ${formatarMoeda(venda.valor_total)}${giga}`;
  }
  const detalhes = itens.map(item => {
    const quantidadeItem = Number(item.quantidade || 0) || 1;
    const valor = item.valor_unitario ? formatarMoeda(parseValor(item.valor_unitario)) : formatarMoeda(venda.valor_total);
    const giga = item.gb || venda.gb;
    return `${quantidadeItem} x ${valor}${giga ? ` x ${giga}GB` : ''}`;
  });
  return `${tipo} - ${quantidade} linha(s) - ${detalhes.join(' - ')}`;
}

export function montarChecklistWhatsappVenda(venda = {}, documentosFaltantes = obterDocumentosFaltantesPadrao(venda)) {
  const documentos = documentosFaltantes.length > 0 ? documentosFaltantes.join(', ') : 'NAO';
  return [
    `OPERADORA : ${venda.operadora?.nome || '-'}`,
    `RAZAO SOCIAL : ${venda.cliente?.razao_social || venda.razao_social || '-'}`,
    `CNPJ : ${formatarCnpj(venda.cliente?.cnpj || venda.cnpj || '') || '-'}`,
    `PRODUTO : ${obterCategoriaProduto(venda)}`,
    `VENDA : ${formatarResumoVenda(venda)}`,
    `VENDEDORA(S) : ${obterVendedoras(venda)}`,
    `PROTOCOLO : ${venda.protocolo || '-'}`,
    `DATA DA VENDA : ${formatarData(venda.data_venda)}`,
    `FALTA DOC : ${documentos}`
  ].join('\n');
}
