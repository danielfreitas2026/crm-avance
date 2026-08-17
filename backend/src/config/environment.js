const path = require('node:path');
const dotenv = require('dotenv');

const defaultEnvPath = path.resolve(__dirname, '../../.env');
let processEnvironmentLoaded = false;

/**
 * Carrega o arquivo de ambiente da aplicacao uma unica vez.
 * Em testes, nenhum arquivo .env pode ser consultado.
 */
function loadEnvironment({
  env = process.env,
  config = dotenv.config,
  envPath = defaultEnvPath
} = {}) {
  const environment = env.NODE_ENV || 'development';

  if (environment === 'test') {
    return { environment, loaded: false, skipped: true };
  }

  if (env === process.env && processEnvironmentLoaded) {
    return { environment, loaded: false, skipped: false };
  }

  const result = config({ path: envPath, processEnv: env });

  if (env === process.env) processEnvironmentLoaded = true;

  return {
    environment: env.NODE_ENV || environment,
    loaded: !result?.error,
    skipped: false,
    error: result?.error
  };
}

module.exports = {
  defaultEnvPath,
  loadEnvironment
};
