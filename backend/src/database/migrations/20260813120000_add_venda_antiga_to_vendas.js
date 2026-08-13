exports.up = async function (knex) {
  await knex.schema.alterTable('vendas', table => {
    table.boolean('venda_antiga').notNullable().defaultTo(false).after('data_venda');
  });

  await knex('vendas')
    .where(builder => {
      builder
        .where('origem_importacao', 'controle_vendas_empresas')
        .orWhereRaw(`
          data_venda IS NOT NULL
          AND DATE(data_venda) <> COALESCE(DATE(criado_em), DATE(created_at))
        `);
    })
    .update({ venda_antiga: true });

  await knex('vendas')
    .whereNull('data_venda')
    .update({
      data_venda: knex.raw('COALESCE(DATE(criado_em), DATE(created_at), CURRENT_DATE())')
    });
};

exports.down = function (knex) {
  return knex.schema.alterTable('vendas', table => {
    table.dropColumn('venda_antiga');
  });
};
