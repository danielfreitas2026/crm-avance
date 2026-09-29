import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync('src/styles/global.css', 'utf8');

describe('marca na tela de login', () => {
  it('mantém um fundo claro limitado à logo para preservar o contraste no painel azul', () => {
    const logoRule = styles.match(/\.login-logo\s*\{([^}]*)\}/)?.[1];

    expect(logoRule).toMatch(/background:\s*#fff\s*;/);
    expect(logoRule).toMatch(/width:\s*fit-content\s*;/);
  });
});
