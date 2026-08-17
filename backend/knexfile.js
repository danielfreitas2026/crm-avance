const path = require('node:path');
const { loadEnvironment } = require('./src/config/environment');

loadEnvironment();

const pool = {
  min: 0,
  max: Number(process.env.DB_POOL_MAX || 10),
  acquireTimeoutMillis: Number(process.env.DB_POOL_ACQUIRE_TIMEOUT || 60000),
  idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT || 30000)
};

const usarLoadInfile = process.env.LEAD_IMPORT_USE_LOAD_INFILE === 'true';
const migrationsDirectory = path.join(__dirname, 'src', 'database', 'migrations');
const seedsDirectory = path.join(__dirname, 'src', 'database', 'seeds');

const testPool = {
  min: 0,
  max: Number(process.env.TEST_DB_POOL_MAX || 2),
  acquireTimeoutMillis: Number(process.env.TEST_DB_POOL_ACQUIRE_TIMEOUT || 1000),
  idleTimeoutMillis: Number(process.env.TEST_DB_POOL_IDLE_TIMEOUT || 1000)
};

module.exports = {
  development: {
    client: process.env.DB_CLIENT || 'mysql2',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'pos_venda',
      dateStrings: true,
      timezone: '+00:00',
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      ...(usarLoadInfile ? { flags: ['LOCAL_FILES'] } : {})
    },
    pool,
    migrations: {
      directory: migrationsDirectory,
      disableTransactions: true
    },
    seeds: {
      directory: seedsDirectory
    }
  },

  production: {
    client: process.env.DB_CLIENT || 'mysql2',
    connection: {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      dateStrings: true,
      timezone: '+00:00',
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      ...(usarLoadInfile ? { flags: ['LOCAL_FILES'] } : {})
    },
    pool,
    migrations: {
      directory: migrationsDirectory,
      disableTransactions: true
    },
    seeds: {
      directory: seedsDirectory
    }
  },

  test: {
    client: process.env.TEST_DB_CLIENT || 'mysql2',
    connection: {
      host: process.env.TEST_DB_HOST || '127.0.0.1',
      port: Number(process.env.TEST_DB_PORT || 3306),
      user: process.env.TEST_DB_USER || 'root',
      password: process.env.TEST_DB_PASSWORD || '',
      database: process.env.TEST_DB_NAME || 'pos_venda_test',
      dateStrings: true,
      timezone: '+00:00',
      enableKeepAlive: false
    },
    pool: testPool,
    migrations: {
      directory: migrationsDirectory,
      disableTransactions: true
    },
    seeds: {
      directory: seedsDirectory
    }
  }
};
