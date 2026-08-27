const archiver = require('archiver');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const Arquivo = require('../models/Arquivo');
const Venda = require('../models/Venda');
const VendaArquivo = require('../models/VendaArquivo');
const VendaArquivoPacote = require('../models/VendaArquivoPacote');
const Usuario = require('../models/Usuario');
/**
 * Servico de anexos e pacotes de arquivos de vendas.
 */
const arquivoService = require('./arquivo.service');
const vendaVisibilidadeService = require('./venda-visibilidade.service');
const { usuarioTemPermissaoLocal } = require('../utils/permissoes');

const {
  STORAGE_DIR,
  formatarDateTimeSQL,
  garantirDiretorio,
  caminhoAbsoluto,
  normalizarNomeArquivo,
  receberUpload,
  materializarArquivo
} = arquivoService;

const MAX_FILE_MB = Number(process.env.VENDA_ARQUIVOS_MAX_FILE_MB || 50);
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
const MAX_FILES_PER_VENDA = Number(process.env.VENDA_ARQUIVOS_MAX_FILES_PER_VENDA || 30);
const RETENCAO_DIAS = Number(process.env.VENDA_ARQUIVOS_RETENCAO_INDIVIDUAIS_DIAS || 30);
const ALLOWED_TYPES = String(
  process.env.VENDA_ARQUIVOS_ALLOWED_TYPES || 'application/pdf,image/jpeg,image/png,image/webp'
).split(',').map(item => item.trim()).filter(Boolean);

const CATEGORIAS_DOCUMENTO = ['contrato', 'documento', 'comprovante', 'outro'];
const CATEGORIAS_ETAPA = ['etapa_abr', 'etapa_vivo'];
const ALLOWED_TYPES_ETAPA = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Indica se a categoria informada e um comprovante de etapa de conferencia.
 * Comprovantes de etapa ficam fora do ZIP e fora da retencao de 30 dias.
 */
function ehCategoriaEtapa(categoria) {
  return CATEGORIAS_ETAPA.includes(String(categoria || ''));
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
    podeVerCompartilhadas: usuarioTemPermissaoLocal(usuario, 'ver_vendas_compartilhadas')
  };
}

/**
 * Verifica se usuario tem permissao atende a condicao esperada.
 */
async function usuarioTemPermissao(usuarioId, permissao) {
  const usuario = await Usuario.query()
    .findById(usuarioId)
    .withGraphFetched('role');

  if (!usuario || !usuario.ativo) {
    return false;
  }

  return usuarioTemPermissaoLocal(usuario, permissao);
}

/**
 * Verifica se usuario pode acessar venda atende a condicao esperada.
 */
async function usuarioPodeAcessarVenda(vendaId, usuarioId) {
  const escopo = await buscarEscopoVendas(usuarioId);

  if (escopo.podeVerTodas) return true;
  if (!escopo.podeVerProprias && !escopo.podeVerCompartilhadas) return false;

  const venda = await Venda.query()
    .findById(vendaId)
    .select('id', 'criado_por_id', 'vendedora_id')
    .whereNull('excluido_em');

  if (escopo.podeVerProprias && (
    Number(venda?.criado_por_id) === Number(usuarioId)
    || Number(venda?.vendedora_id) === Number(usuarioId)
  )) {
    return true;
  }

  if (!escopo.podeVerCompartilhadas) return false;

  const vinculo = await Venda.knex()('venda_vendedoras')
    .where('venda_id', vendaId)
    .where('usuario_id', usuarioId)
    .first();

  return Boolean(vinculo);
}

/**
 * Garante acesso venda antes de continuar o fluxo.
 */
async function garantirAcessoVenda(vendaId, usuarioId) {
  const permitido = await usuarioPodeAcessarVenda(vendaId, usuarioId);

  if (!permitido) {
    const error = new Error('Venda nao encontrada.');
    error.statusCode = 404;
    throw error;
  }

  await vendaVisibilidadeService.garantirAcessoCompletoVenda(vendaId, usuarioId);
}

/**
 * Adiciona dias ao conjunto atual.
 */
function adicionarDias(data, dias) {
  const nova = new Date(data);
  nova.setDate(nova.getDate() + dias);
  return nova;
}

/**
 * Formata arquivo venda para exibicao ou envio.
 */
