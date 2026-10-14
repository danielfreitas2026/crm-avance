// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const estilos = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
const regrasDosCartoes = [...estilos.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([, seletor]) => /\.urgent-alert-card(?=\s*(?:,|$)|:hover\s*(?:,|$)|--[\w-]+\s*(?:,|$))/.test(seletor.trim()))
  .map(([, seletor, declaracoes]) => ({ seletor: seletor.trim(), declaracoes }));

describe('bordas dos cartões de avisos', () => {
  it('mantém uma borda neutra uniforme no cartão', () => {
    expect(estilos).toMatch(/\.urgent-alert-card\s*\{[^}]*border:\s*1px solid var\(--border\)/s);
  });

  it('não sobrescreve a borda no hover, nos tipos de aviso ou no celular', () => {
    expect(regrasDosCartoes.filter(({ seletor }) => seletor === '.urgent-alert-card').length).toBeGreaterThan(1);
    expect(regrasDosCartoes.some(({ seletor }) => seletor === '.urgent-alert-card:hover')).toBe(true);

    regrasDosCartoes.forEach(({ seletor, declaracoes }) => {
      const semBordaNeutra = declaracoes.replace(/\bborder:\s*1px solid var\(--border\)\s*;/g, '');
      expect(semBordaNeutra, seletor).not.toMatch(/\bborder(?:-(?!radius\b)[\w-]+)?\s*:/);
    });
  });
});
