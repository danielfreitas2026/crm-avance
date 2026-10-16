exports.up = knex => knex.schema.alterTable('usuarios', table => {
  table.text('senha_criptografada').nullable();
});

exports.down = knex => knex.schema.alterTable('usuarios', table => {
  table.dropColumn('senha_criptografada');
});
