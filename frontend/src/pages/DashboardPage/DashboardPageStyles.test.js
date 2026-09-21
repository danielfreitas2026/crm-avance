// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const estilos = readFileSync(new URL('./DashboardPage.css', import.meta.url), 'utf8');

describe('estilos da lista de notificacoes do dashboard', () => {
  it('mantem o mesmo fundo nas notificacoes lidas e nao lidas', () => {
    expect(estilos).toMatch(/\.pend-row\s*\{[^}]*background:\s*var\(--surface\)/s);
    expect(estilos).not.toMatch(/\.pend-row\.is-unread\s*\{[^}]*background\s*:/s);
  });
});
