exports.up = async function (knex) {
  const existeTabela = await knex.schema.hasTable('venda_aprovacao_solicitacoes');
  if (!existeTabela) return;

  const colunas = [
    ['telegram_chat_id', table => table.string('telegram_chat_id', 64).nullable()],
    ['telegram_message_id', table => table.string('telegram_message_id', 64).nullable()],
    ['telegram_notificado_em', table => table.timestamp('telegram_notificado_em').nullable()]
  ];

  for (const [nome, adicionar] of colunas) {
    if (!await knex.schema.hasColumn('venda_aprovacao_solicitacoes', nome)) {
      await knex.schema.alterTable('venda_aprovacao_solicitacoes', adicionar);
    }
  }
};

exports.down = async function (knex) {
  const existeTabela = await knex.schema.hasTable('venda_aprovacao_solicitacoes');
  if (!existeTabela) return;

  const colunas = ['telegram_notificado_em', 'telegram_message_id', 'telegram_chat_id'];
  for (const coluna of colunas) {
    if (await knex.schema.hasColumn('venda_aprovacao_solicitacoes', coluna)) {
      await knex.schema.alterTable('venda_aprovacao_solicitacoes', table => table.dropColumn(coluna));
    }
  }
};
