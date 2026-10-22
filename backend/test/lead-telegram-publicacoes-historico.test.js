const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../src/services/lead-telegram-publicacao.service');

function banco(seed = {}) {
  const tabelas = { lead_linhas: [{ id: 1 }], lead_atribuicoes: [
    { id: 10, lead_linha_id: 1, etapa: 'sondagem', atribuido_em: '2025-01-01T12:00:00Z' }
  ], lead_telegram_publicacoes: [], lead_telegram_republicacoes: [], ...seed };
  let fila = Promise.resolve();
  let travas = 0;
  function consulta(tabela) {
    const filtros = [];
    const ordens = [];
    let insercao, conflito, mescla;
    const query = {
      where(chave, valor) {
        filtros.push(typeof chave === 'object'
          ? item => Object.entries(chave).every(([k, v]) => item[k] === v)
          : item => item[chave] === valor);
        return query;
      },
      whereNotNull(chave) { filtros.push(item => item[chave] != null); return query; },
      async select(...campos) {
        return tabelas[tabela].filter(item => filtros.every(filtro => filtro(item)))
          .map(item => Object.fromEntries(campos.map(campo => [campo, item[campo]])));
      },
      forUpdate() { travas++; return query; },
      orderBy(chave, ordem) { ordens.push([chave, ordem]); return query; },
      async first() {
        const lista = tabelas[tabela].filter(item => filtros.every(filtro => filtro(item)));
        lista.sort((a, b) => {
          for (const [k, ordem] of ordens) {
            if (a[k] !== b[k]) return (a[k] < b[k] ? -1 : 1) * (ordem === 'desc' ? -1 : 1);
          }
          return 0;
        });
        return lista[0];
      },
      insert(valor) { insercao = valor; return query; },
      onConflict(chave) { conflito = chave; return query; },
      merge(valor) { mescla = valor; return query; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          const anterior = conflito && tabelas[tabela].find(item => item[conflito] === insercao[conflito]);
          if (anterior) Object.assign(anterior, mescla);
          else tabelas[tabela].push({ id: tabelas[tabela].length + 1, ...insercao });
        }).then(resolve, reject);
      }
    };
    return query;
  }
  const trx = Object.assign(consulta, { isTransaction: true });
  const db = tabela => consulta(tabela);
  db.transaction = trabalho => {
    const resultado = fila.then(() => trabalho(trx));
    fila = resultado.catch(() => {});
    return resultado;
  };
  return { db, tabelas, travas: () => travas };
}
function publicacao(id, extra = {}) {
  return { enviado: true, telegram_chat_id: 'grupo-teste', message_id: id, ...extra };
}

test('resumo identifica ausência de confirmação sem usar o destino ou a fila de tentativas', async () => {
  const { db } = banco({
    lead_linhas: [{ id: 1, futuro_cliente_destino: 'distribuicao' }],
    lead_telegram_republicacoes: [{ lead_linha_id: 1, status: 'falhou' }],
    lead_telegram_publicacoes: [{ lead_linha_id: 2, tipo: 'legado' }]
  });
  assert.deepEqual(await service.obterResumoEnvio(1, db), {
    situacao: 'sem_confirmacao', ultimo_envio_em: null
  });
});

test('resumo conserva o primeiro envio após devolução e usa a última republicação confirmada', async () => {
  const { db, tabelas } = banco();
  await service.registrar(1, publicacao(100), db);
  const primeira = await service.obterResumoEnvio(1, db);
  assert.equal(primeira.situacao, 'enviado');
  assert.equal(primeira.ultimo_envio_em, tabelas.lead_telegram_publicacoes[0].publicado_em.toISOString());
  for (const aceite_status of ['recusado', 'expirado_sem_aceite', 'expirado_sem_acao']) {
    tabelas.lead_atribuicoes.push({ lead_linha_id: 1, etapa: 'venda', aceite_status });
    assert.deepEqual(await service.obterResumoEnvio(1, db), primeira);
  }
  tabelas.lead_telegram_publicacoes.push(
    { lead_linha_id: 1, tipo: 'republicacao', telegram_chat_id: 'teste', telegram_message_id: '102', publicado_em: '2030-02-10 15:00:00' },
    { lead_linha_id: 1, tipo: 'republicacao', telegram_chat_id: 'teste', telegram_message_id: '101', publicado_em: '2030-02-09 15:00:00' },
    { lead_linha_id: 1, tipo: 'legado', publicado_em: '2031-02-10 15:00:00' }
  );
  assert.deepEqual(await service.obterResumoEnvio(1, db), {
    situacao: 'enviado', ultimo_envio_em: '2030-02-10T15:00:00.000Z'
  });
});

test('resumo reconhece publicação legada com comprovação e normaliza o fuso para UTC', async () => {
  const { db } = banco({ lead_telegram_publicacoes: [{
    lead_linha_id: 1, tipo: 'legado', telegram_chat_id: 'teste', telegram_message_id: '100',
    publicado_em: '2026-08-20T12:30:00-03:00'
  }] });
  assert.deepEqual(await service.obterResumoEnvio(1, db), {
    situacao: 'enviado', ultimo_envio_em: '2026-08-20T15:30:00.000Z'
  });
});

test('resumo não inventa confirmação quando falta data válida ou identificação da mensagem', async () => {
  for (const extra of [
    { publicado_em: null }, { publicado_em: 'inválida' }, { publicado_em: '0000-00-00 00:00:00' },
    { telegram_chat_id: null }, { telegram_message_id: null }, { telegram_chat_id: ' ' }
  ]) {
    const { db } = banco({ lead_telegram_publicacoes: [{
      lead_linha_id: 1, tipo: 'legado', telegram_chat_id: 'teste', telegram_message_id: '100',
      publicado_em: '2026-08-20 15:30:00', ...extra
    }] });
    assert.deepEqual(await service.obterResumoEnvio(1, db), {
      situacao: 'historico_incompleto', ultimo_envio_em: null
    });
  }
});

