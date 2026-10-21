// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const componente = readFileSync(new URL('./LayoutPrivado.jsx', import.meta.url), 'utf8');
const estilos = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

describe('estrutura rolavel do layout privado', () => {
  it('envolve o conteudo da pagina em um viewport dedicado', () => {
    expect(componente).toMatch(/<div className="content__viewport" data-navigation-scroll="viewport">\s*\{children\}\s*<\/div>/s);
  });

  it('preserva a altura util para layouts internos flexiveis', () => {
    expect(estilos).toMatch(/\.content__viewport\s*\{[^}]*flex:\s*1[^}]*min-height:\s*0[^}]*display:\s*flex[^}]*flex-direction:\s*column/s);
  });
});
