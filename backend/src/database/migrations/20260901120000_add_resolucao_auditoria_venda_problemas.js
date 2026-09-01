exports.up = async function (knex) {
  await knex.schema.alterTable('venda_problemas', table => {
    table.integer('resolvido_por_id').unsigned().nullable();
    table.string('resolvido_por_nome', 120).nullable();
    table.foreign('resolvido_por_id').references('id').inTable('usuarios').onDelete('SET NULL');
    table.index(['status', 'aberto_em'], 'idx_venda_problemas_status_aberto');
    table.index(['status', 'resolvido_em'], 'idx_venda_problemas_status_resolvido');
  });

  const problemas = await knex('venda_problemas')
    .where('status', 'verificado')
    .whereNotNull('resolvido_em')
    .select('id');

  for (const problema of problemas) {
    const evento = await knex('venda_problema_eventos as e')
      .leftJoin('usuarios as u', 'u.id', 'e.usuario_id')
      .where('e.problema_id', problema.id)
      .where('e.tipo', 'resolucao_automatica')
      .orderBy('e.created_at', 'desc')
      .orderBy('e.id', 'desc')
      .select('e.usuario_id', 'u.nome')
      .first();
    if (evento) {
      await knex('venda_problemas').where('id', problema.id).update({
        resolvido_por_id: evento.usuario_id || null,
        resolvido_por_nome: evento.nome || (evento.usuario_id ? 'Usuário removido' : null)
      });
    }
  }
};

exports.down = async function (knex) {
  await knex.schema.alterTable('venda_problemas', table => {
    table.dropIndex(['status', 'aberto_em'], 'idx_venda_problemas_status_aberto');
    table.dropIndex(['status', 'resolvido_em'], 'idx_venda_problemas_status_resolvido');
    table.dropForeign('resolvido_por_id');
    table.dropColumn('resolvido_por_nome');
    table.dropColumn('resolvido_por_id');
  });
};
