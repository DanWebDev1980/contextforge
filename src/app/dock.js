// The dock: a small pill, bottom-right, draggable, collapsible. Discoverability
// and a place to see what is running. Menu sections are contributed by modules
// (favourite checkpoints, env switcher, mock toggle) via addMenuSection().

import { ui, el, toast } from '../core/overlay/ui.js';
import { runningIds, get as getTool, stop, onChange, list, start } from './registry.js';
import { openPalette } from './palette.js';
import * as settings from './settings.js';

const sections = [];
let dockEl = null;
let menuEl = null;

/** fn() → array of menu rows: { label, icon, hint, onclick, on?, danger? } or a { heading } row. Return [] to hide. */
export function addMenuSection(title, fn) { sections.push({ title, fn }); return () => { const i = sections.findIndex((s) => s.fn === fn); if (i >= 0) sections.splice(i, 1); }; }

export function mountDock({ version, built, onUnload }) {
  const shadow = ui();
  dockEl?.remove();
  const saved = settings.get('dock') ?? {};

  const style = el('style', {}, `
    .dock { position: fixed; z-index: 2147483500; pointer-events: auto; display: flex; align-items: center; gap: 6px;
      background: #14161a; color: #e7e9ee; border: 1px solid #2c313a; border-radius: 999px; padding: 4px 6px 4px 10px;
      box-shadow: 0 10px 30px rgba(0,0,0,.45); font-size: 12px; user-select: none; cursor: grab; }
    .dock:focus { outline: none; border-color: #3b6fe0; }
    .dock--collapsed { padding: 4px; }
    .dock--collapsed .dock__label, .dock--collapsed .dock__count, .dock--collapsed .dock__menu { display: none; }
    .dock__logo { font-weight: 800; letter-spacing: .04em; color: #9fc0ff; cursor: pointer; }
    .dock__label { color: #8b93a1; cursor: pointer; }
    .dock__count { background: #24512e; color: #b6f0c1; border-radius: 10px; padding: 0 7px; font-size: 10px; line-height: 16px; }
    .dock__count:empty { display: none; }
    .dock button.ghost { padding: 2px 6px; }
    .menu { position: fixed; z-index: 2147483550; pointer-events: auto; min-width: 240px; max-width: 360px; max-height: 70vh; overflow: auto;
      background: #14161a; color: #e7e9ee; border: 1px solid #2c313a; border-radius: 10px; box-shadow: 0 16px 40px rgba(0,0,0,.5); padding: 6px; font-size: 12px; }
    .menu__h { padding: 6px 8px 2px; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #8b93a1; }
    .menu__row { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 6px; cursor: pointer; }
    .menu__row:hover { background: #1f2a44; }
    .menu__row .grow { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .menu__hint { color: #8b93a1; font-size: 10px; }
    .menu__x { color: #8b93a1; } .menu__x:hover { color: #ffb4a8; }
    .menu__empty { padding: 4px 8px; color: #8b93a1; font-size: 11px; }
  `);

  const count = el('span', { class: 'dock__count', title: 'running tools' });
  const logo = el('span', { class: 'dock__logo', title: `BrowserCommandCenter ${version} · built ${built}\nClick: command palette`, onclick: () => openPalette() }, 'BCC');
  const label = el('span', { class: 'dock__label', onclick: () => openPalette() }, '▸ tools');
  const menuBtn = el('button', { class: 'ghost dock__menu', title: 'Menu', onclick: (e) => { e.stopPropagation(); toggleMenu(); } }, '≡');
  const collapseBtn = el('button', { class: 'ghost', title: 'Collapse / expand', onclick: (e) => { e.stopPropagation(); setCollapsed(!dockEl.classList.contains('dock--collapsed')); } }, '◦');

  dockEl = el('div', { class: 'dock', tabindex: '0', title: 'Esc while focused: unload BCC' }, logo, label, count, menuBtn, collapseBtn);
  const place = () => {
    const x = saved.x ?? null, y = saved.y ?? null;
    if (x == null || y == null) { dockEl.style.right = '16px'; dockEl.style.bottom = '16px'; }
    else { dockEl.style.left = `${Math.min(Math.max(0, x), innerWidth - 60)}px`; dockEl.style.top = `${Math.min(Math.max(0, y), innerHeight - 30)}px`; }
  };
  place();
  function setCollapsed(on) {
    dockEl.classList.toggle('dock--collapsed', on);
    settings.set('dock', { ...settings.get('dock'), collapsed: on });
  }
  if (saved.collapsed) dockEl.classList.add('dock--collapsed');

  // drag
  let drag = null;
  dockEl.addEventListener('mousedown', (e) => {
    if (e.target.closest('button') || e.button !== 0) return;
    const r = dockEl.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
  });
  const move = (e) => {
    if (!drag) return;
    drag.moved = true;
    dockEl.style.right = 'auto'; dockEl.style.bottom = 'auto';
    dockEl.style.left = `${Math.max(0, Math.min(e.clientX - drag.dx, innerWidth - dockEl.offsetWidth))}px`;
    dockEl.style.top = `${Math.max(0, Math.min(e.clientY - drag.dy, innerHeight - dockEl.offsetHeight))}px`;
  };
  const up = () => {
    if (drag?.moved) {
      const r = dockEl.getBoundingClientRect();
      settings.set('dock', { ...settings.get('dock'), x: Math.round(r.left), y: Math.round(r.top) });
    }
    drag = null;
  };
  addEventListener('mousemove', move, true);
  addEventListener('mouseup', up, true);

  dockEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onUnload?.(); }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPalette(); }
  });

  function refresh() {
    const n = runningIds().length;
    count.textContent = n ? String(n) : '';
    if (menuEl) renderMenu();
  }

  function toggleMenu() { menuEl ? closeMenu() : openMenu(); }
  function closeMenu() { menuEl?.remove(); menuEl = null; removeEventListener('mousedown', outside, true); }
  function outside(e) {
    const path = e.composedPath?.() ?? [];
    if (menuEl && !path.includes(menuEl) && !path.includes(dockEl)) closeMenu();
  }
  function openMenu() {
    menuEl = el('div', { class: 'menu' });
    shadow.appendChild(menuEl);
    renderMenu();
    const r = dockEl.getBoundingClientRect();
    const mh = menuEl.offsetHeight, mw = menuEl.offsetWidth;
    const top = r.top - mh - 8 >= 0 ? r.top - mh - 8 : Math.min(r.bottom + 8, innerHeight - mh - 8);
    menuEl.style.top = `${Math.max(4, top)}px`;
    menuEl.style.left = `${Math.max(4, Math.min(r.right - mw, innerWidth - mw - 4))}px`;
    addEventListener('mousedown', outside, true);
  }
  const row = ({ label: text, icon, hint, onclick, on, danger, close = true, x }) => el('div', {
    class: 'menu__row', onclick: () => { onclick?.(); if (close) closeMenu(); },
  },
    icon ? el('span', { style: 'width:18px;text-align:center' }, icon) : null,
    el('span', { class: `grow${danger ? ' bad' : ''}` }, text),
    on != null ? el('span', { class: on ? 'ok' : 'muted' }, on ? 'on' : 'off') : null,
    hint ? el('span', { class: 'menu__hint' }, hint) : null,
    x ? el('button', { class: 'ghost sm menu__x', title: 'Close tool', onclick: (e) => { e.stopPropagation(); x(); } }, '✕') : null,
  );

  function renderMenu() {
    if (!menuEl) return;
    menuEl.replaceChildren();
    menuEl.append(el('div', { class: 'menu__h' }, 'Running'));
    const ids = runningIds();
    if (!ids.length) menuEl.append(el('div', { class: 'menu__empty' }, 'Nothing running. Click BCC or press the hotkey.'));
    for (const id of ids) {
      const t = getTool(id);
      menuEl.append(row({ label: t?.title ?? id, icon: t?.icon, onclick: () => start(id), close: false, x: () => stop(id) }));
    }
    for (const s of sections) {
      let rows = [];
      try { rows = s.fn() ?? []; } catch (err) { rows = [{ label: `error: ${err.message}`, danger: true }]; }
      if (!rows.length) continue;
      menuEl.append(el('div', { class: 'menu__h' }, s.title));
      for (const r of rows) menuEl.append(r.heading ? el('div', { class: 'menu__empty' }, r.heading) : row(r));
    }
    menuEl.append(el('div', { class: 'menu__h' }, 'BCC'));
    menuEl.append(row({ label: 'Command palette', icon: '›', hint: settings.formatHotkey(settings.get('hotkey')), onclick: () => openPalette() }));
    if (list().some((t) => t.id === 'settings')) menuEl.append(row({ label: 'Settings', icon: '⚙', onclick: () => start('settings') }));
    menuEl.append(row({ label: `Unload BCC (${version})`, icon: '⏻', danger: true, onclick: () => onUnload?.() }));
  }

  onChange(refresh);
  refresh();
  shadow.append(style, dockEl);

  return {
    el: dockEl,
    refresh,
    destroy() { closeMenu(); removeEventListener('mousemove', move, true); removeEventListener('mouseup', up, true); dockEl?.remove(); style.remove(); dockEl = null; },
    flash(msg) { toast(msg); },
  };
}
