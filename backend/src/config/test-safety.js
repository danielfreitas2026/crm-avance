const LOCAL_DATABASE_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * Impede que a configuracao reservada aos testes aponte para outro ambiente.
 */
function assertSafeTestDatabase({ environment, autoMigrate, connection }) {
  if (environment !== 'test') {
    throw new Error('A configuracao de banco de testes exige NODE_ENV=test.');
  }

  const host = normalize(connection?.host);
  if (!LOCAL_DATABASE_HOSTS.has(host)) {
    throw new Error(`O banco de testes deve usar um host local; recebido: ${connection?.host || 'vazio'}.`);
  }

  const database = normalize(connection?.database);
  if (!database.endsWith('_test')) {
    throw new Error(`O nome do banco de testes deve terminar com "_test"; recebido: ${connection?.database || 'vazio'}.`);
  }

  if (normalize(autoMigrate) !== 'false') {
    throw new Error('AUTO_MIGRATE deve permanecer desativado durante os testes.');
  }
}

module.exports = {
  LOCAL_DATABASE_HOSTS,
  assertSafeTestDatabase
};
