const test = require('node:test');
const assert = require('node:assert/strict');
const migration = require('../src/database/migrations/20260909120000_create_funil_automacoes');

function criarKnex() {
  const tabelas = new Set(['vendas', 'usuarios', 'roles', 'permissoes', 'automacao_emails']);
  const dados = {
    vendas: [{
      id: 7, status_funil: 'entrega', prioridade_funil: 'alta', cancelada_em: '2026-09-01 10:00:00',
      motivo_cancelamento: 'Cancelada antes do corte', ultima_atividade_em: '2026-09-01 09:00:00',
      enviada_pos_venda_em: '2026-08-01', excluido_em: null
    }, {
      id: 8, status_funil: 'aceite', prioridade_funil: 'media', enviada_pos_venda_em: null, excluido_em: null
    }, {
      id: 9, status_funil: 'aprovacao', prioridade_funil: 'baixa', enviada_pos_venda_em: '2026-08-02', excluido_em: '2026-09-02'
    }],
    usuarios: [{ id: 1, permissoes: '{}' }],
    roles: [{ id: 1, permissoes: '{}' }],
    permissoes: [],
    venda_funil_automacoes: [],
    venda_funil_automacao_historicos: []
  };
  const coluna = () => ({ unsigned() { return this; }, primary() { return this; }, nullable() { return this; }, notNullable() { return this; }, defaultTo() { return this; }, references() { return this; }, inTable() { return this; }, onDelete() { return this; } });
  const table = new Proxy({}, { get: (_, nome) => ['foreign', 'index'].includes(nome) ? () => coluna() : () => coluna() });

  function knex(nome) {
    let filtros = {};
    const predicados = [];
    const filtrar = () => (dados[nome] || []).filter(item => (
      Object.entries(filtros).every(([chave, valor]) => item[chave] === valor)
      && predicados.every(predicado => predicado(item))
    ));
    const query = {
      select() { return this; },
      where(campo) { if (typeof campo === 'object') filtros = { ...filtros, ...campo }; return this; },
      whereNull(campo) { predicados.push(item => item[campo] == null); return this; },
      whereNotNull(campo) { predicados.push(item => item[campo] != null); return this; },
      first() { return Promise.resolve(filtrar()[0]); },
      then(resolve, reject) { return Promise.resolve(filtrar()).then(resolve, reject); },
      async insert(valor) { (dados[nome] ||= []).push(valor); return valor; },
      async update(valor) { const item = (dados[nome] || []).find(registro => Object.entries(filtros).every(([chave, esperado]) => registro[chave] === esperado)); if (item) Object.assign(item, valor); return item ? 1 : 0; },
      async delete() { dados[nome] = (dados[nome] || []).filter(registro => !Object.entries(filtros).every(([chave, esperado]) => registro[chave] === esperado)); }
    };
    return query;
  }
  knex.schema = {
    hasTable: async nome => tabelas.has(nome),
    createTable: async (nome, callback) => { tabelas.add(nome); dados[nome] ||= []; callback(table); },
    dropTableIfExists: async nome => { tabelas.delete(nome); delete dados[nome]; }
  };
  knex.fn = { now: () => new Date('2026-09-09T12:00:00Z') };
  knex.batchInsert = async (nome, linhas) => { dados[nome].push(...linhas); };
  return { knex, tabelas, dados };
}

test('migration cria fotografia independente sem conceder a permissao', async () => {
  const contexto = criarKnex();
  await migration.up(contexto.knex);

  assert.equal(contexto.tabelas.has('venda_funil_automacoes'), true);
  assert.equal(contexto.tabelas.has('venda_funil_automacao_historicos'), true);
  assert.deepEqual(contexto.dados.venda_funil_automacoes.map(item => ({
    venda_id: item.venda_id,
    status_funil: item.status_funil,
    prioridade_funil: item.prioridade_funil,
    cancelada_em: item.cancelada_em,
    ultima_atividade_em: item.ultima_atividade_em
  })), [{
    venda_id: 7,
    status_funil: 'entrega',
    prioridade_funil: 'alta',
    cancelada_em: '2026-09-01 10:00:00',
    ultima_atividade_em: '2026-09-01 09:00:00'
  }]);
  assert.equal(contexto.dados.permissoes[0].chave, 'funil_automacoes');
  assert.equal(contexto.dados.usuarios[0].permissoes, '{}');
  assert.equal(contexto.dados.roles[0].permissoes, '{}');
});

test('rollback remove estruturas e limpa a chave explicitamente atribuida', async () => {
  const contexto = criarKnex();
  contexto.dados.usuarios[0].permissoes = JSON.stringify({ funil_automacoes: true, vendas: true });
  await migration.up(contexto.knex);
  await migration.down(contexto.knex);

  assert.equal(contexto.tabelas.has('venda_funil_automacoes'), false);
  assert.equal(contexto.tabelas.has('venda_funil_automacao_historicos'), false);
  assert.deepEqual(JSON.parse(contexto.dados.usuarios[0].permissoes), { vendas: true });
  assert.equal(contexto.dados.permissoes.length, 0);
});
