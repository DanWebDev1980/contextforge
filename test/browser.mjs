// End-to-end check of the DOM tools in a real Chromium via CDP: load a fixture,
// inject the built bundle, hover and click an element, then read the basket back
// out of localStorage. Catches the things unit tests structurally cannot —
// shadow-root creation, event capture, getComputedStyle normalisation.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const CHROME = process.env.CHROME ?? 'chromium';
const PORT = 9333;
const FIXTURE_PORT = 9334;

// localStorage is disabled on data: URLs, and the basket lives in localStorage,
// so the fixture has to be served over http.
const fixtureHtml = await readFile(resolve('test/fixture.html'), 'utf8');
const fixtureServer = createServer((req, res) => {
  // no-store, or Chromium serves a stale fixture from a previous run
  res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  res.end(fixtureHtml);
}).listen(FIXTURE_PORT, '127.0.0.1');

// A throwaway profile per run: a persistent one carries localStorage and the
// HTTP cache between runs, which silently corrupts every assertion.
const profile = await mkdtemp(join(tmpdir(), 'cf-test-'));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox',
  '--disable-gpu', '--window-size=1200,900', `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('Chromium did not expose a debugging target');
}

let nextId = 1;
function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: res, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { ready, send, close: () => ws.close() };
}

const evalJs = async (cdp, expression) => {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? 'eval failed');
  return result.value;
};

async function reload(cdp) {
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${FIXTURE_PORT}/` });
  await sleep(400);
}

async function mouse(cdp, type, x, y) {
  await cdp.send('Input.dispatchMouseEvent', {
    type, x, y, button: type === 'mouseMoved' ? 'none' : 'left',
    clickCount: type === 'mouseMoved' ? 0 : 1,
  });
}

let pass = 0;
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; } };

