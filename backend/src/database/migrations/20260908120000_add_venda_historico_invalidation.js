exports.up = async function (knex) {
  const colunas = [
    ['invalidated_at', table => table.dateTime('invalidated_at').nullable()],
    ['invalidated_by_id', table => table.integer('invalidated_by_id').unsigned().nullable()],
    ['invalidation_reason', table => table.text('invalidation_reason').nullable()],
    ['correction_automation_id', table => table.integer('correction_automation_id').unsigned().nullable()]
  ];

  for (const [nome, adicionar] of colunas) {
    if (!await knex.schema.hasColumn('venda_historicos', nome)) {
      await knex.schema.alterTable('venda_historicos', adicionar);
    }
  }

  await knex.schema.alterTable('venda_historicos', table => {
    table.foreign('invalidated_by_id').references('id').inTable('usuarios').onDelete('SET NULL');
    table.foreign('correction_automation_id').references('id').inTable('automacao_emails').onDelete('SET NULL');
    table.index(['invalidated_at', 'venda_id'], 'idx_venda_historicos_invalidated_venda');
    table.index(['correction_automation_id'], 'idx_venda_historicos_correction_automation');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('venda_historicos', table => {
    table.dropForeign('invalidated_by_id');
    table.dropForeign('correction_automation_id');
    table.dropIndex(['invalidated_at', 'venda_id'], 'idx_venda_historicos_invalidated_venda');
    table.dropIndex(['correction_automation_id'], 'idx_venda_historicos_correction_automation');
    table.dropColumns('invalidated_at', 'invalidated_by_id', 'invalidation_reason', 'correction_automation_id');
  });
};
