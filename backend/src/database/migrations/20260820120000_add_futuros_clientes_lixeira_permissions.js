const PERMISSOES = [
  {
    chave: 'futuros_clientes_enviar_lixeira',
    nome: 'Futuros clientes: enviar para lixeira',
    descricao: 'Permite enviar futuros clientes próprios para a lixeira e restaurá-los.'
  },
  {
    chave: 'futuros_clientes_excluir_definitivamente',
    nome: 'Futuros clientes: excluir definitivamente',
    descricao: 'Permite remover definitivamente futuros clientes próprios que estão na lixeira.'
  },
  {
    chave: 'futuros_clientes_gerenciar_todos',
    nome: 'Futuros clientes: gerenciar todos',
    descricao: 'Permite aplicar ações autorizadas da lixeira aos futuros clientes de qualquer responsável.'
  }
];

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
  for (const permissao of PERMISSOES) {
    const existente = await knex('permissoes').where('chave', permissao.chave).first();
    if (existente) await knex('permissoes').where('id', existente.id).update({ ...permissao, ativo: true });
    else await knex('permissoes').insert({ ...permissao, ativo: true });
  }

  const roleAdmin = await knex('roles').where('nome', 'admin').first();
  if (roleAdmin) {
    const permissoes = parsePermissoes(roleAdmin.permissoes);
    for (const permissao of PERMISSOES) permissoes[permissao.chave] = true;
    await knex('roles').where('id', roleAdmin.id).update({
      permissoes: JSON.stringify(permissoes),
      updated_at: knex.fn.now()
    });
  }
};

exports.down = async function down(knex) {
  for (const tabela of ['roles', 'usuarios']) {
    const registros = await knex(tabela).select('id', 'permissoes');
    for (const registro of registros) {
      const permissoes = parsePermissoes(registro.permissoes);
      for (const permissao of PERMISSOES) delete permissoes[permissao.chave];
      await knex(tabela).where('id', registro.id).update({ permissoes: JSON.stringify(permissoes) });
    }
  }

  await knex('permissoes').whereIn('chave', PERMISSOES.map(permissao => permissao.chave)).delete();
};

