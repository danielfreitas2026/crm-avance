const axios = require('axios');
const db = require('../database/connection');
const fuzzy = require('../utils/fuzzy');

const GOOGLE_PLACES_TIMEOUT_MS = Number(process.env.GOOGLE_PLACES_TIMEOUT_MS || 6000);
const GOOGLE_PLACES_MIN_SCORE = Number(process.env.GOOGLE_PLACES_MIN_SCORE || 2);
// Limiar (0-1) acima do qual consideramos o match do Google confiavel o
// suficiente para dispensar uma busca extra (ex.: Apify).
const CONFIANCA_BOA = Number(process.env.GOOGLE_PLACES_CONFIANCA_BOA || 0.72);
const CONFIANCA_ALTA = Number(process.env.GOOGLE_PLACES_CONFIANCA_ALTA || 0.85);
const GOOGLE_MAPS_KEY_PREFIX = 'GOOGLE_MAPS_API_KEY';
const GOOGLE_PLACES_KEY_PREFIX = 'GOOGLE_PLACES_API_KEY';
const GOOGLE_MAPS_API_KEYS_ESPERADAS = Array.from(
  { length: 5 },
  (_, index) => `${GOOGLE_MAPS_KEY_PREFIX}_${index + 1}`
);

const pausadoPorChave = new Map();
const TABELA_GOOGLE_KEYS = 'cnpj_google_places_keys';

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizarTelefone(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');
  if (digitos.startsWith('55') && digitos.length > 11) {
    return digitos.slice(2, 13);
  }
  return digitos.slice(0, 11);
}

function primeiroValor(...valores) {
  return valores.find(valor => String(valor || '').trim()) || '';
}

function adicionarChave(lista, valor, env) {
  const chave = String(valor || '').trim();
  if (!chave || lista.some(item => item.chave === chave)) return;
  lista.push({ chave, env, origem: 'env' });
}

function obterApiKeysGoogleEnv() {
  const keys = [];

  GOOGLE_MAPS_API_KEYS_ESPERADAS.forEach(env => {
    adicionarChave(keys, process.env[env], env);
  });

  adicionarChave(keys, process.env.GOOGLE_MAPS_API_KEY, 'GOOGLE_MAPS_API_KEY');
  adicionarChave(keys, process.env.GOOGLE_PLACES_API_KEY, 'GOOGLE_PLACES_API_KEY');
  for (let index = 1; index <= 5; index += 1) {
    adicionarChave(keys, process.env[`${GOOGLE_PLACES_KEY_PREFIX}_${index}`], `${GOOGLE_PLACES_KEY_PREFIX}_${index}`);
  }

  return keys;
}

function parseBool(valor) {
  return valor === true || valor === 1 || valor === '1';
}

