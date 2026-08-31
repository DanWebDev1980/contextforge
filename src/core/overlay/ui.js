// A tiny shadow-DOM UI kit plus a window manager in miniature. Everything BCC
// draws lives inside one shadow root attached to <html>, so host-page CSS can
// never bleed in and ours can never bleed out onto the page being inspected.
//
// Panels coexist: each tool gets its own, they stack (click to focus), remember
// their geometry per tool, and closing one stops that tool only. `unload()`
// removes the lot.

import { panelGeometry, rememberPanel } from '../../app/settings.js';

export const HOST_ID = 'bcc-root';

const BASE_CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  .panel {
    position: fixed; pointer-events: auto;
    background: #14161a; color: #e7e9ee;
    border: 1px solid #2c313a; border-radius: 10px;
    box-shadow: 0 12px 40px rgba(0,0,0,.45);
    font-size: 12px; line-height: 1.45;
    display: flex; flex-direction: column;
    max-height: 92vh; min-width: 220px; min-height: 90px; overflow: hidden;
    resize: both;
  }
  .panel--focus { border-color: #3b6fe0; }
  .panel__bar {
    display: flex; align-items: center; gap: 8px;
    padding: 7px 10px; background: #1b1e24; border-bottom: 1px solid #2c313a;
    cursor: move; user-select: none; flex: 0 0 auto;
  }
  .panel__icon { font-size: 13px; }
  .panel__title { font-weight: 600; font-size: 12px; letter-spacing: .01em; flex: 1 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .panel__body { padding: 10px; overflow: auto; flex: 1 1 auto; }
  .panel__foot { padding: 8px 10px; border-top: 1px solid #2c313a; background: #1b1e24; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; flex: 0 0 auto; }
  .panel__foot:empty { display: none; }
  button {
    font: inherit; font-size: 11px; padding: 4px 9px; border-radius: 6px; cursor: pointer;
    background: #262b33; color: #e7e9ee; border: 1px solid #363d48; line-height: 1.3;
  }
  button:hover { background: #303743; }
  button:disabled { opacity: .5; cursor: default; }
  button.primary { background: #3b6fe0; border-color: #3b6fe0; color: #fff; }
  button.primary:hover { background: #4a7ceb; }
  button.danger:hover { background: #7a2b2b; border-color: #9b3a3a; }
  button.ghost { background: transparent; border-color: transparent; }
  button.ghost:hover { background: #262b33; }
  button.on { background: #2f7a3f; border-color: #2f7a3f; color: #fff; }
  button.sm { padding: 2px 6px; font-size: 10px; }
  .muted { color: #8b93a1; }
  .ok { color: #7ed957; } .warn { color: #f5c451; } .bad { color: #ffb4a8; }
  .row { display: flex; gap: 6px; align-items: center; }
  .col { display: flex; flex-direction: column; gap: 6px; }
  .grow { flex: 1 1 auto; min-width: 0; }
  .ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  code, kbd, pre, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; }
  kbd { background: #262b33; border: 1px solid #363d48; border-radius: 4px; padding: 1px 5px; }
  pre { margin: 0; background: #0e1013; padding: 8px; border-radius: 6px; overflow: auto; white-space: pre-wrap; word-break: break-word; }
  .input, input[type=text], input[type=search], input[type=number], input[type=url], select, textarea {
    font: inherit; font-size: 11px; width: 100%;
    background: #0e1013; color: #e7e9ee; border: 1px solid #363d48; border-radius: 6px; padding: 5px 6px;
  }
  textarea { resize: vertical; font-family: ui-monospace, monospace; }
  input[type=checkbox] { margin: 0; accent-color: #3b6fe0; }
  input:focus, select:focus, textarea:focus { outline: none; border-color: #3b6fe0; }
  label.field { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: #8b93a1; }
  label.field > span:first-child { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
  .badge { display: inline-block; padding: 0 6px; border-radius: 10px; font-size: 10px; line-height: 16px; background: #262b33; color: #c9d0dc; white-space: nowrap; }
  .badge--env-dev { background: #24512e; color: #b6f0c1; }
  .badge--env-test, .badge--env-qa, .badge--env-uat, .badge--env-staging { background: #4d4116; color: #f5dd8a; }
  .badge--env-prod, .badge--env-production, .badge--env-live { background: #5a2323; color: #ffb4a8; }
  .badge--env-unknown { background: #2b2f38; color: #8b93a1; }
  .table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .table th, .table td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #262b33; vertical-align: top; }
  .table th { color: #8b93a1; font-weight: 600; cursor: pointer; user-select: none; white-space: nowrap; }
  .table tr:hover td { background: #1b1e24; }
  .table tr.sel td { background: #1f2a44; }
  .item { padding: 5px 0; border-bottom: 1px solid #262b33; }
  .tabs { display: flex; gap: 2px; border-bottom: 1px solid #2c313a; margin-bottom: 8px; }
  .tabs button { border: none; background: transparent; border-radius: 6px 6px 0 0; padding: 5px 10px; color: #8b93a1; }
  .tabs button.on { background: #262b33; color: #e7e9ee; }
  .toast {
    position: fixed; bottom: 60px; left: 50%; transform: translateX(-50%);
    background: #14161a; color: #e7e9ee; border: 1px solid #2c313a;
    padding: 9px 14px; border-radius: 8px; font-size: 12px; pointer-events: none;
    box-shadow: 0 8px 24px rgba(0,0,0,.4); z-index: 2147483647; max-width: 70vw;
  }
  .hl { position: fixed; pointer-events: none; border: 1px solid #3b6fe0; background: rgba(59,111,224,.14); border-radius: 2px; z-index: 2147483000; }
  .hl__tag {
    position: fixed; pointer-events: none; background: #3b6fe0; color: #fff; z-index: 2147483001;
    font-size: 10px; font-family: ui-monospace, monospace; padding: 2px 6px;
    border-radius: 4px; white-space: nowrap; max-width: 60vw; overflow: hidden; text-overflow: ellipsis;
  }
  .hl--locked { border-color: #7ed957; background: rgba(126,217,87,.14); }
  .hl__tag--locked { background: #4c9c33; }
  .hl--step { border: 2px solid #f5c451; background: rgba(245,196,81,.15); }
  a { color: #9fc0ff; }
  hr { border: 0; border-top: 1px solid #2c313a; margin: 8px 0; }
  details > summary { cursor: pointer; color: #8b93a1; }
  .kv { display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; font-size: 11px; }
  .kv > .k { color: #8b93a1; white-space: nowrap; }
`;

let root = null;
let zTop = 2147483100;
const openPanels = new Map();

/** Get (or create) the shared shadow root all tools draw into. */
export function ui() {
  if (root && root.host.isConnected) return root;
  const prev = document.getElementById(HOST_ID);
  if (prev) prev.remove();
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('data-bcc', '');
  host.style.cssText = 'all:initial;position:static;';
  (document.documentElement || document.body).appendChild(host);
  root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = BASE_CSS;
  root.appendChild(style);
  return root;
}

export function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k === 'value') node.value = v;
    else if (k === 'checked') node.checked = !!v;
    else if (k === 'disabled') node.disabled = !!v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    node.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
  }
  return node;
}

/** Is this node part of BCC's own overlay? Works for composedPath targets too. */
export function isOurs(node) {
  if (!node) return false;
  const rootNode = node.getRootNode?.();
  if (rootNode && rootNode === root) return true;
  return !!node.closest?.(`#${HOST_ID}`);
}

/**
 * A draggable, resizable, closable panel. Geometry is remembered per `id`.
 * Returns { root, body, foot, close, setTitle, focus, closed }.
 */
export function panel({ id, title, icon, x, y, width = 340, height, onClose } = {}) {
  const shadow = ui();
  const remembered = id ? panelGeometry(id) : null;
  const cascade = openPanels.size * 28;
  const geo = {
    x: remembered?.x ?? x ?? 16 + cascade,
    y: remembered?.y ?? y ?? 16 + cascade,
    width: remembered?.width ?? width,
    height: remembered?.height ?? height,
  };

  const body = el('div', { class: 'panel__body' });
  const foot = el('div', { class: 'panel__foot' });
  const titleEl = el('span', { class: 'panel__title' }, title);
  const closeBtn = el('button', { class: 'ghost danger', title: 'Close (stops this tool)' }, '✕');
  const bar = el('div', { class: 'panel__bar' }, icon ? el('span', { class: 'panel__icon' }, icon) : null, titleEl, closeBtn);
  const box = el('div', { class: 'panel', 'data-panel': id ?? '' }, bar, body, foot);
  box.style.left = `${Math.max(0, Math.min(geo.x, innerWidth - 60))}px`;
  box.style.top = `${Math.max(0, Math.min(geo.y, innerHeight - 40))}px`;
  box.style.width = `${geo.width}px`;
  if (geo.height) box.style.height = `${geo.height}px`;
  shadow.appendChild(box);

  const focus = () => {
    box.style.zIndex = String(++zTop);
    for (const p of openPanels.values()) p.root.classList.toggle('panel--focus', p.root === box);
  };
  box.addEventListener('mousedown', focus, true);

  // drag by the title bar, clamped to the viewport
  let drag = null;
  bar.addEventListener('mousedown', (e) => {
    if (e.target === closeBtn || e.button !== 0) return;
    const r = box.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.preventDefault();
  });
  const move = (e) => {
    if (!drag) return;
    const w = box.offsetWidth, h = box.offsetHeight;
    box.style.left = `${Math.min(Math.max(0, e.clientX - drag.dx), Math.max(0, innerWidth - w))}px`;
    box.style.top = `${Math.min(Math.max(0, e.clientY - drag.dy), Math.max(0, innerHeight - h))}px`;
  };
  const up = () => {
    const wasDragging = !!drag;
    drag = null;
    if (id) {
      const r = box.getBoundingClientRect();
      const saved = panelGeometry(id) ?? {};
      const next = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
      if (wasDragging || saved.width !== next.width || saved.height !== next.height) rememberPanel(id, next);
    }
  };
  addEventListener('mousemove', move, true);
  addEventListener('mouseup', up, true);

  let closed = false;
  const handle = {
    id, root: box, body, foot, focus,
    get closed() { return closed; },
    setTitle: (t) => { titleEl.textContent = t; },
    close: () => {
      if (closed) return;
      closed = true;
      removeEventListener('mousemove', move, true);
      removeEventListener('mouseup', up, true);
      box.remove();
      openPanels.delete(handle);
      onClose?.();
    },
  };
  closeBtn.addEventListener('click', handle.close);
  openPanels.set(handle, handle);
  focus();
  return handle;
}

export function panels() { return [...openPanels.values()]; }

export function toast(message, ms = 1800) {
  const shadow = ui();
  const t = el('div', { class: 'toast' }, message);
  shadow.appendChild(t);
  setTimeout(() => t.remove(), ms);
  return t;
}

/**
 * Draws the hover outline plus a label. Kept as one reusable object so the web
 * inspector, probe, a11y and journey tools highlight identically.
 */
export function highlighter({ variant = '' } = {}) {
  const shadow = ui();
  const boxEl = el('div', { class: 'hl', style: 'display:none' });
  const tagEl = el('div', { class: 'hl__tag', style: 'display:none' });
  shadow.append(boxEl, tagEl);

  return {
    show(rect, label, { locked = false } = {}) {
      if (!rect) return this.hide();
      boxEl.className = `hl ${locked ? 'hl--locked' : ''} ${variant}`.trim();
      boxEl.style.cssText = `display:block;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
      tagEl.className = locked ? 'hl__tag hl__tag--locked' : 'hl__tag';
      tagEl.textContent = label ?? '';
      tagEl.style.display = label ? 'block' : 'none';
      if (label) {
        const above = rect.top > 22;
        tagEl.style.cssText = `display:block;left:${Math.max(2, rect.left)}px;top:${above ? rect.top - 20 : rect.bottom + 4}px`;
      }
    },
    hide() { boxEl.style.display = 'none'; tagEl.style.display = 'none'; },
    destroy() { boxEl.remove(); tagEl.remove(); },
  };
}

/** Small helpers so tools stop re-declaring the same inline styles. */
export const field = (labelText, control) => el('label', { class: 'field' }, el('span', {}, labelText), control);
export const envBadge = (env) => el('span', { class: `badge badge--env-${String(env ?? 'unknown').toLowerCase()}` }, env ?? 'unknown');

export function relativeTime(iso) {
  if (!iso) return '';
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 86400 * 14) return `${Math.floor(d / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Remove every BCC overlay from the page. Tools should have been stopped first. */
export function unloadOverlay() {
  for (const p of [...openPanels.values()]) { try { p.close(); } catch { /* ignore */ } }
  document.getElementById(HOST_ID)?.remove();
  root = null;
}
