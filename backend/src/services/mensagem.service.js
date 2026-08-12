/**
 * Servico de mensagens internas, conversas, anexos e contadores de leitura.
 */
const Mensagem = require('../models/Mensagem');
const MensagemArquivo = require('../models/MensagemArquivo');
const Arquivo = require('../models/Arquivo');
const Usuario = require('../models/Usuario');
const db = require('../database/connection');
const arquivoService = require('./arquivo.service');
const { usuarioTemPermissaoLocal } = require('../utils/permissoes');

const ANEXO_TIPOS_PERMITIDOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const ANEXO_TAMANHO_MAX_MB = Number(process.env.CHAT_ANEXO_MAX_MB || 50);
const ANEXO_TAMANHO_MAX_BYTES = ANEXO_TAMANHO_MAX_MB * 1024 * 1024;

/**
 * Cria um erro HTTP com status e mensagem padronizados.
 */
function erroHttp(mensagem, statusCode) {
  const erro = new Error(mensagem);
  erro.statusCode = statusCode;
  return erro;
}

// Objection serializa um Date como ISO ("...T...Z") que o MySQL grava como
// "0000-00-00". Passamos um texto UTC "YYYY-MM-DD HH:MM:SS" para gravar correto.
/**
 * Retorna o instante atual formatado em UTC.
 */
function agoraUtc() {
  const data = new Date();
  /**
   * Preenche valores numericos com zero a esquerda.
   */
  const pad = valor => String(valor).padStart(2, '0');
  return `${data.getUTCFullYear()}-${pad(data.getUTCMonth() + 1)}-${pad(data.getUTCDate())} `
    + `${pad(data.getUTCHours())}:${pad(data.getUTCMinutes())}:${pad(data.getUTCSeconds())}`;
}

const PERMISSAO_CHAT = 'chat_usar';

/**
 * Verifica se permissao chat esta presente nos dados informados.
 */
function temPermissaoChat(usuario) {
  if (!usuario || !usuario.estaAtivo?.()) return false;
  return usuarioTemPermissaoLocal(usuario, PERMISSAO_CHAT);
}

/**
 * Formata contato para exibicao ou envio.
 */
function formatarContato(usuario) {
  if (!usuario) return null;

  return {
    id: usuario.id,
    nome: usuario.nome,
    foto_perfil: usuario.foto_perfil || null,
    role: usuario.role ? { nome: usuario.role.nome } : null
  };
}

/**
 * Formata anexo para exibicao ou envio.
 */
function formatarAnexo(anexo) {
  if (!anexo) return null;
  return {
    id: anexo.id,
    nome_original: anexo.nome_original,
    mime_type: anexo.arquivo?.mime_type || null,
    tamanho_bytes: Number(anexo.arquivo?.tamanho_bytes || 0)
  };
}

/**
 * Formata mensagem para exibicao ou envio.
 */
function formatarMensagem(mensagem) {
  const excluida = Boolean(mensagem.excluido_em);
  return {
    id: mensagem.id,
    remetente_id: mensagem.remetente_id,
    destinatario_id: mensagem.destinatario_id,
    // Quando excluída, não devolvemos conteúdo nem anexo: o cliente mostra um placeholder.
    conteudo: excluida ? null : mensagem.conteudo,
    recebida_em: mensagem.recebida_em,
    lida_em: mensagem.lida_em,
    created_at: mensagem.created_at,
    anexo: excluida ? null : formatarAnexo(mensagem.anexo),
    excluida,
    tinha_anexo: Boolean(mensagem.tinha_anexo)
  };
}

/**
 * Monta chave conversa a partir dos dados informados.
 */
function montarChaveConversa(usuarioAId, usuarioBId) {
  const ids = [Number(usuarioAId), Number(usuarioBId)].sort((a, b) => a - b);
  return `${ids[0]}-${ids[1]}`;
}

/**
 * Converte chave conversa para o formato interno esperado.
 */
function parseChaveConversa(conversaKey) {
  const partes = String(conversaKey || '').split('-').map(Number);
  if (partes.length !== 2 || partes.some(id => !id || Number.isNaN(id)) || partes[0] === partes[1]) {
    throw erroHttp('Conversa invÃ¡lida.', 400);
  }

  return partes.sort((a, b) => a - b);
}