function formatarArquivoVenda(row) {
  return {
    id: row.id,
    venda_id: row.venda_id,
    arquivo_id: row.arquivo_id,
    nome_original: row.nome_original,
    categoria: row.categoria,
    descricao: row.descricao,
    ordem: row.ordem,
    remover_apos: row.remover_apos,
    excluido_em: row.excluido_em,
    created_at: row.created_at,
    arquivo: row.arquivo ? {
      id: row.arquivo.id,
      mime_type: row.arquivo.mime_type,
      extensao: row.arquivo.extensao,
      tamanho_bytes: Number(row.arquivo.tamanho_bytes || 0),
      hash_sha256: row.arquivo.hash_sha256,
      removido_em: row.arquivo.removido_em
    } : null,
    criado_por: row.criadoPor ? {
      id: row.criadoPor.id,
      nome: row.criadoPor.nome,
      email: row.criadoPor.email
    } : null
  };
}

/**
 * Formata pacote para exibicao ou envio.
 */
function formatarPacote(pacote) {
  if (!pacote) return null;

  return {
    id: pacote.id,
    venda_id: pacote.venda_id,
    status: pacote.status,
    hash_sha256: pacote.hash_sha256,
    tamanho_bytes: pacote.tamanho_bytes ? Number(pacote.tamanho_bytes) : null,
    total_arquivos: pacote.total_arquivos,
    erro: pacote.erro,
    gerado_por_id: pacote.gerado_por_id,
    gerado_em: pacote.gerado_em,
    created_at: pacote.created_at,
    updated_at: pacote.updated_at
  };
}

/**
 * Lista arquivos conforme os filtros e parametros informados.
 */
async function listarArquivos(vendaId, usuarioId) {
  await garantirAcessoVenda(vendaId, usuarioId);

  const podeVisualizarDocumentos = await usuarioTemPermissao(usuarioId, 'vendas_documentos');

  if (!podeVisualizarDocumentos) {
    return {
      arquivos: [],
      etapas_arquivos: [],
      pacote: null,
      documentos_ocultos: true
    };
  }

  const arquivos = await VendaArquivo.query()
    .where('venda_id', vendaId)
    .whereNull('excluido_em')
    .withGraphFetched('[arquivo, criadoPor]')
    .modifyGraph('criadoPor', builder => builder.select('id', 'nome', 'email'))
    .orderBy('ordem', 'asc')
    .orderBy('id', 'asc');

  const pacote = await obterPacote(vendaId, usuarioId, { validarAcesso: false });
  const formatados = arquivos.map(formatarArquivoVenda);

  return {
    arquivos: formatados.filter(item => !ehCategoriaEtapa(item.categoria)),
    etapas_arquivos: formatados.filter(item => ehCategoriaEtapa(item.categoria)),
    pacote
  };
}

/**
 * Processa receber arquivo upload conforme as regras do dominio.
 */
async function receberArquivoUpload(req, vendaId, usuarioId) {
  await garantirAcessoVenda(vendaId, usuarioId);

  const totalAtivos = await VendaArquivo.query()
    .where('venda_id', vendaId)
    .whereNotIn('categoria', CATEGORIAS_ETAPA)
    .whereNull('excluido_em')
    .resultSize();

  if (totalAtivos >= MAX_FILES_PER_VENDA) {
    const error = new Error(`Limite de ${MAX_FILES_PER_VENDA} arquivos por venda atingido.`);
    error.statusCode = 400;
    throw error;
  }

  let upload;
  try {
    upload = await receberUpload(req, {
      allowedTypes: ALLOWED_TYPES,
      maxFileBytes: MAX_FILE_BYTES
    });
  } catch (error) {
    if (/excede o tamanho/i.test(error.message || '')) {
      throw new Error(`Arquivo maior que ${MAX_FILE_MB} MB.`);
    }
    throw error;
  }

  const categoria = String(upload.campos?.categoria || '');
  const etapa = ehCategoriaEtapa(categoria);

  if (etapa && !ALLOWED_TYPES_ETAPA.includes(upload.mimeType)) {
    await fs.promises.unlink(upload.tempPath).catch(() => {});
    const error = new Error('A etapa aceita apenas imagens (JPG, PNG ou WEBP).');
    error.statusCode = 400;
    throw error;
  }

  const arquivoVenda = await salvarArquivoVenda(vendaId, usuarioId, upload);

  if (etapa) {
    const vendaEtapaService = require('./venda-etapa.service');
    await vendaEtapaService.sincronizarEtapaPorArquivos(vendaId, categoria, usuarioId);
  } else {
    await marcarPacoteDesatualizado(vendaId);
  }

  return arquivoVenda;
}

