/**
 * Amplia campanhas com filtros, multiplas operadoras e participantes.
 * @param { import("knex").Knex } knex
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('campanhas', table => {
    table.decimal('target', 14, 2).notNullable().alter();
    table.string('publico_base', 12).notNullable().defaultTo('ambos').after('categoria');
    table.string('categoria_personalizada', 120).nullable().after('publico_base');
  });

  await knex.schema.createTable('campanha_operadoras', table => {
    table.integer('campanha_id').unsigned().notNullable().references('id').inTable('campanhas').onDelete('CASCADE');
    table.integer('operadora_id').unsigned().notNullable().references('id').inTable('operadoras').onDelete('CASCADE');
    table.unique(['campanha_id', 'operadora_id']);
  });

  await knex.schema.createTable('campanha_participantes', table => {
    table.integer('campanha_id').unsigned().notNullable().references('id').inTable('campanhas').onDelete('CASCADE');
    table.integer('usuario_id').unsigned().notNullable().references('id').inTable('usuarios').onDelete('CASCADE');
    table.unique(['campanha_id', 'usuario_id']);
    table.index(['usuario_id']);
  });

  await knex.schema.alterTable('vendas', table => {
    table.string('categoria_campanha', 120).nullable().after('cliente_da_base');
    table.index(['categoria_campanha']);
  });

  const legadas = await knex('campanhas').whereNotNull('operadora_id').select('id', 'operadora_id');
  if (legadas.length) {
    await knex('campanha_operadoras').insert(legadas.map(c => ({ campanha_id: c.id, operadora_id: c.operadora_id })));
  }
};

exports.down = async function(knex) {
  await knex.schema.alterTable('vendas', table => {
    table.dropIndex(['categoria_campanha']);
    table.dropColumn('categoria_campanha');
  });
  await knex.schema.dropTableIfExists('campanha_participantes');
  await knex.schema.dropTableIfExists('campanha_operadoras');
  await knex.schema.alterTable('campanhas', table => {
    table.integer('target').notNullable().alter();
    table.dropColumn('categoria_personalizada');
    table.dropColumn('publico_base');
  });
};
