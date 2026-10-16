const net = require('node:net');

const SAFE_LOCAL_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const NETWORK_GUARD = Symbol.for('crm-avance.test-network-guard');

const sensitiveEnvironmentPatterns = [
  /^APIFY_/,
  /^CLARO_IMAP_/,
  /^DASHBOARD_INTEGRATION_/,
  /^EMAIL(?:_|$)/,
  /^GMAIL_VIVO_/,
  /^GOOGLE_MAPS_API_KEY(?:_|$)/,
  /^GOOGLE_PLACES_API_KEY(?:_|$)/,
  /^SMTP_/,
  /^TELEGRAM_/
];

for (const name of Object.keys(process.env)) {
  if (sensitiveEnvironmentPatterns.some(pattern => pattern.test(name))) {
    delete process.env[name];
  }
}

Object.assign(process.env, {
  NODE_ENV: 'test',
  AUTO_MIGRATE: 'false',
  JWT_SECRET: 'crm-avance-test-only-secret',
  JWT_EXPIRES_IN: '1h',
  TEST_DB_CLIENT: 'mysql2',
  TEST_DB_HOST: '127.0.0.1',
  TEST_DB_PORT: '3306',
  TEST_DB_USER: 'root',
  TEST_DB_PASSWORD: '',
  TEST_DB_NAME: 'pos_venda_test',
  TEST_DB_POOL_MAX: '2',
  TEST_DB_POOL_ACQUIRE_TIMEOUT: '1000',
  TEST_DB_POOL_IDLE_TIMEOUT: '1000',
  LEAD_ENRIQUECIMENTO_ATIVO: 'false',
  LEAD_ENRIQUECIMENTO_APIFY_ATIVO: 'false',
  TELEGRAM_RESUMO_VENDAS_AGENDAMENTO_ATIVO: 'false'
});

function connectionHost(args) {
  let first = args[0];
  if (Array.isArray(first)) [first] = first;

  if (first && typeof first === 'object') {
    if (first.path) return null;
    return String(first.host || 'localhost').trim().toLowerCase();
  }

  if (typeof first === 'number') {
    return String(typeof args[1] === 'string' ? args[1] : 'localhost').trim().toLowerCase();
  }

  if (typeof first === 'string' && /^\d+$/.test(first)) {
    return String(typeof args[1] === 'string' ? args[1] : 'localhost').trim().toLowerCase();
  }

  // Caminhos de IPC locais usam uma string como primeiro argumento.
  return null;
}

if (!net.Socket.prototype[NETWORK_GUARD]) {
  const originalConnect = net.Socket.prototype.connect;

  Object.defineProperty(net.Socket.prototype, NETWORK_GUARD, {
    value: originalConnect,
    configurable: false,
    enumerable: false,
    writable: false
  });

  net.Socket.prototype.connect = function guardedConnect(...args) {
    const host = connectionHost(args);

    if (host && !SAFE_LOCAL_HOSTS.has(host)) {
      const error = new Error(`Rede externa bloqueada durante os testes: ${host}.`);
      error.code = 'ERR_TEST_EXTERNAL_NETWORK_BLOCKED';
      throw error;
    }

    return originalConnect.apply(this, args);
  };
}

module.exports = {
  SAFE_LOCAL_HOSTS,
  connectionHost
};
