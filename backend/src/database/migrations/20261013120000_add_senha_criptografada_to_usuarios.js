exports.up = function (knex) {
  return knex.schema.alterTable('usuarios', table => {
    table.text('senha_criptografada').nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('usuarios', table => {
    table.dropColumn('senha_criptografada');
  });
};
