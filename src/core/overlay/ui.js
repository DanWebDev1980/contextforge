// A tiny shadow-DOM UI kit. Everything the tools draw lives inside one closed-ish
// shadow root attached to <html>, so host-page CSS can never bleed in and our
// styles can never bleed out onto the page we are inspecting.

const HOST_ID = 'contextforge-root';

const BASE_CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
  .panel {
    position: fixed; pointer-events: auto;
    background: #14161a; color: #e7e9ee;
    border: 1px solid #2c313a; border-radius: 10px;
    box-shadow: 0 12px 40px rgba(0,0,0,.45);
    font-size: 12px; line-height: 1.45;
    display: flex; flex-direction: column;
    max-height: 80vh; overflow: hidden;
  }
  .panel__bar {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 10px; background: #1b1e24; border-bottom: 1px solid #2c313a;
    cursor: move; user-select: none; flex: 0 0 auto;
  }
  .panel__title { font-weight: 600; font-size: 12px; letter-spacing: .01em; flex: 1 1 auto; }
  .panel__body { padding: 10px; overflow: auto; flex: 1 1 auto; }
  .panel__foot { padding: 8px 10px; border-top: 1px solid #2c313a; background: #1b1e24; display: flex; gap: 6px; flex-wrap: wrap; flex: 0 0 auto; }
  button {
    font: inherit; font-size: 11px; padding: 4px 9px; border-radius: 6px; cursor: pointer;
    background: #262b33; color: #e7e9ee; border: 1px solid #363d48;
  }
  button:hover { background: #303743; }
  button.primary { background: #3b6fe0; border-color: #3b6fe0; color: #fff; }
  button.primary:hover { background: #4a7ceb; }
  button.danger:hover { background: #7a2b2b; border-color: #9b3a3a; }
  .muted { color: #8b93a1; }
  .row { display: flex; gap: 6px; align-items: center; }
  code, kbd { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
  kbd { background: #262b33; border: 1px solid #363d48; border-radius: 4px; padding: 1px 5px; }
  .toast {
    position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
    background: #14161a; color: #e7e9ee; border: 1px solid #2c313a;
    padding: 9px 14px; border-radius: 8px; font-size: 12px; pointer-events: none;
    box-shadow: 0 8px 24px rgba(0,0,0,.4);
  }
  /* hover highlight */
  .hl { position: fixed; pointer-events: none; border: 1px solid #3b6fe0; background: rgba(59,111,224,.14); border-radius: 2px; }
  .hl--pad { position: fixed; pointer-events: none; background: rgba(126,217,87,.16); }
  .hl__tag {
    position: fixed; pointer-events: none; background: #3b6fe0; color: #fff;
    font-size: 10px; font-family: ui-monospace, monospace; padding: 2px 6px;
    border-radius: 4px; white-space: nowrap; max-width: 60vw; overflow: hidden; text-overflow: ellipsis;
  }
  .hl--locked { border-color: #7ed957; background: rgba(126,217,87,.14); }
  .hl--locked + .hl__tag, .hl__tag--locked { background: #4c9c33; }
`;

let root = null;

/** Get (or create) the shared shadow root all tools draw into. */
export function ui() {
  if (root && root.host.isConnected) return root;
  const prev = document.getElementById(HOST_ID);
  if (prev) prev.remove();
  const host = document.createElement('div');
  host.id = HOST_ID;
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
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return node;
}

/** A draggable, closable panel. Returns { root, body, foot, close, setTitle }. */
export function panel({ title, x = 16, y = 16, width = 340, onClose } = {}) {
  const shadow = ui();
  const body = el('div', { class: 'panel__body' });
  const foot = el('div', { class: 'panel__foot' });
  const titleEl = el('span', { class: 'panel__title' }, title);
  const closeBtn = el('button', { class: 'danger', title: 'Close' }, '✕');
  const bar = el('div', { class: 'panel__bar' }, titleEl, closeBtn);
  const box = el('div', { class: 'panel' }, bar, body, foot);
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
  box.style.width = `${width}px`;
  shadow.appendChild(box);

  // drag by the title bar, clamped to the viewport
  let drag = null;
  bar.addEventListener('mousedown', (e) => {
    if (e.target === closeBtn) return;
    const r = box.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.preventDefault();
  });
  const move = (e) => {
    if (!drag) return;
    const w = box.offsetWidth, h = box.offsetHeight;
    box.style.left = `${Math.min(Math.max(0, e.clientX - drag.dx), innerWidth - w)}px`;
    box.style.top = `${Math.min(Math.max(0, e.clientY - drag.dy), innerHeight - h)}px`;
  };
  const up = () => { drag = null; };
  addEventListener('mousemove', move, true);
  addEventListener('mouseup', up, true);

  const close = () => {
    removeEventListener('mousemove', move, true);
    removeEventListener('mouseup', up, true);
    box.remove();
    onClose?.();
  };
  closeBtn.addEventListener('click', close);

  return { root: box, body, foot, close, setTitle: (t) => { titleEl.textContent = t; } };
}

export function toast(message, ms = 1800) {
  const shadow = ui();
  const t = el('div', { class: 'toast' }, message);
  shadow.appendChild(t);
  setTimeout(() => t.remove(), ms);
  return t;
}

/**
 * Draws the hover outline plus a label. Kept as one reusable object so the web
 * inspector and the Figma layer walker highlight identically.
 */
export function highlighter() {
  const shadow = ui();
  const boxEl = el('div', { class: 'hl', style: 'display:none' });
  const tagEl = el('div', { class: 'hl__tag', style: 'display:none' });
  shadow.append(boxEl, tagEl);

  return {
    show(rect, label, { locked = false } = {}) {
      if (!rect) return this.hide();
      boxEl.className = locked ? 'hl hl--locked' : 'hl';
      boxEl.style.cssText = `display:block;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
      tagEl.className = locked ? 'hl__tag hl__tag--locked' : 'hl__tag';
      tagEl.textContent = label;
      // flip the label below the element when there is no room above
      const above = rect.top > 22;
      tagEl.style.cssText = `display:block;left:${Math.max(2, rect.left)}px;top:${above ? rect.top - 20 : rect.bottom + 4}px`;
    },
    hide() { boxEl.style.display = 'none'; tagEl.style.display = 'none'; },
    destroy() { boxEl.remove(); tagEl.remove(); },
  };
}

/** Remove every contextforge overlay from the page. */
export function teardown() {
  document.getElementById(HOST_ID)?.remove();
  root = null;
}
