const INDEX_NAME = 'idx_venda_historicos_data_efetiva';

exports.up = async function (knex) {
  await knex.schema.alterTable('venda_historicos', table => {
    table.index(['venda_id', 'acao', 'deleted_at', 'created_at'], INDEX_NAME);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('venda_historicos', table => {
    table.dropIndex(['venda_id', 'acao', 'deleted_at', 'created_at'], INDEX_NAME);
  });
};
