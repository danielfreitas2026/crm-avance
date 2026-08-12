function autoMigrateAtivo(valor = process.env.AUTO_MIGRATE, ambiente = process.env.NODE_ENV) {
  const configurado = String(valor || '').trim().toLowerCase();
  if (configurado) return configurado === 'true';
  return String(ambiente || '').trim().toLowerCase() === 'production';
}

const CODIGOS_TRANSITORIOS_MIGRATION = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'PROTOCOL_CONNECTION_LOST',
  'ER_CON_COUNT_ERROR',
  'ER_LOCK_DEADLOCK',
  'ER_LOCK_WAIT_TIMEOUT',
  'ER_TOO_MANY_USER_CONNECTIONS'
]);

function numeroInteiroNaoNegativo(valor, padrao) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= 0 ? numero : padrao;
}

function numeroInteiroPositivo(valor, padrao) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : padrao;
}

function erroTransitorioDeMigration(error) {
  const codigo = String(error?.code || '').trim().toUpperCase();
  return CODIGOS_TRANSITORIOS_MIGRATION.has(codigo);
}

function descreverErro(error) {
  const codigo = error?.code ? ` [${error.code}]` : '';
  const mensagem = String(error?.message || error || 'erro desconhecido').replace(/\s+/g, ' ').trim();
  return `${codigo} ${mensagem}`.trim();
}

function aguardar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function aguardarBancoDisponivel(db, options = {}) {
  const {
    logger = console,
    maxTentativas = numeroInteiroPositivo(process.env.MIGRATION_MAX_ATTEMPTS, 3),
    atrasoBaseMs = numeroInteiroNaoNegativo(process.env.MIGRATION_RETRY_DELAY_MS, 5000),
    esperar = aguardar
  } = options;

  if (typeof db.raw !== 'function') return;

  const tentativas = numeroInteiroPositivo(maxTentativas, 3);
  const atrasoInicial = numeroInteiroNaoNegativo(atrasoBaseMs, 5000);

  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    try {
      await db.raw('SELECT 1');
      return;
    } catch (error) {
      const transitorio = erroTransitorioDeMigration(error);
      logger.error?.(
        `Banco indisponivel na tentativa ${tentativa}/${tentativas}: ${descreverErro(error)}`
      );

      if (!transitorio || tentativa === tentativas) {
        throw error;
      }

      const atrasoMs = Math.min(atrasoInicial * (2 ** (tentativa - 1)), 30000);
      logger.warn?.(`Falha transitoria detectada. Nova verificacao em ${atrasoMs} ms.`);
      await esperar(atrasoMs);
    }
  }
}

async function executarMigracoesAutomaticas(db, options = {}) {
  const {
    valor = process.env.AUTO_MIGRATE,
    ambiente = process.env.NODE_ENV,
    logger = console,
    maxTentativas = numeroInteiroPositivo(process.env.MIGRATION_MAX_ATTEMPTS, 3),
    atrasoBaseMs = numeroInteiroNaoNegativo(process.env.MIGRATION_RETRY_DELAY_MS, 5000),
    esperar = aguardar
  } = options;

  if (!autoMigrateAtivo(valor, ambiente)) {
    return [];
  }

  await aguardarBancoDisponivel(db, {
    logger,
    maxTentativas,
    atrasoBaseMs,
    esperar
  });

  logger.info('Banco disponivel. Verificando migrations pendentes...');

  try {
    const [, migrations] = await db.migrate.latest();

    if (migrations.length === 0) {
      logger.info('Banco de dados sem migrations pendentes.');
    } else {
      logger.info(`Migrations executadas: ${migrations.join(', ')}`);
    }

    return migrations;
  } catch (error) {
    logger.error?.(`Falha ao executar migrations: ${descreverErro(error)}`);
    logger.error?.('A migration nao sera repetida automaticamente e a nova instancia nao sera iniciada.');
    throw error;
  }
}

function abrirServidor(app, port, logger = console) {
  return new Promise((resolve, reject) => {
    let server;

    const aoFalhar = error => {
      reject(error);
    };

    server = app.listen(port, () => {
      server.removeListener('error', aoFalhar);
      logger.info(`Servidor rodando em http://localhost:${port}`);
      resolve(server);
    });

    server.once('error', aoFalhar);
    server.requestTimeout = 30 * 60 * 1000;
    server.headersTimeout = 31 * 60 * 1000;
  });
}

async function iniciarAplicacao(options) {
  const {
    app,
    db,
    port,
    iniciarAgendamentos,
    logger = console,
    autoMigrate = process.env.AUTO_MIGRATE,
    ambiente = process.env.NODE_ENV
  } = options;

  await executarMigracoesAutomaticas(db, {
    valor: autoMigrate,
    ambiente,
    logger
  });

  const server = await abrirServidor(app, port, logger);
  iniciarAgendamentos();

  return server;
}

module.exports = {
  autoMigrateAtivo,
  erroTransitorioDeMigration,
  aguardarBancoDisponivel,
  executarMigracoesAutomaticas,
  abrirServidor,
  iniciarAplicacao
};
