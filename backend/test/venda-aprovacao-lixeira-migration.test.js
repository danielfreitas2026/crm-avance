const test = require('node:test');
const assert = require('node:assert/strict');
const migration = require('../src/database/migrations/20261015120000_obsoletar_aprovacoes_vendas_na_lixeira');

function preparar() {
  const dados = {
    vendas: [{ id: 7, excluido_em: '2026-10-15' }, { id: 8, excluido_em: null }],
    venda_aprovacao_solicitacoes: [
      ...['pendente', 'aprovada', 'recusada'].map((status, indice) => ({
        id: indice + 1, venda_id: 7, status, decidido_por_id: 9
      })),
      { id: 4, venda_id: 7, status: 'obsoleta', status_anterior_obsoleta: 'aprovada' },
      { id: 5, venda_id: 8, status: 'pendente' },
      { id: 6, venda_id: 8, status: 'aprovada' }
    ],
    notificacoes: [
      ...[1, 2, 3, 4, 5, 6].map(id => ({ id, source_key: `venda_aprovacao:${id}`, ativa: true })),
      { id: 7, source_key: 'outra_notificacao', ativa: true }
    ]
  };
  const contexto = { dados, colunaExiste: true, falharNotificacao: false };

  function knex(tabela) {
    const filtros = [];
    let coluna;
    return {
      select(valor) { coluna = valor; return this; },
      whereNotNull(chave) { filtros.push(item => item[chave] != null); return this; },
      whereNot(chave, valor) { filtros.push(item => item[chave] !== valor); return this; },
      where(chave, valor) { filtros.push(item => item[chave] === valor); return this; },
      whereIn(chave, query) { filtros.push(item => query.valores().includes(item[chave])); return this; },
      linhas() { return dados[tabela].filter(item => filtros.every(filtro => filtro(item))); },
      valores() {
        return this.linhas().map(item => typeof coluna === 'string'
          ? item[coluna] : `venda_aprovacao:${item.id}`);
      },
      async update(payload) {
        if (tabela === 'notificacoes' && contexto.falharNotificacao) throw new Error('Falha na notificacao');
        for (const item of this.linhas()) {
          // Knex ordena as chaves de UPDATE; simula o MySQL atribuindo da esquerda para a direita.
          for (const chave of Object.keys(payload).sort()) {
            const valor = payload[chave];
            item[chave] = valor?.ref ? item[valor.ref] : valor;
          }
        }
      }
    };
  }
  knex.ref = nome => ({ ref: nome });
  knex.raw = sql => ({ sql });
  knex.fn = { now: () => '2026-10-15 12:00:00' };
  knex.schema = { hasColumn: async () => contexto.colunaExiste };
  knex.transaction = async callback => {
    const snapshot = structuredClone(dados);
    try { await callback(knex); }
    catch (error) { Object.assign(dados, snapshot); throw error; }
  };
  return { ...contexto, knex, contexto };
}

test('backfill invalida somente vendas na lixeira e preserva status e decisoes anteriores', async () => {
  const { knex, dados } = preparar();
  const ativasAntes = structuredClone(dados.venda_aprovacao_solicitacoes.slice(4));
  await migration.up(knex);
  const solicitacoes = dados.venda_aprovacao_solicitacoes;
  assert.deepEqual(solicitacoes.slice(0, 4).map(item => item.status), Array(4).fill('obsoleta'));
  assert.deepEqual(solicitacoes.slice(0, 4).map(item => item.status_anterior_obsoleta),
    ['pendente', 'aprovada', 'recusada', 'aprovada']);
  assert.deepEqual(solicitacoes.slice(0, 3).map(item => item.decidido_por_id), [9, 9, 9]);
  assert.deepEqual(solicitacoes.slice(4), ativasAntes);
  assert.deepEqual(dados.notificacoes.map(item => item.ativa), [false, false, false, false, true, true, true]);
  const depois = structuredClone(dados);
  await migration.up(knex);
  await migration.down(knex);
  assert.deepEqual(dados, depois);
});

test('backfill reverte todas as alteracoes quando a desativacao de notificacoes falha', async () => {
  const { knex, dados, contexto } = preparar();
  const antes = structuredClone(dados);
  contexto.falharNotificacao = true;
  await assert.rejects(migration.up(knex), /Falha na notificacao/);
  assert.deepEqual(dados, antes);
});

test('schema incompleto interrompe backfill antes de alterar dados', async () => {
  const { knex, dados, contexto } = preparar();
  const antes = structuredClone(dados);
  contexto.colunaExiste = false;
  await assert.rejects(migration.up(knex), /20260921120000_add_telegram_sync_state/);
  assert.deepEqual(dados, antes);
});
