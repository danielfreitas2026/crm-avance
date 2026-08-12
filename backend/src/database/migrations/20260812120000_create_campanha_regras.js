/**
 * Adiciona regras combinaveis de elegibilidade por campanha.
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('campanha_regras', table => {
    table.increments('id').primary();
    table.integer('campanha_id').unsigned().notNullable().references('id').inTable('campanhas').onDelete('CASCADE');
    table.integer('operadora_id').unsigned().nullable().references('id').inTable('operadoras').onDelete('CASCADE');
    table.string('publico_base', 12).notNullable().defaultTo('ambos');
    table.string('tipo', 20).notNullable().defaultTo('categoria');
    table.index(['campanha_id']);
    table.index(['operadora_id']);
  });

  const campanhas = await knex('campanhas').select('id', 'operadora_id', 'publico_base', 'categoria');
  const relacoes = await knex('campanha_operadoras').select('campanha_id', 'operadora_id');
  const operadorasPorCampanha = relacoes.reduce((acc, item) => {
    (acc[item.campanha_id] ||= []).push(item.operadora_id);
    return acc;
  }, {});

  const regras = campanhas.flatMap(campanha => {
    const operadoraIds = operadorasPorCampanha[campanha.id] || (campanha.operadora_id ? [campanha.operadora_id] : [null]);
    return operadoraIds.map(operadora_id => ({
      campanha_id: campanha.id,
      operadora_id,
      publico_base: campanha.categoria === 'registro_cliente' ? 'ambos' : (campanha.publico_base || 'ambos'),
      tipo: 'categoria'
    }));
  });

  if (regras.length) await knex('campanha_regras').insert(regras);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('campanha_regras');
};
