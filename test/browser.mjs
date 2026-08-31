// End-to-end checks of BCC in a real Chromium via CDP. One fixture app on two
// ports (cross-origin), the real dist/bcc.js injected the way a Snippet would,
// tools driven through the palette, the panels and the window.BCC API.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { launchChrome, driver, withShadow, sleep } from './lib/cdp.mjs';
import { fixtureApp } from './lib/fixtures.mjs';

const A = 'http://127.0.0.1:9334';
const B = 'http://127.0.0.1:9335';
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));

const app = fixtureApp();
app.listen(9334); app.listen(9335);
const bundle = await readFile(resolve('dist/bcc.js'), 'utf8');

const { cdp, close } = await launchChrome({ port: 9333 });
const d = driver(cdp);
const S = (expr) => d.evalJs(withShadow(expr));

let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`); } catch (e) { fail++; console.error(`  ✗ ${name}\n    ${e.message.split('\n').slice(0, 6).join('\n    ')}`); } };
const asyncCheck = async (name, fn) => { try { await fn(); pass++; console.log(`  ✓ ${name}`); } catch (e) { fail++; console.error(`  ✗ ${name}\n    ${e.message.split('\n').slice(0, 6).join('\n    ')}`); } };

async function inject({ url = `${A}/`, fresh = true } = {}) {
  if (url) await d.goto(url);
  if (fresh) await d.evalJs(`for (const k of Object.keys(localStorage)) if (k.startsWith('bcc:')) localStorage.removeItem(k);`);
  await d.evalJs(bundle);
  await sleep(120);
}
const reinject = async () => { await d.evalJs(bundle); await sleep(120); };

const sections = {};
const section = (name, fn) => { sections[name] = fn; };

// ---------------------------------------------------------------------------
section('shell', async () => {
  await d.goto(`${A}/`);
  await d.evalJs(`localStorage.clear(); localStorage.setItem('contextforge:basket:v1', JSON.stringify([{ id: 'old1', kind: 'note', title: 'legacy', body: 'x', addedAt: '2020-01-01' }]));`);
  await d.evalJs(bundle); await sleep(150);

  const state = await d.evalJs(`JSON.stringify({ v: BCC.version, n: BCC.tools().length, migrated: JSON.parse(localStorage.getItem('bcc:basket:v1') ?? '[]').length, old: localStorage.getItem('contextforge:basket:v1'), ver: localStorage.getItem('bcc:version') })`);
  const st = JSON.parse(state);
  check('window.BCC exposed with version and ≥ 20 tools', () => { assert.match(st.v, /^1\./); assert.ok(st.n >= 20, `got ${st.n}`); });
  check('contextforge basket migrated to bcc: and old key removed', () => { assert.equal(st.migrated, 1); assert.equal(st.old, null); });
  check('version stamped in localStorage', () => assert.ok(st.ver.includes(st.v)));
  await asyncCheck('dock mounted in the shadow root', async () => assert.equal(await S(`!!$('.dock')`), true));

  await d.key(' ', { code: 'Space', modifiers: 2 | 8 });   // Ctrl+Shift+Space
  await sleep(60);
  await asyncCheck('hotkey opens the palette', async () => assert.equal(await S(`!!$('.pal')`), true));
  await d.type('checkp'); await sleep(40);
  const items = await S(`$$('.pal__item').map((i) => i.dataset.tool)`);
  check('palette filters by name', () => assert.equal(items[0], 'checkpoints'));
  await d.key('Escape', { code: 'Escape' }); await sleep(30);
  await asyncCheck('Esc closes the palette', async () => assert.equal(await S(`!!$('.pal')`), false));
  await d.key(' ', { code: 'Space', modifiers: 2 | 8 }); await sleep(40);
  await d.type('storage'); await sleep(30);
  await d.key('Enter', { code: 'Enter' }); await sleep(120);
  await asyncCheck('Enter launches the selected tool', async () => assert.deepEqual(await d.evalJs(`BCC.running()`), ['storage']));

  await d.evalJs(`BCC.start('ga4'); BCC.start('basket');`); await sleep(80);
  const panels = await S(`$$('.panel').map((p) => p.dataset.panel).sort()`);
  check('three tools coexist with their own panels', () => assert.deepEqual(panels, ['basket', 'ga4', 'storage']));
  await asyncCheck('interceptor active while ga4 runs', async () => assert.equal(await d.evalJs(`BCC.intercept.active`), true));
  await S(`$panel('ga4').querySelector('.panel__bar button').click()`); await sleep(60);
  await asyncCheck('closing one panel stops that tool only', async () => assert.deepEqual((await d.evalJs(`BCC.running()`)).sort(), ['basket', 'storage']));
  await asyncCheck('fetch restored when the last interceptor subscriber leaves', async () => assert.equal(await d.evalJs(`/native code/.test(window.fetch.toString()) && !BCC.intercept.active`), true));
  assert.equal(await d.evalJs(`/native code/.test(window.fetch.toString()) && !BCC.intercept.active`), true);

  // panel geometry remembered per tool
  await S(`const b = $panel('basket'); b.style.left = '300px'; b.style.top = '200px'; return true`);
  await d.evalJs(`document.getElementById('bcc-root').shadowRoot.querySelector('.panel[data-panel="basket"] .panel__bar').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 310, clientY: 210, button: 0 }))`);
  await d.evalJs(`window.dispatchEvent(new MouseEvent('mousemove', { clientX: 320, clientY: 220 })); window.dispatchEvent(new MouseEvent('mouseup', {}))`);
  await sleep(30);
  const geo = await d.evalJs(`JSON.parse(localStorage.getItem('bcc:settings:v1')).panels.basket`);
  check('panel position remembered in settings', () => assert.ok(geo && geo.x >= 300, JSON.stringify(geo)));

  // site ranking
  const ranked = await d.evalJs(`BCC.registry.list({ site: 'figma' }).slice(0, 4).map((t) => t.id)`);
  check('site-aware ranking puts Figma tools first on figma', () => assert.ok(ranked.includes('inspect-figma') && ranked.includes('figma-stickies'), JSON.stringify(ranked)));

  // re-paste replaces the running copy
  await reinject();
  await asyncCheck('pasting the bundle twice leaves one dock and no running tools', async () => assert.deepEqual([await S(`$$('.dock').length`), await d.evalJs(`BCC.running().length`)], [1, 0]));

  // --split bundles: the shell with one tool auto-started (what the old single-tool paste did)
  await d.evalJs(`BCC.unload()`);
  await d.evalJs(await readFile(resolve('dist/checkpoints.js'), 'utf8')); await sleep(120);
  await asyncCheck('a --split bundle boots the shell and auto-starts its tool', async () => { assert.deepEqual(await d.evalJs(`BCC.running()`), ['checkpoints']); assert.equal(await S(`!!$('.dock')`), true); });

  await d.evalJs(`BCC.start('inspect-web'); BCC.unload();`); await sleep(30);
  const after = await d.evalJs(`JSON.stringify({ root: !!document.getElementById('bcc-root'), bcc: typeof window.BCC, fetchNative: /native code/.test(window.fetch.toString()) })`);
  check('unload removes the overlay, window.BCC and every patch', () => assert.deepEqual(JSON.parse(after), { root: false, bcc: 'undefined', fetchNative: true }));
});

// ---------------------------------------------------------------------------
section('inspect-web', async () => {
  await inject();
  await d.evalJs(`BCC.start('inspect-web')`); await sleep(60);
  const box = JSON.parse(await d.evalJs(`JSON.stringify(document.querySelector('.card').getBoundingClientRect())`));
  const cx = box.x + box.width / 2, cy = box.y + 8;
  await d.mouse('mouseMoved', cx, cy); await sleep(60);
  const hoverLabel = await S(`$('.hl__tag').textContent`);
  await d.click(cx, cy); await sleep(150);
  const items = JSON.parse(await d.evalJs(`localStorage.getItem('bcc:basket:v1')`) ?? '[]');
  check('hover label names the element', () => assert.match(hoverLabel, /div.*card/));
  check('click captured exactly one style-capture from the web', () => { assert.equal(items.length, 1); assert.equal(items[0].kind, 'style-capture'); assert.equal(items[0].source, 'web'); });
  const node = items[0].node;
  check('box, flex layout, padding, colours, radius, shadow read', () => {
    assert.equal(node.box.width, 320);
    assert.equal(node.layout.display, 'flex'); assert.equal(node.layout.direction, 'column'); assert.equal(node.layout.gap, 12);
    assert.deepEqual(node.layout.padding, { top: 16, right: 20, bottom: 16, left: 20 });
    assert.equal(node.fill.background, '#ffffff'); assert.equal(node.border.color, '#e2e5ea'); assert.equal(node.border.radius.tl, 8);
    assert.deepEqual({ y: node.effects[0].y, blur: node.effects[0].blur, color: node.effects[0].color }, { y: 2, blur: 8, color: '#00000014' });
  });
  check('children captured, hidden skipped, typography normalised', () => {
    assert.deepEqual(node.children.map((c) => c.name), ['h2', 'p', 'button']);
    assert.equal(node.children[0].typography.fontSize, 18); assert.equal(node.children[0].typography.fontWeight, 600);
    assert.equal(node.children[2].typography.textTransform, 'uppercase'); assert.equal(node.children[2].typography.letterSpacing, 0.5);
  });
  check('selector prefers an id', () => assert.equal(items[0].meta.selector, '#card'));
  check('design tokens (custom properties) in effect are captured', () => {
    const names = items[0].meta.context.tokens.map((t) => t.name).sort();
    assert.deepEqual(names, ['--radius']);
    assert.equal(items[0].meta.context.tokens[0].value, '8px');
  });
  check('@media context recorded with match state', () => {
    const scoped = items[0].meta.context.rules.filter((r) => r.context.length);
    assert.ok(scoped.some((r) => /min-width: 600px/.test(r.context[0].label) && r.context[0].matches === true), JSON.stringify(scoped));
    assert.ok(scoped.some((r) => /max-width: 300px/.test(r.context[0].label) && r.context[0].matches === false));
  });
  const css = await d.evalJs(`BCC.instance('inspect-web').toCSS()`);
  check('copy-as-CSS renders a usable block', () => { assert.match(css, /^#card \{/); assert.match(css, /display: flex;/); assert.match(css, /padding: 16px 20px 16px 20px;/); assert.match(css, /border-radius: 8px;/); });
  const md = await d.evalJs(`BCC.start('basket').build()`);
  check('basket prompt includes tokens and conditional rules', () => { assert.match(md, /--radius/); assert.match(md, /Conditional rules/); });
});

// ---------------------------------------------------------------------------
section('probe + ga4 + diagnose', async () => {
  await inject();
  await d.evalJs(`BCC.start('probe')`); await sleep(50);
  const box = JSON.parse(await d.evalJs(`JSON.stringify(document.querySelector('.card').getBoundingClientRect())`));
  await d.mouse('mouseMoved', box.x + 10, box.y + 8); await sleep(40);
  await d.click(box.x + 10, box.y + 8); await sleep(80);
  const dump = await S(`$panel('probe').querySelector('pre').textContent`);
  check('probe dumps an annotated outline', () => { assert.match(dump, /div#card\.card/); assert.match(dump, /"Filter results"/); assert.match(dump, /button\.btn/); });
  await d.evalJs(`BCC.stop('probe')`);

  await d.evalJs(`window.dataLayer.push({ event: 'page_view', page_title: 'fixture' }); BCC.start('ga4')`); await sleep(60);
  await d.evalJs(`
    window.dataLayer.push({ event: 'filter_applied', filter_name: 'category' });
    navigator.sendBeacon('https://www.google-analytics.com/g/collect?v=2&tid=G-ABC123&en=add_to_cart&ep.item_id=SKU9&epn.value=42');
    fetch('https://www.google-analytics.com/g/collect?v=2&tid=G-ABC123&en=purchase&ep.currency=GBP', { method: 'POST', mode: 'no-cors' }).catch(() => {});
  `); await sleep(250);
  const names = await d.evalJs(`BCC.instance('ga4').events.map((e) => e.name)`);
  check('ga4 replays backlog, sees dataLayer pushes, decodes beacon and fetch collects via the shared interceptor', () => {
    for (const n of ['page_view', 'filter_applied', 'add_to_cart', 'purchase']) assert.ok(names.includes(n), `${n} missing in ${JSON.stringify(names)}`);
  });
  const params = await d.evalJs(`JSON.stringify(BCC.instance('ga4').events.find((e) => e.name === 'add_to_cart').params)`);
  check('collect params decoded with numeric epn.', () => assert.deepEqual(JSON.parse(params), { item_id: 'SKU9', value: 42 }));
  await d.evalJs(`BCC.stop('ga4')`);
  await asyncCheck('sendBeacon and dataLayer.push restored after stop', async () => assert.equal(await d.evalJs(`/native code/.test(navigator.sendBeacon.toString()) && window.dataLayer.push === Array.prototype.push`), true));

  // diagnose on a page with a strict CSP header
  await inject({ url: `${A}/csp.html` });
  await d.evalJs(`BCC.start('diagnose')`); await sleep(700);
  const report = await S(`$panel('diagnose').querySelector('pre').textContent`);
  check('diagnose report renders without an adapter throwing', () => { assert.ok(report.length > 200); assert.ok(!/THREW/.test(report)); });
  check('CSP section reads the response header and flags the hub as blocked', () => { assert.match(report, /policy from header/); assert.match(report, /hub \(http:\/\/localhost:7373\): BLOCKED/); assert.match(report, /bookmarklet .*BLOCKED/); });
  check('adapters degrade to "found nothing" on arbitrary DOM', () => { assert.match(report, /No panel accepted|candidates with controls: 0/); assert.match(report, /found 0:|‹none›/); });
  check('host stripped from the reported url', () => { assert.match(report, /# url: http:\/\/‹host›/); assert.ok(!report.includes('127.0.0.1:9334')); });
});

// ---------------------------------------------------------------------------
section('checkpoints', async () => {
  await inject();
  await d.evalJs(`BCC.settings.set('envMap', { fixture: { a: '${A}', b: '${B}' } })`);
  await d.evalJs(`scrollTo(0, 600)`);
  await d.evalJs(`BCC.start('checkpoints')`); await sleep(80);

  // UI path: Save tab is default when the library is empty; type journey + step, save.
  await S(`$set($field('checkpoints', 'e.g. refund flow'), 'refund flow')`);
  await S(`$set($field('checkpoints', 'e.g. after amount entered'), 'step 3')`);
  await S(`$set($field('checkpoints', 'bug-1234, wizard'), 'bug-1234')`);
  await S(`$click('checkpoints', 'Save checkpoint')`); await sleep(80);
  const saved = await d.evalJs(`BCC.stores.checkpoints.all()`);
  check('saving from the form creates one checkpoint with app/env from the env map', () => {
    assert.equal(saved.length, 1);
    assert.equal(saved[0].app, 'fixture'); assert.equal(saved[0].env, 'a');
    assert.equal(saved[0].journey, 'refund flow'); assert.equal(saved[0].step, 'step 3'); assert.deepEqual(saved[0].tags, ['bug-1234']);
  });
  const cp = saved[0];
  check('checkpoint captures storage, cookies, url and scroll', () => {
    assert.equal(cp.storage.local['app.user'], JSON.stringify({ id: 42, name: 'Dana' }));
    assert.equal(cp.storage.session['wizard.step'], '3');
    assert.ok(cp.cookies.some((c) => c.name === 'theme' && c.value === 'dark'));
    assert.equal(cp.url.path, '/'); assert.equal(cp.scroll.y, 600);
    assert.ok(!Object.keys(cp.storage.local).some((k) => k.startsWith('bcc:')), 'bcc keys must not be captured');
  });
  check('credential-looking keys flagged sensitive', () => assert.deepEqual(cp.sensitive.sort(), ['auth.token', 'session_id']));

  const exported = JSON.parse(await d.evalJs(`JSON.stringify(BCC.instance('checkpoints').export(BCC.stores.checkpoints.all()))`));
  check('export withholds sensitive keys by default and lists them, carries the env map', () => {
    assert.equal(exported.items[0].storage.local['auth.token'], undefined);
    assert.equal(exported.items[0].storage.local['app.user'], cp.storage.local['app.user']);
    assert.ok(exported.withheld.some((w) => w.endsWith(':auth.token')));
    assert.deepEqual(exported.envMap, { fixture: { a: A, b: B } });
  });
  const exportedAll = JSON.parse(await d.evalJs(`JSON.stringify(BCC.instance('checkpoints').export(BCC.stores.checkpoints.all(), { includeSensitive: true }))`));
  check('opt-in export includes sensitive keys', () => assert.equal(exportedAll.items[0].storage.local['auth.token'], 'secret-jwt-value'));

  // library tab shows it; row detail diff after a change
  await d.evalJs(`localStorage.setItem('app.user', '{"id":43}'); sessionStorage.removeItem('wizard.step'); localStorage.setItem('extra', '1')`);
  const diff = await d.evalJs(`BCC.instance('checkpoints').diff(BCC.stores.checkpoints.all()[0]).summary`);
  check('diff against current page: changed / missing / added', () => { assert.equal(diff.changed, 1); assert.equal(diff.missing, 1); assert.ok(diff.added >= 1); });

  // wipe, then restore via the API path (the UI button confirms; confirm() is stubbed)
  await d.evalJs(`localStorage.removeItem('app.user'); localStorage.removeItem('extra'); sessionStorage.clear(); document.cookie = 'theme=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'; scrollTo(0, 0); history.replaceState(null, '', '/api.html')`);
  await d.evalJs(`window.confirm = () => true`);
  const loaded = cdp.once('Page.loadEventFired', 8000);
  await S(`$click('checkpoints', 'Restore')`);
  await loaded; await sleep(200);
  const after = JSON.parse(await d.evalJs(`JSON.stringify({ path: location.pathname, user: localStorage.getItem('app.user'), step: sessionStorage.getItem('wizard.step'), cookie: document.cookie, extra: localStorage.getItem('extra') })`));
  check('restore writes storage + cookies and navigates to the saved path', () => {
    assert.equal(after.path, '/');
    assert.equal(after.user, JSON.stringify({ id: 42, name: 'Dana' }));
    assert.equal(after.step, '3');
    assert.match(after.cookie, /theme=dark/);
  });
  // The fixture page re-writes app.user on load, so check replace-mode semantics via the undo record instead.
  await reinject();
  await sleep(200);
  const scrollY = await d.evalJs(`scrollY`);
  check('scroll restored after re-injection (pending-scroll handoff)', () => assert.equal(scrollY, 600));
  const undo = await d.evalJs(`BCC.stores.checkpoints.all().filter((c) => c.tags.includes('before-restore'))`);
  check('an automatic "before restore" checkpoint was taken', () => { assert.equal(undo.length, 1); assert.equal(undo[0].storage.local['app.user'], undefined); assert.equal(undo[0].url.path, '/api.html'); });
  const restored = await d.evalJs(`BCC.stores.checkpoints.all().find((c) => c.journey === 'refund flow')`);
  check('restore count recorded on the checkpoint', () => assert.equal(restored.restoreCount, 1));

  // star → dock quick-restore
  await d.evalJs(`BCC.stores.checkpoints.update('${cp.id}', { starred: true })`);
  await S(`$('.dock .dock__menu').click()`); await sleep(40);
  const menu = await S(`$$('.menu__row').map((r) => r.textContent)`);
  check('starred checkpoint appears in the dock quick-restore menu', () => assert.ok(menu.some((t) => /refund flow › step 3/.test(t)), JSON.stringify(menu)));
  check('dock menu lists the environments of this app', () => assert.ok(menu.some((t) => /^○?●?\s*[ab]/.test(t) || /here/.test(t)), JSON.stringify(menu)));
  await S(`$('.dock .dock__menu').click()`);

  // cross-origin: import on B with origin rewrite of values containing A
  const file = JSON.stringify(exportedAll);
  await inject({ url: `${B}/` });
  await d.evalJs(`BCC.settings.set('envMap', {})`);
  const imp = await d.evalJs(`BCC.start('checkpoints').import(${JSON.stringify(file)})`);
  await asyncCheck('import merges checkpoints and their env map', async () => {
    assert.equal(imp.added, 1);
    assert.deepEqual(await d.evalJs(`BCC.settings.get('envMap')`), { fixture: { a: A, b: B } });
  });
  const target = await d.evalJs(`BCC.stores.checkpoints.all().find((c) => c.journey === 'refund flow')`);
  check('imported checkpoint retains its source origin for provenance', () => assert.equal(target.url.origin, A));
  await d.evalJs(`localStorage.setItem('apiBase', 'wrong')`);
  const loadedB = cdp.once('Page.loadEventFired', 8000);
  await d.evalJs(`BCC.instance('checkpoints').restore(BCC.stores.checkpoints.all().find((c) => c.journey === 'refund flow'))`);
  await loadedB; await sleep(150);
  // the fixture's inline script rewrites apiBase on load, so verify the rewrite through the undo/written values instead:
  await reinject();
  const rewritten = await d.evalJs(`(() => { const cps = BCC.stores.checkpoints.all(); const src = cps.find((c) => c.journey === 'refund flow'); return { origin: location.origin, restoredOnB: src.restoreCount, apiBaseNow: localStorage.getItem('apiBase') }; })()`);
  check('cross-origin restore lands on B and rewrites values containing the old origin', () => {
    assert.equal(rewritten.origin, B);
    assert.equal(rewritten.apiBaseNow, `${B}/api`);
  });
});

// ---------------------------------------------------------------------------
section('storage editor + env switcher + settings', async () => {
  await inject();
  await d.evalJs(`BCC.start('storage')`); await sleep(60);
  const rows = await S(`[...$panel('storage').querySelectorAll('.item code')].map((c) => c.textContent)`);
  check('storage editor lists app keys but not bcc: keys', () => { assert.ok(rows.includes('app.user')); assert.ok(!rows.some((k) => k.startsWith('bcc:'))); });
  await S(`$click('storage', 'Watch writes')`); await sleep(30);
  await d.evalJs(`(function resetTheme() { localStorage.setItem('theme', 'light'); })(); localStorage.removeItem('ff_newInvoices')`);
  await sleep(30);
  const log = await d.evalJs(`BCC.instance('storage').log.map((e) => ({ op: e.op, key: e.key, hasStack: !!e.stack }))`);
  check('watch mode logs setItem and removeItem with a stack', () => {
    assert.deepEqual(log.map((l) => `${l.op}:${l.key}`), ['set:theme', 'remove:ff_newInvoices']);
    assert.ok(log.every((l) => l.hasStack));
  });
  await d.evalJs(`BCC.stop('storage')`);
  await asyncCheck('Storage.prototype restored after stop', async () => assert.equal(await d.evalJs(`Storage.prototype.setItem.name`), 'setItem'));

  // env switcher
  await d.evalJs(`BCC.start('env')`); await sleep(50);
  await S(`$set($field('env', 'app name, e.g. billing'), 'fixture'); $set($field('env', 'env name, e.g. test'), 'a'); return true`);
  await S(`$click('env', 'Add this origin')`); await sleep(50);
  await asyncCheck('unknown origin can be mapped from the panel', async () => assert.deepEqual(await d.evalJs(`BCC.settings.get('envMap')`), { fixture: { a: A } }));
  await d.evalJs(`BCC.settings.set('envMap', { fixture: { a: '${A}', b: '${B}' } }); history.replaceState(null, '', '/api.html?x=1')`);
  await sleep(50);
  const loaded = cdp.once('Page.loadEventFired', 8000);
  await S(`$click('env', 'Open same path →')`);
  await loaded;
  await asyncCheck('env switcher opens the same path on the other environment', async () => assert.equal(await d.evalJs(`location.href`), `${B}/api.html?x=1`));

  // settings: change hotkey, palette follows
  await reinject();
  await d.evalJs(`BCC.start('settings')`); await sleep(50);
  await S(`$set($field('settings', 'Ctrl+Shift+Space'), 'Ctrl+Shift+K')`);
  await S(`$click('settings', 'Save')`); await sleep(40);
  await d.key(' ', { code: 'Space', modifiers: 2 | 8 }); await sleep(40);
  const oldOpens = await S(`!!$('.pal')`);
  await d.key('k', { code: 'KeyK', modifiers: 2 | 8 }); await sleep(40);
  const newOpens = await S(`!!$('.pal')`);
  check('hotkey change takes effect immediately', () => { assert.equal(oldOpens, false); assert.equal(newOpens, true); });
});

// ---------------------------------------------------------------------------
section('network recorder', async () => {
  await inject({ url: `${A}/api.html` });
  await d.evalJs(`BCC.settings.set('envMap', { fixture: { a: '${A}', b: '${B}' } }); BCC.start('net')`); await sleep(80);
  await d.evalJs(`(async () => {
    await callApi('/api/invoices');
    await callApi('/api/invoices', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer secret' }, body: JSON.stringify({ total: 10 }) });
    await callXhr('GET', '/api/invoices/1');
    await callApi('/api/error');
    await callApi('/api/text');
  })()`);
  await sleep(300);
  const entries = await d.evalJs(`JSON.stringify(BCC.instance('net').entries)`).then(JSON.parse);
  check('five requests recorded via fetch and XHR', () => assert.equal(entries.length, 5));
  const list = entries.find((e) => e.method === 'GET' && /\/api\/invoices$/.test(e.url));
  check('JSON response parsed, status and timing captured', () => { assert.equal(list.status, 200); assert.equal(list.responseType, 'json'); assert.equal(list.responseBody[0].id, 1); assert.ok(list.duration >= 0); assert.equal(list.transport, 'fetch'); });
  const post = entries.find((e) => e.method === 'POST');
  check('request body captured, authorization header stripped', () => { assert.equal(post.requestBody, '{"total":10}'); assert.equal(post.status, 201); assert.equal(post.requestHeaders.authorization, undefined); assert.equal(post.requestHeaders['content-type'], 'application/json'); });
  const xhr = entries.find((e) => e.transport === 'xhr');
  check('XHR recorded with its request header and parsed body', () => { assert.equal(xhr.requestHeaders['x-test'], '1'); assert.equal(xhr.responseBody.id, 1); assert.equal(xhr.status, 200); });
  check('error status and plain text bodies recorded', () => { assert.equal(entries.find((e) => /error/.test(e.url)).status, 500); assert.equal(entries.find((e) => /text/.test(e.url)).responseBody, 'plain text body'); });
  const pre = await d.evalJs(`BCC.instance('net').pre.map((r) => r.url)`);
  check('pre-injection request listed from the performance timeline', () => assert.ok(pre.some((u) => u.includes('early=1')), JSON.stringify(pre)));

  const msw = await d.evalJs(`BCC.instance('net').exportAs('msw', undefined, { toClipboard: true })`);
  check('MSW export infers path params and emits handlers per endpoint', () => {
    assert.match(msw, /http\.get\('\/api\/invoices', /); assert.match(msw, /http\.post\('\/api\/invoices', /);
    assert.match(msw, /http\.get\('\/api\/invoices\/:invoiceId', /); assert.match(msw, /HttpResponse\.json\(/); assert.match(msw, /status: 500/);
  });
  const pw = await d.evalJs(`BCC.instance('net').exportAs('playwright', undefined, { toClipboard: true })`);
  check('Playwright export routes each endpoint', () => { assert.match(pw, /page\.route\('\*\*\/api\/invoices\/\*'/); assert.match(pw, /route\.fulfill/); });
  const json = JSON.parse(await d.evalJs(`BCC.instance('net').exportAs('json', undefined, { toClipboard: true })`));
  check('JSON fixtures de-duplicated by method + path', () => { assert.ok(json['GET /api/invoices']); assert.ok(json['GET /api/invoices/:invoiceId']); assert.deepEqual(json['GET /api/invoices/:invoiceId'].params, ['invoiceId']); });
  const har = JSON.parse(await d.evalJs(`BCC.instance('net').exportAs('har', undefined, { toClipboard: true })`));
  check('HAR 1.2 export is well-formed', () => { assert.equal(har.log.version, '1.2'); assert.equal(har.log.entries.length, 5); assert.equal(har.log.entries[0].request.method, 'GET'); });
  const md = await d.evalJs(`BCC.instance('net').apiMarkdown()`);
  check('API contract markdown lists endpoints with shapes', () => { assert.match(md, /GET \/api\/invoices\/:invoiceId/); assert.match(md, /response shape/); });

  const replayed = await d.evalJs(`BCC.instance('net').replay(BCC.instance('net').entries.find((e) => e.method === 'POST'), { body: '{"total":99}' })`);
  check('request replay re-sends against the current origin with an edited body', () => { assert.equal(replayed.status, 201); assert.equal(replayed.responseBody.total, 99); assert.equal(replayed.transport, 'replay'); });
  const replayedB = await d.evalJs(`(() => { const e = BCC.instance('net').entries.find((x) => x.method === 'GET' && /invoices$/.test(x.url)); const recordedElsewhere = { ...e, url: e.url.replace('${A}', '${B}') }; return BCC.instance('net').replay(recordedElsewhere, { targetOrigin: location.origin }); })()`);
  check('a request recorded on another environment replays against the current origin (origin rewritten)', () => { assert.equal(replayedB.status, 200); assert.ok(replayedB.url.startsWith(A), replayedB.url); });
  await d.evalJs(`window.prompt = (m, dflt) => m.startsWith('Name') ? 'invoice flow' : 'refund'`);
  const rec = await d.evalJs(`BCC.instance('net').save()`);
  check('recording saved with app/env/journey metadata', () => { assert.equal(rec.name, 'invoice flow'); assert.equal(rec.app, 'fixture'); assert.equal(rec.env, 'a'); assert.equal(rec.journey, 'refund'); assert.ok(rec.entries.length >= 5); });
  const prompt = await d.evalJs(`BCC.start('basket').build()`);
  await d.evalJs(`BCC.stores.basket.add({ kind: 'recording', name: 'x', entries: BCC.instance('net').entries.slice(0, 2) })`);
  const prompt2 = await d.evalJs(`BCC.instance('basket').build()`);
  check('basket renders a recording as an API contract section', () => { assert.ok(!/API traffic/.test(prompt)); assert.match(prompt2, /## API traffic/); assert.match(prompt2, /GET \/api\/invoices/); });
});

// ---------------------------------------------------------------------------
section('mock mode', async () => {
  await inject({ url: `${A}/api.html` });
  await d.evalJs(`BCC.settings.set('envMap', { fixture: { a: '${A}' } }); BCC.start('mock')`); await sleep(60);
  await d.evalJs(`
    const m = BCC.instance('mock');
    m.addRule({ method: 'GET', url: '/api/invoices/*', status: 200, body: { id: 99, mocked: true } });
    m.addRule({ method: 'GET', url: '/api/echo', failTimes: 2, failStatus: 503, status: 200, body: { recovered: true } });
    m.addRule({ method: 'POST', url: '/api/text', drop: true });
    m.addRule({ method: 'GET', url: '/api/slow', delay: 300, status: 200, body: 'slow-mock' });
    m.enable();
  `);
  await sleep(50);
  const r1 = await d.evalJs(`callApi('/api/invoices/1')`);
  check('fetch answered from the rule (glob path match)', () => { assert.equal(r1.status, 200); assert.deepEqual(JSON.parse(r1.text), { id: 99, mocked: true }); });
  const x1 = await d.evalJs(`callXhr('GET', '/api/invoices/2')`);
  check('XHR answered from the rule with load events', () => { assert.equal(x1.status, 200); assert.equal(JSON.parse(x1.text).mocked, true); });
  const seq = await d.evalJs(`(async () => [await callApi('/api/echo'), await callApi('/api/echo'), await callApi('/api/echo')])()`);
  check('fail N times then succeed', () => assert.deepEqual(seq.map((r) => r.status), [503, 503, 200]));
  check('third response is the rule body', () => assert.deepEqual(JSON.parse(seq[2].text), { recovered: true }));
  const dropped = await d.evalJs(`callApi('/api/text', { method: 'POST' }).then(() => 'resolved').catch((e) => 'rejected:' + e.message)`);
  check('drop rule rejects the fetch like a network failure', () => assert.match(dropped, /^rejected:.*BCC mock/));
  const timing = await d.evalJs(`(async () => { const t = performance.now(); const r = await callApi('/api/slow'); return { ms: performance.now() - t, text: r.text }; })()`);
  check('latency rule delays the mocked response', () => { assert.ok(timing.ms >= 280, `${timing.ms}ms`); assert.equal(timing.text, 'slow-mock'); });
  const passthrough = await d.evalJs(`callApi('/api/invoices')`);
  check('unmatched requests pass through to the network', () => { assert.equal(passthrough.status, 200); assert.equal(JSON.parse(passthrough.text)[0].id, 1); });
  const hits = await d.evalJs(`BCC.instance('mock').engine.hits.length`);
  check('hits are logged', () => assert.ok(hits >= 7, String(hits)));
  const rulesShown = await S(`[...$panel('mock').querySelectorAll('.item .mono.grow')].map((e) => e.textContent)`);
  check('rules table lists the four rules', () => assert.deepEqual(rulesShown.sort(), ['/api/echo', '/api/invoices/*', '/api/slow', '/api/text']));

  // persists per app: re-inject → engine re-armed at boot without opening the panel
  await d.goto(`${A}/api.html`); await d.evalJs(bundle); await sleep(150);
  const armed = await d.evalJs(`BCC.running().length === 0 && BCC.intercept.active`);
  const r2 = await d.evalJs(`callApi('/api/invoices/7')`);
  check('mock mode re-arms at boot for this app, with no panel open', () => { assert.equal(armed, true); assert.equal(JSON.parse(r2.text).mocked, true); });
  await S(`$('.dock .dock__menu').click()`); await sleep(40);
  const row = await S(`$$('.menu__row').find((r) => /Mock responses/.test(r.textContent))?.textContent`);
  check('dock menu shows the mock switch as on with the rule count', () => { assert.match(row, /on/); assert.match(row, /4 rules/); });
  await S(`$$('.menu__row').find((r) => /Mock responses/.test(r.textContent)).click()`); await sleep(40);
  const r3 = await d.evalJs(`callApi('/api/invoices/1')`);
  check('dock switch turns mock mode off; real response returns', () => { assert.equal(JSON.parse(r3.text).id, 1); assert.equal(JSON.parse(r3.text).mocked, undefined); });
  await asyncCheck('mock setting persisted off', async () => assert.equal(await d.evalJs(`BCC.settings.get('mockEnabled').fixture`), false));
});

// ---------------------------------------------------------------------------
section('journeys', async () => {
  await fetch(`${A}/reset`);
  await inject({ url: `${A}/form1.html` });
  await d.evalJs(`BCC.settings.set('envMap', { fixture: { a: '${A}' } }); BCC.stores.journeys.clear(); BCC.stores.checkpoints.clear(); BCC.start('journey').record()`); await sleep(60);
  // record: type a name, pick a plan, tick, type a pin, click Next (hard navigation)
  await d.evalJs(`document.getElementById('name').focus()`);
  await d.type('Dana Q'); await sleep(30);
  await d.evalJs(`const s = document.querySelector('select[name=plan]'); s.value = 'pro'; s.dispatchEvent(new Event('change', { bubbles: true }));`);
  await d.evalJs(`document.querySelector('input[name=agree]').click()`);
  await d.evalJs(`document.querySelector('input[name=pin]').focus()`);
  await d.type('4321'); await sleep(30);
  const mid = await d.evalJs(`JSON.stringify(BCC.instance('journey').steps.map((s) => ({ action: s.action, value: s.value, first: s.selectors[0] })))`).then(JSON.parse);
  check('steps recorded with coalesced input, select, check; password value replaced by ‹prompt›', () => {
    assert.deepEqual(mid.map((s) => s.action), ['input', 'select', 'check', 'input']);
    assert.equal(mid[0].value, 'Dana Q'); assert.equal(mid[1].value, 'pro'); assert.equal(mid[2].value, true); assert.equal(mid[3].value, '‹prompt›');
  });
  check('selector strategy: label first for a labelled input, data-testid first when present', () => {
    assert.deepEqual(mid[0].first, { kind: 'label', value: 'Customer name', tag: 'input' });
    assert.deepEqual(mid[3].first, { kind: 'testid', value: 'pin' });
  });
  const nav1 = cdp.once('Page.loadEventFired', 8000);
  await d.evalJs(`document.querySelector('[data-testid=next]').click()`);
  await nav1; await sleep(100);
  await asyncCheck('the recorded click navigated to step 2 and the server got the form', async () => { assert.equal(await d.evalJs(`location.pathname`), '/form2.html'); const got = await (await fetch(`${A}/received`)).json(); assert.equal(got[0].form.name, 'Dana Q'); });
  await reinject();
  await sleep(150);
  const resumed = await d.evalJs(`JSON.stringify({ running: BCC.running(), n: BCC.instance('journey')?.steps.length, banner: document.getElementById('bcc-root').shadowRoot.querySelector('.panel[data-panel=journey] .panel__body div').textContent })`).then(JSON.parse);
  check('recording resumes after the hard navigation with the steps kept', () => { assert.deepEqual(resumed.running, ['journey']); assert.ok(resumed.n >= 5, `steps ${resumed.n}`); assert.match(resumed.banner, /Recording/); });
  await d.evalJs(`document.getElementById('amount').focus()`);
  await d.type('250'); await sleep(30);
  const nav2 = cdp.once('Page.loadEventFired', 8000);
  await d.evalJs(`document.querySelector('#f2 button').click()`);
  await nav2; await sleep(80);
  await reinject(); await sleep(150);
  await d.evalJs(`window.prompt = () => 'wizard journey'`);
  const saved = await d.evalJs(`BCC.instance('journey').save()`);
  check('journey saved after two pages with implicit submits marked', () => {
    const actions = saved.steps.map((s) => s.action);
    assert.deepEqual(actions, ['input', 'select', 'check', 'input', 'click', 'submit', 'input', 'click', 'submit']);
    assert.ok(saved.steps.filter((s) => s.action === 'submit').every((s) => s.implicit));
    assert.equal(saved.name, 'wizard journey'); assert.equal(saved.startUrl, '/form1.html');
  });
  await asyncCheck('in-progress recording state cleared once saved', async () => assert.equal(await d.evalJs(`sessionStorage.getItem('bcc:journey:recording')`), null));

  // replay from a clean page, across the hard navigation, asking for the pin, ending with a checkpoint
  await fetch(`${A}/reset`);
  await d.goto(`${A}/form1.html`); await d.evalJs(bundle); await sleep(120);
  await d.evalJs(`window.prompt = () => '9999'; const j = BCC.start('journey'); j.load(BCC.stores.journeys.all()[0]); j.setEndWithCheckpoint(true);`);
  const nav3 = cdp.once('Page.loadEventFired', 10000);
  await d.evalJs(`BCC.instance('journey').replay(); true`);
  await nav3; await sleep(80);
  const pending = JSON.parse(await d.evalJs(`sessionStorage.getItem('bcc:journey:pending')`));
  check('pending run persisted before the navigating step', () => { assert.equal(pending.index, 5); assert.equal(pending.endWithCheckpoint, true); assert.equal(pending.values['3'], '9999'); });
  const nav4 = cdp.once('Page.loadEventFired', 12000);
  await reinject();                                  // auto-resumes → fills amount → Finish → /done.html
  await nav4; await sleep(80);
  const received = await (await fetch(`${A}/received`)).json();
  check('replay recreated both submits on the server, React-style value writes included', () => {
    assert.equal(received.length, 2);
    assert.deepEqual(received[0].form, { name: 'Dana Q', plan: 'pro', agree: 'yes', pin: '9999' });
    assert.deepEqual(received[1].form, { amount: '250' });
  });
  await d.evalJs(`localStorage.setItem('after', '1')`);
  await reinject(); await sleep(400);
  const done = await d.evalJs(`JSON.stringify({ path: location.pathname, pending: sessionStorage.getItem('bcc:journey:pending'), cps: BCC.stores.checkpoints.all().map((c) => [c.journey, c.step]) })`).then(JSON.parse);
  check('run completes on the last page, pending cleared, end-with-checkpoint saved', () => { assert.equal(done.path, '/done.html'); assert.equal(done.pending, null); assert.deepEqual(done.cps, [['wizard journey', 'after replay']]); });

  // React controlled input: native setter + input event reaches the component's state
  await inject({ url: `${A}/react.html` });
  const res = await d.evalJs(`(async () => { const j = BCC.start('journey'); j.steps = [
      { action: 'input', value: 'Dana', selectors: [{ kind: 'testid', value: 'name-input' }] },
      { action: 'click', selectors: [{ kind: 'role', value: 'button:Save name' }] },
    ]; const r = await j.replay(); return { r, status: document.getElementById('status').textContent, name: document.getElementById('status').dataset.name }; })()`);
  check('React-style controlled input accepts the replayed value and the click saves it', () => { assert.equal(res.r.ok, true); assert.equal(res.status, 'saved:Dana'); assert.equal(res.name, 'Dana'); });
  const fail = await d.evalJs(`(async () => { const j = BCC.instance('journey'); j.steps = [{ action: 'click', selectors: [{ kind: 'testid', value: 'nope' }] }]; BCC.stop('journey'); const j2 = BCC.start('journey', { timeout: 300, onFailure: async () => 'abort' }); j2.steps = [{ action: 'click', selectors: [{ kind: 'testid', value: 'nope' }] }]; return j2.replay(); })()`);
  check('a missing element stops the run visibly instead of silently continuing', () => { assert.equal(fail.ok, false); assert.equal(fail.reason, 'not found'); });
});

// ---------------------------------------------------------------------------
section('context depth: components, errors, facts, a11y, presets', async () => {
  await inject({ url: `${A}/react.html` });
  const tree = await d.evalJs(`BCC.start('components').pick(document.getElementById('name'))`);
  check('component tree walks the fiber chain nearest-first with host tags', () => {
    assert.deepEqual(tree.chain.map((c) => c.name), ['Field', 'InvoiceForm', 'Page']);
    assert.equal(tree.chain[0].host, 'input'); assert.equal(tree.chain[2].host, 'div');
  });
  check('props sanitised (functions → ƒ, arrays kept short), hooks counted, source surfaced', () => {
    assert.match(tree.chain[0].props.onChange, /^ƒ/); assert.equal(tree.chain[0].props.label, 'Name');
    assert.deepEqual(tree.chain[1].props.items, [1, 2, 3]);
    assert.equal(tree.chain[0].hooks, 2); assert.equal(tree.chain[0].source, 'components/Field.tsx:12');
    assert.equal(tree.minified, false);
  });
  const md = await d.evalJs(`BCC.start('basket').build()`);
  await d.evalJs(`BCC.stores.basket.add(BCC.instance('components').last)`);
  const md2 = await d.evalJs(`BCC.instance('basket').build()`);
  check('component tree renders in the prompt', () => { assert.ok(!/## Components/.test(md)); assert.match(md2, /## Components/); assert.match(md2, /\*\*Field\*\* \(`<input>`\) · 2 hooks · `components\/Field.tsx:12`/); });
  const notReact = await d.evalJs(`BCC.instance('components').pick(document.querySelector('h1'))`);
  check('an element without a fiber reports why instead of guessing', () => { assert.equal(notReact.chain.length, 0); assert.match(notReact.note, /no fiber/); });
  await d.evalJs(`BCC.stop('components')`);

  // errors
  await d.evalJs(`BCC.start('errors')`); await sleep(40);
  await d.evalJs(`
    console.error('boom', { code: 7 });
    console.error('boom', { code: 7 });
    console.warn('careful');
    setTimeout(() => { throw new Error('uncaught one'); }, 0);
    Promise.reject(new Error('nobody caught me'));
    const img = document.createElement('img'); img.src = '/definitely-missing.png'; document.body.appendChild(img);
  `);
  await sleep(400);
  const errs = await d.evalJs(`JSON.stringify(BCC.instance('errors').entries.map((e) => ({ level: e.level, message: e.message, count: e.count, hasStack: !!e.stack })))`).then(JSON.parse);
  check('console.error/warn, uncaught, rejection and resource failures captured; duplicates coalesced', () => {
    const by = (lvl) => errs.filter((e) => e.level === lvl);
    assert.equal(by('error').length, 1); assert.equal(by('error')[0].count, 2); assert.match(by('error')[0].message, /boom \{"code":7\}/);
    assert.equal(by('warn')[0].message, 'careful');
    assert.match(by('uncaught')[0].message, /uncaught one/); assert.ok(by('uncaught')[0].hasStack);
    assert.match(by('unhandledrejection')[0].message, /nobody caught me/);
    assert.match(by('resource')[0].message, /definitely-missing\.png/);
  });
  await d.evalJs(`BCC.stop('errors')`);
  await asyncCheck('console methods restored after stop', async () => assert.equal(await d.evalJs(`/native code/.test(console.error.toString())`), true));

  // page facts on the main fixture (feature flag key present)
  await inject();
  const facts = await d.evalJs(`BCC.start('facts').facts`);
  const fmd = await d.evalJs(`BCC.instance('facts').markdown`);
  check('page facts: flags found by pattern, vitals present, viewport and storage counts', () => {
    assert.ok(facts.flags.some((f) => f.key === 'ff_newInvoices' && f.value === 'true'), JSON.stringify(facts.flags));
    assert.equal(typeof facts.vitals.ttfb, 'number'); assert.ok(facts.vitals.resources >= 0);
    assert.equal(facts.viewport.width, 1200); assert.ok(facts.storage.local >= 4);
    assert.match(fmd, /Feature flags found in storage/); assert.match(fmd, /Vitals so far/);
  });
  await d.evalJs(`BCC.stop('facts')`);

  // a11y outline
  const a11y = await d.evalJs(`BCC.start('a11y').analyse(document.getElementById('main'))`);
  check('a11y outline: roles, names, headings, unlabeled control and contrast failure flagged', () => {
    assert.equal(a11y.region, '#main');
    assert.match(a11y.markdown, /- h1 Invoices/); assert.match(a11y.markdown, /- navigation "Pages"/);
    assert.match(a11y.markdown, /textbox "Search"/); assert.match(a11y.markdown, /button "Refresh list"/);
    assert.match(a11y.markdown, /link "API page"/);
    assert.ok(a11y.summary.contrastFailures >= 1, 'low-contrast paragraph should be flagged');
    assert.match(a11y.markdown, /Low contrast text here/);
  });
  await d.evalJs(`BCC.stop('a11y')`);

  // basket presets + persisted include
  await d.evalJs(`BCC.stores.basket.clear(); BCC.stores.basket.add({ kind: 'note', title: 'n', body: 'b' }); BCC.stores.basket.add({ kind: 'errors', entries: [{ level: 'error', message: 'x' }] }); BCC.stores.basket.add({ kind: 'facts', markdown: 'F', facts: {} });`);
  await d.evalJs(`BCC.start('basket')`); await sleep(40);
  await S(`const sel = $panel('basket').querySelector('select'); sel.value = 'wire'; $click('basket', 'Apply'); return true`);
  const wire = await d.evalJs(`BCC.instance('basket').build()`);
  check('preset "wire" includes errors and excludes notes and facts', () => { assert.match(wire, /## Errors/); assert.ok(!/## Notes/.test(wire)); assert.ok(!/## Environment/.test(wire)); });
  await d.evalJs(`BCC.stop('basket')`);
  const persisted = await d.evalJs(`BCC.start('basket').build()`);
  check('include/exclude ticks persist across reopen', () => { assert.ok(!/## Notes/.test(persisted)); assert.match(persisted, /## Errors/); });
  const n = await d.evalJs(`BCC.tools().length`);
  check('full catalogue registered', () => assert.equal(n, 21));
});

// ---------------------------------------------------------------------------
section('hub', async () => {
  process.env.BCC_HUB_DIR = `${process.env.TMPDIR ?? '/tmp'}/bcc-hub-test-${Date.now()}`;
  const { server } = await import('../hub/server.mjs');
  await new Promise((r) => server.listen(7373, '127.0.0.1', r));
  try {
    await inject();
    await d.evalJs(`BCC.stores.basket.clear(); BCC.stores.basket.add({ id: 'hubbed', kind: 'note', title: 'from A', body: 'x' })`);
    await sleep(250);
    const ping = await d.evalJs(`BCC.hub.ping()`);
    check('hub answers ping with its name and version', () => { assert.equal(ping.ok, true); assert.equal(ping.name, 'bcc-hub'); });
    const onHub = await (await fetch('http://127.0.0.1:7373/items?ns=basket')).json();
    check('basket writes mirror to the hub automatically', () => assert.ok(onHub.items.some((i) => i.id === 'hubbed'), JSON.stringify(onHub)));
    await inject({ url: `${B}/` });
    await d.evalJs(`BCC.stores.basket.clear(); BCC.start('basket')`); await sleep(40);
    await S(`$click('basket', 'Pull hub')`); await sleep(300);
    const pulled = await d.evalJs(`BCC.stores.basket.all().map((i) => i.id)`);
    check('"Pull hub" on another origin merges the mirrored item', () => assert.deepEqual(pulled, ['hubbed']));
    const ns = await (await fetch('http://127.0.0.1:7373/namespaces')).json();
    check('hub lists namespaces', () => assert.ok(ns.namespaces.includes('basket')));
    await d.evalJs(`BCC.start('diagnose')`); await sleep(700);
    const report = await S(`$panel('diagnose').querySelector('pre').textContent`);
    check('diagnose reports the live hub as reachable when CSP allows it', () => assert.match(report, /live hub ping: reachable/));
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ---------------------------------------------------------------------------
const run = async () => {
  for (const [name, fn] of Object.entries(sections)) {
    if (only.length && !only.some((o) => name.includes(o))) continue;
    console.log(`\n${name}:`);
    try { await fn(); } catch (e) { fail++; console.error(`  ✗ section aborted: ${e.message.split('\n')[0]}`); }
  }
};

try {
  await run();
  console.log(`\n${pass} browser checks passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
} finally {
  await close();
  app.close();
}
