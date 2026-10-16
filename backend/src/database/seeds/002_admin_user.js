const bcrypt = require('bcrypt');

exports.seed = async function (knex) {
  const senhaHash = await bcrypt.hash('admin123', 10);

  const adminRole = await knex('roles')
    .where('nome', 'admin')
    .first();

  if (!adminRole) {
    throw new Error('Role admin não encontrada. Execute primeiro a seed 001_roles.');
  }

  const adminExistente = await knex('usuarios')
    .where('email', 'admin@empresa.com')
    .first();

  if (adminExistente) {
    await knex('usuarios')
      .where('id', adminExistente.id)
      .update({
        nome: 'Administrador',
        senha: senhaHash,
        role_id: adminRole.id,
        ativo: true,
        updated_at: knex.fn.now()
      });

    return;
  }

  await knex('usuarios').insert({
    nome: 'Administrador',
    email: 'admin@empresa.com',
    senha: senhaHash,
    role_id: adminRole.id,
    ativo: true
  });
};
