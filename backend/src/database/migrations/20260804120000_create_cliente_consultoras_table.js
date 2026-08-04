exports.up = function (knex) {
  return knex.schema.createTable('cliente_consultoras', table => {
    table.integer('cliente_id').unsigned().notNullable()
      .references('id').inTable('clientes').onUpdate('CASCADE').onDelete('CASCADE');
    table.integer('usuario_id').unsigned().notNullable()
      .references('id').inTable('usuarios').onUpdate('CASCADE').onDelete('CASCADE');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.primary(['cliente_id', 'usuario_id']);
    table.index(['usuario_id'], 'idx_cliente_consultoras_usuario');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('cliente_consultoras');
};
