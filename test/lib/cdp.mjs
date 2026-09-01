// Minimal Chrome DevTools Protocol harness shared by the browser tests: spawn a
// throwaway-profile headless Chromium, connect to a page target, eval JS, drive
// the mouse/keyboard, navigate and wait.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launchChrome({ chrome = process.env.CHROME ?? 'chromium', port = 9333, width = 1200, height = 900 } = {}) {
  // Node exposes a global WebSocket by default from 22 onwards; on 20 it sits
  // behind --experimental-websocket. Say so, rather than dying on a bare
  // ReferenceError deep inside connect().
  if (typeof WebSocket === 'undefined') {
    throw new Error(
      `The browser suite needs a global WebSocket (CDP runs over one), and Node ${process.versions.node} has none. `
      + 'Use Node 22 or newer, or re-run with --experimental-websocket. The unit suite needs neither.',
    );
  }
  // A throwaway profile per run: a persistent one carries localStorage and the
  // HTTP cache between runs, which silently corrupts every assertion.
  const profile = await mkdtemp(join(tmpdir(), 'bcc-test-'));
  const proc = spawn(chrome, [
    '--headless=new', `--remote-debugging-port=${port}`, '--no-sandbox', '--disable-gpu',
    `--window-size=${width},${height}`, `--user-data-dir=${profile}`, '--no-first-run',
    '--disable-features=TranslateUI', 'about:blank',
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 100 && !wsUrl; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const page = (await res.json()).find((t) => t.type === 'page');
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    if (!wsUrl) await sleep(150);
  }
  if (!wsUrl) { proc.kill(); throw new Error('Chromium did not expose a debugging target'); }

  const cdp = await connect(wsUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  return {
    cdp,
    async close() {
      try { cdp.close(); } catch { /* ignore */ }
      proc.kill();
      await new Promise((r) => proc.once('exit', r));
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

let nextId = 1;
async function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  const events = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method && events.has(msg.method)) {
      for (const fn of events.get(msg.method)) fn(msg.params);
    }
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const on = (method, fn) => { if (!events.has(method)) events.set(method, new Set()); events.get(method).add(fn); return () => events.get(method).delete(fn); };
  const once = (method, timeout = 5000) => new Promise((resolve, reject) => {
    const t = setTimeout(() => { off(); reject(new Error(`timeout waiting for ${method}`)); }, timeout);
    const off = on(method, (p) => { clearTimeout(t); off(); resolve(p); });
  });
  return { send, on, once, close: () => ws.close() };
}

export function driver(cdp) {
  const evalJs = async (expression) => {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text ?? 'eval failed');
    return result.value;
  };
  const mouse = async (type, x, y, { button = 'left' } = {}) => cdp.send('Input.dispatchMouseEvent', {
    type, x, y, button: type === 'mouseMoved' ? 'none' : button, clickCount: type === 'mouseMoved' ? 0 : 1,
  });
  const click = async (x, y) => { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); };
  const key = async (keyName, { code, text, modifiers = 0, windowsVirtualKeyCode } = {}) => {
    const base = { key: keyName, code: code ?? keyName, modifiers, windowsVirtualKeyCode };
    await cdp.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, text });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  };
  const type = async (text) => { for (const ch of text) await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: ch, key: ch }); };
  const goto = async (url, { settle = 350 } = {}) => {
    const loaded = cdp.once('Page.loadEventFired', 8000);
    await cdp.send('Page.navigate', { url });
    await loaded;
    await sleep(settle);
  };
  const waitFor = async (expression, { timeout = 5000, every = 60 } = {}) => {
    const t0 = Date.now();
    for (;;) {
      let v = null;
      try { v = await evalJs(expression); } catch { v = null; }
      if (v) return v;
      if (Date.now() - t0 > timeout) throw new Error(`waitFor timed out: ${expression.slice(0, 120)}`);
      await sleep(every);
    }
  };
  return { evalJs, mouse, click, key, type, goto, waitFor, sleep };
}

/** Shadow-root query helper source, evaluated in the page. */
export const SHADOW = `
  var $root = () => document.getElementById('bcc-root')?.shadowRoot;
  var $ = (sel) => $root()?.querySelector(sel);
  var $$ = (sel) => [...($root()?.querySelectorAll(sel) ?? [])];
  var $panel = (id) => $('.panel[data-panel="' + id + '"]');
  var $btn = (panelId, text) => [...($panel(panelId)?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim() === text || b.title === text);
  var $click = (panelId, text) => { const b = $btn(panelId, text); if (!b) throw new Error('no button ' + text + ' in ' + panelId); b.click(); return true; };
  var $field = (panelId, placeholder) => [...($panel(panelId)?.querySelectorAll('input,textarea,select') ?? [])].find((i) => i.placeholder === placeholder || i.name === placeholder);
  var $set = (input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return true; };
`;
/** Wrap an expression so SHADOW helpers are block-scoped and the last expression is returned. */
export const withShadow = (expr) => (/\breturn\b/.test(expr) ? `(() => { ${SHADOW}\n${expr} })()` : `(() => { ${SHADOW}\nreturn (${expr}); })()`);