function formatarDateTimeSQL(data = new Date()) {
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

function proximaMeiaNoite() {
  const agora = new Date();
  const proxima = new Date(agora);
  proxima.setHours(24, 0, 0, 0);
  return proxima;
}

function mascararApiKey(chave) {
  const texto = String(chave || '').trim();
  if (texto.length <= 10) return texto ? '****' : '';
  return `${texto.slice(0, 6)}...${texto.slice(-4)}`;
}

function normalizarRegistroKey(registro) {
  const esgotadaAte = registro.esgotada_ate ? new Date(registro.esgotada_ate) : null;

  return {
    id: registro.id,
    nome: registro.nome || `Chave ${registro.id}`,
    api_key: String(registro.api_key || ''),
    mascarada: mascararApiKey(registro.api_key),
    ativo: parseBool(registro.ativo),
    esgotada: Boolean(esgotadaAte && esgotadaAte.getTime() > Date.now()),
    esgotada_em: registro.esgotada_em || null,
    esgotada_ate: registro.esgotada_ate || null,
    ultimo_status: registro.ultimo_status || '',
    ultimo_erro: registro.ultimo_erro || '',
    created_at: registro.created_at || null,
    updated_at: registro.updated_at || null
  };
}

async function tabelaGoogleKeysExiste() {
  try {
    return await db.schema.hasTable(TABELA_GOOGLE_KEYS);
  } catch {
    return false;
  }
}

async function obterApiKeysGoogleBanco() {
  if (!(await tabelaGoogleKeysExiste())) return [];

  const registros = await db(TABELA_GOOGLE_KEYS)
    .where({ ativo: true })
    .orderBy('id', 'asc');

  return registros
    .map(registro => ({
      chave: String(registro.api_key || '').trim(),
      env: registro.nome || `Chave ${registro.id}`,
      id: registro.id,
      origem: 'banco',
      esgotadaAte: registro.esgotada_ate ? new Date(registro.esgotada_ate) : null
    }))
    .filter(item => item.chave);
}

async function obterApiKeysGoogle() {
  const keysBanco = await obterApiKeysGoogleBanco();
  if (keysBanco.length > 0) return keysBanco;
  return obterApiKeysGoogleEnv();
}

async function listarGooglePlacesKeys() {
  if (!(await tabelaGoogleKeysExiste())) return [];

  const registros = await db(TABELA_GOOGLE_KEYS)
    .orderBy('id', 'asc');

  return registros.map(normalizarRegistroKey);
}

async function adicionarGooglePlacesKey({ nome, apiKey }) {
  if (!(await tabelaGoogleKeysExiste())) {
    const error = new Error('Execute as migrations antes de cadastrar chaves do Google Places.');
    error.statusCode = 500;
    throw error;
  }

  const chave = String(apiKey || '').trim();
  if (!chave) {
    const error = new Error('Informe a chave da API do Google Places.');
    error.statusCode = 400;
    throw error;
  }

  const agora = formatarDateTimeSQL();
  const [id] = await db(TABELA_GOOGLE_KEYS).insert({
    nome: String(nome || '').trim() || `Google Places ${agora}`,
    api_key: chave,
    ativo: true,
    esgotada_em: null,
    esgotada_ate: null,
    ultimo_status: null,
    ultimo_erro: null,
    created_at: agora,
    updated_at: agora
  });

  const registro = await db(TABELA_GOOGLE_KEYS).where({ id }).first();
  return normalizarRegistroKey(registro);
}

async function removerGooglePlacesKey(id) {
  if (!(await tabelaGoogleKeysExiste())) return false;

  const removidos = await db(TABELA_GOOGLE_KEYS)
    .where({ id })
    .delete();

  return removidos > 0;
}

async function atualizarGooglePlacesKey(id, { nome, apiKey }) {
  if (!(await tabelaGoogleKeysExiste())) {
    const error = new Error('Execute as migrations antes de editar chaves do Google Places.');
    error.statusCode = 500;
    throw error;
  }

  const chaveId = Number.parseInt(id, 10);
  if (!Number.isFinite(chaveId) || chaveId <= 0) {
    const error = new Error('Chave invalida.');
    error.statusCode = 400;
    throw error;
  }

  const atualizacao = {
    nome: String(nome || '').trim() || `Chave ${chaveId}`,
    updated_at: formatarDateTimeSQL()
  };

  const chave = String(apiKey || '').trim();
  if (chave) {
    atualizacao.api_key = chave;
    atualizacao.esgotada_em = null;
    atualizacao.esgotada_ate = null;
    atualizacao.ultimo_status = null;
    atualizacao.ultimo_erro = null;
  }

  const atualizados = await db(TABELA_GOOGLE_KEYS)
    .where({ id: chaveId })
    .update(atualizacao);

  if (!atualizados) return null;

  const registro = await db(TABELA_GOOGLE_KEYS).where({ id: chaveId }).first();
  return normalizarRegistroKey(registro);
}

async function marcarKeyUsada(item) {
  if (item.origem !== 'banco' || !item.id) return;

  await db(TABELA_GOOGLE_KEYS)
    .where({ id: item.id })
    .update({
      ultimo_status: 'ok',
      ultimo_erro: null,
      updated_at: formatarDateTimeSQL()
    });
}

async function marcarKeyEsgotada(item, resultado) {
  if (item.origem !== 'banco' || !item.id) return;

  const agora = new Date();
  await db(TABELA_GOOGLE_KEYS)
    .where({ id: item.id })
    .update({
      esgotada_em: formatarDateTimeSQL(agora),
      esgotada_ate: formatarDateTimeSQL(proximaMeiaNoite()),
      ultimo_status: resultado.google_status || resultado.motivo || 'limite',
      ultimo_erro: resultado.message || '',
      updated_at: formatarDateTimeSQL(agora)
    });
}

function montarQueryEmpresa(dados = {}) {
  const buscaInformada = primeiroValor(dados.queryGoogle, dados.textoBusca);
  if (buscaInformada) return buscaInformada;

  const nome = primeiroValor(dados.nomeFantasia, dados.razaoSocial);
  const local = [
    dados.endereco,
    dados.numero,
    dados.municipio,
    dados.uf
  ].filter(Boolean).join(' ');

  return [nome, local].filter(Boolean).join(' ');
}

function calcularScore(dados = {}, place = {}) {
  const nomePlace = normalizarTexto(place.displayName?.text || place.displayName || '');
  const enderecoPlace = normalizarTexto(place.formattedAddress || '');
  const nomesEmpresa = [
    normalizarTexto(dados.nomeFantasia),
    normalizarTexto(dados.razaoSocial)
  ].filter(Boolean);
  let score = 0;

  if (nomesEmpresa.some(nome => nomePlace.includes(nome) || nome.includes(nomePlace))) {
    score += 2;
  } else if (nomesEmpresa.some(nome => nome.split(' ').filter(Boolean).some(parte => parte.length > 3 && nomePlace.includes(parte)))) {
    score += 1;
  }

  if (dados.municipio && enderecoPlace.includes(normalizarTexto(dados.municipio))) {
    score += 1;
  }

  if (dados.uf && enderecoPlace.includes(normalizarTexto(dados.uf))) {
    score += 1;
  }

  return score;
}

async function buscarPlacesPorTexto(query, apiKey) {
  const response = await axios.post('https://places.googleapis.com/v1/places:searchText', {
    textQuery: query,
    languageCode: 'pt-BR',
    regionCode: 'BR',
    maxResultCount: 5
  }, {
    timeout: GOOGLE_PLACES_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress'
    }
  });

  return Array.isArray(response.data?.places) ? response.data.places : [];
}

