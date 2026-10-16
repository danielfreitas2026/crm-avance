const ClienteSecreto = require('../models/ClienteSecreto');
const ClienteSecretoOperadora = require('../models/ClienteSecretoOperadora');
const Usuario = require('../models/Usuario');
const { usuarioTemPermissaoLocal } = require('../utils/permissoes');

const CAMPOS = [
  'nome',
  'razao_social',
  'cnpj',
  'responsavel_tipo',
  'responsavel_nome',
  'email',
  'whatsapp_ddd',
  'whatsapp_numero',
  'fixo_ddd',
  'fixo_numero',
  'telefone_receita',
  'telefone_receita_contatavel',
  'telefone_google',
  'telefone_google_contatavel',
  'fidelidade_fim',
  'operadora_atual_id',
  'valor_pago',
  'quantidade_chips'
];

function limparValor(valor) {
  if (valor === undefined) return undefined;
  if (valor === '') return null;
  return valor;
}

function apenasDigitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function separarTelefone(valor) {
  const digitos = apenasDigitos(valor);
  if (!digitos) return { ddd: null, numero: null };
  return {
    ddd: digitos.slice(0, 2) || null,
    numero: digitos.slice(2) || null
  };
}

function normalizarData(valor) {
  if (!valor) return null;
  const texto = String(valor).trim();
  if (!texto || texto === '1899-11-30' || texto === '30/11/1899') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  const match = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return null;
  const [, dia, mes, ano] = match;
  const anoCompleto = ano.length === 2 ? `20${ano}` : ano;
  return `${anoCompleto}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
}

function normalizarValorMonetario(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  const texto = String(valor).trim();
  if (!texto) return null;
  const normalizado = texto.includes(',') ? texto.replace(/\./g, '').replace(',', '.') : texto;
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}

function normalizarInteiroOpcional(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return null;
  return Math.max(Math.trunc(numero), 0);
}

function normalizarBooleano(valor) {
  return valor === true || valor === 1 || valor === '1' || valor === 'true' || valor === 'on';
}

function normalizarTelefoneOrigem(valor) {
  const digitos = apenasDigitos(valor).slice(0, 11);
  return digitos || null;
}

function validarDigitosCnpj(cnpj) {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calcularDigito = (base) => {
    const pesos = base === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((total, peso, index) => total + Number(cnpj[index]) * peso, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return calcularDigito(12) === Number(cnpj[12]) && calcularDigito(13) === Number(cnpj[13]);
}

function validarDigitosCpf(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (n) => {
    const soma = Array.from({ length: n }, (_, i) => Number(cpf[i]) * (n + 1 - i)).reduce((a, b) => a + b, 0);
    const r = (soma * 10) % 11;
    return r >= 10 ? 0 : r;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

function formatarCnpj(valor) {
  const digitos = apenasDigitos(valor).slice(0, 14);
  if (digitos.length !== 14) return String(valor || '').trim();
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`;
}

