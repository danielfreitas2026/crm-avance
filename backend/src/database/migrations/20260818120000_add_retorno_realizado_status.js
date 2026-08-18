exports.up = async function (knex) {
  await knex.schema.alterTable('entidade_notas', table => {
    table.datetime('retorno_realizado_em').nullable().after('retorno_agendado_para');
    table.integer('retorno_realizado_por_id').unsigned().nullable()
      .references('id').inTable('usuarios').onUpdate('CASCADE').onDelete('SET NULL')
      .after('retorno_realizado_em');
    table.index(
      ['usuario_id', 'retorno_agendado_para', 'retorno_realizado_em'],
      'entidade_notas_retorno_pendente_idx'
    );
  });

  await knex.schema.alterTable('lead_linhas', table => {
    table.datetime('retorno_agendado_realizado_em').nullable().after('retorno_agendado_por_id');
    table.integer('retorno_agendado_realizado_por_id').unsigned().nullable()
      .references('id').inTable('usuarios').onUpdate('CASCADE').onDelete('SET NULL')
      .after('retorno_agendado_realizado_em');
    table.datetime('futuro_cliente_retorno_realizado_em').nullable().after('futuro_cliente_retorno');
    table.integer('futuro_cliente_retorno_realizado_por_id').unsigned().nullable()
      .references('id').inTable('usuarios').onUpdate('CASCADE').onDelete('SET NULL')
      .after('futuro_cliente_retorno_realizado_em');
    table.index(
      ['retorno_agendado_em', 'retorno_agendado_realizado_em'],
      'lead_linhas_retorno_pendente_idx'
    );
    table.index(
      ['futuro_cliente_retorno', 'futuro_cliente_retorno_realizado_em'],
      'lead_linhas_futuro_retorno_pendente_idx'
    );
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('lead_linhas', table => {
    table.dropIndex(
      ['futuro_cliente_retorno', 'futuro_cliente_retorno_realizado_em'],
      'lead_linhas_futuro_retorno_pendente_idx'
    );
    table.dropIndex(
      ['retorno_agendado_em', 'retorno_agendado_realizado_em'],
      'lead_linhas_retorno_pendente_idx'
    );
    table.dropForeign('futuro_cliente_retorno_realizado_por_id');
    table.dropForeign('retorno_agendado_realizado_por_id');
  });
  await knex.schema.alterTable('lead_linhas', table => {
    table.dropColumn('futuro_cliente_retorno_realizado_por_id');
    table.dropColumn('futuro_cliente_retorno_realizado_em');
    table.dropColumn('retorno_agendado_realizado_por_id');
    table.dropColumn('retorno_agendado_realizado_em');
  });

  await knex.schema.alterTable('entidade_notas', table => {
    table.dropIndex(
      ['usuario_id', 'retorno_agendado_para', 'retorno_realizado_em'],
      'entidade_notas_retorno_pendente_idx'
    );
    table.dropForeign('retorno_realizado_por_id');
  });
  await knex.schema.alterTable('entidade_notas', table => {
    table.dropColumn('retorno_realizado_por_id');
    table.dropColumn('retorno_realizado_em');
  });
};
