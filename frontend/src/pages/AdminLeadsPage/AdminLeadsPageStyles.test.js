// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const estilos = readFileSync(new URL('./AdminLeadsPage.css', import.meta.url), 'utf8');
const regras = [...estilos.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .flatMap(([, seletores, declaracoes]) => seletores.split(',').map(seletor => ({
    seletor: seletor.trim(), declaracoes
  })));

describe('ações dos cards de planilha de mailing', () => {
  it.each(['history', 'download', 'cancel', 'delete'])(
    'oculta a ação %s sem hover e mantém acesso por foco de teclado', acao => {
      const botao = `.lead-doc-${acao}`;
      const card = acao === 'history' ? '.lead-doc-card' : '.lead-doc-card.active';
      const declaracoes = seletor => regras
        .filter(regra => regra.seletor === seletor)
        .map(regra => regra.declaracoes).join('\n');

      expect(declaracoes(botao)).toMatch(/visibility:\s*hidden/);
      expect(regras.some(regra => regra.seletor.includes(':focus-within') && regra.seletor.endsWith(botao))).toBe(false);
      for (const estado of [':hover', ':focus-visible', ':has(:focus-visible)']) {
        expect(declaracoes(`${card}${estado} ${botao}`)).toMatch(/visibility:\s*visible/);
      }
    }
  );
});
