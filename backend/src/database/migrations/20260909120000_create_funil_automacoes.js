const PERMISSAO = {
  chave: 'funil_automacoes',
  nome: 'Funil automações',
  descricao: 'Permite visualizar e movimentar o funil comparativo das automações.'
};

function parsePermissoes(valor) {
  if (!valor) return {};
  if (typeof valor === 'string') {
    try { return parsePermissoes(JSON.parse(valor)); } catch { return {}; }
  }
  if (Array.isArray(valor)) return Object.fromEntries(valor.map(chave => [chave, true]));
  return typeof valor === 'object' ? { ...valor } : {};
}

exports.up = async function up(knex) {
  if (!await knex.schema.hasTable('venda_funil_automacoes')) {
    await knex.schema.createTable('venda_funil_automacoes', table => {
      table.integer('venda_id').unsigned().primary();
      table.string('status_funil', 40).nullable();
      table.string('prioridade_funil', 20).notNullable().defaultTo('media');
      table.dateTime('cancelada_em').nullable();
      table.string('motivo_cancelamento', 255).nullable();
      table.dateTime('ultima_atividade_em').nullable();
      table.timestamps(true, true);
      table.foreign('venda_id').references('id').inTable('vendas').onDelete('CASCADE');
      table.index(['status_funil', 'cancelada_em'], 'idx_funil_automacoes_estado');
    });
  }

  if (!await knex.schema.hasTable('venda_funil_automacao_historicos')) {
    await knex.schema.createTable('venda_funil_automacao_historicos', table => {
      table.increments('id').primary();
      table.integer('venda_id').unsigned().notNullable();
      table.integer('usuario_id').unsigned().nullable();
      table.integer('automacao_email_id').unsigned().nullable();
      table.string('origem', 40).notNullable();
      table.string('acao', 80).notNullable();
      table.string('status_anterior', 40).nullable();
      table.string('status_novo', 40).nullable();
      table.string('prioridade_anterior', 20).nullable();
      table.string('prioridade_nova', 20).nullable();
      table.text('observacao').nullable();
      table.json('dados').nullable();
      table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
      table.foreign('venda_id').references('id').inTable('vendas').onDelete('CASCADE');
      table.foreign('usuario_id').references('id').inTable('usuarios').onDelete('SET NULL');
      table.foreign('automacao_email_id').references('id').inTable('automacao_emails').onDelete('SET NULL');
      table.index(['venda_id', 'created_at'], 'idx_funil_automacao_hist_venda');
      table.unique(['automacao_email_id'], 'uq_funil_automacao_hist_email');
    });
  }

  const existentes = await knex('venda_funil_automacoes').select('venda_id');
  const idsExistentes = new Set(existentes.map(item => Number(item.venda_id)));
  const vendas = await knex('vendas')
    .select('id', 'status_funil', 'prioridade_funil', 'cancelada_em', 'motivo_cancelamento', 'ultima_atividade_em', 'updated_at', 'created_at')
    .whereNull('excluido_em')
    .whereNotNull('enviada_pos_venda_em');
  const agora = new Date();
  const estados = vendas
    .filter(venda => !idsExistentes.has(Number(venda.id)))
    .map(venda => ({
      venda_id: venda.id,
      status_funil: venda.status_funil || null,
      prioridade_funil: venda.prioridade_funil || 'media',
      cancelada_em: venda.cancelada_em || null,
      motivo_cancelamento: venda.motivo_cancelamento || null,
      ultima_atividade_em: venda.ultima_atividade_em || venda.updated_at || venda.created_at || agora,
      created_at: agora,
      updated_at: agora
    }));
  if (estados.length) await knex.batchInsert('venda_funil_automacoes', estados, 500);

  const permissao = await knex('permissoes').where({ chave: PERMISSAO.chave }).first();
  if (permissao) await knex('permissoes').where({ id: permissao.id }).update({ ...PERMISSAO, ativo: true });
  else await knex('permissoes').insert({ ...PERMISSAO, ativo: true });
};

exports.down = async function down(knex) {
  for (const tabela of ['roles', 'usuarios']) {
    const registros = await knex(tabela).select('id', 'permissoes');
    for (const registro of registros) {
      const permissoes = parsePermissoes(registro.permissoes);
      if (!Object.prototype.hasOwnProperty.call(permissoes, PERMISSAO.chave)) continue;
      delete permissoes[PERMISSAO.chave];
      await knex(tabela).where({ id: registro.id }).update({ permissoes: JSON.stringify(permissoes) });
    }
  }
  await knex('permissoes').where({ chave: PERMISSAO.chave }).delete();
  await knex.schema.dropTableIfExists('venda_funil_automacao_historicos');
  await knex.schema.dropTableIfExists('venda_funil_automacoes');
};

exports._internals = { PERMISSAO, parsePermissoes };