async function buscarDetalhesPlace(placeId, apiKey) {
  const response = await axios.get(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    timeout: GOOGLE_PLACES_TIMEOUT_MS,
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,websiteUri'
    }
  });

  return response.data || {};
}

/**
 * Classifica a confianca (0-1) em um nivel textual usado na interface.
 */
function nivelConfianca(confianca) {
  if (confianca >= CONFIANCA_ALTA) return 'alta';
  if (confianca >= CONFIANCA_BOA) return 'media';
  return 'baixa';
}

/**
 * Decide se vale a pena uma busca extra (ex.: Apify) para este candidato e
 * explica o porque. NAO dispara nada: apenas sinaliza o caso recomendado.
 *
 * Regras:
 *  - Nome pouco parecido (confianca baixa): o Google pode ter achado outra
 *    empresa; uma busca extra ajudaria a confirmar/achar o contato certo.
 *  - Nome confiavel mas sem telefone: a empresa foi identificada, porem o
 *    Google nao expos telefone; uma busca extra no site/redes pode achar.
 *  - Nome confiavel e com telefone: o Google ja basta.
 */
function recomendarApify(confianca, temTelefone) {
  if (confianca < CONFIANCA_BOA) {
    return {
      recomenda: true,
      motivo: 'Baixa correspondencia do nome: o Google pode ter encontrado outra empresa. Uma busca extra (Apify) ajudaria a confirmar e achar o contato certo.'
    };
  }
  if (!temTelefone) {
    return {
      recomenda: true,
      motivo: 'Empresa identificada com boa confianca, mas sem telefone publico no Google. Uma busca extra (Apify) no site/redes pode encontrar o numero.'
    };
  }
  return { recomenda: false, motivo: '' };
}

