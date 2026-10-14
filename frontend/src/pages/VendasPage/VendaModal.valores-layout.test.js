import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const estilos = readFileSync('src/pages/VendasPage/VendasPage.css', 'utf8');

function regra(seletor) {
  return estilos.split('}').find(bloco => bloco.split('{')[0].trim() === seletor) || '';
}

describe('layout dos valores dos chips', () => {
  it('mantém subtotais longos dentro do campo sem sobrepor o valor unitário', () => {
    const subtotal = regra('.chip-item-subtotal strong');
    expect(subtotal).toContain('display: block');
    expect(subtotal).toContain('height: auto');
    expect(subtotal).toContain('min-height: 36px');
    expect(subtotal).toContain('overflow-wrap: anywhere');
  });

  it('permite quebrar o rodapé sem espremer o botão e o contador', () => {
    expect(regra('.chip-items__footer')).toContain('flex-wrap: wrap');
    expect(regra('.chip-items__summary')).toContain('min-width: 0');
    expect(regra('.chip-items__summary')).toContain('flex-wrap: wrap');
    expect(regra('.chip-items__footer strong')).toContain('overflow-wrap: anywhere');
    expect(regra('.chip-items__footer .btn')).toContain('flex-shrink: 0');
  });
});
