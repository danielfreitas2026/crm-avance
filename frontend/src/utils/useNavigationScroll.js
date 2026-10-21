import { useEffect } from 'react';
import { navigationKey, readNavigation, writeNavigation } from './navigation-storage';

const validPosition = value => value && Number.isFinite(value.x) && value.x >= 0
  && Number.isFinite(value.y) && value.y >= 0;

/** Restaura somente áreas marcadas, acompanhando conteúdo carregado assincronamente. */
export function trackNavigationScroll(root, scope) {
  const ownerKey = navigationKey(`scroll:${scope}`);
  const previousRestoration = window.history.scrollRestoration;
  window.history.scrollRestoration = 'manual';
  const pending = new Map();
  const completed = new Set();
  let frame;
  let stopped = false;
  const context = () => root.querySelector('[data-navigation-context]')?.getAttribute('data-navigation-context') || '';
  const signature = () => `${context()}:${Array.from(root.querySelectorAll('[data-navigation-scroll]'), el => el.getAttribute('data-navigation-scroll')).join('|')}`;
  let lastContext = signature();
  const entries = () => [
    [document.scrollingElement || document.documentElement, 'pagina'],
    ...Array.from(root.querySelectorAll('[data-navigation-scroll]'), el => [el, el.getAttribute('data-navigation-scroll')])
  ];
  const keyFor = name => ownerKey && navigationKey(`scroll:${scope}`) === ownerKey
    ? `${ownerKey}:${context()}:${name}` : null;
  const restore = () => {
    if (lastContext !== signature()) {
      lastContext = signature();
      stopped = false;
      pending.clear();
      completed.clear();
    }
    if (stopped) return;
    const surfaces = entries();
    const activeKeys = new Set(surfaces.map(([, name]) => keyFor(name)));
    for (const key of completed) if (!activeKeys.has(key)) completed.delete(key);
    for (const [el, name] of surfaces) {
      const key = keyFor(name);
      if (!key || completed.has(key)) continue;
      const position = pending.get(key) || readNavigation(key, null, validPosition);
      if (!position) continue;
      pending.set(key, position);
      el.scrollLeft = Math.min(position.x, Math.max(0, el.scrollWidth - el.clientWidth));
      el.scrollTop = Math.min(position.y, Math.max(0, el.scrollHeight - el.clientHeight));
      if (el.scrollLeft === position.x && el.scrollTop === position.y) {
        pending.delete(key);
        completed.add(key);
      }
    }
  };
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(restore);
  };
  const save = event => {
    const el = event.target === document ? document.scrollingElement || document.documentElement : event.target;
    const entry = entries().find(([element]) => element === el);
    if (!entry) return;
    const key = keyFor(entry[1]);
    if (!pending.has(key)) writeNavigation(key, { x: el.scrollLeft, y: el.scrollTop });
  };
  const cancel = () => {
    stopped = true;
    pending.clear();
    cancelAnimationFrame(frame);
  };
  const onKey = event => {
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) cancel();
  };
  const flush = () => {
    for (const [el, name] of entries()) {
      const key = keyFor(name);
      if (!pending.has(key)) writeNavigation(key, { x: el.scrollLeft, y: el.scrollTop });
    }
  };
  const mutations = new MutationObserver(schedule);
  mutations.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-navigation-context', 'data-navigation-scroll'] });
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  resize?.observe(root);
  document.addEventListener('scroll', save, true);
  window.addEventListener('wheel', cancel, { passive: true });
  window.addEventListener('touchmove', cancel, { passive: true });
  window.addEventListener('pointerdown', cancel, { passive: true });
  window.addEventListener('keydown', onKey);
  window.addEventListener('pagehide', flush);
  schedule();
  return () => {
    if (root.isConnected) flush();
    mutations.disconnect();
    resize?.disconnect();
    cancelAnimationFrame(frame);
    document.removeEventListener('scroll', save, true);
    window.removeEventListener('wheel', cancel);
    window.removeEventListener('touchmove', cancel);
    window.removeEventListener('pointerdown', cancel);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('pagehide', flush);
    window.history.scrollRestoration = previousRestoration;
  };
}

export function useNavigationScroll(rootRef, scope) {
  useEffect(() => {
    if (!rootRef.current) return undefined;
    return trackNavigationScroll(rootRef.current, scope);
  }, [rootRef, scope]);
}