function resumirCandidatoPlace(item, detalhes = {}, dados = {}) {
  const nome = detalhes.displayName?.text || item.place?.displayName?.text || '';
  const endereco = detalhes.formattedAddress || item.place?.formattedAddress || '';
  const telefone = normalizarTelefone(primeiroValor(
    detalhes.nationalPhoneNumber,
    detalhes.internationalPhoneNumber
  ));

  const nomeBusca = primeiroValor(dados.nomeFantasia, dados.razaoSocial, dados.queryGoogle, dados.textoBusca);
  const confianca = fuzzy.confiancaEmpresa(nomeBusca, dados, { nome, endereco });
  const apify = recomendarApify(confianca, Boolean(telefone));

  return {
    id: detalhes.id || item.place?.id || '',
    nome,
    endereco,
    telefone,
    site: detalhes.websiteUri || '',
    score: item.score,
    confianca,
    confianca_pct: Math.round(confianca * 100),
    confianca_nivel: nivelConfianca(confianca),
    recomenda_apify: apify.recomenda,
    apify_motivo: apify.motivo
  };
}

async function buscarTelefoneEmpresaComChave(dados, query, apiKey, keyIndex, env) {
  try {
    const places = await buscarPlacesPorTexto(query, apiKey);
    const candidatos = places
      .map(place => ({
        place,
        score: calcularScore(dados, place)
      }))
      .sort((a, b) => b.score - a.score);
    const melhor = candidatos[0];

    if (!melhor || melhor.score < GOOGLE_PLACES_MIN_SCORE || !melhor.place?.id) {
      return {
        encontrado: false,
        motivo: 'sem_match',
        query,
        google_key_index: keyIndex,
        google_key_env: env,
        candidatos: candidatos.slice(0, 5).map(item => resumirCandidatoPlace(item, {}, dados))
      };
    }

    const detalhes = await buscarDetalhesPlace(melhor.place.id, apiKey);
    const telefone = normalizarTelefone(primeiroValor(
      detalhes.nationalPhoneNumber,
      detalhes.internationalPhoneNumber
    ));

    const candidatoPrincipal = resumirCandidatoPlace(melhor, detalhes, dados);
    const candidatosResumo = [
      candidatoPrincipal,
      ...candidatos
        .filter(item => item.place?.id !== melhor.place?.id)
        .map(item => resumirCandidatoPlace(item, {}, dados))
    ];

    if (!telefone) {
      return {
        encontrado: false,
        motivo: 'sem_telefone',
        query,
        google_key_index: keyIndex,
        google_key_env: env,
        place: candidatoPrincipal,
        candidatos: candidatosResumo
      };
    }

    return {
      encontrado: true,
      telefone,
      fonte: 'Google Places',
      confianca: melhor.score >= 3 ? 'alta' : 'media',
      query,
      google_key_index: keyIndex,
      google_key_env: env,
      place: candidatoPrincipal,
      candidatos: candidatosResumo
    };
  } catch (error) {
    const status = error.response?.status || null;
    const mensagemGoogle = error.response?.data?.error?.message || error.message;
    const statusGoogle = error.response?.data?.error?.status || '';
    const motivo = status === 429 || statusGoogle === 'RESOURCE_EXHAUSTED'
      ? 'limite'
      : status === 403 || statusGoogle === 'PERMISSION_DENIED'
        ? 'permissao'
        : status === 401 || statusGoogle === 'UNAUTHENTICATED'
          ? 'autenticacao'
          : 'erro';

    return {
      encontrado: false,
      motivo,
      status,
      google_status: statusGoogle,
      google_key_index: keyIndex,
      google_key_env: env,
      message: mensagemGoogle
    };
  }
}

function deveTentarProximaChave(resultado = {}) {
  return ['limite', 'permissao', 'autenticacao', 'erro'].includes(resultado.motivo);
}

function montarTentativa(resultado = {}) {
  return {
    env: resultado.google_key_env || '',
    origem: resultado.google_key_origem || '',
    index: resultado.google_key_index || null,
    motivo: resultado.motivo || '',
    status: resultado.status || null,
    google_status: resultado.google_status || '',
    message: resultado.message || ''
  };
}

