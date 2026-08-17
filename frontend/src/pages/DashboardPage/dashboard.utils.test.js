import { describe, expect, it } from 'vitest';
import { calcularSegmentosCirculares } from './dashboard.utils';

describe('calcularSegmentosCirculares', () => {
  it('calcula percentuais e posiciona cada segmento sem alterar os itens', () => {
    const items = [
      { key: 'a', value: 25 },
      { key: 'b', value: 50 },
      { key: 'c', value: 25 }
    ];
    const original = structuredClone(items);

    const segmentos = calcularSegmentosCirculares(items, 100);

    expect(segmentos.map(({ share, offset }) => ({ share, offset }))).toEqual([
      { share: 25, offset: 0 },
      { share: 50, offset: 25 },
      { share: 25, offset: 75 }
    ]);
    expect(items).toEqual(original);
  });

  it('trata valores negativos ou inválidos como zero', () => {
    const segmentos = calcularSegmentosCirculares([
      { value: -10 },
      { value: 'invalido' },
      { value: 20 }
    ], 20);

    expect(segmentos.map(({ share, offset }) => ({ share, offset }))).toEqual([
      { share: 0, offset: 0 },
      { share: 0, offset: 0 },
      { share: 100, offset: 0 }
    ]);
  });
});
