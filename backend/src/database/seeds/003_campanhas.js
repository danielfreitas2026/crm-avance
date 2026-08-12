exports.seed = async function(knex) {
  const agora = new Date();
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(agora).reduce((acc, parte) => ({ ...acc, [parte.type]: parte.value }), {});
  const hoje = `${partes.year}-${partes.month}-${partes.day}`;
  const campanhas = [
    {
      tipo: 'diaria',
      periodo: 'personalizado',
      data_inicio: hoje,
      data_fim: hoje,
      categoria: 'registro_cliente',
      target: 15,
      desc: 'Campanha Diária Global',
      reward: null,
      is_gift: false
    },
    {
      tipo: 'diaria_registro_cliente',
      periodo: 'personalizado',
      data_inicio: hoje,
      data_fim: hoje,
      categoria: 'registro_cliente',
      target: 5,
      desc: 'Registrar 5 clientes',
      reward: 'Vale iFood R$ 50',
      is_gift: true
    },
    {
      tipo: 'diaria_chip_novo',
      periodo: 'personalizado',
      data_inicio: hoje,
      data_fim: hoje,
      categoria: 'chip_novo',
      target: 10,
      desc: 'Vender 10 chips novos',
      reward: 'Pix R$ 20',
      is_gift: true
    },
    {
      tipo: 'semanal_portabilidade',
      periodo: 'personalizado',
      data_inicio: hoje,
      data_fim: hoje,
      categoria: 'portabilidade',
      target: 3,
      desc: 'Fazer 3 portabilidades',
      reward: 'Meio período de folga',
      is_gift: true
    },
    {
      tipo: 'diaria_internet',
      periodo: 'personalizado',
      data_inicio: hoje,
      data_fim: hoje,
      categoria: 'internet',
      target: 3,
      desc: 'Vender 3 planos de internet',
      reward: 'Vale Uber R$ 30',
      is_gift: true
    }
  ];

  for (const campanha of campanhas) {
    const existente = await knex('campanhas')
      .where('tipo', campanha.tipo)
      .first();

    if (existente) {
      await knex('campanhas')
        .where('id', existente.id)
        .update({
          periodo: campanha.periodo,
          data_inicio: campanha.data_inicio,
          data_fim: campanha.data_fim,
          categoria: campanha.categoria,
          target: campanha.target,
          desc: campanha.desc,
          reward: campanha.reward,
          is_gift: campanha.is_gift,
          updated_at: knex.fn.now()
        });

      continue;
    }

    await knex('campanhas').insert({
      ...campanha,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    });
  }
};
