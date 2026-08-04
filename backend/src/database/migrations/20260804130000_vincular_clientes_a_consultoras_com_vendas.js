/**
 * Vincula em massa clientes às consultoras que já possuem vendas ativas para eles.
 * Inclui a vendedora principal e as participantes de vendas compartilhadas.
 */
exports.up = async function up(knex) {
  await knex.raw(`
    INSERT IGNORE INTO cliente_consultoras (cliente_id, usuario_id, created_at)
    SELECT DISTINCT v.cliente_id, v.vendedora_id, NOW()
    FROM vendas AS v
    INNER JOIN usuarios AS u ON u.id = v.vendedora_id
    WHERE v.cliente_id IS NOT NULL
      AND v.vendedora_id IS NOT NULL
      AND v.excluido_em IS NULL
  `);

  await knex.raw(`
    INSERT IGNORE INTO cliente_consultoras (cliente_id, usuario_id, created_at)
    SELECT DISTINCT v.cliente_id, vv.usuario_id, NOW()
    FROM vendas AS v
    INNER JOIN venda_vendedoras AS vv ON vv.venda_id = v.id
    INNER JOIN usuarios AS u ON u.id = vv.usuario_id
    WHERE v.cliente_id IS NOT NULL
      AND v.excluido_em IS NULL
  `);
};

exports.down = function down() {
  // Os vínculos podem ter sido alterados manualmente após a importação; não removê-los.
  return Promise.resolve();
};
