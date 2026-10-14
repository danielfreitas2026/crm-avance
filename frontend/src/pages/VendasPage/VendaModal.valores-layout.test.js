import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const estilos = readFileSync('src/pages/VendasPage/VendasPage.css', 'utf8');

function regra(seletor) {
  return estilos.split('}').find(bloco => bloco.split('{')[0].trim() === seletor) || '';
}

describe('layout dos valores dos chips', () => {
  it('mantém subtotais longos no rodapé sem sobrepor os campos', () => {
    const subtotal = regra('.chip-item-subtotal strong');
    expect(subtotal).toContain('display: block');
    expect(subtotal).toContain('height: auto');
    expect(subtotal).toContain('min-width: 0');
    expect(subtotal).not.toMatch(/(?:border|background|padding):/);
    expect(regra('.chip-item-subtotal')).toContain('justify-content: space-between');
    expect(subtotal).toContain('overflow-wrap: anywhere');
  });

  it('reserva colunas curtas para DDD, Chips e GB e o restante para o preço', () => {
    const detalhes = regra('.chip-item-details');
    expect(detalhes).toContain('grid-template-columns: 56px 56px 64px minmax(0, 1fr) 32px');
    expect(detalhes).toContain('grid-template-areas: "ddd quantidade gb valor remover"');
    expect(regra('.chip-item-operators')).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
  });

  it('move o preço para uma linha inteira até 400px e empilha operadoras até 320px', () => {
    const compacto = estilos.match(/@container chipItems \(max-width: 400px\) \{([\s\S]*?)\n\}/)?.[1];
    expect(compacto).toContain('"ddd quantidade gb remover"');
    expect(compacto).toContain('"valor valor valor valor"');
    const estreito = estilos.match(/@container chipItems \(max-width: 320px\) \{([\s\S]*?)\n\}/)?.[1];
    expect(estreito).toMatch(/\.chip-item-operators\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
  });

  it('permite quebrar o rodapé sem espremer o botão e o contador', () => {
    expect(regra('.chip-items__footer')).toContain('flex-wrap: wrap');
    expect(regra('.chip-items__summary')).toContain('min-width: 0');
    expect(regra('.chip-items__summary')).toContain('flex-wrap: wrap');
    expect(regra('.chip-items__footer strong')).toContain('overflow-wrap: anywhere');
    expect(regra('.chip-items__footer .btn')).toContain('flex-shrink: 0');
  });
});
