const PERMISSOES = [
  { chave: 'automacoes_gerenciar', nome: 'Automações: gerenciar', descricao: 'Permite acompanhar, revisar e reprocessar automações.' },
  { chave: 'problemas_pos_venda_responsavel', nome: 'Problemas pós-venda: responsável', descricao: 'Recebe, visualiza e resolve problemas automáticos de pós-venda.' }
];

exports.up = async function (knex) {
  if (!await knex.schema.hasTable('automacao_emails')) {
    await knex.schema.createTable('automacao_emails', table => {
      table.increments('id').primary();
      table.string('gmail_message_id', 255).notNullable().unique();
      table.string('gmail_thread_id', 255).nullable();
      table.string('remetente', 320).notNullable();
      table.string('assunto', 500).nullable();
      table.longText('corpo_texto').nullable();
      table.string('corpo_hash', 64).nullable();
      table.dateTime('recebido_em').notNullable();
      table.json('dados_extraidos').nullable();
      table.enum('classificacao', ['tipo_1', 'tipo_2', 'desconhecido']).nullable();
      table.enum('status', ['pendente', 'processando', 'concluido', 'revisao', 'erro', 'rejeitado', 'descartado']).notNullable().defaultTo('pendente');
      table.integer('venda_id').unsigned().nullable();
      table.string('etapa_destino', 40).nullable();
      table.integer('problema_id').unsigned().nullable();
      table.text('erro').nullable();
      table.integer('tentativas').notNullable().defaultTo(0);
      table.integer('revisado_por_id').unsigned().nullable();
      table.text('justificativa_revisao').nullable();
      table.string('telegram_status', 30).nullable();
      table.string('telegram_message_id', 64).nullable();
      table.text('telegram_erro').nullable();
      table.dateTime('processado_em').nullable();
      table.dateTime('corpo_expirado_em').nullable();
      table.timestamps(true, true);
      table.foreign('venda_id').references('id').inTable('vendas').onDelete('SET NULL');
      table.foreign('problema_id').references('id').inTable('venda_problemas').onDelete('SET NULL');
      table.foreign('revisado_por_id').references('id').inTable('usuarios').onDelete('SET NULL');
      table.index(['status', 'recebido_em']);
      table.index(['problema_id']);
    });
  }

  for (const permissao of PERMISSOES) {
    const existente = await knex('permissoes').where('chave', permissao.chave).first();
    if (existente) await knex('permissoes').where('id', existente.id).update({ ...permissao, ativo: true });
    else await knex('permissoes').insert({ ...permissao, ativo: true });
  }
};

exports.down = async function (knex) {
  await knex('permissoes').whereIn('chave', PERMISSOES.map(item => item.chave)).update({ ativo: false });
  await knex.schema.dropTableIfExists('automacao_emails');
};