async function buscarEmpresasPorTextoComChave(dados, query, apiKey, keyIndex, env) {
  try {
    const places = await buscarPlacesPorTexto(query, apiKey);
    const candidatos = places
      .map(place => ({
        place,
        score: calcularScore(dados, place)
      }))
      .sort((a, b) => b.score - a.score);

    if (candidatos.length === 0) {
      return {
        encontrado: false,
        motivo: 'sem_match',
        query,
        google_key_index: keyIndex,
        google_key_env: env,
        candidatos: []
      };
    }

    const empresas = await Promise.all(candidatos.map(async item => {
      const detalhes = item.place?.id
        ? await buscarDetalhesPlace(item.place.id, apiKey)
        : {};
      return resumirCandidatoPlace(item, detalhes, dados);
    }));

    return {
      encontrado: true,
      fonte: 'Google Places',
      query,
      google_key_index: keyIndex,
      google_key_env: env,
      empresas
    };
  } catch (error) {
    const status = error.response?.status || null;
    const mensagemGoogle = error.response?.data?.error?.message || error.message;
    const statusGoogle = error.response?.data?.error?.status || '';
    const motivo = status === 429 || statusGoogle === 'RESOURCE_EXHAUSTED'
      ? 'limite'
      : status === 403 || statusGoogle === 'PERMISSION_DENIED'
        ? 'permissao'
        : status === 401 || statusGoogle === 'UNAUTHENTICATED'
          ? 'autenticacao'
          : 'erro';

    return {
      encontrado: false,
      motivo,
      status,
      google_status: statusGoogle,
      google_key_index: keyIndex,
      google_key_env: env,
      message: mensagemGoogle
    };
  }
}

