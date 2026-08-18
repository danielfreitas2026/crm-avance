/**
 * Resolve prospectivamente a origem de uma venda nova em futuros clientes.
 */
const {
  normalizarCnpjVenda,
  resolverCnpjFuturoCliente
} = require('./lead-cnpj.service');

function normalizarIds(valores = []) {
  return [...new Set(valores.map(Number).filter(id => Number.isInteger(id) && id > 0))];
}

function candidatoElegivel(linha, { cnpj, vendedorasIds, criadoEm }) {
  const ids = new Set(normalizarIds(vendedorasIds));
  if (!linha?.futuro_cliente || linha.futuro_cliente_excluido_em || linha.venda_id) return false;
  if (linha.status_operacional === 'vendido' || linha.status_operacional === 'perdido') return false;
  if (linha.venda_recusada_em || linha.venda_recusada_motivo) return false;
  if (!ids.has(Number(linha.atribuido_para_id))) return false;
  const marcadoEm = new Date(linha.futuro_cliente_marcado_em).getTime();
  const cadastradoEm = new Date(criadoEm).getTime();
  if (!Number.isFinite(marcadoEm) || !Number.isFinite(cadastradoEm) || marcadoEm > cadastradoEm) return false;

  try {
    return resolverCnpjFuturoCliente(linha).cnpj === normalizarCnpjVenda({ cnpj });
  } catch {
    return false;
  }
}

function selecionarCandidatoUnico(linhas, contexto) {
  const candidatas = (linhas || []).filter(linha => candidatoElegivel(linha, contexto));
  return candidatas.length === 1 ? candidatas[0] : null;
}

function montarQueryCandidatos(trx, vendedorasIds, criadoEm) {
  return trx('lead_linhas as ll')
    .leftJoin('lead_sondagens as ls', 'ls.lead_linha_id', 'll.id')
    .where('ll.futuro_cliente', true)
    .whereNull('ll.futuro_cliente_excluido_em')
    .whereNull('ll.venda_id')
    .whereNull('ll.venda_recusada_em')
    .where(builder => builder
      .whereNull('ll.venda_recusada_motivo')
      .orWhere('ll.venda_recusada_motivo', ''))
    .where(builder => builder
      .whereNull('ll.status_operacional')
      .orWhereNotIn('ll.status_operacional', ['vendido', 'perdido']))
    .whereIn('ll.atribuido_para_id', normalizarIds(vendedorasIds))
    .whereNotNull('ll.futuro_cliente_marcado_em')
    .where('ll.futuro_cliente_marcado_em', '<=', criadoEm)
    .select('ll.*', 'ls.cnpj as sondagem_cnpj');
}

async function buscarFuturoClienteParaVenda({ cnpj, vendedorasIds, criadoEm, trx }) {
  const cnpjNormalizado = normalizarCnpjVenda({ cnpj });
  const ids = normalizarIds(vendedorasIds);
  if (!cnpjNormalizado || !ids.length) return null;

  const linhas = await montarQueryCandidatos(trx, ids, criadoEm);
  const candidata = selecionarCandidatoUnico(linhas, { cnpj: cnpjNormalizado, vendedorasIds: ids, criadoEm });
  if (!candidata) return null;

  const bloqueada = await montarQueryCandidatos(trx, ids, criadoEm)
    .where('ll.id', Number(candidata.id))
    .forUpdate()
    .first();
  if (!bloqueada) return null;
  return candidatoElegivel(bloqueada, { cnpj: cnpjNormalizado, vendedorasIds: ids, criadoEm }) ? bloqueada : null;
}

module.exports = {
  buscarFuturoClienteParaVenda,
  _internals: {
    candidatoElegivel,
    montarQueryCandidatos,
    normalizarIds,
    selecionarCandidatoUnico
  }
};
