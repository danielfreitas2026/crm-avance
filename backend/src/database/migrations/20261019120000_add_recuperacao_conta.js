exports.up = async function (knex) {
  await knex.schema.alterTable('usuarios', table => {
    table.string('email_recuperacao', 254).nullable();
    table.string('email_recuperacao_pendente', 254).nullable();
    table.timestamp('email_recuperacao_confirmado_em').nullable();
    table.integer('versao_sessao').unsigned().notNullable().defaultTo(0);
  });
  await knex.schema.createTable('recuperacao_conta_tokens', table => {
    table.increments('id').primary();
    table.integer('usuario_id').unsigned().notNullable()
      .references('id').inTable('usuarios').onDelete('CASCADE');
    table.string('finalidade', 20).notNullable();
    table.string('destinatario', 254).notNullable();
    table.string('token_hash', 64).notNullable().unique();
    table.timestamp('expira_em').notNullable();
    table.timestamp('usado_em').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['usuario_id', 'finalidade', 'created_at']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTable('recuperacao_conta_tokens');
  await knex.schema.alterTable('usuarios', table => {
    table.dropColumns('email_recuperacao', 'email_recuperacao_pendente',
      'email_recuperacao_confirmado_em', 'versao_sessao');
  });
};
