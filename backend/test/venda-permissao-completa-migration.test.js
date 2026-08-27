const test = require('node:test');
const assert = require('node:assert/strict');

const migration = require('../src/database/migrations/20260827150000_add_vendas_ver_completa_apos_envio_permission');

function criarKnex(estado) {
  let proximoId = 100;

  return function knex(tabela) {
    const filtros = [];
    const registrosFiltrados = () => estado[tabela].filter(registro => (
      filtros.every(([campo, valor]) => registro[campo] === valor)
    ));

    const builder = {
      where(campo, valor) {
        filtros.push([campo, valor]);
        return builder;
      },
      async first() {
        return registrosFiltrados()[0];
      },
      async select() {
        return registrosFiltrados().map(registro => ({ ...registro }));
      },
      async insert(payload) {
        estado[tabela].push({ id: proximoId++, ...payload });
      },
      async update(payload) {
        const encontrados = registrosFiltrados();
        encontrados.forEach(registro => Object.assign(registro, payload));
        return encontrados.length;
      },
      async delete() {
        const encontrados = new Set(registrosFiltrados());
        estado[tabela] = estado[tabela].filter(registro => !encontrados.has(registro));
        return encontrados.size;
      }
    };

    return builder;
  };
}

test('migration adiciona a permissao sem conceder a usuarios e aceita repeticao', async () => {
  const estado = {
    permissoes: [],
    roles: [{ id: 1, permissoes: JSON.stringify({ pos_venda: true }) }],
    usuarios: [{ id: 9, permissoes: { vendas_ver_todas: true } }]
  };
  const knex = criarKnex(estado);

  await migration.up(knex);
  await migration.up(knex);

  assert.equal(estado.permissoes.length, 1);
  assert.deepEqual(estado.permissoes[0], {
    id: 100,
    ...migration._internals.PERMISSAO,
    ativo: true
  });
  assert.deepEqual(JSON.parse(estado.roles[0].permissoes), { pos_venda: true });
  assert.deepEqual(estado.usuarios[0].permissoes, { vendas_ver_todas: true });
});

test('rollback remove somente a nova chave e seu registro', async () => {
  const chave = migration._internals.PERMISSAO.chave;
  const estado = {
    permissoes: [{ id: 4, ...migration._internals.PERMISSAO, ativo: true }],
    roles: [{ id: 1, permissoes: JSON.stringify({ pos_venda: true, [chave]: true }) }],
    usuarios: [{ id: 9, permissoes: { vendas_ver_todas: true, [chave]: false } }]
  };

  await migration.down(criarKnex(estado));

  assert.deepEqual(estado.permissoes, []);
  assert.deepEqual(JSON.parse(estado.roles[0].permissoes), { pos_venda: true });
  assert.deepEqual(JSON.parse(estado.usuarios[0].permissoes), { vendas_ver_todas: true });
});
