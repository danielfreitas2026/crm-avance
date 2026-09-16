const TABELA = 'automacao_email_estado';

exports.up = async function up(knex) {
  if (!await knex.schema.hasTable(TABELA)) {
    await knex.schema.createTable(TABELA, table => {
      table.integer('id').unsigned().primary();
      table.string('estado', 20).notNullable().defaultTo('aguardando');
      table.string('fase_erro', 20).nullable();
      table.dateTime('ultimo_inicio_em').nullable();
      table.dateTime('ultimo_fim_em').nullable();
      table.dateTime('ultimo_sucesso_em').nullable();
      table.dateTime('ultimo_erro_em').nullable();
      table.text('ultimo_erro').nullable();
      table.integer('falhas_consecutivas').unsigned().notNullable().defaultTo(0);
      table.integer('emails_ultimo_ciclo').unsigned().notNullable().defaultTo(0);
      table.timestamps(true, true);
    });
  }

  if (!await knex(TABELA).where({ id: 1 }).first()) {
    await knex(TABELA).insert({ id: 1, estado: 'aguardando' });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABELA);
};

exports._internals = { TABELA };
