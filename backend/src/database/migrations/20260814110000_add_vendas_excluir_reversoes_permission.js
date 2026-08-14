const PERMISSAO = {
  chave: 'vendas_excluir_reversoes',
  nome: 'Vendas: excluir reversões',
  descricao: 'Permite ocultar reversões de vendas acessíveis, mediante justificativa auditada.'
};

function parsePermissoes(permissoes) {
  if (!permissoes) return {};
  if (typeof permissoes === 'string') {
    try { return parsePermissoes(JSON.parse(permissoes)); } catch { return {}; }
  }
  if (Array.isArray(permissoes)) {
    return permissoes.reduce((acc, chave) => ({ ...acc, [chave]: true }), {});
  }
  return permissoes;
}

exports.up = async function (knex) {
  const temDeletedAt = await knex.schema.hasColumn('venda_historicos', 'deleted_at');
  const temDeletedBy = await knex.schema.hasColumn('venda_historicos', 'deleted_by_id');
  const temDeletedReason = await knex.schema.hasColumn('venda_historicos', 'deleted_reason');

  if (!temDeletedAt || !temDeletedBy || !temDeletedReason) {
    await knex.schema.alterTable('venda_historicos', table => {
      if (!temDeletedAt) table.timestamp('deleted_at').nullable().index();
      if (!temDeletedReason) table.string('deleted_reason', 1000).nullable();
      if (!temDeletedBy) {
        table.integer('deleted_by_id').unsigned().nullable()
          .references('id').inTable('usuarios')
          .onUpdate('CASCADE').onDelete('SET NULL');
      }
    });
  }

  const existente = await knex('permissoes').where('chave', PERMISSAO.chave).first();
  if (existente) {
    await knex('permissoes').where('id', existente.id).update({ ...PERMISSAO, ativo: true });
  } else {
    await knex('permissoes').insert({ ...PERMISSAO, ativo: true });
  }
};

exports.down = async function (knex) {
  await knex('permissoes').where('chave', PERMISSAO.chave).delete();

  for (const tabela of ['roles', 'usuarios']) {
    const registros = await knex(tabela).select('id', 'permissoes');
    for (const registro of registros) {
      const permissoes = parsePermissoes(registro.permissoes);
      delete permissoes[PERMISSAO.chave];
      await knex(tabela).where('id', registro.id).update({ permissoes: JSON.stringify(permissoes) });
    }
  }

  const temDeletedBy = await knex.schema.hasColumn('venda_historicos', 'deleted_by_id');
  const temDeletedAt = await knex.schema.hasColumn('venda_historicos', 'deleted_at');
  const temDeletedReason = await knex.schema.hasColumn('venda_historicos', 'deleted_reason');
  if (temDeletedBy || temDeletedAt || temDeletedReason) {
    await knex.schema.alterTable('venda_historicos', table => {
      if (temDeletedBy) {
        table.dropForeign('deleted_by_id');
        table.dropColumn('deleted_by_id');
      }
      if (temDeletedReason) table.dropColumn('deleted_reason');
      if (temDeletedAt) table.dropColumn('deleted_at');
    });
  }
};
