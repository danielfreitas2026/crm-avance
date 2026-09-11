const Venda = require('../models/Venda');
const VendaArquivo = require('../models/VendaArquivo');

/**
 * Concentra a regra de documentacao efetiva da venda.
 * Documento fisico e qualquer vinculo de arquivo ativo possuem o mesmo peso.
 */
function valorBooleano(valor) {
  return valor === true || valor === 1 || valor === '1';
}

function possuiDocumentacao(venda = {}) {
  return valorBooleano(venda.possui_doc_na_casa) || Number(venda.total_arquivos || 0) > 0;
}

async function contarArquivosAtivos(vendaId) {
  return VendaArquivo.query()
    .where('venda_id', Number(vendaId))
    .whereNull('excluido_em')
    .resultSize();
}

async function obterEstadoDocumentacao(vendaId) {
  const [venda, totalArquivos] = await Promise.all([
    Venda.query().findById(vendaId).select('id', 'possui_doc_na_casa'),
    contarArquivosAtivos(vendaId)
  ]);

  if (!venda) return null;
  return possuiDocumentacao({
    possui_doc_na_casa: venda.possui_doc_na_casa,
    total_arquivos: totalArquivos
  });
}

module.exports = {
  contarArquivosAtivos,
  obterEstadoDocumentacao,
  possuiDocumentacao,
  valorBooleano
};
