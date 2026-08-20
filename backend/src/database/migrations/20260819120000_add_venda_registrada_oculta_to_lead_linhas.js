/** Permite ocultar apenas o chip de venda registrada em mailing redistribuido. */
exports.up = async function (knex) {
  await knex.schema.alterTable('lead_linhas', table => {
    table.boolean('venda_registrada_oculta').notNullable().defaultTo(false).after('venda_id');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('lead_linhas', table => {
    table.dropColumn('venda_registrada_oculta');
  });
};
