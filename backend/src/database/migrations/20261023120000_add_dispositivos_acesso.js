exports.up = async function (knex) {
  await knex.schema.alterTable('configuracoes_acesso_rede', table => {
    table.string('modo', 16).notNullable().defaultTo('rede');
  });
  await knex.schema.createTable('acesso_dispositivos', table => {
    table.string('id', 36).primary();
    table.string('nome', 80).notNullable();
    table.string('credencial_hash', 64).notNullable().unique();
    table.integer('criado_por').unsigned().nullable().references('id').inTable('usuarios').onDelete('SET NULL');
    table.dateTime('cadastrado_em').notNullable();
    table.dateTime('revogado_em').nullable();
  });
};

// Reverter apagaria autorizações permanentes ou trocaria a política de acesso.
// Para desativar, use a configuração; reparos de schema devem ser aditivos.
exports.down = async function () {
  throw new Error('Migration de dispositivos não reversível. Desative o controle nas configurações sem apagar os cadastros.');
};