/**
 * Lista contatos conforme os filtros e parametros informados.
 */
async function listarContatos(usuarioId) {
  const usuarios = await Usuario.query()
    .withGraphFetched('role')
    .where('ativo', true)
    .whereNot('id', Number(usuarioId))
    .orderBy('nome', 'asc');

  // Só usuários que podem usar o chat podem ser contatados.
  return usuarios.filter(temPermissaoChat).map(formatarContato);
}

/**
 * Conta nao lidas conforme os dados informados.
 */
async function contarNaoLidas(usuarioId) {
  const me = Number(usuarioId);

  const linhas = await db('mensagens')
    .where('destinatario_id', me)
    .whereNull('lida_em')
    .groupBy('remetente_id')
    .select('remetente_id')
    .count('* as total');

  const por_contato = {};
  let total = 0;

  for (const linha of linhas) {
    const quantidade = Number(linha.total);
    por_contato[Number(linha.remetente_id)] = quantidade;
    total += quantidade;
  }

  return { total, por_contato };
}

/**
 * Lista conversas conforme os filtros e parametros informados.
 */
async function listarConversas(usuarioId) {
  const me = Number(usuarioId);

  const contatos = await db('mensagens')
    .where('remetente_id', me)
    .orWhere('destinatario_id', me)
    .distinct(db.raw(
      'CASE WHEN remetente_id = ? THEN destinatario_id ELSE remetente_id END AS contato_id',
      [me]
    ));

  const contatoIds = contatos
    .map(linha => Number(linha.contato_id))
    .filter(id => id && id !== me);

  if (contatoIds.length === 0) {
    return [];
  }

  const { por_contato: naoLidasPorContato } = await contarNaoLidas(me);

  const usuarios = await Usuario.query()
    .withGraphFetched('role')
    .whereIn('id', contatoIds);
  const usuariosPorId = new Map(usuarios.map(usuario => [Number(usuario.id), usuario]));

  const conversas = [];

  for (const contatoId of contatoIds) {
    const usuario = usuariosPorId.get(contatoId);
    if (!usuario) continue;

    const ultima = await Mensagem.query()
      .where(builder => {
        builder
          .where({ remetente_id: me, destinatario_id: contatoId })
          .orWhere({ remetente_id: contatoId, destinatario_id: me });
      })
      .withGraphFetched('anexo.arquivo')
      .orderBy('id', 'desc')
      .first();

    conversas.push({
      contato: formatarContato(usuario),
      ultima_mensagem: ultima ? formatarMensagem(ultima) : null,
      nao_lidas: naoLidasPorContato[contatoId] || 0
    });
  }

  conversas.sort((a, b) => {
    const dataA = a.ultima_mensagem?.created_at || '';
    const dataB = b.ultima_mensagem?.created_at || '';
    return String(dataB).localeCompare(String(dataA));
  });

  return conversas;
}

/**
 * Lista todas conversas conforme os filtros e parametros informados.
 */
async function listarTodasConversas() {
  const linhas = await db('mensagens')
    .select(
      db.raw('LEAST(remetente_id, destinatario_id) as usuario_a_id'),
      db.raw('GREATEST(remetente_id, destinatario_id) as usuario_b_id')
    )
    .max('id as ultima_id')
    .count('* as total_mensagens')
    .groupByRaw('LEAST(remetente_id, destinatario_id), GREATEST(remetente_id, destinatario_id)')
    .orderBy('ultima_id', 'desc');

  if (linhas.length === 0) {
    return [];
  }

  const usuarioIds = Array.from(new Set(
    linhas.flatMap(linha => [Number(linha.usuario_a_id), Number(linha.usuario_b_id)])
  ));
  const usuarios = await Usuario.query()
    .withGraphFetched('role')
    .whereIn('id', usuarioIds);
  const usuariosPorId = new Map(usuarios.map(usuario => [Number(usuario.id), usuario]));

  const ultimas = await Mensagem.query()
    .whereIn('id', linhas.map(linha => Number(linha.ultima_id)))
    .withGraphFetched('anexo.arquivo');
  const ultimasPorId = new Map(ultimas.map(mensagem => [Number(mensagem.id), mensagem]));

  return linhas
    .map(linha => {
      const usuarioA = usuariosPorId.get(Number(linha.usuario_a_id));
      const usuarioB = usuariosPorId.get(Number(linha.usuario_b_id));
      const ultima = ultimasPorId.get(Number(linha.ultima_id));

      if (!usuarioA || !usuarioB || !ultima) return null;

      return {
        chave: montarChaveConversa(usuarioA.id, usuarioB.id),
        participantes: [formatarContato(usuarioA), formatarContato(usuarioB)],
        ultima_mensagem: formatarMensagem(ultima),
        total_mensagens: Number(linha.total_mensagens || 0)
      };
    })
    .filter(Boolean);
}