async function buscarEmpresasPorTexto(dados = {}) {
  const keys = await obterApiKeysGoogle();
  const agora = Date.now();

  if (keys.length === 0) {
    return {
      encontrado: false,
      motivo: 'sem_chave',
      message: 'Nenhuma chave do Google Places cadastrada. Adicione uma chave na tela de consulta de CNPJ.'
    };
  }

  const query = montarQueryEmpresa(dados);
  if (!query) {
    return {
      encontrado: false,
      motivo: 'sem_query'
    };
  }

  const tentativas = [];
  let ultimoResultado = null;

  for (const [index, item] of keys.entries()) {
    const keyIndex = index + 1;
    const pausadoAteMemoria = pausadoPorChave.get(item.chave) || 0;
    const pausadoAteBanco = item.esgotadaAte?.getTime?.() || 0;
    const pausadoAte = Math.max(pausadoAteMemoria, pausadoAteBanco);

    if (pausadoAte > agora) {
      tentativas.push({
        env: item.env,
        origem: item.origem,
        index: keyIndex,
        motivo: 'pausado',
        status: null,
        google_status: '',
        message: item.origem === 'banco'
          ? 'Chave esgotada hoje. Ela sera usada novamente amanha.'
          : 'Chave pausada temporariamente apos erro de limite/permissao/autenticacao.'
      });
      continue;
    }

    const resultado = await buscarEmpresasPorTextoComChave(dados, query, item.chave, keyIndex, item.env);
    resultado.google_key_origem = item.origem;
    ultimoResultado = resultado;

    if (resultado.encontrado || !deveTentarProximaChave(resultado)) {
      if (resultado.encontrado) {
        await marcarKeyUsada(item);
      }

      return {
        ...resultado,
        tentativas_google: tentativas
      };
    }

    tentativas.push(montarTentativa(resultado));
    if (['limite', 'permissao', 'autenticacao'].includes(resultado.motivo)) {
      pausadoPorChave.set(item.chave, proximaMeiaNoite().getTime());
      await marcarKeyEsgotada(item, resultado);
    }
  }

  const todasCredenciaisEsgotadas = tentativas.length === keys.length
    && tentativas.every(tentativa => ['limite', 'pausado'].includes(tentativa.motivo));

  if (todasCredenciaisEsgotadas) {
    return {
      encontrado: false,
      motivo: 'credenciais_esgotadas',
      query,
      message: 'Todas as credenciais do Google Places cadastradas esgotaram hoje. Volte amanha para continuar usando a busca extra.',
      tentativas_google: tentativas
    };
  }

  if (ultimoResultado) {
    return {
      ...ultimoResultado,
      tentativas_google: tentativas
    };
  }

  return {
    encontrado: false,
    motivo: 'pausado',
    query,
    message: 'Todas as chaves do Google Places estao pausadas temporariamente.',
    tentativas_google: tentativas
  };
}
async function buscarTelefoneEmpresa(dados = {}) {
  const keys = await obterApiKeysGoogle();
  const agora = Date.now();

  if (keys.length === 0) {
    return {
      encontrado: false,
      motivo: 'sem_chave',
      message: 'Nenhuma chave do Google Places cadastrada. Adicione uma chave na tela de consulta de CNPJ.'
    };
  }

  const query = montarQueryEmpresa(dados);
  if (!query) {
    return {
      encontrado: false,
      motivo: 'sem_query'
    };
  }

  const tentativas = [];
  let ultimoResultado = null;

  for (const [index, item] of keys.entries()) {
    const keyIndex = index + 1;
    const pausadoAteMemoria = pausadoPorChave.get(item.chave) || 0;
    const pausadoAteBanco = item.esgotadaAte?.getTime?.() || 0;
    const pausadoAte = Math.max(pausadoAteMemoria, pausadoAteBanco);

    if (pausadoAte > agora) {
      tentativas.push({
        env: item.env,
        origem: item.origem,
        index: keyIndex,
        motivo: 'pausado',
        status: null,
        google_status: '',
        message: item.origem === 'banco'
          ? 'Chave esgotada hoje. Ela sera usada novamente amanha.'
          : 'Chave pausada temporariamente apos erro de limite/permissao/autenticacao.'
      });
      continue;
    }

    const resultado = await buscarTelefoneEmpresaComChave(dados, query, item.chave, keyIndex, item.env);
    resultado.google_key_origem = item.origem;
    ultimoResultado = resultado;

    if (resultado.encontrado || !deveTentarProximaChave(resultado)) {
      if (resultado.encontrado) {
        await marcarKeyUsada(item);
      }

      return {
        ...resultado,
        tentativas_google: [...tentativas, montarTentativa(resultado)]
      };
    }

    if (['limite', 'permissao', 'autenticacao'].includes(resultado.motivo)) {
      if (resultado.motivo === 'limite' && item.origem === 'banco') {
        await marcarKeyEsgotada(item, resultado);
      } else {
        pausadoPorChave.set(item.chave, proximaMeiaNoite().getTime());
      }
    }

    tentativas.push(montarTentativa(resultado));
  }

  const todasCredenciaisEsgotadas = tentativas.length === keys.length
    && tentativas.every(tentativa => ['limite', 'pausado'].includes(tentativa.motivo));

  if (todasCredenciaisEsgotadas) {
    return {
      encontrado: false,
      motivo: 'credenciais_esgotadas',
      query,
      message: 'Todas as credenciais do Google Places cadastradas esgotaram hoje. Volte amanha para continuar usando a busca extra.',
      tentativas_google: tentativas
    };
  }

  if (ultimoResultado) {
    return {
      ...ultimoResultado,
      tentativas_google: tentativas
    };
  }

  return {
    encontrado: false,
    motivo: 'pausado',
    query,
    message: 'Todas as chaves do Google Places estao pausadas temporariamente.',
    tentativas_google: tentativas
  };
}

module.exports = {
  buscarEmpresasPorTexto,
  buscarTelefoneEmpresa,
  calcularScore,
  nivelConfianca,
  recomendarApify,
  montarQueryEmpresa,
  normalizarTelefone,
  normalizarTexto,
  obterApiKeysGoogle,
  obterApiKeysGoogleEnv,
  listarGooglePlacesKeys,
  adicionarGooglePlacesKey,
  atualizarGooglePlacesKey,
  removerGooglePlacesKey,
  GOOGLE_MAPS_API_KEYS_ESPERADAS
};
