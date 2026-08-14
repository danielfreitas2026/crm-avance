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