try {
  const cdp = connect(await findTarget());
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${FIXTURE_PORT}/` });
  await sleep(500);

  // --- inspect-web -------------------------------------------------------
  const bundle = await readFile(resolve('dist/inspect-web.js'), 'utf8');
  await evalJs(cdp, bundle);
  await sleep(100);

  const rect = await evalJs(cdp, `JSON.stringify(document.querySelector('.card').getBoundingClientRect())`);
  const box = JSON.parse(rect);
  const cx = box.x + box.width / 2;
  const cy = box.y + 8;      // near the top edge: inside .card, outside its children

  await mouse(cdp, 'mouseMoved', cx, cy);
  await sleep(80);
  const hoverLabel = await evalJs(cdp,
    `document.getElementById('contextforge-root').shadowRoot.querySelector('.hl__tag').textContent`);

  await mouse(cdp, 'mousePressed', cx, cy);
  await mouse(cdp, 'mouseReleased', cx, cy);
  await sleep(150);

  const stored = await evalJs(cdp, `localStorage.getItem('contextforge:basket:v1')`);
  const items = JSON.parse(stored ?? '[]');

  const shadowOk = await evalJs(cdp, `!!document.getElementById('contextforge-root')?.shadowRoot`);

  console.log('\ninspect-web:');
  check('overlay mounts a shadow root', () => assert.equal(shadowOk, true));
  check('hover label names the element', () => {
    assert.match(hoverLabel, /div.*card/, `got "${hoverLabel}"`);
  });
  check('click captured exactly one item', () => assert.equal(items.length, 1));

  const node = items[0].node;
  check('capture is a style-capture from the web', () => {
    assert.equal(items[0].kind, 'style-capture');
    assert.equal(items[0].source, 'web');
  });
  check('root box measured', () => {
    assert.equal(node.box.width, 320);
  });
  check('flex layout read', () => {
    assert.equal(node.layout.display, 'flex');
    assert.equal(node.layout.direction, 'column');
    assert.equal(node.layout.gap, 12);
  });
  check('padding read', () => {
    assert.deepEqual(node.layout.padding, { top: 16, right: 20, bottom: 16, left: 20 });
  });
  check('colours normalised to hex', () => {
    assert.equal(node.fill.background, '#ffffff');
    assert.equal(node.border.color, '#e2e5ea');
  });
  check('radius read', () => assert.equal(node.border.radius.tl, 8));
  check('box-shadow parsed', () => {
    assert.equal(node.effects.length, 1);
    assert.deepEqual(
      { y: node.effects[0].y, blur: node.effects[0].blur, color: node.effects[0].color },
      { y: 2, blur: 8, color: '#00000014' });
  });
  check('children captured, hidden ones skipped', () => {
    const names = node.children.map((c) => c.name);
    assert.deepEqual(names, ['h2', 'p', 'button'], `got ${JSON.stringify(names)}`);
  });
  check('child typography normalised', () => {
    const title = node.children[0];
    assert.equal(title.typography.fontSize, 18);
    assert.equal(title.typography.fontWeight, 600);
    assert.equal(title.typography.lineHeight, 24);
    assert.equal(title.typography.color, '#111827');
    assert.equal(title.text, 'Filter results');
  });
  check('uppercase + letter-spacing survive', () => {
    const btn = node.children[2];
    assert.equal(btn.typography.textTransform, 'uppercase');
    assert.equal(btn.typography.letterSpacing, 0.5);
  });
  check('selector prefers an id when there is one', () => {
    assert.equal(items[0].meta.selector, '#card');
  });

  // --- probe -------------------------------------------------------------
  console.log('\nprobe:');
  await reload(cdp);
  await evalJs(cdp, `localStorage.clear()`);
  await evalJs(cdp, await readFile(resolve('dist/probe.js'), 'utf8'));
  await sleep(80);
  await mouse(cdp, 'mouseMoved', cx, cy);
  await sleep(60);
  await mouse(cdp, 'mousePressed', cx, cy);
  await mouse(cdp, 'mouseReleased', cx, cy);
  await sleep(120);
  const dump = await evalJs(cdp,
    `document.getElementById('contextforge-root').shadowRoot.querySelector('pre').textContent`);
  check('probe dumps an annotated outline', () => {
    assert.match(dump, /div#card\.card/);
    assert.match(dump, /"Filter results"/);
    assert.match(dump, /button\.btn/);
  });

  // --- ga4 ---------------------------------------------------------------
  console.log('\nga4:');
  await reload(cdp);
  await evalJs(cdp, `localStorage.clear(); window.dataLayer = [{ event: 'page_view', page_title: 'fixture' }];`);
  await evalJs(cdp, await readFile(resolve('dist/ga4.js'), 'utf8'));
  await sleep(80);
  await evalJs(cdp, `
    window.dataLayer.push({ event: 'filter_applied', filter_name: 'category' });
    navigator.sendBeacon('https://www.google-analytics.com/g/collect?v=2&tid=G-ABC123&en=add_to_cart&ep.item_id=SKU9&epn.value=42');
  `);
  await sleep(120);
  const rows = await evalJs(cdp, `
    [...document.getElementById('contextforge-root').shadowRoot.querySelectorAll('.panel__body > div:last-child > div')]
      .map(d => d.textContent)
  `);
  check('backlog dataLayer entry replayed', () => assert.ok(rows.some((r) => r.includes('page_view')), JSON.stringify(rows)));
  check('live dataLayer push captured', () => assert.ok(rows.some((r) => r.includes('filter_applied'))));
  check('sendBeacon /g/collect decoded', () => assert.ok(rows.some((r) => r.includes('add_to_cart'))));
  check('collect params decoded', () => assert.ok(rows.some((r) => r.includes('SKU9') || r.includes('item_id'))));
  const restored = await evalJs(cdp, `
    (() => { const root = document.getElementById('contextforge-root');
      const btn = [...root.shadowRoot.querySelectorAll('button')].find(b => b.textContent === '✕');
      btn.click();
      return /native code/.test(navigator.sendBeacon.toString()); })()
  `);
  check('patches reverted after close', () => assert.equal(restored, true));

  cdp.close();
  console.log(`\n${pass} browser checks passed`);
} finally {
  chrome.kill();
  // wait for Chromium to actually exit, or it rewrites profile files mid-delete
  await new Promise((r) => chrome.once('exit', r));
  fixtureServer.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
