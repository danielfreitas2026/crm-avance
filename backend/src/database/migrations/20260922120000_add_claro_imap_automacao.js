const ORIGEM_VIVO = 'gmail_vivo';
const ORIGEM_CLARO = 'imap_claro';

exports.up = async function up(knex) {
  if (!await knex.schema.hasColumn('automacao_emails', 'origem')) {
    await knex.schema.alterTable('automacao_emails', table => {
      table.string('origem', 40).notNullable().defaultTo(ORIGEM_VIVO).index();
      table.string('operadora', 40).notNullable().defaultTo('Vivo').index();
      table.string('identificador_remoto', 512).nullable();
      table.string('chave_deduplicacao', 64).nullable().unique('uq_automacao_emails_dedup');
      table.boolean('autenticacao_valida').nullable();
    });
    await knex('automacao_emails').update({
      origem: ORIGEM_VIVO,
      operadora: 'Vivo',
      identificador_remoto: knex.ref('gmail_message_id')
    });
    await knex.raw("UPDATE automacao_emails SET chave_deduplicacao = SHA2(CONCAT('gmail_vivo:', gmail_message_id), 256) WHERE chave_deduplicacao IS NULL");
  }

  if (!await knex.schema.hasColumn('automacao_email_estado', 'origem')) {
    await knex.schema.alterTable('automacao_email_estado', table => {
      table.string('origem', 40).nullable().unique('uq_automacao_email_estado_origem');
      table.string('uidvalidity', 255).nullable();
      table.bigInteger('ultimo_uid').unsigned().notNullable().defaultTo(0);
    });
    await knex('automacao_email_estado').where({ id: 1 }).update({ origem: ORIGEM_VIVO });
    await knex('automacao_email_estado').insert({ id: 2, origem: ORIGEM_CLARO, estado: 'aguardando', ultimo_uid: 0 }).onConflict('id').ignore();
  }

  if (!await knex.schema.hasColumn('venda_funil_automacoes', 'aceite_concluido_auto')) {
    await knex.schema.alterTable('venda_funil_automacoes', table => {
      table.boolean('aceite_concluido_auto').notNullable().defaultTo(false);
      table.boolean('biometria_concluida_auto').notNullable().defaultTo(false);
    });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('automacao_emails', 'origem')) {
    // O esquema anterior não representa mensagens IMAP; remova-as antes de
    // voltar para evitar que sejam interpretadas como mensagens Gmail/Vivo.
    await knex('automacao_emails').where({ origem: ORIGEM_CLARO }).delete();
  }
  if (await knex.schema.hasColumn('venda_funil_automacoes', 'aceite_concluido_auto')) {
    await knex.schema.alterTable('venda_funil_automacoes', table => {
      table.dropColumn('aceite_concluido_auto');
      table.dropColumn('biometria_concluida_auto');
    });
  }
  if (await knex.schema.hasColumn('automacao_email_estado', 'origem')) {
    await knex('automacao_email_estado').where({ origem: ORIGEM_CLARO }).delete();
    await knex.schema.alterTable('automacao_email_estado', table => {
      table.dropUnique(['origem'], 'uq_automacao_email_estado_origem');
      table.dropColumn('origem');
      table.dropColumn('uidvalidity');
      table.dropColumn('ultimo_uid');
    });
  }
  if (await knex.schema.hasColumn('automacao_emails', 'origem')) {
    await knex.schema.alterTable('automacao_emails', table => {
      table.dropUnique(['chave_deduplicacao'], 'uq_automacao_emails_dedup');
      table.dropColumn('origem');
      table.dropColumn('operadora');
      table.dropColumn('identificador_remoto');
      table.dropColumn('chave_deduplicacao');
      table.dropColumn('autenticacao_valida');
    });
  }
};

exports._internals = { ORIGEM_VIVO, ORIGEM_CLARO };
