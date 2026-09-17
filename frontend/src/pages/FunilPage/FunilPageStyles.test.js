// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const estilos = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

function regrasDosEstadosDoCard(css) {
  const classesDeEstado = [
    'sale-card-priority-alta',
    'sale-card-priority-media',
    'sale-card-priority-baixa',
    'sale-card-cancelada',
    'sale-card-finalizada',
    'sale-card-sem-documento',
    'sale-card-divergente'
  ];

  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, seletor]) => classesDeEstado.some(classe => (
      new RegExp(`\\.${classe}(?![-\\w])`).test(seletor)
    )))
    .map(([, seletor, declaracoes]) => ({ seletor: seletor.trim(), declaracoes }));
}

describe('estilos dos cartões do funil', () => {
  it('usa borda neutra uniforme no cartão', () => {
    expect(estilos).toMatch(/\.sale-card\s*\{[^}]*border:\s*1px solid var\(--border\)/s);
    expect(estilos).not.toMatch(/\.sale-card\s*\{[^}]*border-left-width/s);
  });

  it('não aplica borda ou contorno colorido aos estados da venda', () => {
    const regras = regrasDosEstadosDoCard(estilos);

    expect(regras.length).toBeGreaterThan(0);
    regras.forEach(({ seletor, declaracoes }) => {
      expect(declaracoes, seletor).not.toMatch(/(?:border(?:-[\w-]+)?|outline(?:-[\w-]+)?)\s*:/);
    });
  });
});
