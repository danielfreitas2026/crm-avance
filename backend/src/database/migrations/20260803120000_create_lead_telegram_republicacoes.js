exports.up = async function (knex) {
  await knex.schema.createTable('lead_telegram_republicacoes', table => {
    table.increments('id').primary();
    table.integer('lead_linha_id').unsigned().notNullable().references('id').inTable('lead_linhas').onUpdate('CASCADE').onDelete('CASCADE');
    table.enu('status', ['processando', 'publicado', 'falhou', 'ignorado']).notNullable().defaultTo('processando');
    table.integer('tentativas').unsigned().notNullable().defaultTo(1);
    table.string('telegram_chat_id', 64).nullable();
    table.string('telegram_message_id', 64).nullable();
    table.timestamp('publicado_em').nullable();
    table.timestamps(true, true);
    table.unique(['lead_linha_id']);
    table.index(['status']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('lead_telegram_republicacoes');
};
