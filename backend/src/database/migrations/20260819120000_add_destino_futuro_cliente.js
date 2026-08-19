exports.up = async function up(knex) {
  await knex.schema.table('lead_linhas', table => {
    table.enu('futuro_cliente_destino', ['carteira', 'distribuicao']).nullable().after('futuro_cliente_marcado_por_id');
    table.index(['futuro_cliente_marcado_por_id', 'futuro_cliente_destino'], 'lead_linhas_futuro_destino_idx');
  });
};

exports.down = async function down(knex) {
  await knex.schema.table('lead_linhas', table => {
    table.dropIndex(['futuro_cliente_marcado_por_id', 'futuro_cliente_destino'], 'lead_linhas_futuro_destino_idx');
    table.dropColumn('futuro_cliente_destino');
  });
};
