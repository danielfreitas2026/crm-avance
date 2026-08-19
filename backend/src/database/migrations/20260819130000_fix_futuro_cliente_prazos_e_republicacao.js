exports.up = async function (knex) {
  await knex.schema.alterTable('lead_telegram_republicacoes', table => {
    table.timestamp('proxima_tentativa_em').nullable();
    table.text('ultimo_erro').nullable();
    table.index(['status', 'proxima_tentativa_em'], 'idx_lead_telegram_republicacoes_fila');
  });

  await knex.raw(`
    UPDATE lead_atribuicoes AS la
    INNER JOIN lead_linhas AS ll ON ll.id = la.lead_linha_id
    SET
      la.acao_registrada_tipo = 'retorno_agendado',
      la.acao_registrada_em = COALESCE(la.acao_registrada_em, UTC_TIMESTAMP()),
      la.prazo_acao_em = CASE
        WHEN COALESCE(ll.retorno_agendado_em, ll.futuro_cliente_retorno) IS NOT NULL
          AND DATE_ADD(COALESCE(ll.retorno_agendado_em, ll.futuro_cliente_retorno), INTERVAL 30 MINUTE)
            > DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 MINUTE)
          THEN DATE_ADD(COALESCE(ll.retorno_agendado_em, ll.futuro_cliente_retorno), INTERVAL 30 MINUTE)
        ELSE DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 MINUTE)
      END,
      la.updated_at = UTC_TIMESTAMP()
    WHERE la.etapa = 'venda'
      AND la.aceite_status = 'aceito'
      AND (
        la.acao_registrada_tipo = 'retorno_agendado'
        OR (
          la.acao_registrada_tipo IS NULL
          AND COALESCE(ll.retorno_agendado_em, ll.futuro_cliente_retorno) IS NOT NULL
        )
      )
  `);
};

exports.down = async function (knex) {
  await knex.schema.alterTable('lead_telegram_republicacoes', table => {
    table.dropIndex(['status', 'proxima_tentativa_em'], 'idx_lead_telegram_republicacoes_fila');
    table.dropColumn('ultimo_erro');
    table.dropColumn('proxima_tentativa_em');
  });
};