/**
 * Marca conversa lida conforme a acao solicitada.
 */
async function marcarConversaLida(usuarioId, contatoId) {
  const me = Number(usuarioId);
  const contato = Number(contatoId);

  await Mensagem.query()
    .where('destinatario_id', me)
    .where('remetente_id', contato)
    .whereNull('lida_em')
    .patch({ lida_em: agoraUtc() });

  return true;
}

/**
 * Lista mensagens conforme os filtros e parametros informados.
 */
async function listarMensagens(usuarioId, contatoId, { desde, limit = 50 } = {}) {
  const me = Number(usuarioId);
  const contato = Number(contatoId);

  if (!contato || Number.isNaN(contato)) {
    throw erroHttp('Contato inválido.', 400);
  }

  // Marca como lidas as mensagens recebidas deste contato.
  await marcarConversaLida(me, contato);

  const query = Mensagem.query()
    .where(builder => {
      builder
        .where({ remetente_id: me, destinatario_id: contato })
        .orWhere({ remetente_id: contato, destinatario_id: me });
    })
    .withGraphFetched('anexo.arquivo');

  let mensagens;

  if (desde) {
    mensagens = await query.where('id', '>', Number(desde)).orderBy('id', 'asc');
  } else {
    const registros = await query
      .orderBy('id', 'desc')
      .limit(Math.min(Number(limit) || 50, 100));
    mensagens = registros.reverse();
  }

  return mensagens.map(formatarMensagem);
}

/**
 * Lista mensagens conversa interna conforme os filtros e parametros informados.
 */
async function listarMensagensConversaInterna(conversaKey, { desde, limit = 50 } = {}) {
  const [usuarioAId, usuarioBId] = parseChaveConversa(conversaKey);

  const query = Mensagem.query()
    .where(builder => {
      builder
        .where({ remetente_id: usuarioAId, destinatario_id: usuarioBId })
        .orWhere({ remetente_id: usuarioBId, destinatario_id: usuarioAId });
    })
    .withGraphFetched('anexo.arquivo');

  let mensagens;

  if (desde) {
    mensagens = await query.where('id', '>', Number(desde)).orderBy('id', 'asc');
  } else {
    const registros = await query
      .orderBy('id', 'desc')
      .limit(Math.min(Number(limit) || 50, 200));
    mensagens = registros.reverse();
  }

  return mensagens.map(formatarMensagem);
}

/**
 * Envia mensagem para processamento.
 */
async function prepararMensagem(remetenteId, conteudo, arquivoId = null, nomeArquivo = null) {
  const remetente = Number(remetenteId);
  const texto = typeof conteudo === 'string' ? conteudo.trim() : '';
  const arquivoFoiInformado = arquivoId !== null && arquivoId !== undefined && arquivoId !== '';
  const arquivoIdNum = arquivoId ? Number(arquivoId) : null;
  const nomeArquivoSanitizado = nomeArquivo
    ? arquivoService.normalizarNomeArquivo(String(nomeArquivo))
    : null;

  if (arquivoFoiInformado && (!Number.isInteger(arquivoIdNum) || arquivoIdNum <= 0)) {
    throw erroHttp('Anexo inválido.', 400);
  }

  if (!texto && !arquivoIdNum) {
    throw erroHttp('A mensagem não pode estar vazia.', 400);
  }

  let arquivoAnexo = null;
  if (arquivoIdNum) {
    arquivoAnexo = await Arquivo.query().findById(arquivoIdNum);
    // O frontend só conhece arquivos que ele mesmo subiu nesta sessão; ainda assim
    // exigimos que o arquivo exista e pertença ao remetente para evitar referência cruzada.
    if (!arquivoAnexo || arquivoAnexo.removido_em || Number(arquivoAnexo.criado_por_id) !== remetente) {
      throw erroHttp('Anexo inválido.', 400);
    }
  }

  return { remetente, texto, arquivoAnexo, nomeArquivoSanitizado };
}

