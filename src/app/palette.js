// The command palette: hotkey → type to filter → Enter to launch. The fast path.

import { ui, el, isOurs } from '../core/overlay/ui.js';
import { list, start, isRunning, GROUPS } from './registry.js';
import { detectSite } from '../core/site.js';

let open = null;

export function isOpen() { return !!open; }

export function closePalette() {
  if (!open) return;
  open.remove();
  open = null;
}

export function openPalette({ initial = '' } = {}) {
  if (open) { open.querySelector('input').focus(); return open; }
  const shadow = ui();
  const site = detectSite();

  const input = el('input', { type: 'text', placeholder: 'Type a tool name… (Esc closes)', value: initial, autocomplete: 'off', spellcheck: 'false' });
  const results = el('div', { class: 'pal__list' });
  const hint = el('div', { class: 'pal__hint muted' }, `on ${site === 'web' ? location.hostname : site} · ↑↓ move · Enter launch · Esc close`);
  const box = el('div', { class: 'pal' }, el('div', { class: 'pal__input row' }, el('span', {}, '›'), input), results, hint);
  const backdrop = el('div', { class: 'pal__backdrop', onmousedown: (e) => { if (e.target === backdrop) closePalette(); } }, box);

  const style = el('style', {}, `
    .pal__backdrop { position: fixed; inset: 0; z-index: 2147483600; background: rgba(0,0,0,.25); display: flex; justify-content: center; align-items: flex-start; padding-top: 12vh; pointer-events: auto; }
    .pal { width: min(560px, 92vw); background: #14161a; color: #e7e9ee; border: 1px solid #3b6fe0; border-radius: 12px; box-shadow: 0 24px 60px rgba(0,0,0,.6); overflow: hidden; font-size: 12px; }
    .pal__input { padding: 10px 12px; border-bottom: 1px solid #2c313a; gap: 8px; }
    .pal__input input { border: none; background: transparent; font-size: 14px; padding: 2px 0; }
    .pal__input input:focus { border: none; }
    .pal__list { max-height: 50vh; overflow: auto; padding: 4px; }
    .pal__group { padding: 6px 10px 2px; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #8b93a1; }
    .pal__item { display: flex; gap: 10px; align-items: center; padding: 7px 10px; border-radius: 8px; cursor: pointer; }
    .pal__item.sel { background: #1f2a44; }
    .pal__item:hover { background: #1b1e24; }
    .pal__icon { width: 20px; text-align: center; font-size: 14px; }
    .pal__title { font-weight: 600; }
    .pal__desc { color: #8b93a1; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pal__run { font-size: 10px; color: #7ed957; }
    .pal__hint { padding: 6px 12px; border-top: 1px solid #2c313a; font-size: 10px; }
  `);
  backdrop.prepend(style);

  let items = [];
  let sel = 0;

  function render() {
    const q = input.value;
    items = list({ site, query: q });
    sel = Math.min(sel, Math.max(0, items.length - 1));
    results.replaceChildren();
    if (!items.length) { results.append(el('div', { class: 'muted', style: 'padding:10px' }, 'No tool matches.')); return; }
    let lastGroup = null;
    items.forEach((t, i) => {
      if (!q && t.group !== lastGroup) {
        lastGroup = t.group;
        results.append(el('div', { class: 'pal__group' }, GROUPS.find(([g]) => g === t.group)?.[1] ?? t.group));
      }
      const row = el('div', {
        class: `pal__item${i === sel ? ' sel' : ''}`,
        'data-tool': t.id,
        onclick: () => launch(t),
        onmousemove: () => { if (sel !== i) { sel = i; render(); } },
      },
        el('span', { class: 'pal__icon' }, t.icon),
        el('div', { class: 'grow' }, el('div', { class: 'pal__title' }, t.title), el('div', { class: 'pal__desc' }, t.desc ?? '')),
        isRunning(t.id) ? el('span', { class: 'pal__run' }, '● running') : null,
      );
      results.append(row);
    });
    results.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }

  function launch(t) {
    closePalette();
    try { start(t.id); } catch { /* start() already toasted */ }
  }

  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(1, items.length); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % Math.max(1, items.length); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[sel]) launch(items[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); }
    e.stopPropagation();
  });

  shadow.appendChild(backdrop);
  open = backdrop;
  render();
  input.focus();
  input.select();
  return backdrop;
}

export function togglePalette() { open ? closePalette() : openPalette(); }

/** Swallow keyboard events aimed at the palette so the host app never sees them. */
export function paletteOwns(event) {
  return !!open && isOurs(event.composedPath?.()[0] ?? event.target);
}
