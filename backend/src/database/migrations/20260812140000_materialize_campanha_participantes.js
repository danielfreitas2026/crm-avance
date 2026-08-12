/**
 * Materializa os usuários ativos nas campanhas coletivas que ainda usavam
 * a ausência de vínculos como sinônimo de "todos".
 * @param { import('knex').Knex } knex
 */
function montarVinculos(campanhas, usuarios) {
  return campanhas.flatMap(campanha_id => usuarios.map(usuario_id => ({
    campanha_id: Number(campanha_id),
    usuario_id: Number(usuario_id)
  })));
}

exports.up = async function up(knex) {
  const [campanhas, usuarios] = await Promise.all([
    knex('campanhas as c')
      .where('c.is_gift', true)
      .whereNotExists(function semParticipantes() {
        this.select(knex.raw('1'))
          .from('campanha_participantes as cp')
          .whereRaw('cp.campanha_id = c.id');
      })
      .pluck('c.id'),
    knex('usuarios').where('ativo', true).pluck('id')
  ]);

  const vinculos = montarVinculos(campanhas, usuarios);

  if (vinculos.length) {
    await knex.batchInsert('campanha_participantes', vinculos, 500);
  }
};

// Não removemos vínculos no rollback porque não é possível distinguir com
// segurança participantes materializados de edições feitas depois do deploy.
exports.down = async function down() {};

exports._internals = { montarVinculos };
