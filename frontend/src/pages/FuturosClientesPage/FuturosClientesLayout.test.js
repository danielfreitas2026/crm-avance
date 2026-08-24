// @vitest-environment node

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const estilos = readFileSync(new URL('./FuturosClientesPage.css', import.meta.url), 'utf8');
const componente = readFileSync(new URL('./FuturosClientesPage.jsx', import.meta.url), 'utf8');

describe('layout responsivo dos futuros clientes', () => {
  it('impede que as abas sejam comprimidas pela altura do conteúdo de estatísticas', () => {
    expect(estilos).toMatch(/\.clientes-tabs\s*\{[^}]*flex:\s*0 0 auto/);
  });

  it('usa uma cor definida pelo tema no progresso de produtividade', () => {
    expect(estilos).toMatch(/\.future-stats__user-progress b\s*\{[^}]*background:\s*var\(--accent,\s*#171717\)/);
  });

  it('faz a lista e a tabela ocuparem a altura útil em telas não móveis', () => {
    expect(estilos).toMatch(/@media \(min-width: 781px\)[\s\S]*?\.futuros-clientes-view\s*\{[\s\S]*?flex:\s*1 1 0/);
    expect(estilos).toMatch(/\.futuros-clientes-view > \.futuros-clientes-table\s*\{[\s\S]*?height:\s*auto/);
  });

  it('reorganiza os filtros em larguras intermediárias', () => {
    expect(estilos).toMatch(/@media \(min-width: 781px\) and \(max-width: 1180px\)/);
    expect(estilos).toMatch(/\.clientes-leads-toolbar\s*\{\s*flex-wrap:\s*wrap/);
    expect(estilos).toMatch(/\.clientes-search\s*\{\s*flex:\s*1 1 100%/);
  });

  it('reserva espaço para o card interno do responsável sem alterar o display da célula', () => {
    expect(estilos).toMatch(/\.futuros-clientes-table \.futuro-cliente-responsavel-col\s*\{[\s\S]*?min-width:\s*210px[\s\S]*?max-width:\s*240px/);
    expect(estilos).toMatch(/\.futuro-cliente-responsavel-card\s*\{[\s\S]*?display:\s*flex/);
    expect(estilos).not.toMatch(/\.futuro-cliente-responsavel-col\s*\{[^}]*display:\s*flex/);
  });

  it('reserva largura para o maior status sem sobreposição da coluna de ações', () => {
    expect(estilos).toMatch(/\.clientes-leads-table th:nth-child\(2\),[\s\S]*?width:\s*220px;[\s\S]*?min-width:\s*220px;[\s\S]*?max-width:\s*220px/);
    expect(estilos).toMatch(/\.clientes-leads-table--acoes th:nth-child\(3\),[\s\S]*?left:\s*380px/);
  });

  it('posiciona o responsável em uma linha completa no card mobile', () => {
    expect(estilos).toMatch(/@media \(max-width: 640px\)[\s\S]*?td\.futuro-cliente-responsavel-col\s*\{[\s\S]*?grid-column:\s*1 \/ -1[\s\S]*?grid-row:\s*3/);
  });

  it('destaca a linha completa conforme o resultado da venda', () => {
    expect(componente).toMatch(/<tr[\s\S]*?key=\{linha\.atribuicao_id \|\| linha\.id\}[\s\S]*?className=\{getClasseResultadoVenda\(linha\)\}/);
    expect(estilos).toMatch(/\.futuros-clientes-table tbody tr\.lead-row-vendido td\s*\{[\s\S]*?var\(--success\)/);
    expect(estilos).toMatch(/\.futuros-clientes-table tbody tr\.lead-row-recusado td\s*\{[\s\S]*?var\(--danger/);
  });
});
