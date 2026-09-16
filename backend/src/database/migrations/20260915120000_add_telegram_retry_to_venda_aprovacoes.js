exports.up = async function (knex) {
  await knex.schema.alterTable('venda_aprovacao_solicitacoes', table => {
    table.integer('telegram_tentativas').unsigned().notNullable().defaultTo(0);
    table.timestamp('telegram_proxima_tentativa_em').nullable();
    table.text('telegram_ultimo_erro').nullable();
    table.index(
      ['status', 'telegram_proxima_tentativa_em'],
      'idx_venda_aprovacao_telegram_fila'
    );
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('venda_aprovacao_solicitacoes', table => {
    table.dropIndex(
      ['status', 'telegram_proxima_tentativa_em'],
      'idx_venda_aprovacao_telegram_fila'
    );
    table.dropColumn('telegram_ultimo_erro');
    table.dropColumn('telegram_proxima_tentativa_em');
    table.dropColumn('telegram_tentativas');
  });
};
