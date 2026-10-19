const test = require('node:test');
const assert = require('node:assert/strict');

const {
  partesSaoPaulo,
  estaDentroDoHorario,
  validarDias
} = require('../src/services/horario-acesso.service');

test('considera abertura inclusiva e fechamento exclusivo', () => {
  const dia = { ativo: true, abertura: '08:00', fechamento: '18:00' };
  assert.equal(estaDentroDoHorario(dia, '07:59'), false);
  assert.equal(estaDentroDoHorario(dia, '08:00'), true);
  assert.equal(estaDentroDoHorario(dia, '17:59'), true);
  assert.equal(estaDentroDoHorario(dia, '18:00'), false);
  assert.equal(estaDentroDoHorario({ ...dia, ativo: false }, '12:00'), false);
});

test('calcula dia e horário no fuso de São Paulo durante mudança de data UTC', () => {
  assert.deepEqual(partesSaoPaulo(new Date('2026-08-17T02:30:00Z')), { dia_semana: 0, horario: '23:30' });
  assert.deepEqual(partesSaoPaulo(new Date('2026-08-17T03:00:00Z')), { dia_semana: 1, horario: '00:00' });
});

test('valida os sete dias e rejeita períodos atravessando a meia-noite', () => {
  const dias = Array.from({ length: 7 }, (_, dia_semana) => ({
    dia_semana,
    ativo: dia_semana > 0 && dia_semana < 6,
    abertura: '08:00',
    fechamento: '18:00'
  }));
  assert.equal(validarDias(dias).length, 7);
  assert.throws(() => validarDias(dias.map(dia => dia.dia_semana === 2 ? { ...dia, abertura: '22:00', fechamento: '06:00' } : dia)), /anterior/);
  assert.throws(() => validarDias(dias.slice(0, 6)), /sete dias/);
  assert.throws(() => validarDias(dias.map(dia => dia.dia_semana === 3 ? { ...dia, ativo: 'false' } : dia)), /verdadeiro ou falso/);
});

test('avaliação de acesso carrega versão de sessão em todos os caminhos de usuário ativo', async t => {
  const db = require('../src/config/database');
  const { avaliarAcesso } = require('../src/services/horario-acesso.service');
  let configuracaoAtiva = false;
  let diaAtivo = false;
  let excecao = false;
  let usuarioAtivo = true;
  const consultas = [];
  t.mock.method(db.client, 'acquireConnection', async () => ({}));
  t.mock.method(db.client, 'releaseConnection', async () => {});
  t.mock.method(db.client, '_query', async (_conexao, consulta) => {
    consultas.push(consulta.sql);
    let rows;
    if (consulta.sql.includes('from `usuarios`')) rows = usuarioAtivo ? [{ id: 1, versao_sessao: 3 }] : [];
    else if (consulta.sql.includes('from `configuracoes_horario_acesso`')) rows = [{ ativo: configuracaoAtiva }];
    else if (consulta.sql.includes('from `horario_acesso_dias`')) rows = [{ ativo: diaAtivo, abertura: '08:00', fechamento: '18:00' }];
    else if (consulta.sql.includes('from `horario_acesso_usuarios`')) rows = excecao ? [{ usuario_id: 1 }] : [];
    else assert.fail(`Consulta inesperada: ${consulta.sql}`);
    return { ...consulta, response: [rows, []] };
  });
  const agora = new Date('2026-10-19T15:00:00Z');
  assert.deepEqual(await avaliarAcesso(1, agora), { permitido: true, versao_sessao: 3 });
  configuracaoAtiva = true;
  diaAtivo = true;
  assert.deepEqual(await avaliarAcesso(1, agora), { permitido: true, versao_sessao: 3 });
  diaAtivo = false;
  excecao = true;
  assert.deepEqual(await avaliarAcesso(1, agora), { permitido: true, excecao: true, versao_sessao: 3 });
  excecao = false;
  assert.deepEqual(await avaliarAcesso(1, agora), { permitido: false, motivo: 'SYSTEM_CLOSED', versao_sessao: 3 });
  usuarioAtivo = false;
  assert.deepEqual(await avaliarAcesso(1, agora), { permitido: false, motivo: 'USUARIO_INATIVO' });
  assert.ok(consultas[0].includes('`versao_sessao`'));
});