/**
 * Salva arquivo venda com os dados informados.
 */
async function salvarArquivoVenda(vendaId, usuarioId, upload) {
  const arquivo = await materializarArquivo(upload, usuarioId);

  const maiorOrdem = await VendaArquivo.query()
    .where('venda_id', vendaId)
    .max('ordem as ordem')
    .first();

  const vinculo = await VendaArquivo.query().insertAndFetch({
    venda_id: Number(vendaId),
    arquivo_id: arquivo.id,
    nome_original: upload.nomeOriginal,
    categoria: [...CATEGORIAS_DOCUMENTO, ...CATEGORIAS_ETAPA].includes(upload.campos.categoria)
      ? upload.campos.categoria
      : 'outro',
    descricao: upload.campos.descricao ? String(upload.campos.descricao).slice(0, 500) : null,
    ordem: Number(maiorOrdem?.ordem || 0) + 1,
    criado_por_id: usuarioId
  });

  const completo = await VendaArquivo.query()
    .findById(vinculo.id)
    .withGraphFetched('[arquivo, criadoPor]')
    .modifyGraph('criadoPor', builder => builder.select('id', 'nome', 'email'));

  return formatarArquivoVenda(completo);
}

/**
 * Busca vinculo arquivo conforme os parametros informados.
 */
async function buscarVinculoArquivo(vendaId, arquivoVendaId, usuarioId) {
  await garantirAcessoVenda(vendaId, usuarioId);

  const vinculo = await VendaArquivo.query()
    .findById(arquivoVendaId)
    .where('venda_id', vendaId)
    .whereNull('excluido_em')
    .withGraphFetched('arquivo');

  if (!vinculo?.arquivo) {
    const error = new Error('Arquivo nao encontrado.');
    error.statusCode = 404;
    throw error;
  }

  return vinculo;
}

/**
 * Prepara o download de arquivo.
 */
async function prepararDownloadArquivo(vendaId, arquivoVendaId, usuarioId) {
  const vinculo = await buscarVinculoArquivo(vendaId, arquivoVendaId, usuarioId);
  const absPath = caminhoAbsoluto(vinculo.arquivo.storage_path);

  if (vinculo.arquivo.removido_em) {
    const error = new Error('Arquivo individual já foi arquivado no pacote.');
    error.statusCode = 410;
    throw error;
  }

  await fs.promises.access(absPath, fs.constants.R_OK);

  return {
    stream: fs.createReadStream(absPath),
    nome: vinculo.nome_original,
    mimeType: vinculo.arquivo.mime_type,
    tamanhoBytes: Number(vinculo.arquivo.tamanho_bytes || 0)
  };
}

/**
 * Exclui arquivo venda conforme a regra de negocio.
 */
async function excluirArquivoVenda(vendaId, arquivoVendaId, usuarioId) {
  const vinculo = await buscarVinculoArquivo(vendaId, arquivoVendaId, usuarioId);

  const total = await VendaArquivo.query()
    .patch({
      excluido_em: formatarDateTimeSQL(),
      updated_at: formatarDateTimeSQL()
    })
    .where('id', arquivoVendaId)
    .where('venda_id', vendaId)
    .whereNull('excluido_em');

  if (total > 0) {
    if (ehCategoriaEtapa(vinculo.categoria)) {
      const vendaEtapaService = require('./venda-etapa.service');
      await vendaEtapaService.sincronizarEtapaPorArquivos(vendaId, vinculo.categoria, usuarioId);
    } else {
      await marcarPacoteDesatualizado(vendaId);
    }
  }

  return total;
}

/**
 * Obtem pacote a partir dos dados informados.
 */
async function obterPacote(vendaId, usuarioId, opcoes = {}) {
  if (opcoes.validarAcesso !== false) {
    await garantirAcessoVenda(vendaId, usuarioId);
  }

  const pacote = await VendaArquivoPacote.query()
    .where('venda_id', vendaId)
    .orderBy('id', 'desc')
    .first();

  return formatarPacote(pacote);
}

