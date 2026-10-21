exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('lead_planilhas', 'local_config'))) await knex.schema.alterTable('lead_planilhas', table => {
    table.json('local_config').nullable();
  });
  if (!(await knex.schema.hasColumn('lead_linhas', 'local_ddds'))) await knex.schema.alterTable('lead_linhas', table => {
    table.json('local_ddds').nullable();
  });
};

exports.down = async function (knex) {
  // Não remover os dados originais nem os textos de Local em dados_json.
  if (await knex.schema.hasColumn('lead_linhas', 'local_ddds')) await knex.schema.alterTable('lead_linhas', table => table.dropColumn('local_ddds'));
  if (await knex.schema.hasColumn('lead_planilhas', 'local_config')) await knex.schema.alterTable('lead_planilhas', table => table.dropColumn('local_config'));
};
