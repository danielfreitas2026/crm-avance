// @vitest-environment node

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const estilos = readFileSync(new URL('./FuturosClientesPage.css', import.meta.url), 'utf8');

describe('layout responsivo dos futuros clientes', () => {
  it('faz a lista e a tabela ocuparem a altura útil em telas não móveis', () => {
    expect(estilos).toMatch(/@media \(min-width: 781px\)[\s\S]*?\.futuros-clientes-view\s*\{[\s\S]*?flex:\s*1 1 0/);
    expect(estilos).toMatch(/\.futuros-clientes-view > \.futuros-clientes-table\s*\{[\s\S]*?height:\s*auto/);
  });

  it('reorganiza os filtros em larguras intermediárias', () => {
    expect(estilos).toMatch(/@media \(min-width: 781px\) and \(max-width: 1180px\)/);
    expect(estilos).toMatch(/\.clientes-leads-toolbar\s*\{\s*flex-wrap:\s*wrap/);
    expect(estilos).toMatch(/\.clientes-search\s*\{\s*flex:\s*1 1 100%/);
  });
});
