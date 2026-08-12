/**
 * Permite incluir vendas especificas no progresso de uma campanha.
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('campanha_vendas_excecoes', table => {
    table.integer('campanha_id').unsigned().notNullable()
      .references('id').inTable('campanhas').onDelete('CASCADE');
    table.integer('venda_id').unsigned().notNullable()
      .references('id').inTable('vendas').onDelete('CASCADE');
    table.unique(['campanha_id', 'venda_id']);
    table.index(['venda_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('campanha_vendas_excecoes');
};
