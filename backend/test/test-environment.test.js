const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');

const { loadEnvironment } = require('../src/config/environment');
const { assertSafeTestDatabase } = require('../src/config/test-safety');
const knexConfig = require('../knexfile');

test('bootstrap define o ambiente seguro antes dos testes', () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.AUTO_MIGRATE, 'false');
  assert.equal(process.env.JWT_SECRET, 'crm-avance-test-only-secret');
  assert.equal(process.env.TEST_DB_HOST, '127.0.0.1');
  assert.equal(process.env.TEST_DB_NAME, 'pos_venda_test');
});

test('carregador nao consulta arquivos .env no ambiente de teste', () => {
  let configCalls = 0;
  const result = loadEnvironment({
    env: { NODE_ENV: 'test' },
    config: () => {
      configCalls += 1;
      return {};
    }
  });

  assert.equal(configCalls, 0);
  assert.equal(result.skipped, true);
  assert.equal(result.loaded, false);
});

test('carregador continua consultando o arquivo configurado fora dos testes', () => {
  const env = { NODE_ENV: 'development' };
  let receivedOptions;
  const result = loadEnvironment({
    env,
    envPath: 'arquivo-controlado.env',
    config: options => {
      receivedOptions = options;
      return { parsed: {} };
    }
  });

  assert.equal(result.skipped, false);
  assert.equal(result.loaded, true);
  assert.equal(receivedOptions.path, 'arquivo-controlado.env');
  assert.equal(receivedOptions.processEnv, env);
});

test('bootstrap remove credenciais externas herdadas pelo processo', () => {
  const setupPath = path.resolve(__dirname, 'setup-env.js');
  const script = `process.stdout.write(JSON.stringify({
    nodeEnv: process.env.NODE_ENV,
    autoMigrate: process.env.AUTO_MIGRATE,
    telegram: process.env.TELEGRAM_BOT_TOKEN,
    smtp: process.env.SMTP_PASS,
    dashboard: process.env.DASHBOARD_INTEGRATION_API_KEY,
    google: process.env.GOOGLE_MAPS_API_KEY,
    apify: process.env.APIFY_TOKEN
  }))`;

  const output = execFileSync(process.execPath, ['--require', setupPath, '-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      AUTO_MIGRATE: 'true',
      TELEGRAM_BOT_TOKEN: 'nao-pode-sobreviver',
      SMTP_PASS: 'nao-pode-sobreviver',
      DASHBOARD_INTEGRATION_API_KEY: 'nao-pode-sobreviver',
      GOOGLE_MAPS_API_KEY: 'nao-pode-sobreviver',
      APIFY_TOKEN: 'nao-pode-sobreviver'
    }
  });
  const result = JSON.parse(output);

  assert.deepEqual(result, {
    nodeEnv: 'test',
    autoMigrate: 'false'
  });
});

test('rede externa e bloqueada antes de abrir um socket', () => {
  assert.throws(
    () => net.createConnection({ host: 'example.com', port: 443 }),
    error => error?.code === 'ERR_TEST_EXTERNAL_NETWORK_BLOCKED'
  );

  assert.throws(
    () => net.createConnection('443', 'example.com'),
    error => error?.code === 'ERR_TEST_EXTERNAL_NETWORK_BLOCKED'
  );
});

test('configuracao Knex de teste usa somente banco local reservado', () => {
  assert.doesNotThrow(() => assertSafeTestDatabase({
    environment: 'test',
    autoMigrate: process.env.AUTO_MIGRATE,
    connection: knexConfig.test.connection
  }));

  assert.equal(knexConfig.test.connection.host, '127.0.0.1');
  assert.equal(knexConfig.test.connection.database, 'pos_venda_test');
});

test('protecao recusa host de banco nao local', () => {
  assert.throws(
    () => assertSafeTestDatabase({
      environment: 'test',
      autoMigrate: 'false',
      connection: { host: 'db.producao.exemplo', database: 'pos_venda_test' }
    }),
    /host local/
  );
});

test('protecao recusa banco sem sufixo de teste', () => {
  assert.throws(
    () => assertSafeTestDatabase({
      environment: 'test',
      autoMigrate: 'false',
      connection: { host: '127.0.0.1', database: 'pos_venda' }
    }),
    /terminar com "_test"/
  );
});

test('protecao recusa migration automatica em testes', () => {
  assert.throws(
    () => assertSafeTestDatabase({
      environment: 'test',
      autoMigrate: 'true',
      connection: { host: '127.0.0.1', database: 'pos_venda_test' }
    }),
    /AUTO_MIGRATE/
  );
});
