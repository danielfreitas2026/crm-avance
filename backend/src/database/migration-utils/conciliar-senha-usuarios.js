const tabela = 'usuarios';
const coluna = 'senha_criptografada';
const reserva = 'senha_criptografada_merge';

// As duas branches criam a mesma coluna e a branch local depois a remove.
// Reserva os valores sem ler senhas na aplicacao ou alterar migrations aplicadas.
async function reservar(knex) {
  if (!await knex.schema.hasColumn(tabela, coluna)) return;
  if (!await knex.schema.hasColumn(tabela, reserva)) {
    await knex.schema.alterTable(tabela, table => table.renameColumn(coluna, reserva));
  } else {
    await knex(tabela).update({ [reserva]: knex.raw('COALESCE(??, ??)', [coluna, reserva]) });
    await knex.schema.alterTable(tabela, table => table.dropColumn(coluna));
  }
}

async function restaurar(knex) {
  if (!await knex.schema.hasColumn(tabela, coluna)) {
    await knex.schema.alterTable(tabela, table => table.text(coluna).nullable());
  }
  if (await knex.schema.hasColumn(tabela, reserva)) {
    await knex(tabela).update({ [coluna]: knex.raw('COALESCE(??, ??)', [coluna, reserva]) });
    await knex.schema.alterTable(tabela, table => table.dropColumn(reserva));
  }
}

async function prepararCriacaoRecebida(knex) {
  const aplicada = await knex('knex_migrations')
    .where('name', '20261014120000_add_senha_criptografada_usuarios.js').first();
  if (!aplicada) return reservar(knex);
  // Se a segunda criacao ja rodou, a remocao local ainda pode estar pendente.
  // Mantem a reserva e garante uma coluna vazia para esse DDL historico.
  if (!await knex.schema.hasColumn(tabela, coluna)) {
    await knex.schema.alterTable(tabela, table => table.text(coluna).nullable());
  }
}

async function impedirRollback() {
  // O historico das branches possui DDLs incompativeis e uma remocao destrutiva.
  // Interrompe antes de executar os downs antigos e perder as copias recuperadas.
  throw new Error('A conciliacao de senhas do merge nao admite rollback automatico. Crie uma nova migration para evoluir o schema.');
}

module.exports = { reservar, prepararCriacaoRecebida, restaurar, impedirRollback };
