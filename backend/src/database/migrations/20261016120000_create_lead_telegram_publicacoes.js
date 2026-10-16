/** Publicações confirmadas não devem ser sobrescritas pela fila de retentativas. */
exports.up = async function (knex) {
  await knex.schema.createTable('lead_telegram_publicacoes', table => {
    table.increments('id').primary();
    table.integer('lead_linha_id').unsigned().notNullable().references('id').inTable('lead_linhas').onDelete('CASCADE');
    table.integer('atribuicao_sondagem_id').unsigned().nullable().references('id').inTable('lead_atribuicoes').onDelete('SET NULL');
    table.integer('usuario_id').unsigned().nullable().references('id').inTable('usuarios').onDelete('SET NULL');
    table.string('tipo', 24).notNullable();
    table.string('telegram_chat_id', 64).nullable();
    table.string('telegram_message_id', 64).nullable();
    table.timestamp('publicado_em').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['telegram_chat_id', 'telegram_message_id'], 'lead_telegram_pub_mensagem_unique');
    table.index(['lead_linha_id', 'publicado_em'], 'lead_telegram_pub_linha_data_idx');
    table.index(['publicado_em'], 'lead_telegram_pub_data_idx');
  });

  // A fila antiga só conserva a última publicação. Não é evidência de primeiro envio.
  await knex.raw(`
    INSERT INTO lead_telegram_publicacoes (
      lead_linha_id, tipo, telegram_chat_id, telegram_message_id, publicado_em, created_at
    )
    SELECT lead_linha_id, ?, telegram_chat_id, telegram_message_id, publicado_em, created_at
    FROM lead_telegram_republicacoes
  `, ['legado']);
  // Mesmo sem mensagem conservada, um atendimento anterior comprova que o lead não é novo.
  await knex.raw(`
    INSERT INTO lead_telegram_publicacoes (lead_linha_id, tipo)
    SELECT DISTINCT la.lead_linha_id, ?
    FROM lead_atribuicoes AS la
    WHERE la.etapa = ? AND la.aceite_status IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM lead_telegram_publicacoes AS p WHERE p.lead_linha_id = la.lead_linha_id
      )
  `, ['legado', 'venda']);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('lead_telegram_publicacoes');
};
