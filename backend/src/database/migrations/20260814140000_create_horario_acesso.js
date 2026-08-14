const DIAS_SEMANA = Array.from({ length: 7 }, (_, dia_semana) => ({
  configuracao_id: 1,
  dia_semana,
  ativo: dia_semana >= 1 && dia_semana <= 5,
  abertura: '08:00:00',
  fechamento: '18:00:00'
}));

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
  if (!(await knex.schema.hasTable('configuracoes_horario_acesso'))) {
    await knex.schema.createTable('configuracoes_horario_acesso', table => {
      table.increments('id').primary();
      table.boolean('ativo').notNullable().defaultTo(false);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('horario_acesso_dias'))) {
    await knex.schema.createTable('horario_acesso_dias', table => {
      table.increments('id').primary();
      table.integer('configuracao_id').unsigned().notNullable()
        .references('id').inTable('configuracoes_horario_acesso').onDelete('CASCADE');
      table.integer('dia_semana').unsigned().notNullable();
      table.boolean('ativo').notNullable().defaultTo(false);
      table.time('abertura').notNullable();
      table.time('fechamento').notNullable();
      table.unique(['configuracao_id', 'dia_semana']);
    });
  }

  if (!(await knex.schema.hasTable('horario_acesso_usuarios'))) {
    await knex.schema.createTable('horario_acesso_usuarios', table => {
      table.integer('configuracao_id').unsigned().notNullable()
        .references('id').inTable('configuracoes_horario_acesso').onDelete('CASCADE');
      table.integer('usuario_id').unsigned().notNullable()
        .references('id').inTable('usuarios').onDelete('CASCADE');
      table.primary(['configuracao_id', 'usuario_id']);
    });
  }

  if (!(await knex('configuracoes_horario_acesso').where({ id: 1 }).first())) {
    await knex('configuracoes_horario_acesso').insert({ id: 1, ativo: false });
  }

  for (const dia of DIAS_SEMANA) {
    if (!(await knex('horario_acesso_dias').where({ configuracao_id: 1, dia_semana: dia.dia_semana }).first())) {
      await knex('horario_acesso_dias').insert(dia);
    }
  }

  const permissao = {
    chave: 'configurar_horario_acesso',
    nome: 'Configurar horário de acesso',
    descricao: 'Permite configurar os horários de funcionamento e os usuários liberados fora deles.'
  };
  const existente = await knex('permissoes').where('chave', permissao.chave).first();
  if (existente) await knex('permissoes').where('id', existente.id).update({ ...permissao, ativo: true });
  else await knex('permissoes').insert({ ...permissao, ativo: true });

  const admin = await knex('roles').where('nome', 'admin').first();
  if (admin) {
    const permissoes = parsePermissoes(admin.permissoes);
    await knex('roles').where('id', admin.id).update({
      permissoes: JSON.stringify({ ...permissoes, configurar_horario_acesso: true })
    });

    const usuariosAdmin = await knex('usuarios').where('role_id', admin.id).select('id', 'permissoes');
    for (const usuario of usuariosAdmin) {
      const permissoesUsuario = parsePermissoes(usuario.permissoes);
      await knex('usuarios').where('id', usuario.id).update({
        permissoes: JSON.stringify({ ...permissoesUsuario, configurar_horario_acesso: true })
      });
    }
  }
};

exports.down = async function (knex) {
  await knex('permissoes').where('chave', 'configurar_horario_acesso').update({ ativo: false });
  await knex.schema.dropTableIfExists('horario_acesso_usuarios');
  await knex.schema.dropTableIfExists('horario_acesso_dias');
  await knex.schema.dropTableIfExists('configuracoes_horario_acesso');
};
