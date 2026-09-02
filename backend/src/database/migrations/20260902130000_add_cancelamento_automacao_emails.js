exports.up = async function (knex) {
  await knex.raw("ALTER TABLE automacao_emails MODIFY classificacao ENUM('tipo_1', 'tipo_2', 'desconhecido', 'sem_acao', 'cancelamento') NULL");
};

exports.down = async function (knex) {
  await knex('automacao_emails').where('classificacao', 'cancelamento').update({ classificacao: 'desconhecido' });
  await knex.raw("ALTER TABLE automacao_emails MODIFY classificacao ENUM('tipo_1', 'tipo_2', 'desconhecido', 'sem_acao') NULL");
};
