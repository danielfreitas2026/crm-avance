exports.up = async function (knex) {
  await knex.schema.alterTable('venda_aprovacao_solicitacoes', table => {
    table.string('telegram_status_sincronizado', 16).nullable();
    table.timestamp('telegram_sincronizado_em').nullable();
    table.string('telegram_decisor_nome', 255).nullable();
    table.string('status_anterior_obsoleta', 16).nullable();
  });

  await knex('venda_aprovacao_solicitacoes')
    .where('status', 'pendente')
    .whereNotNull('telegram_message_id')
    .update({
      telegram_status_sincronizado: 'pendente',
      telegram_sincronizado_em: knex.raw('COALESCE(telegram_notificado_em, updated_at)')
    });

  await knex('venda_aprovacao_solicitacoes')
    .where('status', 'obsoleta')
    .whereNull('decidido_em')
    .update({ status_anterior_obsoleta: 'pendente' });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('venda_aprovacao_solicitacoes', table => {
    table.dropColumn('status_anterior_obsoleta');
    table.dropColumn('telegram_decisor_nome');
    table.dropColumn('telegram_sincronizado_em');
    table.dropColumn('telegram_status_sincronizado');
  });
};
