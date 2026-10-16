exports.up = async function (knex) {
  // A migration de sincronizacao do Telegram deve estar aplicada integralmente.
  if (!await knex.schema.hasColumn('venda_aprovacao_solicitacoes', 'status_anterior_obsoleta')) {
    throw new Error('Schema de aprovacoes incompleto: verifique a migration 20260921120000_add_telegram_sync_state_to_venda_aprovacoes antes de continuar.');
  }

  await knex.transaction(async trx => {
    const vendasExcluidas = () => trx('vendas').select('id').whereNotNull('excluido_em');

    await trx('venda_aprovacao_solicitacoes')
      .whereIn('venda_id', vendasExcluidas())
      .whereNot('status', 'obsoleta')
      .update({ status_anterior_obsoleta: trx.ref('status') });

    // Updates separados preservam o valor anterior independentemente da ordem
    // de atribuicao das colunas gerada pelo Knex para o MySQL.
    await trx('venda_aprovacao_solicitacoes')
      .whereIn('venda_id', vendasExcluidas())
      .whereNot('status', 'obsoleta')
      .update({ status: 'obsoleta', updated_at: trx.fn.now() });

    await trx('notificacoes')
      .whereIn('source_key', trx('venda_aprovacao_solicitacoes')
        .select(trx.raw("CONCAT('venda_aprovacao:', id)"))
        .whereIn('venda_id', vendasExcluidas()))
      .where('ativa', true)
      .update({ ativa: false, updated_at: trx.fn.now() });
  });
};

exports.down = async function () {
  // Exclusoes nao podem recuperar aprovacoes antigas em um rollback.
};
