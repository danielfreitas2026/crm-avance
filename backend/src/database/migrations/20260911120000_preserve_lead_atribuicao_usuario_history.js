/**
 * Preserva a identidade do destinatario quando um usuario e excluido.
 *
 * O id historico nao possui FK de proposito: ele e a identidade imutavel usada
 * para agrupar atribuicoes depois que usuario_id recebe NULL pelo SET NULL.
 */
exports.up = async function (knex) {
  await knex.schema.table('lead_atribuicoes', table => {
    table.integer('usuario_id_historico').unsigned().nullable().after('usuario_id');
    table.string('usuario_nome_historico', 120).nullable().after('usuario_id_historico');
  });

  await knex('lead_atribuicoes as la')
    .join('usuarios as u', 'u.id', 'la.usuario_id')
    .update({
      'la.usuario_id_historico': knex.ref('la.usuario_id'),
      'la.usuario_nome_historico': knex.ref('u.nome')
    });

  await knex.schema.table('lead_atribuicoes', table => {
    table.dropForeign(['usuario_id']);
  });
  await knex.schema.alterTable('lead_atribuicoes', table => {
    table.integer('usuario_id').unsigned().nullable().alter();
    table.foreign('usuario_id').references('id').inTable('usuarios')
      .onUpdate('CASCADE').onDelete('SET NULL');
  });
};

exports.down = async function (knex) {
  // Registros orfaos seriam removidos em cascata no esquema anterior.
  await knex('lead_atribuicoes').whereNull('usuario_id').delete();

  await knex.schema.table('lead_atribuicoes', table => {
    table.dropForeign(['usuario_id']);
  });
  await knex.schema.alterTable('lead_atribuicoes', table => {
    table.integer('usuario_id').unsigned().notNullable().alter();
    table.foreign('usuario_id').references('id').inTable('usuarios')
      .onUpdate('CASCADE').onDelete('CASCADE');
  });
  await knex.schema.table('lead_atribuicoes', table => {
    table.dropColumn('usuario_nome_historico');
    table.dropColumn('usuario_id_historico');
  });
};

exports.config = {
  transaction: false
};
