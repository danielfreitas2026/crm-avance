exports.up = function (knex) {
  return knex.schema.alterTable('usuarios', table => {
    table.dropColumn('senha_criptografada');
  });
};

exports.down = function (knex) {
  // O rollback restaura a coluna vazia; as cópias removidas não são recuperáveis.
  return knex.schema.alterTable('usuarios', table => {
    table.text('senha_criptografada').nullable();
  });
};
