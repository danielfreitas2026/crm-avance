import { describe, expect, it } from 'vitest';
import { chaveDataMensagem, rotuloDataMensagem } from './chatFlutuante.utils';

describe('datas do chat flutuante', () => {
  it('agrupa timestamps pelo dia no fuso local', () => {
    const valor = '2026-08-12T15:30:00Z';
    const data = new Date(valor);
    const pad = numero => String(numero).padStart(2, '0');
    expect(chaveDataMensagem(valor)).toBe(`${data.getFullYear()}-${pad(data.getMonth() + 1)}-${pad(data.getDate())}`);
  });

  it('usa Hoje, Ontem e data completa', () => {
    const agora = new Date(2026, 7, 12, 12);
    const localIso = (dia) => new Date(2026, 7, dia, 10).toISOString();
    expect(rotuloDataMensagem(localIso(12), agora)).toBe('Hoje');
    expect(rotuloDataMensagem(localIso(11), agora)).toBe('Ontem');
    expect(rotuloDataMensagem(localIso(8), agora)).toBe('08/08/2026');
  });
});