/**
 * Executa a acao de solicitar pacote venda mantendo o estado da tela consistente.
 */
async function solicitarPacoteVenda(vendaId, usuarioId, opcoes = {}) {
  if (opcoes.validarAcesso !== false) {
    await garantirAcessoVenda(vendaId, usuarioId);
  }

  const existente = await VendaArquivoPacote.query()
    .where('venda_id', vendaId)
    .whereIn('status', ['pendente', 'gerando', 'pronto'])
    .orderBy('id', 'desc')
    .first();

  if (existente?.status === 'pronto' && !opcoes.forcar) {
    return formatarPacote(existente);
  }

  const pacote = existente && existente.status !== 'gerando'
    ? await VendaArquivoPacote.query().patchAndFetchById(existente.id, {
      status: 'pendente',
      erro: null,
      updated_at: formatarDateTimeSQL()
    })
    : await VendaArquivoPacote.query().insertAndFetch({
      venda_id: Number(vendaId),
      status: 'pendente',
      storage_driver: 'local',
      gerado_por_id: usuarioId
    });

  setImmediate(() => {
    gerarPacoteVenda(vendaId, usuarioId, pacote.id).catch(error => {
      console.error('Erro ao gerar pacote de arquivos da venda:', error);
    });
  });

  return formatarPacote(pacote);
}

/**
 * Gera pacote venda a partir dos dados informados.
 */
async function gerarPacoteVenda(vendaId, usuarioId, pacoteId = null) {
  const pacote = pacoteId
    ? await VendaArquivoPacote.query().findById(pacoteId)
    : await VendaArquivoPacote.query().where('venda_id', vendaId).orderBy('id', 'desc').first();

  if (!pacote) {
    return null;
  }

  await VendaArquivoPacote.query().patchAndFetchById(pacote.id, {
    status: 'gerando',
    erro: null,
    updated_at: formatarDateTimeSQL()
  });

  try {
    const arquivos = await VendaArquivo.query()
      .where('venda_id', vendaId)
      .whereNotIn('categoria', CATEGORIAS_ETAPA)
      .whereNull('excluido_em')
      .withGraphFetched('arquivo')
      .orderBy('ordem', 'asc')
      .orderBy('id', 'asc');

    if (arquivos.length === 0) {
      throw new Error('Venda sem arquivos ativos para compactar.');
    }

    const relPath = path.join('pacotes', 'vendas', String(vendaId), `venda-${vendaId}-documentos.zip`);
    const absPath = caminhoAbsoluto(relPath);
    await garantirDiretorio(path.dirname(absPath));

    await criarZipVenda(absPath, arquivos);

    const { hashSha256, tamanhoBytes } = await hashArquivo(absPath);
    const pronto = await VendaArquivoPacote.query().patchAndFetchById(pacote.id, {
      status: 'pronto',
      hash_sha256: hashSha256,
      tamanho_bytes: tamanhoBytes,
      storage_driver: 'local',
      storage_path: relPath,
      total_arquivos: arquivos.length,
      erro: null,
      gerado_por_id: usuarioId,
      gerado_em: formatarDateTimeSQL(),
      updated_at: formatarDateTimeSQL()
    });

    await VendaArquivo.query()
      .patch({
        arquivado_no_pacote_id: pronto.id,
        remover_apos: formatarDateTimeSQL(adicionarDias(new Date(), RETENCAO_DIAS)),
        updated_at: formatarDateTimeSQL()
      })
      .where('venda_id', vendaId)
      .whereNotIn('categoria', CATEGORIAS_ETAPA)
      .whereNull('excluido_em');

    return formatarPacote(pronto);
  } catch (error) {
    const atualizado = await VendaArquivoPacote.query().patchAndFetchById(pacote.id, {
      status: 'erro',
      erro: error.message || 'Erro ao gerar pacote.',
      updated_at: formatarDateTimeSQL()
    });

    return formatarPacote(atualizado);
  }
}

/**
 * Retorna nome unico zip no formato esperado pelo fluxo.
 */
