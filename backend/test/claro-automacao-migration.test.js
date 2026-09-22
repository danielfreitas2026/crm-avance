const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const migration = require('../src/database/migrations/20260922120000_add_claro_imap_automacao');

function criarKnex() {
  const colunas = new Map([
    ['automacao_emails', new Set(['id', 'gmail_message_id'])],
    ['automacao_email_estado', new Set(['id', 'estado'])],
    ['venda_funil_automacoes', new Set(['venda_id', 'status_funil'])]
  ]);
  const dados = {
    automacao_emails: [{ id: 1, gmail_message_id: 'gmail-1' }],
    automacao_email_estado: [{ id: 1, estado: 'aguardando' }],
    venda_funil_automacoes: [{ venda_id: 10, status_funil: 'aceite' }]
  };
  let tabelaAtual;
  const cadeia = () => ({ unsigned() { return this; }, notNullable() { return this; }, nullable() { return this; }, defaultTo() { return this; }, index() { return this; }, unique() { return this; } });
  const table = new Proxy({}, {
    get(_, metodo) {
      if (metodo === 'dropColumn') return nome => colunas.get(tabelaAtual).delete(nome);
      if (metodo === 'dropUnique') return () => {};
      return nome => { colunas.get(tabelaAtual).add(nome); return cadeia(); };
    }
  });
  function knex(nome) {
    let filtro = {};
    const query = {
      where(valor) { filtro = valor; return this; },
      async update(patch) {
        let total = 0;
        for (const item of dados[nome].filter(registro => Object.entries(filtro).every(([chave, valor]) => registro[chave] === valor))) {
          for (const [chave, valor] of Object.entries(patch)) item[chave] = valor?.__ref ? item[valor.__ref] : valor;
          total += 1;
        }
        return total;
      },
      insert(valor) { this.valor = valor; return this; },
      onConflict() { return this; },
      async ignore() {
        if (!dados[nome].some(item => item.id === this.valor.id)) dados[nome].push(this.valor);
        return this.valor;
      },
      async delete() {
        dados[nome] = dados[nome].filter(registro => !Object.entries(filtro).every(([chave, valor]) => registro[chave] === valor));
      }
    };
    return query;
  }
  knex.schema = {
    hasColumn: async (tabela, coluna) => colunas.get(tabela).has(coluna),
    alterTable: async (tabela, callback) => { tabelaAtual = tabela; callback(table); tabelaAtual = null; }
  };
  knex.ref = coluna => ({ __ref: coluna });
  knex.raw = async () => {
    for (const item of dados.automacao_emails) {
      if (!item.chave_deduplicacao) item.chave_deduplicacao = crypto.createHash('sha256').update(`gmail_vivo:${item.gmail_message_id}`).digest('hex');
    }
  };
  return { knex, colunas, dados };
}

test('migration generaliza registros Vivo, cria estado Claro e marcadores comparativos', async () => {
  const contexto = criarKnex();
  await migration.up(contexto.knex);
  await migration.up(contexto.knex);

  assert.equal(contexto.dados.automacao_emails[0].origem, 'gmail_vivo');
  assert.equal(contexto.dados.automacao_emails[0].operadora, 'Vivo');
  assert.equal(contexto.dados.automacao_emails[0].identificador_remoto, 'gmail-1');
  assert.equal(contexto.dados.automacao_emails[0].chave_deduplicacao.length, 64);
  assert.deepEqual(contexto.dados.automacao_email_estado.map(item => [item.id, item.origem]), [[1, 'gmail_vivo'], [2, 'imap_claro']]);
  assert.equal(contexto.colunas.get('venda_funil_automacoes').has('aceite_concluido_auto'), true);
  assert.equal(contexto.colunas.get('venda_funil_automacoes').has('biometria_concluida_auto'), true);
});

test('rollback remove apenas as estruturas adicionadas pela integração Claro', async () => {
  const contexto = criarKnex();
  await migration.up(contexto.knex);
  await migration.down(contexto.knex);
  assert.deepEqual([...contexto.colunas.get('automacao_emails')].sort(), ['gmail_message_id', 'id']);
  assert.deepEqual([...contexto.colunas.get('automacao_email_estado')].sort(), ['estado', 'id']);
  assert.deepEqual([...contexto.colunas.get('venda_funil_automacoes')].sort(), ['status_funil', 'venda_id']);
  assert.deepEqual(contexto.dados.automacao_email_estado.map(item => item.id), [1]);
});
