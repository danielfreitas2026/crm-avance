// Deve preceder o backfill 20261015120000, inclusive em bancos onde a migration
// original consta como aplicada mas sua estrutura esta incompleta.
exports.up = async function (knex) {
  const tabela = 'venda_aprovacao_solicitacoes';
  const colunas = [
    ['telegram_status_sincronizado', table => table.string('telegram_status_sincronizado', 16).nullable()],
    ['telegram_sincronizado_em', table => table.timestamp('telegram_sincronizado_em').nullable()],
    ['telegram_decisor_nome', table => table.string('telegram_decisor_nome', 255).nullable()],
    ['status_anterior_obsoleta', table => table.string('status_anterior_obsoleta', 16).nullable()]
  ];

  for (const [nome, adicionar] of colunas) {
    if (!await knex.schema.hasColumn(tabela, nome)) {
      await knex.schema.alterTable(tabela, adicionar);
    }
  }
  // Os estados sincronizados desconhecidos ficam nulos: o reconciliador existente
  // confirma as mensagens no Telegram sem inventar decisoes ou status anteriores.
};

exports.down = async function () {
  // As colunas pertencem ao contrato da migration original. Nao remove dados
  // recuperados nem quebra a API ao reverter somente esta reparacao.
};
