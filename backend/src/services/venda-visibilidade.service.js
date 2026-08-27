/**
 * Politica central de visibilidade de vendas enviadas ao pos-venda.
 */
const FunilEtapa = require('../models/FunilEtapa');
const Usuario = require('../models/Usuario');
const Venda = require('../models/Venda');
const { usuarioTemPermissaoLocal } = require('../utils/permissoes');

function erroAcessoResumo() {
  const error = new Error('Após o envio ao pós-venda, a consultora possui acesso apenas ao resumo da venda.');
  error.statusCode = 403;
  return error;
}

function normalizarItensChips(valor) {
  if (Array.isArray(valor)) return valor;
  if (!valor) return [];
  try {
    const parseado = JSON.parse(valor);
    return Array.isArray(parseado) ? parseado : [];
  } catch {
    return [];
  }
}

function normalizarData(valor) {
  if (!valor) return null;
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return [
      valor.getFullYear(),
      String(valor.getMonth() + 1).padStart(2, '0'),
      String(valor.getDate()).padStart(2, '0')
    ].join('-');
  }
  const match = String(valor).match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || null;
}

function normalizarValorMonetario(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  const texto = String(valor || '').trim();
  if (!texto) return 0;
  const normalizado = texto.includes(',')
    ? texto.replace(/\./g, '').replace(',', '.')
    : texto;
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : 0;
}

function usuarioVinculadoVenda(venda, usuarioId) {
  const id = Number(usuarioId);
  if (!id || !venda) return false;
  return Number(venda.criado_por_id) === id
    || Number(venda.vendedora_id) === id
    || (venda.vendedoras || []).some(item => Number(item?.id || item) === id);
}

function deveResumirVenda(venda, usuario) {
  if (!venda?.enviada_pos_venda_em || !usuario?.id) return false;
  if (usuario.role?.nome === 'admin' || usuarioTemPermissaoLocal(usuario, 'pos_venda')) return false;
  return usuarioVinculadoVenda(venda, usuario.id);
}

async function buscarUsuario(usuarioId, trx = null) {
  if (!usuarioId) return null;
  return Usuario.query(trx).findById(usuarioId).withGraphFetched('role');
}

async function buscarVendaComVinculos(vendaId, trx = null) {
  return Venda.query(trx)
    .findById(vendaId)
    .whereNull('excluido_em')
    .withGraphFetched('vendedoras')
    .modifyGraph('vendedoras', builder => builder.select('usuarios.id', 'usuarios.nome'));
}

async function obterCodigoEtapaFinal(trx = null) {
  try {
    const etapa = await FunilEtapa.query(trx)
      .where('etapa_final', true)
      .orderBy('ativo', 'desc')
      .orderBy('ordem', 'asc')
      .first();
    return etapa?.codigo || 'concluido';
  } catch {
    return 'concluido';
  }
}

function nomeOperadora(item, tipo, operadorasPorId, venda) {
  const atual = tipo === 'atual';
  const nome = atual ? item.operadora_atual_nome : item.operadora_nome;
  const id = Number(atual ? item.operadora_atual_id : item.operadora_id);
  if (nome) return nome;
  if (operadorasPorId.has(id)) return operadorasPorId.get(id);
  if (!atual && Number(venda?.operadora?.id) === id) return venda.operadora.nome || null;
  return null;
}

async function buscarNomesOperadoras(itens, venda, trx = null) {
  const ids = new Set();
  itens.forEach(item => {
    [item.operadora_atual_id, item.operadora_id].forEach(id => {
      const numero = Number(id);
      if (numero) ids.add(numero);
    });
  });
  if (ids.size === 0) return new Map();
  const knex = trx || Venda.knex();
  const rows = await knex('operadoras').whereIn('id', Array.from(ids)).select('id', 'nome');
  return new Map(rows.map(row => [Number(row.id), row.nome]));
}

async function montarResumoVenda(venda, opcoes = {}) {
  const itens = normalizarItensChips(venda?.valores_unitarios_chips);
  const operadorasPorId = opcoes.operadorasPorId || await buscarNomesOperadoras(itens, venda, opcoes.trx);
  const etapaFinal = opcoes.etapaFinal || await obterCodigoEtapaFinal(opcoes.trx);
  const chips = itens.map(item => {
    const quantidade = Number(item.quantidade || 0);
    const valorUnitario = normalizarValorMonetario(item.valor_unitario);
    return {
      quantidade,
      gb: item.gb || null,
      tipo_linha: item.tipo_linha || item.tipo || item.categoria || null,
      operadora_atual: nomeOperadora(item, 'atual', operadorasPorId, venda),
      operadora_destino: nomeOperadora(item, 'destino', operadorasPorId, venda),
      valor_unitario: valorUnitario,
      subtotal: quantidade * valorUnitario
    };
  });
  const totalCalculado = chips.reduce((total, item) => total + item.subtotal, 0);
  const vendedoras = Array.isArray(venda?.vendedoras) ? venda.vendedoras.filter(Boolean) : [];

  return {
    id: venda.id,
    visao_resumida_consultora: true,
    razao_social: venda.razao_social || venda.cliente?.razao_social || null,
    cnpj: venda.cnpj || venda.cliente?.cnpj || null,
    data_venda: normalizarData(venda.data_venda)
      || normalizarData(venda.criado_em)
      || normalizarData(venda.created_at),
    chips,
    valor_total: chips.length > 0 ? totalCalculado : normalizarValorMonetario(venda.valor_total),
    vendedoras: vendedoras.length > 1
      ? vendedoras.map(item => ({ nome: item.nome || 'Não informada' }))
      : [],
    concluida: venda.status_funil === etapaFinal
  };
}

async function aplicarVisibilidadeVenda(venda, usuarioId, opcoes = {}) {
  if (!venda || !usuarioId) return venda;
  const usuario = opcoes.usuario || await buscarUsuario(usuarioId, opcoes.trx);
  return deveResumirVenda(venda, usuario)
    ? montarResumoVenda(venda, opcoes)
    : venda;
}

async function garantirAcessoCompletoVenda(vendaOuId, usuarioId, opcoes = {}) {
  const venda = typeof vendaOuId === 'object'
    ? vendaOuId
    : await buscarVendaComVinculos(vendaOuId, opcoes.trx);
  if (!venda) return null;
  const usuario = opcoes.usuario || await buscarUsuario(usuarioId, opcoes.trx);
  if (deveResumirVenda(venda, usuario)) throw erroAcessoResumo();
  return venda;
}

function sanitizarProblema(problema, usuario) {
  if (!problema) return problema;
  const json = typeof problema.toJSON === 'function' ? problema.toJSON() : { ...problema };
  if (!deveResumirVenda(json.venda, usuario)) return json;
  return {
    ...json,
    venda: {
      id: json.venda?.id || json.venda_id,
      visao_resumida_consultora: true
    }
  };
}

async function sanitizarProblemaParaUsuario(problemaOuLista, usuarioId) {
  const usuario = await buscarUsuario(usuarioId);
  if (Array.isArray(problemaOuLista)) {
    return problemaOuLista.map(problema => sanitizarProblema(problema, usuario));
  }
  return sanitizarProblema(problemaOuLista, usuario);
}

module.exports = {
  aplicarVisibilidadeVenda,
  buscarUsuario,
  deveResumirVenda,
  garantirAcessoCompletoVenda,
  montarResumoVenda,
  sanitizarProblema,
  sanitizarProblemaParaUsuario,
  usuarioVinculadoVenda,
  _internals: {
    normalizarData,
    normalizarItensChips,
    normalizarValorMonetario
  }
};
