function concederDispensa(valor) {
  if (valor == null || valor === '') return ['acesso_rede_sem_codigo'];
  if (typeof valor === 'string') return concederDispensa(JSON.parse(valor));
  if (Array.isArray(valor)) {
    return valor.includes('acesso_rede_sem_codigo') ? valor : [...valor, 'acesso_rede_sem_codigo'];
  }
  if (typeof valor === 'object') return { ...valor, acesso_rede_sem_codigo: true };
  throw new Error('Formato de permissões inválido.');
}

// Concessão pontual: o histórico do Knex impede a reaplicação em novos deploys.
// Não adicionar esta concessão ao startup, aos perfis nem ao cadastro de usuários.
exports.up = async function (knex) {
  await knex.transaction(async trx => {
    const usuarios = await trx('usuarios').select('id', 'permissoes').orderBy('id', 'asc').forUpdate();
    for (const usuario of usuarios) {
      let permissoes;
      try {
        permissoes = concederDispensa(usuario.permissoes);
      } catch {
        throw new Error(`Permissões inválidas no usuário ${usuario.id}. A liberação inicial não foi aplicada.`);
      }
      await trx('usuarios').where({ id: usuario.id }).update({ permissoes: JSON.stringify(permissoes) });
    }
  });
};

// A origem da permissão não pode ser distinguida de uma concessão manual.
// Um rollback não deve remover dispensas nem desfazer ajustes administrativos.
exports.down = async function () {};
