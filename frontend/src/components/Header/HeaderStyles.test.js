// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const estilos = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
const regra = seletor => [...estilos.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([, encontrado]) => encontrado.trim() === seletor)
  .map(([, , declaracoes]) => declaracoes).join('\n');
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

describe('apresentação do painel de avisos', () => {
  it('mantém o cabeçalho fixo e a lista rolável dentro do painel', () => {
    expect(regra('.header-urgent-alert-stack')).toMatch(/min-height:\s*0/);
    expect(regra('.header-urgent-alert-stack')).toMatch(/overflow-y:\s*auto/);
    expect(regra('.notification-popover__header')).toMatch(/flex-shrink:\s*0/);
    expect(regra('.notification-empty')).toMatch(/overflow-y:\s*auto/);
  });

  it('separa o texto das ações para preservar espaço de leitura em telas estreitas', () => {
    expect(regra('.header-urgent-alert-stack .urgent-alert-card')).toMatch(/grid-template-areas:\s*"icon body"\s*"\. actions"/);
    expect(regra('.header-urgent-alert-stack .urgent-alert-card__body span')).toMatch(/white-space:\s*normal/);
  });

  it('mantém a borda neutra uniforme, inclusive com avisos pendentes', () => {
    expect(regra('.notification-popover')).toMatch(/border:\s*1px solid var\(--border\)/);
    for (const seletor of ['.notification-popover--urgent', '.notification-popover--attention']) {
      expect(regra(seletor)).not.toMatch(/\bborder(?:-(?!radius\b)[\w-]+)?\s*:/);
    }
    expect(regra('.notification-popover--attention')).not.toMatch(/animation:/);
  });
});
