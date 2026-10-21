import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationKey } from './navigation-storage';
import { trackNavigationScroll } from './useNavigationScroll';

describe('rolagem da navegação', () => {
  let root;
  let list;
  let cleanup;
  let frame;
  beforeEach(() => {
    localStorage.setItem('usuario', '{"id":7}');
    root = document.createElement('main');
    root.innerHTML = '<div data-navigation-context="recebidos"><div data-navigation-scroll="lista"></div></div>';
    document.body.append(root);
    list = root.querySelector('[data-navigation-scroll]');
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, value: 800 }, clientWidth: { configurable: true, value: 200 }
    });
    vi.stubGlobal('requestAnimationFrame', callback => { frame = callback; return 1; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    root.remove();
    vi.unstubAllGlobals();
  });
  const key = () => navigationKey('scroll:/futuros-clientes:recebidos:lista');

  it('recupera a rolagem vertical e horizontal de uma listagem', () => {
    sessionStorage.setItem(key(), '{"x":120,"y":450}');
    cleanup = trackNavigationScroll(root, '/futuros-clientes');
    frame();
    expect(list.scrollTop).toBe(450);
    expect(list.scrollLeft).toBe(120);
  });

  it('aguarda os dados sem apagar a posição salva e limita a área disponível', async () => {
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 200 });
    sessionStorage.setItem(key(), '{"x":0,"y":450}');
    cleanup = trackNavigationScroll(root, '/futuros-clientes');
    frame();
    expect(list.scrollTop).toBe(100);
    list.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(JSON.parse(sessionStorage.getItem(key())).y).toBe(450);
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1000 });
    list.append(document.createElement('div'));
    await Promise.resolve();
    frame();
    expect(list.scrollTop).toBe(450);
  });

  it('interrompe a restauração quando o usuário rola e salva a nova posição', () => {
    sessionStorage.setItem(key(), '{"x":0,"y":450}');
    cleanup = trackNavigationScroll(root, '/futuros-clientes');
    window.dispatchEvent(new Event('wheel'));
    list.scrollTop = 80;
    list.dispatchEvent(new Event('scroll', { bubbles: true }));
    frame();
    expect(list.scrollTop).toBe(80);
    expect(JSON.parse(sessionStorage.getItem(key())).y).toBe(80);
  });

  it('mantém posições distintas por aba interna e remove listeners ao sair', async () => {
    sessionStorage.setItem(key(), '{"x":0,"y":450}');
    sessionStorage.setItem(navigationKey('scroll:/futuros-clientes:meus:lista'), '{"x":0,"y":200}');
    cleanup = trackNavigationScroll(root, '/futuros-clientes');
    frame();
    root.firstChild.setAttribute('data-navigation-context', 'meus');
    await Promise.resolve();
    frame();
    expect(list.scrollTop).toBe(200);
    cleanup();
    cleanup = undefined;
    list.scrollTop = 50;
    list.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(JSON.parse(sessionStorage.getItem(navigationKey('scroll:/futuros-clientes:meus:lista'))).y).toBe(200);
  });

  it('ignora posições inválidas e áreas não marcadas', () => {
    sessionStorage.setItem(key(), '{"x":0,"y":-10}');
    cleanup = trackNavigationScroll(root, '/futuros-clientes');
    frame();
    expect(list.scrollTop).toBe(0);
    root.scrollTop = 50;
    root.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(sessionStorage.getItem(navigationKey('scroll:/futuros-clientes:recebidos:null'))).toBeNull();
  });

  it('retoma a restauração ao trocar o detalhe depois de uma interação', async () => {
    sessionStorage.setItem(key(), '{"x":0,"y":450}');
    cleanup = trackNavigationScroll(root, '/futuros-clientes');
    frame();
    window.dispatchEvent(new Event('pointerdown'));
    sessionStorage.setItem(navigationKey('scroll:/futuros-clientes:recebidos:outro-detalhe'), '{"x":0,"y":200}');
    list.setAttribute('data-navigation-scroll', 'outro-detalhe');
    await Promise.resolve();
    frame();
    expect(list.scrollTop).toBe(200);
  });

  it('não sobrescreve a posição da página quando o componente já saiu do DOM', () => {
    sessionStorage.setItem(navigationKey('scroll:/futuros-clientes:recebidos:pagina'), '{"x":0,"y":450}');
    cleanup = trackNavigationScroll(root, '/futuros-clientes');
    root.remove();
    cleanup();
    cleanup = undefined;
    expect(JSON.parse(sessionStorage.getItem(navigationKey('scroll:/futuros-clientes:recebidos:pagina'))).y).toBe(450);
  });
});
