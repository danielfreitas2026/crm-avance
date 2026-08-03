const TABELA = 'telegram_resumo_execucoes';

exports.up = async function up(knex) {
  if (await knex.schema.hasTable(TABELA)) return;
  await knex.schema.createTable(TABELA, table => {
    table.bigIncrements('id').primary();
    table.date('data_referencia').notNullable();
    table.string('tipo', 30).notNullable().defaultTo('diario');
    table.string('status', 30).notNullable().defaultTo('em_andamento');
    table.integer('mensagens').unsigned().nullable();
    table.text('erro').nullable();
    table.timestamp('iniciado_em').nullable();
    table.timestamp('concluido_em').nullable();
    table.timestamps(true, true);
    table.unique(['data_referencia', 'tipo'], 'uq_telegram_resumo_data_tipo');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABELA);
};
