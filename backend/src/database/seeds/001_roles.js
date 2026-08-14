function montarPermissoes(permissoes, permissoesLiberadas = []) {
  return permissoes.reduce((acc, permissao) => {
    acc[permissao.chave] = permissoesLiberadas.includes(permissao.chave);
    return acc;
  }, {});
}

const PERMISSOES_ADMIN_EXPLICITAS = new Set([
  'clientes_secretos_ver_todos',
  'clientes_antigos_ver_historico',
  'vendas_excluir_reversoes'
]);

async function upsertRole(knex, role) {
  const existente = await knex('roles')
    .where('nome', role.nome)
    .first();

  if (existente) {
    return knex('roles')
      .where('id', existente.id)
      .update({
        descricao: role.descricao,
        permissoes: role.permissoes,
        updated_at: knex.fn.now()
      });
  }

  return knex('roles').insert(role);
}

exports.seed = async function (knex) {
  const permissoes = await knex('permissoes')
    .select('chave')
    .where('ativo', true)
    .orderBy('chave', 'asc');

  const todasPermissoes = permissoes
    .map((permissao) => permissao.chave)
    .filter(chave => !PERMISSOES_ADMIN_EXPLICITAS.has(chave));
  const permissoesUsuario = [];

  const roles = [
    {
      nome: 'admin',
      descricao: 'Administrador do sistema com acesso total.',
      permissoes: JSON.stringify(
        montarPermissoes(permissoes, todasPermissoes)
      )
    },
    {
      nome: 'usuario',
      descricao: 'Usuário comum com acesso limitado ao sistema.',
      permissoes: JSON.stringify(
        montarPermissoes(permissoes, permissoesUsuario)
      )
    }
  ];

  for (const role of roles) {
    await upsertRole(knex, role);
  }
};