function nomeUnicoZip(nome, usados) {
  const limpo = normalizarNomeArquivo(nome);
  const ext = path.extname(limpo);
  const base = ext ? limpo.slice(0, -ext.length) : limpo;
  let candidato = limpo;
  let indice = 2;

  while (usados.has(candidato.toLowerCase())) {
    candidato = `${base} (${indice})${ext}`;
    indice += 1;
  }

  usados.add(candidato.toLowerCase());
  return candidato;
}

/**
 * Cria zip venda com os dados informados.
 */
async function criarZipVenda(destino, arquivos) {
  await fs.promises.unlink(destino).catch(() => {});

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destino);
    const zip = archiver('zip', { zlib: { level: 9 } });
    const usados = new Set();

    output.on('close', resolve);
    output.on('error', reject);
    zip.on('error', reject);

    zip.pipe(output);

    arquivos.forEach(vinculo => {
      const arquivoPath = caminhoAbsoluto(vinculo.arquivo.storage_path);
      zip.file(arquivoPath, {
        name: nomeUnicoZip(vinculo.nome_original, usados)
      });
    });

    zip.finalize();
  });
}

/**
 * Processa hash arquivo conforme as regras do dominio.
 */
async function hashArquivo(absPath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    let tamanhoBytes = 0;
    const stream = fs.createReadStream(absPath);

    stream.on('data', chunk => {
      tamanhoBytes += chunk.length;
      hash.update(chunk);
    });
    stream.on('error', reject);
    stream.on('end', () => resolve({
      hashSha256: hash.digest('hex'),
      tamanhoBytes
    }));
  });
}

/**
 * Prepara o download de pacote.
 */
async function prepararDownloadPacote(vendaId, usuarioId) {
  await garantirAcessoVenda(vendaId, usuarioId);

  const pacote = await VendaArquivoPacote.query()
    .where('venda_id', vendaId)
    .where('status', 'pronto')
    .orderBy('id', 'desc')
    .first();

  if (!pacote?.storage_path) {
    const error = new Error('Pacote ainda não está pronto.');
    error.statusCode = 404;
    throw error;
  }

  const absPath = caminhoAbsoluto(pacote.storage_path);
  await fs.promises.access(absPath, fs.constants.R_OK);

  return {
    stream: fs.createReadStream(absPath),
    nome: `venda-${vendaId}-documentos.zip`,
    mimeType: 'application/zip',
    tamanhoBytes: Number(pacote.tamanho_bytes || 0)
  };
}

/**
 * Marca pacote desatualizado conforme a acao solicitada.
 */
async function marcarPacoteDesatualizado(vendaId) {
  await VendaArquivoPacote.query()
    .patch({
      status: 'desatualizado',
      updated_at: formatarDateTimeSQL()
    })
    .where('venda_id', vendaId)
    .where('status', 'pronto');
}

/**
 * Limpa arquivos individuais vencidos e restaura o estado inicial.
 */
async function limparArquivosIndividuaisVencidos() {
  const vencidos = await VendaArquivo.query()
    .whereNotNull('remover_apos')
    .where('remover_apos', '<=', formatarDateTimeSQL())
    .withGraphFetched('arquivo')
    .limit(100);

  let removidos = 0;

  for (const vinculo of vencidos) {
    const usosAtivos = await VendaArquivo.query()
      .where('arquivo_id', vinculo.arquivo_id)
      .whereNull('excluido_em')
      .where(builder => builder.whereNull('remover_apos').orWhere('remover_apos', '>', formatarDateTimeSQL()))
      .resultSize();

    if (usosAtivos > 0) continue;

    await fs.promises.unlink(caminhoAbsoluto(vinculo.arquivo.storage_path)).catch(() => {});
    await Arquivo.query().patchAndFetchById(vinculo.arquivo_id, {
      removido_em: formatarDateTimeSQL(),
      updated_at: formatarDateTimeSQL()
    });
    removidos += 1;
  }

  return removidos;
}

module.exports = {
  CATEGORIAS_DOCUMENTO,
  CATEGORIAS_ETAPA,
  ehCategoriaEtapa,
  garantirAcessoVenda,
  listarArquivos,
  receberArquivoUpload,
  prepararDownloadArquivo,
  excluirArquivoVenda,
  obterPacote,
  solicitarPacoteVenda,
  gerarPacoteVenda,
  prepararDownloadPacote,
  marcarPacoteDesatualizado,
  limparArquivosIndividuaisVencidos
};
