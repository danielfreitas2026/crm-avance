async function existeIndice(knex, nome) {
  const [linhas] = await knex.raw(
    'SELECT 1 FROM information_schema.statistics WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1',
    ['venda_historicos', nome]
  );
  return linhas.length > 0;
}

async function existeChaveEstrangeira(knex, coluna) {
  const [linhas] = await knex.raw(
    'SELECT 1 FROM information_schema.key_column_usage WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL LIMIT 1',
    ['venda_historicos', coluna]
  );
  return linhas.length > 0;
}

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

  if (!await existeChaveEstrangeira(knex, 'invalidated_by_id')) {
    await knex.schema.alterTable('venda_historicos', table => {
      table.foreign('invalidated_by_id').references('id').inTable('usuarios').onDelete('SET NULL');
    });
  }
  if (!await existeChaveEstrangeira(knex, 'correction_automation_id')) {
    await knex.schema.alterTable('venda_historicos', table => {
      table.foreign('correction_automation_id').references('id').inTable('automacao_emails').onDelete('SET NULL');
    });
  }
  if (!await existeIndice(knex, 'idx_venda_historicos_invalidated_venda')) {
    await knex.schema.alterTable('venda_historicos', table => {
      table.index(['invalidated_at', 'venda_id'], 'idx_venda_historicos_invalidated_venda');
    });
  }
  if (!await existeIndice(knex, 'idx_venda_historicos_correction_automation')) {
    await knex.schema.alterTable('venda_historicos', table => {
      table.index(['correction_automation_id'], 'idx_venda_historicos_correction_automation');
    });
  }
};

exports.down = async function (knex) {
  if (await existeChaveEstrangeira(knex, 'invalidated_by_id')) await knex.schema.alterTable('venda_historicos', table => table.dropForeign('invalidated_by_id'));
  if (await existeChaveEstrangeira(knex, 'correction_automation_id')) await knex.schema.alterTable('venda_historicos', table => table.dropForeign('correction_automation_id'));
  if (await existeIndice(knex, 'idx_venda_historicos_invalidated_venda')) await knex.schema.alterTable('venda_historicos', table => table.dropIndex(['invalidated_at', 'venda_id'], 'idx_venda_historicos_invalidated_venda'));
  if (await existeIndice(knex, 'idx_venda_historicos_correction_automation')) await knex.schema.alterTable('venda_historicos', table => table.dropIndex(['correction_automation_id'], 'idx_venda_historicos_correction_automation'));
  for (const coluna of ['invalidated_at', 'invalidated_by_id', 'invalidation_reason', 'correction_automation_id']) {
    if (await knex.schema.hasColumn('venda_historicos', coluna)) {
      await knex.schema.alterTable('venda_historicos', table => table.dropColumn(coluna));
    }
  }
};
