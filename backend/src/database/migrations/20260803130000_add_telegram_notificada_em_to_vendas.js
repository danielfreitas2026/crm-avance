exports.up = function (knex) {
  return knex.schema.alterTable('vendas', function (table) {
    table.timestamp('telegram_notificada_em').nullable().index();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('vendas', function (table) {
    table.dropColumn('telegram_notificada_em');
  });
};
