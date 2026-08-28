exports.up = async function (knex) {
  const [temMarcacaoEtapa, temAceiteVenda, temBiometriaVenda] = await Promise.all([
    knex.schema.hasColumn('funil_etapas', 'aceite_biometria'),
    knex.schema.hasColumn('vendas', 'aceite_concluido'),
    knex.schema.hasColumn('vendas', 'biometria_concluida')
  ]);

  if (!temMarcacaoEtapa) {
    await knex.schema.alterTable('funil_etapas', table => {
      table.boolean('aceite_biometria').notNullable().defaultTo(false);
    });
  }

  if (!temAceiteVenda || !temBiometriaVenda) {
    await knex.schema.alterTable('vendas', table => {
      if (!temAceiteVenda) table.boolean('aceite_concluido').notNullable().defaultTo(false);
      if (!temBiometriaVenda) table.boolean('biometria_concluida').notNullable().defaultTo(false);
    });
  }
};

exports.down = async function (knex) {
  const [temMarcacaoEtapa, temAceiteVenda, temBiometriaVenda] = await Promise.all([
    knex.schema.hasColumn('funil_etapas', 'aceite_biometria'),
    knex.schema.hasColumn('vendas', 'aceite_concluido'),
    knex.schema.hasColumn('vendas', 'biometria_concluida')
  ]);

  if (temMarcacaoEtapa) {
    await knex.schema.alterTable('funil_etapas', table => {
      table.dropColumn('aceite_biometria');
    });
  }

  if (temAceiteVenda || temBiometriaVenda) {
    await knex.schema.alterTable('vendas', table => {
      if (temAceiteVenda) table.dropColumn('aceite_concluido');
      if (temBiometriaVenda) table.dropColumn('biometria_concluida');
    });
  }
};
