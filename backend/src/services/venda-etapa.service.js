const Venda = require('../models/Venda');
const VendaArquivo = require('../models/VendaArquivo');
const Usuario = require('../models/Usuario');

const arquivoService = require('./arquivo.service');
const vendaArquivoService = require('./venda-arquivo.service');

const { formatarDateTimeSQL } = arquivoService;
const { garantirAcessoVenda } = vendaArquivoService;

/**
 * Resultados possiveis da verificacao com o 0800.
 * A etapa e concluida ao registrar qualquer um deles.
 */
const RESULTADOS_0800 = [
  { valor: 'nao_e_base', rotulo: 'Não é base' },
  { valor: 'base_claro', rotulo: 'Base da Claro' },
  { valor: 'base_vivo', rotulo: 'Base da Vivo' }
];

/**
 * Definicao das etapas de conferencia de uma venda.
 * A ordem do array e a ordem exibida no fluxo.
 */
const ETAPAS = [
  {
    chave: '0800',
    ordem: 1,
    titulo: 'Verificar com o 0800',
    coluna: 'etapa_0800_concluida',
    coluna_resultado: 'etapa_0800_resultado',
    opcoes: RESULTADOS_0800,
    categoria: null,
    requer_arquivo: false
  },
  {
    chave: 'abr',
    ordem: 2,
    titulo: 'Confirmar no ABR Telecom',
    coluna: 'etapa_abr_concluida',
    categoria: 'etapa_abr',
    requer_arquivo: true
  },
  {
    chave: 'vivo',
    ordem: 3,
    titulo: 'Confirmação com a VIVO',
    coluna: 'etapa_vivo_concluida',
    categoria: 'etapa_vivo',
    requer_arquivo: true
  }
];

const CATEGORIAS_ETAPA = ETAPAS.map(etapa => etapa.categoria).filter(Boolean);

/**
 * Busca a definicao de uma etapa pela categoria de arquivo vinculada.
 */
function etapaPorCategoria(categoria) {
  return ETAPAS.find(etapa => etapa.categoria === categoria) || null;
}

/**
 * Indica se a etapa da VIVO se aplica a venda (venda destinada a operadora Vivo).
 */
function etapaVivoAplicavel(venda) {
  return /vivo/i.test(venda?.operadora?.nome || '');
}

/**
 * Indica se a etapa se aplica a venda informada.
 */
function etapaAplicavel(etapa, venda) {
  return etapa.chave === 'vivo' ? etapaVivoAplicavel(venda) : true;
}

/**
 * Lista as etapas de conferencia aplicaveis a venda que ainda nao foram concluidas.
 * A venda precisa vir com o graph `operadora` carregado.
 */
function etapasPendentes(venda) {
  return ETAPAS
    .filter(etapa => etapaAplicavel(etapa, venda) && !venda[etapa.coluna])
    .map(etapa => ({ chave: etapa.chave, titulo: etapa.titulo }));
}

/**
 * Aplica a conclusao (ou o retorno para pendente) de uma etapa na venda.
 * Etapas com `coluna_resultado` tambem registram o resultado escolhido.
 */
async function aplicarConclusao(vendaId, etapa, concluida, usuarioId, resultado = null) {
  const agora = formatarDateTimeSQL();

  const patch = {
    [etapa.coluna]: Boolean(concluida),
    [`${etapa.coluna}_em`]: concluida ? agora : null,
    [`${etapa.coluna}_por_id`]: concluida ? Number(usuarioId) : null,
    updated_at: agora
  };

  if (etapa.coluna_resultado) {
    patch[etapa.coluna_resultado] = concluida ? resultado : null;
  }

  await Venda.query().patch(patch).findById(vendaId);
}

/**
 * Recalcula a conclusao de uma etapa a partir dos comprovantes anexados.
 * Usada apos upload e apos exclusao de um comprovante de etapa.
 */
async function sincronizarEtapaPorArquivos(vendaId, categoria, usuarioId) {
  const etapa = etapaPorCategoria(categoria);
  if (!etapa) return null;

  const total = await VendaArquivo.query()
    .where('venda_id', vendaId)
    .where('categoria', categoria)
    .whereNull('excluido_em')
    .resultSize();

  const venda = await Venda.query().findById(vendaId);
  if (!venda) return null;

  const concluida = total > 0;

  // Conclusoes feitas pela automacao do Gmail nao possuem usuario autor e
  // continuam validas mesmo sem comprovante anexado.
  const conclusaoAutomatica = Boolean(venda[etapa.coluna])
    && !venda[`${etapa.coluna}_por_id`];

  if (!concluida && conclusaoAutomatica) {
    return { chave: etapa.chave, concluida: true };
  }

  if (Boolean(venda[etapa.coluna]) === concluida) {
    return { chave: etapa.chave, concluida };
  }

  await aplicarConclusao(vendaId, etapa, concluida, usuarioId);

  return { chave: etapa.chave, concluida };
}

/**
 * Registra o resultado da etapa 1 (verificacao com o 0800).
 * Qualquer resultado valido conclui a etapa; `null` volta a etapa para pendente.
 */
async function definirEtapa0800(vendaId, resultado, usuarioId) {
  await garantirAcessoVenda(vendaId, usuarioId);

  const valor = resultado || null;

  if (valor && !RESULTADOS_0800.some(opcao => opcao.valor === valor)) {
    const error = new Error('Resultado invalido para a etapa do 0800.');
    error.statusCode = 400;
    throw error;
  }

  const etapa = ETAPAS.find(item => item.chave === '0800');
  await aplicarConclusao(vendaId, etapa, Boolean(valor), usuarioId, valor);

  return obterEtapas(vendaId, usuarioId, { validarAcesso: false });
}

/**
 * Retorna as etapas de conferencia de uma venda ja normalizadas para a interface.
 */
async function obterEtapas(vendaId, usuarioId, opcoes = {}) {
  if (opcoes.validarAcesso !== false) {
    await garantirAcessoVenda(vendaId, usuarioId);
  }

  const venda = await Venda.query()
    .findById(vendaId)
    .whereNull('excluido_em')
    .withGraphFetched('operadora');

  if (!venda) {
    const error = new Error('Venda nao encontrada.');
    error.statusCode = 404;
    throw error;
  }

  const autoresIds = ETAPAS
    .map(etapa => venda[`etapa_${etapa.chave}_concluida_por_id`])
    .filter(Boolean);

  const autores = autoresIds.length > 0
    ? await Usuario.query().findByIds([...new Set(autoresIds)]).select('id', 'nome', 'email')
    : [];

  return ETAPAS.map(etapa => {
    const autorId = venda[`etapa_${etapa.chave}_concluida_por_id`];

    return {
      chave: etapa.chave,
      ordem: etapa.ordem,
      titulo: etapa.titulo,
      categoria: etapa.categoria,
      requer_arquivo: etapa.requer_arquivo,
      aplicavel: etapaAplicavel(etapa, venda),
      opcoes: etapa.opcoes || null,
      resultado: etapa.coluna_resultado ? (venda[etapa.coluna_resultado] || null) : null,
      concluida: Boolean(venda[etapa.coluna]),
      concluida_em: venda[`etapa_${etapa.chave}_concluida_em`] || null,
      concluida_por: autores.find(autor => Number(autor.id) === Number(autorId)) || null
    };
  });
}

module.exports = {
  ETAPAS,
  RESULTADOS_0800,
  CATEGORIAS_ETAPA,
  etapaPorCategoria,
  etapasPendentes,
  sincronizarEtapaPorArquivos,
  definirEtapa0800,
  obterEtapas
};
