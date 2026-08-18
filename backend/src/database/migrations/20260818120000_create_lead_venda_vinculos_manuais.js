exports.up = async function (knex) {
  await knex.schema.createTable('lead_venda_vinculos_manuais', table => {
    table.increments('id').primary();
    table.integer('lead_linha_id').unsigned().notNullable()
      .references('id').inTable('lead_linhas').onUpdate('CASCADE').onDelete('CASCADE');
    table.integer('venda_id').unsigned().notNullable()
      .references('id').inTable('vendas').onUpdate('CASCADE').onDelete('CASCADE');
    table.integer('vinculado_por_id').unsigned().nullable()
      .references('id').inTable('usuarios').onUpdate('CASCADE').onDelete('SET NULL');
    table.integer('origem_sondador_id').unsigned().nullable()
      .references('id').inTable('usuarios').onUpdate('CASCADE').onDelete('SET NULL');
    table.string('lead_etapa_anterior', 32).nullable();
    table.string('lead_status_anterior', 32).nullable();
    table.integer('lead_cliente_id_anterior').unsigned().nullable();
    table.integer('lead_venda_id_anterior').unsigned().nullable();
    table.integer('atribuicao_id').unsigned().nullable()
      .references('id').inTable('lead_atribuicoes').onUpdate('CASCADE').onDelete('SET NULL');
    table.string('atribuicao_status_anterior', 32).nullable();
    table.datetime('atribuicao_finalizado_em_anterior').nullable();
    table.datetime('atribuicao_acao_registrada_em_anterior').nullable();
    table.string('atribuicao_acao_registrada_tipo_anterior', 64).nullable();
    table.integer('venda_origem_lead_linha_id_anterior').unsigned().nullable();
    table.integer('venda_origem_sondador_id_anterior').unsigned().nullable();
    table.integer('desvinculado_por_id').unsigned().nullable()
      .references('id').inTable('usuarios').onUpdate('CASCADE').onDelete('SET NULL');
    table.timestamp('vinculado_em').defaultTo(knex.fn.now());
    table.timestamp('desvinculado_em').nullable();
    table.timestamps(true, true);
    table.index(['lead_linha_id', 'desvinculado_em'], 'lead_venda_manual_linha_ativo_idx');
    table.index(['venda_id', 'desvinculado_em'], 'lead_venda_manual_venda_ativo_idx');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('lead_venda_vinculos_manuais');
};
