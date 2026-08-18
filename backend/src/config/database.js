const knex = require('knex');
const { AjvValidator, Model } = require('objection');
const { loadEnvironment } = require('./environment');
const { assertSafeTestDatabase } = require('./test-safety');

loadEnvironment();

const knexConfig = require('../../knexfile');

const environment = process.env.NODE_ENV || 'development';
const selectedConfig = knexConfig[environment];

if (!selectedConfig) {
  throw new Error(`Configuracao de banco inexistente para NODE_ENV=${environment}.`);
}

if (environment === 'test') {
  assertSafeTestDatabase({
    environment,
    autoMigrate: process.env.AUTO_MIGRATE,
    connection: selectedConfig.connection
  });
}

const connection = knex(selectedConfig);

Model.createValidator = () => new AjvValidator({
  options: {
    allErrors: true,
    validateSchema: true,
    ownProperties: true,
    allowUnionTypes: true
  }
});

Model.knex(connection);

module.exports = connection;
