exports.up = async function (knex) {
  await knex.raw("ALTER TABLE automacao_emails MODIFY classificacao ENUM('tipo_1', 'tipo_2', 'desconhecido', 'sem_acao') NULL");
};

exports.down = async function (knex) {
  await knex('automacao_emails').where('classificacao', 'sem_acao').update({ classificacao: 'desconhecido' });
  await knex.raw("ALTER TABLE automacao_emails MODIFY classificacao ENUM('tipo_1', 'tipo_2', 'desconhecido') NULL");
};
