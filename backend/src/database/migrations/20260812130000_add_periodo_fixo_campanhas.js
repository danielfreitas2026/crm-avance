const TIME_ZONE = 'America/Sao_Paulo';

function dataISOEmSaoPaulo(base = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(base).reduce((acc, parte) => ({ ...acc, [parte.type]: parte.value }), {});
  return `${partes.year}-${partes.month}-${partes.day}`;
}

function adicionarDias(dataISO, dias) {
  const data = new Date(`${dataISO}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

function intervaloCiclo(periodo, hojeISO) {
  const hoje = new Date(`${hojeISO}T12:00:00Z`);
  if (periodo === 'semanal') {
    const deslocamento = hoje.getUTCDay() === 0 ? -6 : 1 - hoje.getUTCDay();
    const inicio = adicionarDias(hojeISO, deslocamento);
    return { data_inicio: inicio, data_fim: adicionarDias(inicio, 6) };
  }
  if (periodo === 'mensal') {
    const ano = hoje.getUTCFullYear();
    const mes = hoje.getUTCMonth();
    const inicio = `${ano}-${String(mes + 1).padStart(2, '0')}-01`;
    const fim = new Date(Date.UTC(ano, mes + 1, 0, 12)).toISOString().slice(0, 10);
    return { data_inicio: inicio, data_fim: fim };
  }
  return { data_inicio: hojeISO, data_fim: hojeISO };
}

/** @param { import("knex").Knex } knex */
exports.up = async function (knex) {
  await knex.schema.alterTable('campanhas', table => {
    table.date('data_inicio').nullable().after('periodo');
    table.date('data_fim').nullable().after('data_inicio');
    table.index(['data_inicio', 'data_fim']);
  });

  const hoje = dataISOEmSaoPaulo();
  const campanhas = await knex('campanhas').select('id', 'periodo');
  for (const campanha of campanhas) {
    const intervalo = intervaloCiclo(campanha.periodo, hoje);
    await knex('campanhas').where({ id: campanha.id }).update({
      periodo: 'personalizado',
      ...intervalo
    });
  }

  await knex.schema.alterTable('campanhas', table => {
    table.date('data_inicio').notNullable().alter();
    table.date('data_fim').notNullable().alter();
  });
};

exports.down = async function (knex) {
  await knex('campanhas').where('periodo', 'personalizado').update({ periodo: 'diaria' });
  await knex.schema.alterTable('campanhas', table => {
    table.dropIndex(['data_inicio', 'data_fim']);
    table.dropColumn('data_fim');
    table.dropColumn('data_inicio');
  });
};

exports._internals = { adicionarDias, dataISOEmSaoPaulo, intervaloCiclo };
