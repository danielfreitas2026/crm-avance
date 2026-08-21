exports.up = async function (knex) {
  await knex.schema.createTable('lead_telegram_atualizacoes', table => {
    table.increments('id').primary();
    table.integer('lead_atribuicao_id').unsigned().notNullable()
      .references('id').inTable('lead_atribuicoes').onUpdate('CASCADE').onDelete('CASCADE');
    table.enu('status', ['pendente', 'processando', 'sincronizado', 'falhou'])
      .notNullable().defaultTo('pendente');
    table.integer('tentativas').unsigned().notNullable().defaultTo(0);
    table.timestamp('proxima_tentativa_em').nullable();
    table.text('ultimo_erro').nullable();
    table.timestamp('sincronizado_em').nullable();
    table.timestamps(true, true);
    table.unique(['lead_atribuicao_id']);
    table.index(['status', 'proxima_tentativa_em'], 'idx_lead_telegram_atualizacoes_fila');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('lead_telegram_atualizacoes');
};
