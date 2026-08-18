/**
 * Normaliza o CNPJ usado para relacionar futuros clientes e vendas.
 */
const { restaurarZerosCnpj } = require('./cnpj.service');

function criarHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parseJson(valor, fallback = {}) {
  if (valor === null || valor === undefined) return fallback;
  if (typeof valor !== 'string') return valor;
  try {
    return JSON.parse(valor);
  } catch {
    return fallback;
  }
}

function extrairCnpjsMailing(dadosJson) {
  const dados = parseJson(dadosJson, {});
  return [...Object.entries(dados).reduce((acc, [chave, valor]) => {
    const nome = String(chave || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (!nome.includes('cnpj') && !nome.includes('documento')) return acc;
    const cnpj = restaurarZerosCnpj(valor);
    if (cnpj) acc.add(cnpj);
    return acc;
  }, new Set())];
}

function resolverCnpjFuturoCliente(linha) {
  const cnpjSondagem = restaurarZerosCnpj(linha?.sondagem_cnpj);
  if (cnpjSondagem) return { cnpj: cnpjSondagem, origem: 'sondagem' };

  const cnpjsMailing = extrairCnpjsMailing(linha?.dados_json);
  if (cnpjsMailing.length === 1) return { cnpj: cnpjsMailing[0], origem: 'mailing' };
  if (cnpjsMailing.length > 1) {
    throw criarHttpError(422, 'Ha mais de um CNPJ no mailing. Corrija o CNPJ do futuro cliente antes de buscar vendas.');
  }
  throw criarHttpError(422, 'Informe um CNPJ valido no futuro cliente antes de buscar vendas.');
}

function normalizarCnpjVenda(venda) {
  return restaurarZerosCnpj(venda?.cnpj) || restaurarZerosCnpj(venda?.cliente_cnpj_digitos);
}

function expressaoCnpjVenda() {
  return "REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(v.cnpj, ''), '.', ''), '/', ''), '-', ''), ' ', '')";
}

module.exports = {
  expressaoCnpjVenda,
  extrairCnpjsMailing,
  normalizarCnpjVenda,
  resolverCnpjFuturoCliente
};
