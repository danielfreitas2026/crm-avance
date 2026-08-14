/**
 * Adiciona o filtro de tipo de chip às regras de elegibilidade.
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('campanha_regras', table => {
    table.string('tipo_chip', 20).notNullable().defaultTo('ambos');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('campanha_regras', table => {
    table.dropColumn('tipo_chip');
  });
};
