const PERMISSAO = {
  chave: 'vendas_permitir_reversoes',
  nome: 'Vendas: permitir reversões',
  descricao: 'Permite registrar alterações auditadas em vendas acessíveis.'
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
  const existente = await knex('permissoes').where('chave', PERMISSAO.chave).first();
  if (existente) {
    await knex('permissoes').where('id', existente.id).update({ ...PERMISSAO, ativo: true });
  } else {
    await knex('permissoes').insert({ ...PERMISSAO, ativo: true });
  }

  const roleAdmin = await knex('roles').where('nome', 'admin').first();
  if (roleAdmin) {
    await knex('roles').where('id', roleAdmin.id).update({
      permissoes: JSON.stringify({
        ...parsePermissoes(roleAdmin.permissoes),
        [PERMISSAO.chave]: true
      }),
      updated_at: knex.fn.now()
    });
  }
};

exports.down = async function (knex) {
  await knex('permissoes').where('chave', PERMISSAO.chave).delete();
  const roles = await knex('roles').select('id', 'permissoes');
  for (const role of roles) {
    const permissoes = parsePermissoes(role.permissoes);
    delete permissoes[PERMISSAO.chave];
    await knex('roles').where('id', role.id).update({ permissoes: JSON.stringify(permissoes) });
  }
};
