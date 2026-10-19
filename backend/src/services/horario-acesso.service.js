const db = require('../config/database');

const CONFIGURACAO_ID = 1;
const TIMEZONE = 'America/Sao_Paulo';
const SYSTEM_CLOSED_MESSAGE = 'O sistema está temporariamente fechado. Tente novamente no horário de funcionamento.';
const DIAS_INGLES = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function horarioCurto(valor) {
  return String(valor || '').slice(0, 5);
}

function partesSaoPaulo(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(agora).reduce((acc, parte) => {
    acc[parte.type] = parte.value;
    return acc;
  }, {});

  return {
    dia_semana: DIAS_INGLES[partes.weekday],
    horario: `${partes.hour}:${partes.minute}`
  };
}

function estaDentroDoHorario(dia, horario) {
  if (!dia?.ativo) return false;
  const abertura = horarioCurto(dia.abertura);
  const fechamento = horarioCurto(dia.fechamento);
  return horario >= abertura && horario < fechamento;
}

function validarDias(dias) {
  if (!Array.isArray(dias) || dias.length !== 7) {
    throw new Error('Informe a configuração dos sete dias da semana.');
  }

  const vistos = new Set();
  return dias.map(dia => {
    const diaSemana = Number(dia.dia_semana);
    const abertura = horarioCurto(dia.abertura);
    const fechamento = horarioCurto(dia.fechamento);
    if (!Number.isInteger(diaSemana) || diaSemana < 0 || diaSemana > 6 || vistos.has(diaSemana)) {
      throw new Error('Os dias da semana informados são inválidos.');
    }
    if (typeof dia.ativo !== 'boolean') {
      throw new Error('O estado de cada dia deve ser verdadeiro ou falso.');
    }
    vistos.add(diaSemana);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(abertura) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(fechamento)) {
      throw new Error('Informe horários válidos no formato HH:mm.');
    }
    if (abertura >= fechamento) {
      throw new Error('O horário de abertura deve ser anterior ao fechamento.');
    }
    return { dia_semana: diaSemana, ativo: Boolean(dia.ativo), abertura, fechamento };
  }).sort((a, b) => a.dia_semana - b.dia_semana);
}

async function buscarConfiguracao(executor = db) {
  const configuracao = await executor('configuracoes_horario_acesso').where({ id: CONFIGURACAO_ID }).first();
  const dias = await executor('horario_acesso_dias').where({ configuracao_id: CONFIGURACAO_ID }).orderBy('dia_semana');
  const usuarioIds = await executor('horario_acesso_usuarios').where({ configuracao_id: CONFIGURACAO_ID }).pluck('usuario_id');
  return {
    id: CONFIGURACAO_ID,
    ativo: Boolean(configuracao?.ativo),
    fuso_horario: TIMEZONE,
    dias: dias.map(dia => ({ ...dia, ativo: Boolean(dia.ativo), abertura: horarioCurto(dia.abertura), fechamento: horarioCurto(dia.fechamento) })),
    usuario_ids: usuarioIds.map(Number)
  };
}

async function buscarConfiguracaoAdministrativa() {
  const [configuracao, usuarios] = await Promise.all([
    buscarConfiguracao(),
    db('usuarios as u').leftJoin('roles as r', 'u.role_id', 'r.id')
      .where('u.ativo', true)
      .select('u.id', 'u.nome', 'u.email', 'r.nome as role_nome')
      .orderBy('u.nome', 'asc')
  ]);
  const idsAtivos = new Set(usuarios.map(usuario => Number(usuario.id)));
  return {
    ...configuracao,
    usuario_ids: configuracao.usuario_ids.filter(id => idsAtivos.has(Number(id))),
    usuarios
  };
}

async function atualizarConfiguracao(dados, { registrarAuditoria } = {}) {
  if (typeof dados?.ativo !== 'boolean') {
    throw new Error('O estado da trava deve ser verdadeiro ou falso.');
  }
  const dias = validarDias(dados?.dias);
  const usuarioIds = [...new Set((dados?.usuario_ids || []).map(Number))];
  if (usuarioIds.some(id => !Number.isInteger(id) || id <= 0)) throw new Error('A lista de usuários autorizados é inválida.');

  if (usuarioIds.length) {
    const ativos = await db('usuarios').where('ativo', true).whereIn('id', usuarioIds).pluck('id');
    if (ativos.length !== usuarioIds.length) throw new Error('Selecione somente usuários ativos.');
  }

  await db.transaction(async trx => {
    let anterior;
    if (registrarAuditoria) {
      await trx('configuracoes_horario_acesso').where({ id: CONFIGURACAO_ID }).forUpdate().first();
      anterior = estadoAuditoriaConfiguracao(await buscarConfiguracao(trx));
    }
    await trx('configuracoes_horario_acesso').where({ id: CONFIGURACAO_ID }).update({
      ativo: Boolean(dados.ativo),
      updated_at: trx.fn.now()
    });
    for (const dia of dias) {
      await trx('horario_acesso_dias').where({ configuracao_id: CONFIGURACAO_ID, dia_semana: dia.dia_semana }).update(dia);
    }
    await trx('horario_acesso_usuarios').where({ configuracao_id: CONFIGURACAO_ID }).delete();
    if (usuarioIds.length) {
      await trx('horario_acesso_usuarios').insert(usuarioIds.map(usuario_id => ({ configuracao_id: CONFIGURACAO_ID, usuario_id })));
    }
    if (registrarAuditoria) await registrarAuditoria(anterior, estadoAuditoriaConfiguracao(await buscarConfiguracao(trx)), trx);
  });
  return buscarConfiguracaoAdministrativa();
}

function estadoAuditoriaConfiguracao(configuracao) {
  return {
    ativo: configuracao.ativo,
    dias: configuracao.dias.map(({ dia_semana, ativo, abertura, fechamento }) => ({ dia_semana, ativo, abertura, fechamento })),
    usuario_ids: [...configuracao.usuario_ids].sort((a, b) => a - b)
  };
}

async function avaliarAcesso(usuarioId, agora = new Date()) {
  const usuario = await db('usuarios').where({ id: usuarioId, ativo: true }).first('id', 'versao_sessao');
  if (!usuario) return { permitido: false, motivo: 'USUARIO_INATIVO' };
  const configuracao = await db('configuracoes_horario_acesso').where({ id: CONFIGURACAO_ID }).first('ativo');
  if (!configuracao?.ativo) return { permitido: true, versao_sessao: usuario.versao_sessao };
  const atual = partesSaoPaulo(agora);
  const dia = await db('horario_acesso_dias').where({ configuracao_id: CONFIGURACAO_ID, dia_semana: atual.dia_semana }).first();
  if (estaDentroDoHorario(dia, atual.horario)) return { permitido: true, versao_sessao: usuario.versao_sessao };
  const excecao = await db('horario_acesso_usuarios').where({ configuracao_id: CONFIGURACAO_ID, usuario_id: usuarioId }).first('usuario_id');
  if (excecao) return { permitido: true, excecao: true, versao_sessao: usuario.versao_sessao };
  return { permitido: false, motivo: 'SYSTEM_CLOSED', versao_sessao: usuario.versao_sessao };
}

module.exports = {
  TIMEZONE,
  SYSTEM_CLOSED_MESSAGE,
  partesSaoPaulo,
  estaDentroDoHorario,
  validarDias,
  buscarConfiguracaoAdministrativa,
  atualizarConfiguracao,
  avaliarAcesso
};