/**
 * Remove destinatarios repetidos preservando valores invalidos para relatar falhas.
 */
function normalizarDestinatarios(destinatarioIds) {
  const destinatarios = [];
  const vistos = new Set();
  for (const valor of destinatarioIds) {
    const numero = Number(valor);
    const valido = Number.isInteger(numero) && numero > 0;
    const normalizado = valido ? numero : valor;
    const chave = valido ? `id:${numero}` : `invalido:${String(valor)}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    destinatarios.push(normalizado);
  }
  return destinatarios;
}

/**
 * Valida um destinatario antes de criar sua copia da mensagem.
 */
async function validarDestinatario(remetente, destinatarioId) {
  const destinatario = Number(destinatarioId);

  if (!destinatario || Number.isNaN(destinatario) || !Number.isInteger(destinatario)) {
    throw erroHttp('Destinatário inválido.', 400);
  }

  if (destinatario === remetente) {
    throw erroHttp('Não é possível enviar mensagem para si mesmo.', 400);
  }

  const usuarioDestino = await Usuario.query()
    .findById(destinatario)
    .withGraphFetched('role');

  if (!usuarioDestino || !usuarioDestino.estaAtivo()) {
    throw erroHttp('Destinatário não encontrado ou inativo.', 404);
  }

  if (!temPermissaoChat(usuarioDestino)) {
    throw erroHttp('Este usuário não pode usar o chat.', 403);
  }

  return destinatario;
}

/**
 * Persiste uma mensagem e seu eventual vinculo de anexo atomicamente.
 */
async function criarMensagemParaDestinatario(preparada, destinatarioId) {
  const destinatario = await validarDestinatario(preparada.remetente, destinatarioId);
  const agora = agoraUtc();

  return db.transaction(async trx => {
    const mensagem = await Mensagem.query(trx).insertAndFetch({
      remetente_id: preparada.remetente,
      destinatario_id: destinatario,
      conteudo: preparada.texto || null,
      tinha_anexo: Boolean(preparada.arquivoAnexo),
      // "Recebido" = mensagem salva no servidor (independe do destinatário estar online).
      recebida_em: agora,
      created_at: agora,
      updated_at: agora
    });

    if (preparada.arquivoAnexo) {
      await MensagemArquivo.query(trx).insert({
        mensagem_id: mensagem.id,
        arquivo_id: preparada.arquivoAnexo.id,
        nome_original: preparada.nomeArquivoSanitizado || `arquivo${preparada.arquivoAnexo.extensao || ''}`
      });
    }

    const completa = await Mensagem.query(trx)
      .findById(mensagem.id)
      .withGraphFetched('anexo.arquivo');

    return formatarMensagem(completa);
  });
}

/**
 * Envia mensagem para processamento.
 */
async function enviarMensagem(remetenteId, destinatarioId, conteudo, arquivoId = null, nomeArquivo = null) {
  const preparada = await prepararMensagem(remetenteId, conteudo, arquivoId, nomeArquivo);
  return criarMensagemParaDestinatario(preparada, destinatarioId);
}

/**
 * Envia copias independentes da mesma mensagem para varios destinatarios.
 */
async function enviarMensagensEmLote(remetenteId, destinatarioIds, conteudo, arquivoId = null, nomeArquivo = null) {
  if (!Array.isArray(destinatarioIds) || destinatarioIds.length === 0) {
    throw erroHttp('Informe ao menos um destinatário.', 400);
  }

  const destinatarios = normalizarDestinatarios(destinatarioIds);

  const preparada = await prepararMensagem(remetenteId, conteudo, arquivoId, nomeArquivo);
  const enviadas = [];
  const falhas = [];

  for (const destinatarioId of destinatarios) {
    try {
      const mensagem = await criarMensagemParaDestinatario(preparada, destinatarioId);
      enviadas.push({ destinatario_id: Number(destinatarioId), mensagem });
    } catch (error) {
      if (!error.statusCode) console.error(error);
      falhas.push({
        destinatario_id: destinatarioId,
        motivo: error.statusCode ? error.message : 'Não foi possível enviar a mensagem.'
      });
    }
  }

  return {
    enviadas,
    falhas,
    resumo: {
      solicitadas: destinatarios.length,
      enviadas: enviadas.length,
      falhas: falhas.length
    }
  };
}

// Recebe o multipart, valida tipo/tamanho e materializa no storage de arquivos.
// Devolve o registro de `arquivos` (com nome_original_upload anexado em memória
// para que enviarMensagem possa preservá-lo ao criar o vínculo).
/**
 * Processa upload anexo conforme as regras do dominio.
 */
async function uploadAnexo(req, usuarioId) {
  let upload;
  try {
    upload = await arquivoService.receberUpload(req, {
      allowedTypes: ANEXO_TIPOS_PERMITIDOS,
      maxFileBytes: ANEXO_TAMANHO_MAX_BYTES
    });
  } catch (error) {
    if (/excede o tamanho/i.test(error.message || '')) {
      throw erroHttp(`Arquivo maior que ${ANEXO_TAMANHO_MAX_MB} MB.`, 400);
    }
    if (/tipo de arquivo/i.test(error.message || '')) {
      throw erroHttp('Tipo de arquivo não permitido.', 400);
    }
    throw erroHttp(error.message || 'Falha no upload.', 400);
  }

  const arquivo = await arquivoService.materializarArquivo(upload, usuarioId);

  return {
    arquivo_id: arquivo.id,
    nome_original: upload.nomeOriginal,
    mime_type: arquivo.mime_type,
    tamanho_bytes: Number(arquivo.tamanho_bytes || 0)
  };
}

/**
 * Exclui mensagem conforme a regra de negocio.
 */
async function excluirMensagem(usuarioId, mensagemId) {
  const me = Number(usuarioId);
  const id = Number(mensagemId);

  if (!id || Number.isNaN(id)) {
    throw erroHttp('Mensagem inválida.', 400);
  }

  const mensagem = await Mensagem.query().findById(id);

  if (!mensagem) {
    throw erroHttp('Mensagem não encontrada.', 404);
  }

  if (Number(mensagem.remetente_id) !== me) {
    throw erroHttp('Você só pode excluir as próprias mensagens.', 403);
  }

  if (mensagem.excluido_em) {
    return true;
  }

  // Soft delete: a bolha continua na thread como "Mensagem deletada" / "Arquivo deletado".
  // O vínculo do anexo é removido para que o blob vire órfão e seja limpo pelo cron.
  await MensagemArquivo.query().delete().where('mensagem_id', id);
  await Mensagem.query().patchAndFetchById(id, {
    excluido_em: agoraUtc(),
    conteudo: null,
    updated_at: agoraUtc()
  });

  return true;
}

/**
 * Prepara o download de anexo.
 */
async function prepararDownloadAnexo(usuarioId, mensagemArquivoId, { permitirQualquerConversa = false } = {}) {
  const me = Number(usuarioId);

  const vinculo = await MensagemArquivo.query()
    .findById(mensagemArquivoId)
    .withGraphFetched('[arquivo, mensagem]');

  if (!vinculo || !vinculo.arquivo || !vinculo.mensagem) {
    throw erroHttp('Anexo não encontrado.', 404);
  }

  const mensagem = vinculo.mensagem;
  if (!permitirQualquerConversa && Number(mensagem.remetente_id) !== me && Number(mensagem.destinatario_id) !== me) {
    throw erroHttp('Sem acesso a este anexo.', 403);
  }

  if (mensagem.excluido_em) {
    throw erroHttp('Anexo não está mais disponível.', 410);
  }

  const stream = await arquivoService.abrirStreamArquivo(vinculo.arquivo);

  return {
    ...stream,
    nome: vinculo.nome_original
  };
}

module.exports = {
  listarContatos,
  listarConversas,
  listarTodasConversas,
  listarMensagens,
  listarMensagensConversaInterna,
  enviarMensagem,
  enviarMensagensEmLote,
  contarNaoLidas,
  marcarConversaLida,
  uploadAnexo,
  prepararDownloadAnexo,
  excluirMensagem,
  _internals: { normalizarDestinatarios }
};
