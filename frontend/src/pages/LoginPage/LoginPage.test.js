import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync('src/styles/global.css', 'utf8');

describe('marca na tela de login', () => {
  it('mostra a logo sem uma divisão de cores no fundo', () => {
    const logoRule = styles.match(/\.login-logo img,\s*\.sidebar-logo-img,\s*\.public-info__header img\s*\{([^}]*)\}/)?.[1];

    expect(logoRule).toBeUndefined();
  });
});
