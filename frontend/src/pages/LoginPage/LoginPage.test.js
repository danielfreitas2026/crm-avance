import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync('src/styles/global.css', 'utf8');

describe('marca na tela de login', () => {
  it('usa dois fundos para destacar as partes clara e escura da logo', () => {
    const logoRule = styles.match(/\.login-logo img,\s*\.sidebar-logo-img,\s*\.public-info__header img\s*\{([^}]*)\}/)?.[1];

    expect(logoRule).toMatch(/background:\s*linear-gradient\(90deg, #183675 0 72%, #f7fbff 72% 100%\)/);
  });
});