function formatarCpf(valor) {
  const digitos = apenasDigitos(valor).slice(0, 11);
  if (digitos.length !== 11) return String(valor || '').trim();
  return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`;
}

function criarHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function usuarioPodeVerTodosClientesSecretos(usuarioId) {
  const usuario = await Usuario.query()
    .findById(usuarioId)
    .withGraphFetched('role');

  return usuarioTemPermissaoLocal(usuario, 'clientes_secretos_ver_todos');
}

function normalizarDocumentoObrigatorio(valor) {
  const digitos = apenasDigitos(valor);

  if (digitos.length === 14) {
    if (!validarDigitosCnpj(digitos)) throw criarHttpError(400, 'CNPJ invalido.');
    return { cnpj: formatarCnpj(digitos), cnpj_digitos: digitos };
  }

  if (digitos.length === 11) {
    if (!validarDigitosCpf(digitos)) throw criarHttpError(400, 'CPF invalido.');
    return { cnpj: formatarCpf(digitos), cnpj_digitos: digitos };
  }

  throw criarHttpError(400, 'Informe um CPF ou CNPJ valido.');
}

function normalizarOperadorasCliente(dados = {}) {
  const fonte = Array.isArray(dados.operadoras_atuais)
    ? dados.operadoras_atuais
    : Array.isArray(dados.operadorasAtuais)
      ? dados.operadorasAtuais
      : [];
  const porOperadora = new Map();

  fonte.forEach(item => {
    const operadoraId = Number(item?.operadora_id || item?.operadora?.id);
    if (!Number.isFinite(operadoraId) || operadoraId <= 0) return;
    const atual = porOperadora.get(operadoraId) || {
      operadora_id: operadoraId,
      quantidade_chips: 0,
      valor_pago: 0,
      fidelidade_fim: null
    };
    const quantidade = normalizarInteiroOpcional(item.quantidade_chips);
    const valor = normalizarValorMonetario(item.valor_pago);
    const fidelidade = normalizarData(item.fidelidade_fim);

    if (quantidade !== null) atual.quantidade_chips += quantidade;
    if (valor !== null) atual.valor_pago = Number((Number(atual.valor_pago || 0) + Number(valor)).toFixed(2));
    if (fidelidade && (!atual.fidelidade_fim || fidelidade < atual.fidelidade_fim)) atual.fidelidade_fim = fidelidade;
    porOperadora.set(operadoraId, atual);
  });

  return Array.from(porOperadora.values()).map(item => ({
    ...item,
    quantidade_chips: item.quantidade_chips > 0 ? item.quantidade_chips : null,
    valor_pago: item.valor_pago > 0 ? item.valor_pago : null
  }));
}

function obterResumoOperadoras(operadoras = []) {
  const ordenadas = [...operadoras].sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
  const primeira = ordenadas[0] || null;
  const quantidade = ordenadas.reduce((total, item) => total + Number(item.quantidade_chips || 0), 0);
  const valor = ordenadas.reduce((total, item) => total + Number(item.valor_pago || 0), 0);
  const fidelidades = ordenadas.map(item => normalizarData(item.fidelidade_fim)).filter(Boolean).sort();
  return {
    operadora_atual_id: primeira?.operadora_id || null,
    quantidade_chips: quantidade > 0 ? quantidade : null,
    valor_pago: valor > 0 ? Number(valor.toFixed(2)) : null,
    fidelidade_fim: fidelidades[0] || null
  };
}

async function atualizarResumoLegado(clienteId, trx = null) {
  const operadoras = await ClienteSecretoOperadora.query(trx)
    .where('cliente_secreto_id', clienteId)
    .orderBy('id', 'asc');
  const resumo = obterResumoOperadoras(operadoras);
  await ClienteSecreto.query(trx).patchAndFetchById(clienteId, {
    ...resumo,
    updated_at: new Date()
  });
}

async function sincronizarOperadoras(clienteId, operadoras, trx = null) {
  const linhas = normalizarOperadorasCliente({ operadoras_atuais: operadoras });
  await ClienteSecretoOperadora.query(trx).delete().where('cliente_secreto_id', clienteId);

  if (linhas.length > 0) {
    await ClienteSecretoOperadora.query(trx).insert(linhas.map(item => ({
      ...item,
      cliente_secreto_id: Number(clienteId),
      operadora_id: Number(item.operadora_id)
    })));
  }

  await atualizarResumoLegado(clienteId, trx);
}

function montarPayload(dados) {
  const dadosNormalizados = { ...dados };

  if (dados.whatsapp !== undefined) {
    const whatsapp = separarTelefone(dados.whatsapp);
    dadosNormalizados.whatsapp_ddd = whatsapp.ddd;
    dadosNormalizados.whatsapp_numero = whatsapp.numero;
  }

  if (dados.fixo !== undefined) {
    const fixo = separarTelefone(dados.fixo);
    dadosNormalizados.fixo_ddd = fixo.ddd;
    dadosNormalizados.fixo_numero = fixo.numero;
  }

  const payload = {};
  CAMPOS.forEach(campo => {
    const valor = limparValor(dadosNormalizados[campo]);
    if (valor !== undefined) payload[campo] = valor;
  });

  if (payload.nome !== undefined && payload.nome !== null) payload.nome = String(payload.nome).trim();
  if (payload.cnpj !== undefined) Object.assign(payload, normalizarDocumentoObrigatorio(payload.cnpj));
  if (!payload.responsavel_tipo) payload.responsavel_tipo = 'rl';
  if (!['adm', 'rl'].includes(payload.responsavel_tipo)) throw criarHttpError(400, 'Tipo do responsavel invalido.');
  if (payload.operadora_atual_id !== undefined && payload.operadora_atual_id !== null) payload.operadora_atual_id = Number(payload.operadora_atual_id);
  if (payload.quantidade_chips !== undefined && payload.quantidade_chips !== null) payload.quantidade_chips = Number(payload.quantidade_chips);
  if (payload.valor_pago !== undefined) payload.valor_pago = normalizarValorMonetario(payload.valor_pago);
  if (payload.telefone_receita !== undefined) payload.telefone_receita = normalizarTelefoneOrigem(payload.telefone_receita);
  if (payload.telefone_google !== undefined) payload.telefone_google = normalizarTelefoneOrigem(payload.telefone_google);
  if (payload.telefone_receita_contatavel !== undefined) payload.telefone_receita_contatavel = normalizarBooleano(payload.telefone_receita_contatavel);
  if (payload.telefone_google_contatavel !== undefined) payload.telefone_google_contatavel = normalizarBooleano(payload.telefone_google_contatavel);
  if (payload.fidelidade_fim !== undefined) payload.fidelidade_fim = normalizarData(payload.fidelidade_fim);
  return payload;
}

function formatarOperadoras(operadoras = []) {
  return [...operadoras].sort((a, b) => Number(a.id || 0) - Number(b.id || 0)).map(item => ({
    id: item.id,
    cliente_secreto_id: item.cliente_secreto_id,
    operadora_id: item.operadora_id,
    operadora: item.operadora || null,
    quantidade_chips: item.quantidade_chips ?? null,
    valor_pago: item.valor_pago ?? null,
    fidelidade_fim: item.fidelidade_fim || null
  }));
}

function formatarCliente(cliente) {
  if (!cliente) return null;
  const operadoras_atuais = formatarOperadoras(cliente.operadorasAtuais || cliente.operadoras_atuais || []);
  return {
    id: cliente.id,
    nome: cliente.nome,
    razao_social: cliente.razao_social,
    cnpj: cliente.cnpj,
    cnpj_digitos: cliente.cnpj_digitos,
    responsavel_tipo: cliente.responsavel_tipo,
    responsavel_nome: cliente.responsavel_nome,
    email: cliente.email,
    whatsapp_ddd: cliente.whatsapp_ddd,
    whatsapp_numero: cliente.whatsapp_numero,
    fixo_ddd: cliente.fixo_ddd,
    fixo_numero: cliente.fixo_numero,
    telefone_receita: cliente.telefone_receita,
    telefone_receita_contatavel: Boolean(cliente.telefone_receita_contatavel),
    telefone_google: cliente.telefone_google,
    telefone_google_contatavel: Boolean(cliente.telefone_google_contatavel),
    fidelidade_fim: cliente.fidelidade_fim,
    operadora_atual_id: cliente.operadora_atual_id,
    operadoraAtual: cliente.operadoraAtual || null,
    operadoras_atuais,
    valor_pago: cliente.valor_pago,
    quantidade_chips: cliente.quantidade_chips,
    criado_por_id: cliente.criado_por_id,
    criador: cliente.criador || null,
    created_at: cliente.created_at,
    updated_at: cliente.updated_at,
    secreto: true
  };
}

function aplicarBusca(query, busca) {
  const termo = String(busca || '').trim();
  if (!termo) return;
  const like = `%${termo}%`;
  const digitos = apenasDigitos(termo);
  query.where(builder => {
    builder
      .where('nome', 'like', like)
      .orWhere('razao_social', 'like', like)
      .orWhere('email', 'like', like)
      .orWhere('responsavel_nome', 'like', like)
      .orWhere('cnpj', 'like', like);
    if (digitos) {
      builder
        .orWhere('cnpj_digitos', 'like', `%${digitos}%`)
        .orWhere('telefone_receita', 'like', `%${digitos}%`)
        .orWhere('telefone_google', 'like', `%${digitos}%`)
        .orWhereRaw("CONCAT(COALESCE(whatsapp_ddd, ''), COALESCE(whatsapp_numero, '')) like ?", [`%${digitos}%`])
        .orWhereRaw("CONCAT(COALESCE(fixo_ddd, ''), COALESCE(fixo_numero, '')) like ?", [`%${digitos}%`]);
    }
  });
}

async function buscarDuplicado(documentoDigitos, usuarioId, ignorarId = null, trx = null) {
  if (!documentoDigitos) return null;
  const query = ClienteSecreto.query(trx)
    .select('id', 'nome', 'razao_social', 'cnpj')
    .where('criado_por_id', Number(usuarioId))
    .where('cnpj_digitos', documentoDigitos);
  if (ignorarId) query.whereNot('id', Number(ignorarId));
  return query.first();
}

async function verificarDocumentoClienteSecreto(documento, usuarioId, opcoes = {}) {
  const normalizado = normalizarDocumentoObrigatorio(documento);
  const cliente = await buscarDuplicado(normalizado.cnpj_digitos, usuarioId, opcoes.ignorarId);
  return { existe: Boolean(cliente), cliente: cliente ? formatarCliente(cliente) : null };
}

async function listarClientesSecretos(filtros = {}, usuarioId) {
  const query = ClienteSecreto.query()
    .withGraphFetched('[operadoraAtual, operadorasAtuais.operadora, criador]')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc');

  if (!(await usuarioPodeVerTodosClientesSecretos(usuarioId))) {
    query.where('criado_por_id', Number(usuarioId));
  }

  aplicarBusca(query, filtros.busca);
  return (await query).map(formatarCliente);
}

async function buscarClienteSecretoPorId(id, usuarioId) {
  const query = ClienteSecreto.query()
    .findById(id)
    .withGraphFetched('[operadoraAtual, operadorasAtuais.operadora, criador]');

  if (!(await usuarioPodeVerTodosClientesSecretos(usuarioId))) {
    query.where('criado_por_id', Number(usuarioId));
  }

  const cliente = await query;
  return formatarCliente(cliente);
}

async function criarClienteSecreto(dados, usuarioId) {
  const payload = montarPayload(dados);
  const duplicado = await buscarDuplicado(payload.cnpj_digitos, usuarioId);
  if (duplicado) throw criarHttpError(400, 'Ja existe um cliente próprio seu com este CPF/CNPJ.');

  return ClienteSecreto.transaction(async trx => {
    const criado = await ClienteSecreto.query(trx).insertAndFetch({
      ...payload,
      criado_por_id: Number(usuarioId)
    });
    await sincronizarOperadoras(criado.id, dados.operadoras_atuais || dados.operadorasAtuais || [], trx);
    const cliente = await ClienteSecreto.query(trx)
      .findById(criado.id)
      .where('criado_por_id', Number(usuarioId))
      .withGraphFetched('[operadoraAtual, operadorasAtuais.operadora, criador]');
    return formatarCliente(cliente);
  });
}

async function atualizarClienteSecreto(id, dados, usuarioId, { registrarAuditoria } = {}) {
  const atual = await ClienteSecreto.query()
    .findById(id)
    .select('id')
    .where('criado_por_id', Number(usuarioId));
  if (!atual) return null;

  const payload = montarPayload(dados);
  const duplicado = await buscarDuplicado(payload.cnpj_digitos, usuarioId, id);
  if (duplicado) throw criarHttpError(400, 'Ja existe um cliente próprio seu com este CPF/CNPJ.');

  return ClienteSecreto.transaction(async trx => {
    const anterior = await ClienteSecreto.query(trx).findById(id).where('criado_por_id', Number(usuarioId)).forUpdate();
    if (!anterior) return null;
    const estadoAnterior = registrarAuditoria ? await obterEstadoAuditoriaClienteSecreto(anterior, trx) : null;
    await ClienteSecreto.query(trx).patchAndFetchById(id, {
      ...payload,
      updated_at: new Date()
    });
    await sincronizarOperadoras(id, dados.operadoras_atuais || dados.operadorasAtuais || [], trx);
    const cliente = await ClienteSecreto.query(trx)
      .findById(id)
      .where('criado_por_id', Number(usuarioId))
      .withGraphFetched('[operadoraAtual, operadorasAtuais.operadora, criador]');
    if (registrarAuditoria) {
      const salvo = await ClienteSecreto.query(trx).findById(id);
      await registrarAuditoria(estadoAnterior, await obterEstadoAuditoriaClienteSecreto(salvo, trx), trx);
    }
    return formatarCliente(cliente);
  });
}

async function obterEstadoAuditoriaClienteSecreto(cliente, trx) {
  const operadoras = await ClienteSecretoOperadora.query(trx).where('cliente_secreto_id', cliente.id)
    .select('operadora_id', 'quantidade_chips', 'valor_pago', 'fidelidade_fim').orderBy('operadora_id');
  return { ...cliente, operadoras_atuais: operadoras.map(item => ({ ...item })) };
}

async function excluirClienteSecreto(id, usuarioId) {
  return ClienteSecreto.query()
    .delete()
    .where('id', Number(id))
    .where('criado_por_id', Number(usuarioId));
}

module.exports = {
  listarClientesSecretos,
  buscarClienteSecretoPorId,
  verificarDocumentoClienteSecreto,
  criarClienteSecreto,
  atualizarClienteSecreto,
  excluirClienteSecreto
};
