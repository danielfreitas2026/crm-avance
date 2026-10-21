exports.up = async function (knex) {
  if (!await knex.schema.hasTable('configuracoes_acesso_rede')) {
    await knex.schema.createTable('configuracoes_acesso_rede', table => {
      table.integer('id').unsigned().primary();
      table.boolean('ativo').notNullable().defaultTo(false);
      table.text('redes').notNullable();
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });
  }
  if (!await knex('configuracoes_acesso_rede').where({ id: 1 }).first()) {
    await knex('configuracoes_acesso_rede').insert({ id: 1, ativo: false, redes: '[]' });
  }
  if (!await knex.schema.hasTable('acesso_rede_solicitacoes')) {
    await knex.schema.createTable('acesso_rede_solicitacoes', table => {
      table.string('id', 36).primary();
      table.integer('usuario_id').unsigned().notNullable().references('id').inTable('usuarios').onDelete('CASCADE');
      table.string('sessao_id', 64).notNullable();
      table.integer('versao_sessao').unsigned().notNullable();
      table.string('ip', 45).notNullable();
      table.string('origem', 10).notNullable();
      table.string('codigo_hash', 64).notNullable();
      table.string('estado', 16).notNullable();
      table.integer('tentativas').unsigned().notNullable().defaultTo(0);
      table.dateTime('created_at').notNullable();
      table.dateTime('expira_em').notNullable();
      table.dateTime('sessao_expira_em').nullable();
      table.index(['usuario_id', 'created_at']);
      table.index(['sessao_id', 'ip', 'estado']);
      table.index(['ip', 'created_at']);
    });
  }
  for (const permissao of [
    { chave: 'configurar_acesso_rede', nome: 'Configurar acesso por rede', descricao: 'Permite configurar as redes da empresa e ativar o bloqueio de acesso externo.' },
    { chave: 'acesso_rede_sem_codigo', nome: 'Acessar de qualquer rede sem código', descricao: 'Dispensa o código de acesso externo. Administradores são sempre dispensados.' }
  ]) {
    const existente = await knex('permissoes').where('chave', permissao.chave).first();
    if (existente) await knex('permissoes').where('id', existente.id).update({ ...permissao, ativo: true });
    else await knex('permissoes').insert({ ...permissao, ativo: true });
  }
  const admin = await knex('roles').where('nome', 'admin').first();
  if (admin) {
    const normalizarPermissoes = valor => {
      if (typeof valor === 'string') {
        try { return normalizarPermissoes(JSON.parse(valor)); } catch { return {}; }
      }
      return Array.isArray(valor) ? Object.fromEntries(valor.map(chave => [chave, true])) : valor || {};
    };
    const usuarios = await knex('usuarios').where('role_id', admin.id).select('id', 'permissoes');
    for (const usuario of usuarios) {
      const permissoes = normalizarPermissoes(usuario.permissoes);
      if (permissoes.configurar_acesso_rede === undefined) {
        await knex('usuarios').where('id', usuario.id).update({ permissoes: JSON.stringify({ ...permissoes, configurar_acesso_rede: true }) });
      }
    }
  }
};

exports.down = async function (knex) {
  await knex('permissoes').whereIn('chave', ['configurar_acesso_rede', 'acesso_rede_sem_codigo']).update({ ativo: false });
  await knex.schema.dropTableIfExists('acesso_rede_solicitacoes');
  await knex.schema.dropTableIfExists('configuracoes_acesso_rede');
};
