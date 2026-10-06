exports.up = async function (knex) {
  await knex.schema.alterTable('campanhas', table => {
    table.string('hora_inicio', 5).nullable();
    table.string('hora_fim', 5).nullable();
  });
  await knex.schema.alterTable('lead_linhas', table => {
    table.dateTime('futuro_cliente_primeiro_registro_em').nullable();
    table.integer('futuro_cliente_primeiro_registro_por_id').unsigned().nullable();
    table.index(['futuro_cliente_primeiro_registro_por_id', 'futuro_cliente_primeiro_registro_em'], 'lead_primeiro_registro_campanha_idx');
  });
  await knex('lead_linhas').whereNotNull('futuro_cliente_marcado_em')
    .where('futuro_cliente_marcado_em', '>', '1970-01-01 00:00:00')
    .update({
      futuro_cliente_primeiro_registro_em: knex.ref('futuro_cliente_marcado_em'),
      futuro_cliente_primeiro_registro_por_id: knex.ref('futuro_cliente_marcado_por_id')
    });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('lead_linhas', table => {
    table.dropIndex([], 'lead_primeiro_registro_campanha_idx');
    table.dropColumn('futuro_cliente_primeiro_registro_em');
    table.dropColumn('futuro_cliente_primeiro_registro_por_id');
  });
  await knex.schema.alterTable('campanhas', table => {
    table.dropColumn('hora_inicio');
    table.dropColumn('hora_fim');
  });
};