test('persistência serializa o lead, deduplica confirmação e preserva a primeira data', async () => {
  const { db, tabelas, travas } = banco();
  assert.deepEqual(await Promise.all([service.registrar(1, publicacao(100), db),
    service.registrar(1, publicacao(100), db)]), [true, true]);
  assert.equal(tabelas.lead_telegram_publicacoes.length, 1);
  const primeira = tabelas.lead_telegram_publicacoes[0];
  assert.equal(primeira.tipo, 'primeiro_envio');
  assert.equal(primeira.atribuicao_sondagem_id, 10);
  const dataInicial = primeira.publicado_em;
  await service.registrar(1, publicacao(101), db);
  await service.registrar(1, publicacao(100), db);
  assert.equal(tabelas.lead_telegram_publicacoes.length, 2);
  assert.equal(tabelas.lead_telegram_publicacoes[1].tipo, 'republicacao');
  assert.equal(primeira.publicado_em, dataInicial);
  assert.equal(tabelas.lead_telegram_republicacoes[0].telegram_message_id, '101');
  assert.equal(travas(), 4);
});

test('retorno automático, manual e histórico legado nunca são classificados como novos', async () => {
  const cenarios = [
    { lead_atribuicoes: [{ id: 20, lead_linha_id: 1, etapa: 'venda', aceite_status: 'expirado_sem_acao', finalizado_em: '2025-02-10T12:00:00Z' }] },
    { lead_telegram_publicacoes: [{ id: 1, lead_linha_id: 1, tipo: 'legado', publicado_em: null }] }
  ];
  for (const seed of cenarios) {
    const { db, tabelas } = banco(seed);
    await service.registrar(1, publicacao(100), db);
    assert.equal(tabelas.lead_telegram_publicacoes.at(-1).tipo, 'republicacao');
  }
  const { db, tabelas } = banco();
  await service.registrar(1, publicacao(100, { contexto_publicacao_telegram: { tipo: 'retorno' } }), db);
  assert.equal(tabelas.lead_telegram_publicacoes[0].tipo, 'republicacao');
});

test('falha inicial não gera publicação; sucesso posterior conta na data da confirmação', async t => {
  const { db, tabelas } = banco({ lead_telegram_republicacoes: [
    { id: 1, lead_linha_id: 1, status: 'falhou', created_at: new Date('2025-01-01T12:00:00Z') }
  ] });
  t.mock.method(console, 'error', () => {});
  let sucesso = false;
  const opcoes = {
    validarLinha: async () => true, reconciliacaoPendente: async () => false,
    carregarLinha: async () => ({ id: 1 }),
    enviar: async () => sucesso ? publicacao(100) : { enviado: false, motivo: 'indisponível' },
    marcarFalha: async () => {},
    registrar: (id, dados) => service.registrar(id, dados, db)
  };
  const item = { id: 1, lead_linha_id: 1, tentativas: 1 };
  const falha = await service._internals.processarItem(item, opcoes);
  assert.equal(falha.falhou, true);
  assert.equal(tabelas.lead_telegram_publicacoes.length, 0);
  const inicio = new Date();
  sucesso = true;
  const resultado = await service._internals.processarItem(item, opcoes);
  assert.equal(resultado.publicado, true);
  assert.equal(tabelas.lead_telegram_publicacoes[0].tipo, 'primeiro_envio');
  assert.ok(tabelas.lead_telegram_publicacoes[0].publicado_em >= inicio);
});

test('sem identificação completa não há registro de envio confirmado', async () => {
  const { db, tabelas } = banco();
  assert.equal(await service.registrar(1, { message_id: 1 }, db), false);
  assert.equal(await service.registrar(1, { telegram_chat_id: 'teste' }, db), false);
  assert.equal(tabelas.lead_telegram_publicacoes.length, 0);
});

test('migration cria unicidade da mensagem e recupera legado sem inferir primeiro envio', async () => {
  const knex = require('knex')({ client: 'mysql2' });
  const migration = require('../src/database/migrations/20261016120000_create_lead_telegram_publicacoes');
  const sqls = [];
  const fake = {};
  fake.raw = async (sql, bindings) => { sqls.push(knex.raw(sql, bindings).toSQL()); };
  fake.fn = knex.fn;
  fake.schema = {
    createTable: async (nome, definir) => sqls.push(...knex.schema.createTable(nome, definir).toSQL()),
    dropTableIfExists: async nome => sqls.push(...knex.schema.dropTableIfExists(nome).toSQL())
  };
  await migration.up(fake);
  const ddl = sqls.map(item => item.sql).join('\n');
  assert.match(ddl, /unique .*\(`telegram_chat_id`, `telegram_message_id`\)/);
  assert.match(ddl, /atribuicao_sondagem_id/);
  assert.equal(sqls.filter(item => item.bindings?.includes('legado')).length, 2);
  assert.ok(!sqls.some(item => item.bindings?.includes('primeiro_envio')));
  const inserts = sqls.filter(item => item.sql.includes('INSERT INTO lead_telegram_publicacoes'));
  assert.match(inserts[0].sql, /\(\s*lead_linha_id, tipo, telegram_chat_id, telegram_message_id, publicado_em, created_at\s*\)/);
  assert.match(inserts[1].sql, /\(lead_linha_id, tipo\)/);
  await migration.down(fake);
  assert.match(sqls.at(-1).sql, /drop table if exists `lead_telegram_publicacoes`/);
  await knex.destroy();
});
