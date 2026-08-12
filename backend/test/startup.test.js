const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const {
  autoMigrateAtivo,
  erroTransitorioDeMigration,
  aguardarBancoDisponivel,
  executarMigracoesAutomaticas,
  iniciarAplicacao
} = require('../src/startup');

function criarAppFake(eventos) {
  const server = new EventEmitter();

  return {
    server,
    app: {
      listen: (port, callback) => {
        eventos.push(`listen:${port}`);
        setImmediate(callback);
        return server;
      }
    }
  };
}

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {}
};

test('AUTO_MIGRATE respeita configuracao explicita e ativa por padrao em producao', () => {
  assert.equal(autoMigrateAtivo('true'), true);
  assert.equal(autoMigrateAtivo(' TRUE '), true);
  assert.equal(autoMigrateAtivo('false'), false);
  assert.equal(autoMigrateAtivo(undefined, 'production'), true);
  assert.equal(autoMigrateAtivo(undefined, 'development'), false);
  assert.equal(autoMigrateAtivo(undefined, 'test'), false);
});

test('executa migration, abre a API e depois inicia os agendamentos', async () => {
  const eventos = [];
  const { app, server } = criarAppFake(eventos);
  const db = {
    migrate: {
      latest: async () => {
        eventos.push('migrate');
        return [1, ['001_migration.js']];
      }
    }
  };

  const resultado = await iniciarAplicacao({
    app,
    db,
    port: 3000,
    iniciarAgendamentos: () => eventos.push('agendamentos'),
    logger,
    autoMigrate: 'true'
  });

  assert.equal(resultado, server);
  assert.deepEqual(eventos, ['migrate', 'listen:3000', 'agendamentos']);
  assert.equal(server.requestTimeout, 30 * 60 * 1000);
  assert.equal(server.headersTimeout, 31 * 60 * 1000);
});

test('classifica apenas erros conhecidos de conexao e lock como transitorios', () => {
  assert.equal(erroTransitorioDeMigration({ code: 'ECONNRESET' }), true);
  assert.equal(erroTransitorioDeMigration({ code: 'ER_LOCK_WAIT_TIMEOUT' }), true);
  assert.equal(erroTransitorioDeMigration({ code: 'ER_PARSE_ERROR' }), false);
  assert.equal(erroTransitorioDeMigration(new Error('migration invalida')), false);
});

test('repete a verificacao do banco antes da migration e aplica espera crescente', async () => {
  let chamadas = 0;
  const atrasos = [];
  const db = {
    raw: async () => {
      chamadas += 1;
      if (chamadas < 3) {
        const erro = new Error('conexao temporariamente indisponivel');
        erro.code = 'ECONNRESET';
        throw erro;
      }
    }
  };

  await aguardarBancoDisponivel(db, {
    logger,
    maxTentativas: 3,
    atrasoBaseMs: 100,
    esperar: async atraso => atrasos.push(atraso)
  });

  assert.equal(chamadas, 3);
  assert.deepEqual(atrasos, [100, 200]);
});

test('nao repete erro permanente na verificacao do banco', async () => {
  let chamadas = 0;
  const erro = Object.assign(new Error('credenciais invalidas'), { code: 'ER_ACCESS_DENIED_ERROR' });
  const db = {
    raw: async () => {
      chamadas += 1;
      throw erro;
    }
  };

  await assert.rejects(
    aguardarBancoDisponivel(db, {
      logger,
      maxTentativas: 3,
      atrasoBaseMs: 0,
      esperar: async () => {}
    }),
    erro
  );
  assert.equal(chamadas, 1);
});

test('interrompe depois de esgotar as verificacoes de falha transitoria', async () => {
  let chamadas = 0;
  const erro = Object.assign(new Error('lock temporario'), { code: 'ER_LOCK_DEADLOCK' });
  const db = {
    raw: async () => {
      chamadas += 1;
      throw erro;
    }
  };

  await assert.rejects(
    aguardarBancoDisponivel(db, {
      logger,
      maxTentativas: 3,
      atrasoBaseMs: 0,
      esperar: async () => {}
    }),
    erro
  );
  assert.equal(chamadas, 3);
});

test('nao repete migration que falha depois de iniciada', async () => {
  let chamadas = 0;
  const erro = Object.assign(new Error('conexao perdida durante DDL'), { code: 'ECONNRESET' });
  const db = {
    raw: async () => {},
    migrate: {
      latest: async () => {
        chamadas += 1;
        throw erro;
      }
    }
  };

  await assert.rejects(
    executarMigracoesAutomaticas(db, {
      valor: 'true',
      logger,
      maxTentativas: 3,
      atrasoBaseMs: 0,
      esperar: async () => {}
    }),
    erro
  );
  assert.equal(chamadas, 1);
});

test('executa migration automaticamente em producao sem exigir AUTO_MIGRATE', async () => {
  const eventos = [];
  const { app } = criarAppFake(eventos);
  const db = { migrate: { latest: async () => { eventos.push('migrate'); return [1, []]; } } };

  await iniciarAplicacao({
    app,
    db,
    port: 3000,
    iniciarAgendamentos: () => eventos.push('agendamentos'),
    logger,
    autoMigrate: undefined,
    ambiente: 'production'
  });

  assert.deepEqual(eventos, ['migrate', 'listen:3000', 'agendamentos']);
});

test('mantem a inicializacao normal quando AUTO_MIGRATE esta desativado', async () => {
  const eventos = [];
  const { app } = criarAppFake(eventos);
  const db = {
    migrate: {
      latest: async () => {
        throw new Error('nao deveria executar');
      }
    }
  };

  await iniciarAplicacao({
    app,
    db,
    port: 3000,
    iniciarAgendamentos: () => eventos.push('agendamentos'),
    logger,
    autoMigrate: 'false',
    ambiente: 'production'
  });

  assert.deepEqual(eventos, ['listen:3000', 'agendamentos']);
});

test('nao abre a API nem inicia agendamentos se a migration falhar', async () => {
  const eventos = [];
  const { app } = criarAppFake(eventos);
  const erro = new Error('migration invalida');
  const db = {
    migrate: {
      latest: async () => {
        eventos.push('migrate');
        throw erro;
      }
    }
  };

  await assert.rejects(
    iniciarAplicacao({
      app,
      db,
      port: 3000,
      iniciarAgendamentos: () => eventos.push('agendamentos'),
      logger,
      autoMigrate: 'true'
    }),
    erro
  );

  assert.deepEqual(eventos, ['migrate']);
});
