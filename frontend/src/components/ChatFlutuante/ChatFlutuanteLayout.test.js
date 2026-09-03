// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const estilos = readFileSync(new URL('./ChatFlutuante.css', import.meta.url), 'utf8');

describe('layout do chat acoplado', () => {
  it('mantem barra e painel desktop presos ao rodape com a mesma largura', () => {
    expect(estilos).toMatch(/--chat-dock-width:\s*clamp\(260px,\s*19vw,\s*300px\)/);
    expect(estilos).toMatch(/\.chat-flutuante\s*\{[^}]*bottom:\s*0/s);
    expect(estilos).toMatch(/\.chat-flutuante__atalho,\s*\.chat-flutuante__painel\s*\{[^}]*width:\s*min\(var\(--chat-dock-width\)/s);
    expect(estilos).toMatch(/\.chat-flutuante__painel\s*\{[^}]*height:\s*min\(540px,\s*calc\(100dvh - 16px\)\)[^}]*border-bottom:\s*0/s);
  });

  it('usa atalho compacto em telas menores e o oculta diante de modais', () => {
    expect(estilos).toMatch(/@media \(max-width:\s*1100px\), \(max-height:\s*700px\)[\s\S]*?\.chat-flutuante\s*\{[^}]*bottom:\s*12px/);
    expect(estilos).toMatch(/@media \(max-width:\s*1100px\), \(max-height:\s*700px\)[\s\S]*?\.chat-flutuante__atalho\s*\{[^}]*width:\s*46px[^}]*border-radius:\s*50%/);
    expect(estilos).toMatch(/@media \(max-width:\s*1100px\), \(max-height:\s*700px\)[\s\S]*?\.chat-flutuante__painel\s*\{[^}]*width:\s*min\(340px,\s*calc\(100vw - 24px\)\)/);
    expect(estilos).toMatch(/body:has\(\.modal-overlay\) \.chat-flutuante:has\(\.chat-flutuante__atalho\)\s*\{[^}]*display:\s*none/);
  });

  it('adiciona area rolavel abaixo das paginas sem deslocar paginacoes', () => {
    expect(estilos).toMatch(/body:has\(\.chat-flutuante\) \.content__viewport\s*\{[^}]*min-height:\s*calc\(100% \+ 72px \+ env\(safe-area-inset-bottom, 0px\)\)[^}]*padding-bottom:\s*calc\(72px \+ env\(safe-area-inset-bottom, 0px\)\)/s);
    expect(estilos).not.toMatch(/body:has\(\.chat-flutuante\) \.paginacao/);
    expect(estilos).not.toMatch(/body:has\(\.chat-flutuante\) \.lead-pagination/);
  });
});
