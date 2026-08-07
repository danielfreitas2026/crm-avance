/**
 * Fila e resultado do enriquecimento automatico de contatos do mailing.
 *
 * Cada linha do mailing dividida para sondagem gera um registro nesta tabela
 * (status "pendente"). Um worker em background consulta o Google Places,
 * calcula a confiabilidade (fuzzy) e grava aqui o telefone/site encontrado,
 * a % de confianca e se uma busca extra (Apify) seria recomendada.
 *
 * A unicidade por lead_linha_id garante idempotencia: dividir a mesma linha de
 * novo nao reprocessa nem gera custo duplicado de API.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('lead_enriquecimento', table => {
    table.increments('id').primary();
    table.integer('lead_linha_id').unsigned().notNullable()
      .references('id').inTable('lead_linhas').onUpdate('CASCADE').onDelete('CASCADE');
    table.enu('status', ['pendente', 'processando', 'concluido', 'sem_resultado', 'erro'])
      .notNullable().defaultTo('pendente');

    table.decimal('confianca', 4, 3).nullable();
    table.integer('confianca_pct').nullable();
    table.string('confianca_nivel', 10).nullable();

    table.string('telefone', 20).nullable();
    table.string('site', 255).nullable();
    table.string('nome_encontrado', 255).nullable();
    table.string('endereco', 255).nullable();

    table.boolean('recomenda_apify').notNullable().defaultTo(false);
    table.string('apify_motivo', 255).nullable();

    table.text('contatos_json').nullable();
    table.string('fonte', 40).nullable();
    table.string('query_google', 255).nullable();
    table.string('erro', 255).nullable();
    table.integer('tentativas').notNullable().defaultTo(0);
    table.timestamp('processado_em').nullable();
    table.timestamps(true, true);

    table.unique(['lead_linha_id']);
    table.index(['status'], 'lead_enriquecimento_status_idx');
    table.index(['status', 'id'], 'lead_enriquecimento_status_id_idx');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('lead_enriquecimento');
};
