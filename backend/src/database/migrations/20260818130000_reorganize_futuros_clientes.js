const PERMISSAO = {
  chave: 'futuros_clientes_ver_todos',
  nome: 'Futuros clientes: visualizar todos',
  descricao: 'Permite alternar entre a carteira propria e todos os futuros clientes.'
};

function parsePermissoes(valor) {
  if (!valor) return {};
  if (typeof valor === 'string') {
    try { return parsePermissoes(JSON.parse(valor)); } catch { return {}; }
  }
  if (Array.isArray(valor)) return valor.reduce((acc, chave) => ({ ...acc, [chave]: true }), {});
  if (typeof valor === 'object') return valor;
  return {};
}

exports.up = async function up(knex) {
  await knex.schema.table('lead_envios', table => {
    table.string('origem', 40).notNullable().defaultTo('mailing').after('nome');
    table.index(['origem', 'created_at'], 'lead_envios_origem_created_idx');
  });

  await knex('lead_envios')
    .where(builder => builder
      .whereExists(
        knex('lead_atribuicoes as la')
          .select(knex.raw('1'))
          .whereRaw('la.envio_id = lead_envios.id')
          .where('la.etapa', 'venda')
      )
      .orWhereRaw("LOWER(nome) LIKE 'indicacao #%'")
      .orWhereRaw("LOWER(nome) LIKE 'indicação #%'")
    )
    .update({ origem: 'futuro_cliente_telegram' });

  const existente = await knex('permissoes').where('chave', PERMISSAO.chave).first();
  if (existente) await knex('permissoes').where('id', existente.id).update({ ...PERMISSAO, ativo: true });
  else await knex('permissoes').insert({ ...PERMISSAO, ativo: true });

  const roleAdmin = await knex('roles').where('nome', 'admin').first();
  if (roleAdmin) {
    await knex('roles').where('id', roleAdmin.id).update({
      permissoes: JSON.stringify({ ...parsePermissoes(roleAdmin.permissoes), [PERMISSAO.chave]: true }),
      updated_at: knex.fn.now()
    });
  }
};

exports.down = async function down(knex) {
  const roles = await knex('roles').select('id', 'permissoes');
  for (const role of roles) {
    const permissoes = parsePermissoes(role.permissoes);
    delete permissoes[PERMISSAO.chave];
    await knex('roles').where('id', role.id).update({ permissoes: JSON.stringify(permissoes) });
  }
  await knex('permissoes').where('chave', PERMISSAO.chave).delete();
  await knex.schema.table('lead_envios', table => {
    table.dropIndex(['origem', 'created_at'], 'lead_envios_origem_created_idx');
    table.dropColumn('origem');
  });
};
