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
  const admin = await knex('roles').where('nome', 'admin').first('id');
  if (!admin) return;

  const usuarios = await knex('usuarios').where('role_id', admin.id).select('id', 'permissoes');
  for (const usuario of usuarios) {
    const permissoes = parsePermissoes(usuario.permissoes);
    if (permissoes.configurar_horario_acesso === undefined) {
      await knex('usuarios').where('id', usuario.id).update({
        permissoes: JSON.stringify({ ...permissoes, configurar_horario_acesso: true })
      });
    }
  }
};

exports.down = async function () {};
