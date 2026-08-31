// Pure-logic tests, no browser. The DOM tools are covered by browser.mjs; this
// covers everything that would silently poison a prompt, a checkpoint file, a
// fixture export or a mock rule: normalisers, the comparison engine, the
// markdown renderers, the store, the checkpoint schema, fixture generators,
// CSP analysis, mock matching, hotkeys and env-map resolution.
import assert from 'node:assert/strict';

// --- minimal browser shims so core modules load under Node -------------------
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; },
};
globalThis.sessionStorage = { ...globalThis.localStorage };
globalThis.location = { origin: 'https://billing-test.corp', href: 'https://billing-test.corp/invoices/12?tab=lines#top', hostname: 'billing-test.corp', pathname: '/invoices/12', search: '?tab=lines', hash: '#top' };
globalThis.window = globalThis;
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', sendBeacon: () => true }, configurable: true });
globalThis.XMLHttpRequest = function () {}; XMLHttpRequest.prototype = {};
globalThis.fetch = async () => { throw new Error('no network in unit tests'); };

const { px, color, fontWeight, fontFamily, emptyNode, capture } = await import('../src/core/schema/style.js');
const { compareNodes } = await import('../src/core/compare.js');
const { toMarkdown, PRESETS, labelFor } = await import('../src/core/export/markdown.js');
const { Store, kv, keyFor } = await import('../src/core/store/store.js');
const { migrate } = await import('../src/core/store/migrate.js');
const settings = await import('../src/app/settings.js');
const site = await import('../src/core/site.js');
const cp = await import('../src/core/schema/checkpoint.js');
const fx = await import('../src/core/export/fixtures.js');
const csp = await import('../src/core/csp.js');
const mock = await import('../src/core/net/mock-engine.js');
const { parseCollect } = await import('../src/adapters/web/ga4.js');
const { headersToObject, bodyToText } = await import('../src/core/net/intercept.js');

let pass = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; } };

// --- style schema + compare + markdown (carried over) -----------------------
t('px units', () => {
  assert.equal(px('16px'), 16); assert.equal(px('1.5rem'), 24); assert.equal(px('2em', { parentFontSize: 20 }), 40);
  assert.equal(px('12pt'), 16); assert.equal(px('normal'), null); assert.equal(px('Mixed'), null); assert.equal(px('50%'), null); assert.equal(px(24), 24); assert.equal(px(''), null);
});
t('color normalisation', () => {
  assert.equal(color('#FFF'), '#ffffff'); assert.equal(color('rgb(255, 0, 0)'), '#ff0000'); assert.equal(color('rgba(0,0,0,0.5)'), '#00000080');
  assert.equal(color('#ff0000ff'), '#ff0000'); assert.equal(color('transparent'), '#00000000'); assert.equal(color('rgb(59 111 224 / 1)'), '#3b6fe0'); assert.equal(color('Mixed'), null);
});
t('font weight and family', () => { assert.equal(fontWeight('Semi Bold'), 600); assert.equal(fontWeight('700'), 700); assert.equal(fontWeight('Regular'), 400); assert.equal(fontFamily('"Inter", sans-serif'), 'Inter'); });
t('compare finds real mismatches and tolerates float noise', () => {
  const design = emptyNode({ name: 'Button' }); design.box = { width: 120, height: 40 };
  design.typography = { ...design.typography, fontSize: 16, fontWeight: 600, color: '#ffffff', lineHeight: 24 }; design.fill.background = '#3b6fe0'; design.border.radius.tl = 8;
  const web = emptyNode({ name: 'button.btn' }); web.box = { width: 120.0003, height: 40 };
  web.typography = { ...web.typography, fontSize: 14, fontWeight: 600, color: '#ffffffff', lineHeight: 24 }; web.fill.background = '#3b6fe0'; web.border.radius.tl = 4;
  const all = compareNodes(design, web);
  assert.deepEqual(compareNodes(design, web, { onlyDifferences: true }).rows.map((r) => r.property).sort(), ['border-radius', 'font-size']);
  assert.equal(all.summary.mismatches, 2);
});
t('markdown export omits nulls and includes real values', () => {
  const node = emptyNode({ name: 'div.card', ref: 'div.card', text: 'Hello' });
  node.typography = { ...node.typography, fontSize: 16, fontFamily: 'Inter', color: '#111111' }; node.border.radius = { tl: 8, tr: 8, br: 8, bl: 8 };
  const md = toMarkdown([capture({ source: 'web', node })], { task: 'Build the card' });
  assert.ok(md.includes('Build the card')); assert.ok(md.includes('Inter')); assert.ok(md.includes('radius: 8px')); assert.ok(md.includes('> Hello')); assert.ok(!md.includes('null'));
});
t('markdown renders comparison, story, note', () => {
  const md = toMarkdown([
    { kind: 'comparison', label: 'Button', rows: [{ property: 'font-size', design: 16, web: 14, match: false }] },
    { kind: 'story', storyId: 4821, storyType: 'story', title: 'Add filter chips', fields: { phase: 'In progress' }, description: 'Body', acceptanceCriteria: '- one', comments: [{ author: 'QA', body: 'looks off' }] },
    { kind: 'note', title: 'N', body: 'text' },
  ]);
  assert.ok(md.includes('| font-size | `16` | `14` | ❌ |')); assert.ok(md.includes('🎫 story 4821 — Add filter chips')); assert.ok(md.includes('**QA**: looks off')); assert.ok(md.includes('### 📝 N'));
});
t('markdown renders every new kind without throwing, in group order', () => {
  const items = [
    { kind: 'checkpoint', app: 'billing', env: 'test', journey: 'refund', step: 's3', url: { origin: 'https://x', path: '/p' }, storage: { local: { a: '1', token: 'zzz' }, session: {} }, cookies: [{ name: 'c', value: 'v' }], sensitive: ['token'] },
    { kind: 'recording', name: 'r', entries: [{ method: 'GET', url: 'https://x/api/invoices/12', status: 200, responseType: 'json', responseBody: { id: 12 }, duration: 5 }] },
    { kind: 'errors', entries: [{ level: 'error', message: 'boom', stack: 'at a\nat b', count: 2 }] },
    { kind: 'facts', markdown: '- **Framework**: React 18' },
    { kind: 'a11y', region: '#main', markdown: '- main' },
    { kind: 'component-tree', selector: '#name', chain: [{ name: 'Field', host: 'input', hooks: 2, source: 'Field.tsx:1', props: { a: 1 } }] },
    { kind: 'journey', name: 'wizard', steps: [{ action: 'input', value: 'x', selectors: [{ kind: 'label', value: 'Name' }] }] },
    { kind: 'request', entry: { method: 'POST', url: 'https://x/api/a', status: 201, responseBody: { ok: true }, responseType: 'json' } },
    { kind: 'mystery', foo: 1 },
  ];
  const md = toMarkdown(items);
  const order = ['## Environment', '## Components', '## Accessibility', '## Application state', '## API traffic', '## Requests', '## Errors', '## Journeys', '## Other'].map((h) => md.indexOf(h));
  assert.ok(order.every((i) => i >= 0), md.slice(0, 200));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'groups render in catalogue order');
  assert.ok(md.includes('_‹redacted›_'), 'sensitive checkpoint keys redacted in prompt');
  assert.ok(!md.includes('zzz'));
  assert.ok(md.includes('GET /api/invoices/:invoiceId'));
  assert.ok(md.includes('**error** boom ×2'));
  assert.ok(md.includes('**Field** (`<input>`) · 2 hooks · `Field.tsx:1`'));
  assert.ok(md.includes('```json\n{"foo":1'.slice(0, 7)));
  for (const it of items.slice(0, -1)) assert.ok(labelFor(it).length > 0);
  assert.ok(PRESETS.wire.kinds.includes('errors'));
});

// --- store ---------------------------------------------------------------------
t('Store: add/update/remove/merge/export/import round-trip', () => {
  mem.clear();
  const s = new Store('things', { idPrefix: 'th' });
  const a = s.add({ kind: 'x', v: 1 });
  assert.match(a.id, /^th_/); assert.equal(a.origin, 'https://billing-test.corp');
  s.update(a.id, { v: 2 });
  assert.equal(s.get(a.id).v, 2); assert.ok(s.get(a.id).updatedAt);
  const b = s.add({ id: 'fixed', kind: 'y' });
  const env = s.export();
  assert.equal(env.kind, 'bcc-export'); assert.equal(env.namespace, 'things'); assert.equal(env.count, 2);
  s.clear(); assert.equal(s.count(), 0);
  const r = s.import(JSON.stringify(env));
  assert.equal(r.added, 2); assert.equal(s.get('fixed').kind, 'y');
  assert.throws(() => s.import('{"namespace":"other","items":[]}'), /holds "other"/);
  assert.throws(() => s.import('{}'), /not a BCC export/);
  const r2 = s.merge([{ id: 'fixed', kind: 'y', updatedAt: '2000-01-01', v: 'old' }]);
  assert.equal(s.get('fixed').v, undefined, 'older incoming item must not overwrite newer local item');
  assert.equal(r2.added, 0);
  s.remove([a.id, b.id]); assert.equal(s.count(), 0);
});
t('Store: listeners fire and export can redact', () => {
  const s = new Store('l');
  let n = 0; const off = s.onChange(() => { n += 1; });
  s.add({ a: 1 }); s.add({ a: 2 }); off(); s.add({ a: 3 });
  assert.equal(n, 2);
  const e = s.export({ map: (i) => ({ ...i, a: '‹redacted›' }) });
  assert.ok(e.items.every((i) => i.a === '‹redacted›'));
});
t('kv settings bag with defaults', () => {
  const k = kv('kvtest');
  assert.equal(k.get('missing', 'dflt'), 'dflt');
  k.set('x', { y: 1 }); assert.deepEqual(k.get('x'), { y: 1 });
  k.patch({ z: 2 }); assert.deepEqual(k.all(), { x: { y: 1 }, z: 2 });
  k.delete('x'); assert.equal(k.get('x', null), null);
});
t('migration moves the contextforge basket to bcc: and unions when both exist', () => {
  mem.clear();
  localStorage.setItem('contextforge:basket:v1', JSON.stringify([{ id: 'a' }, { id: 'b' }]));
  localStorage.setItem(keyFor('basket'), JSON.stringify([{ id: 'b', new: true }, { id: 'c' }]));
  const moved = migrate();
  assert.deepEqual(moved, ['contextforge:basket:v1']);
  assert.equal(localStorage.getItem('contextforge:basket:v1'), null);
  const items = JSON.parse(localStorage.getItem(keyFor('basket')));
  assert.deepEqual(items.map((i) => i.id).sort(), ['a', 'b', 'c']);
  assert.equal(items.find((i) => i.id === 'b').new, true, 'the bcc: copy wins on conflict');
  assert.deepEqual(migrate(), [], 'second run is a no-op');
});

// --- settings / hotkeys / redaction ------------------------------------------------
t('hotkey parse + match', () => {
  assert.deepEqual(settings.parseHotkey('Ctrl+Shift+Space'), { ctrl: true, shift: true, alt: false, meta: false, key: ' ' });
  assert.equal(settings.matchesHotkey({ key: ' ', code: 'Space', ctrlKey: true, shiftKey: true }, 'Ctrl+Shift+Space'), true);
  assert.equal(settings.matchesHotkey({ key: ' ', code: 'Space', ctrlKey: true, shiftKey: false }, 'Ctrl+Shift+Space'), false);
  assert.equal(settings.matchesHotkey({ key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true }, 'Ctrl+Shift+K'), true);
  assert.equal(settings.matchesHotkey({ key: 'k', ctrlKey: true, shiftKey: true, altKey: true }, 'Ctrl+Shift+K'), false, 'extra modifier must not match');
  assert.equal(settings.formatHotkey('Ctrl+Shift+Space'), 'Ctrl + Shift + Space');
});
t('redaction rules: words and /regex/, case-insensitive; flag pattern', () => {
  const list = settings.DEFAULTS.redaction;
  for (const k of ['auth.token', 'JWT', 'session_id', 'refreshToken', 'my-secret', 'PASSWORD', 'Bearer']) assert.equal(settings.isSensitiveKey(k, list), true, k);
  for (const k of ['app.user', 'theme', 'cart']) assert.equal(settings.isSensitiveKey(k, list), false, k);
  assert.equal(settings.isSensitiveKey('x-api-key', ['/api[-_]?key/']), true);
  assert.equal(settings.redactionRegex([]).test('token'), false);
  assert.equal(settings.flagRegex('flag|ff_').test('ff_new'), true);
  assert.equal(settings.flagRegex('[').test('x'), false, 'bad regex degrades to never-match');
});

// --- site / env map ---------------------------------------------------------------
const ENV = { billing: { dev: 'http://localhost:3000', test: 'https://billing-test.corp', prod: 'https://billing.corp/' }, crm: { test: 'https://crm-test.corp' } };
t('detectSite', () => {
  assert.equal(site.detectSite('www.figma.com', '/'), 'figma'); assert.equal(site.detectSite('figma.com', '/'), 'figma');
  assert.equal(site.detectSite('almoctane-eu.saas.microfocus.com', '/ui'), 'octane'); assert.equal(site.detectSite('billing-test.corp', '/'), 'web');
  assert.equal(site.detectSite('notfigma.com', '/'), 'web');
});
t('env map resolution, description, envs, origin rewrite', () => {
  assert.deepEqual(site.resolveEnv(ENV, 'https://billing-test.corp'), { app: 'billing', env: 'test', origin: 'https://billing-test.corp' });
  assert.deepEqual(site.resolveEnv(ENV, 'https://billing.corp'), { app: 'billing', env: 'prod', origin: 'https://billing.corp' }, 'trailing slash tolerated');
  assert.equal(site.resolveEnv(ENV, 'https://unknown.corp'), null);
  assert.deepEqual(site.describeOrigin(ENV, 'https://www.unknown.corp'), { app: 'unknown.corp', env: 'unknown', origin: 'https://www.unknown.corp' });
  assert.equal(site.originFor(ENV, 'billing', 'dev'), 'http://localhost:3000'); assert.equal(site.originFor(ENV, 'billing', 'nope'), null);
  assert.deepEqual(site.envsFor(ENV, 'billing', 'https://billing-test.corp').map((e) => [e.env, e.current]), [['dev', false], ['test', true], ['prod', false]]);
  assert.equal(site.rewriteOrigin('https://billing-test.corp/invoices/1?x=1#h', 'http://localhost:3000'), 'http://localhost:3000/invoices/1?x=1#h');
  assert.equal(site.rewriteValue('{"api":"https://a.corp/api","x":"https://a.corp"}', 'https://a.corp', 'https://b.corp'), '{"api":"https://b.corp/api","x":"https://b.corp"}');
  assert.deepEqual(site.validateEnvMap(ENV), []);
  assert.ok(site.validateEnvMap({ billing: 'nope' }).length); assert.ok(site.validateEnvMap({ billing: { dev: 'not a url at all ::' } }).length); assert.ok(site.validateEnvMap([]).length);
});

// --- checkpoints -----------------------------------------------------------------
const SNAP = {
  storage: { local: { 'app.user': '{"id":42}', 'auth.token': 'jwt', apiBase: 'https://billing-test.corp/api' }, session: { 'wizard.step': '3' } },
  cookies: [{ name: 'theme', value: 'dark' }, { name: 'session_id', value: 'abc' }],
  url: { origin: 'https://billing-test.corp', path: '/invoices/12', search: '?tab=lines', hash: '#top' }, scroll: { x: 0, y: 600 }, meta: { title: 'Invoices › Detail' },
};
const isSensitive = (k) => settings.isSensitiveKey(k, settings.DEFAULTS.redaction);
t('makeCheckpoint captures, names, flags sensitive keys, honours include', () => {
  const c = cp.makeCheckpoint(SNAP, { app: 'billing', env: 'test', journey: 'refund', step: 's3', tags: ['bug-1'], isSensitive });
  assert.equal(c.kind, 'checkpoint'); assert.match(c.id, /^cp_/); assert.equal(c.page, 'Invoices › Detail'); assert.equal(cp.keyCount(c), 6);
  assert.deepEqual(c.sensitive.sort(), ['auth.token', 'session_id']);
  const narrow = cp.makeCheckpoint(SNAP, { app: 'billing', include: { local: ['app.user'], session: [], cookies: ['theme'] }, isSensitive });
  assert.deepEqual(Object.keys(narrow.storage.local), ['app.user']); assert.deepEqual(narrow.cookies.map((x) => x.name), ['theme']); assert.deepEqual(narrow.sensitive, []);
  const noApp = cp.makeCheckpoint(SNAP, {}); assert.equal(noApp.app, 'billing-test.corp');
});
t('redactForExport withholds and lists; opt-in keeps', () => {
  const c = cp.makeCheckpoint(SNAP, { app: 'billing', isSensitive });
  const r = cp.redactForExport(c);
  assert.equal(r.storage.local['auth.token'], undefined); assert.equal(r.storage.local['app.user'], '{"id":42}'); assert.deepEqual(r.cookies.map((x) => x.name), ['theme']);
  assert.deepEqual(r.withheld.sort(), ['auth.token', 'session_id']);
  assert.equal(cp.redactForExport(c, { includeSensitive: true }).storage.local['auth.token'], 'jwt');
});
t('diffAgainst classifies same / changed / missing / added', () => {
  const c = cp.makeCheckpoint(SNAP, { app: 'billing' });
  const now = { storage: { local: { 'app.user': '{"id":43}', apiBase: 'https://billing-test.corp/api', extra: '1' }, session: {} }, cookies: [{ name: 'theme', value: 'dark' }] };
  const d = cp.diffAgainst(c, now);
  assert.deepEqual(d.summary, { changed: 1, same: 2, missing: 3, added: 1 });
  assert.equal(d.rows.find((r) => r.key === 'wizard.step').status, 'missing'); assert.equal(d.restorable, true);
});
t('origin-bearing values found and rewritten; restore URL built', () => {
  const c = cp.makeCheckpoint(SNAP, { app: 'billing' });
  assert.deepEqual(cp.valuesContaining(c).map((e) => e.key), ['apiBase']);
  const rw = cp.rewriteValues(c, 'https://billing-test.corp', 'http://localhost:3000');
  assert.equal(rw.storage.local.apiBase, 'http://localhost:3000/api'); assert.equal(c.storage.local.apiBase, 'https://billing-test.corp/api', 'original untouched');
  assert.equal(cp.restoreUrl(c, 'http://localhost:3000'), 'http://localhost:3000/invoices/12?tab=lines#top');
});
t('library helpers: filter, sort, group, validate', () => {
  const a = { ...cp.makeCheckpoint(SNAP, { app: 'billing', journey: 'refund', env: 'test' }), createdAt: '2026-01-01' };
  const b = { ...cp.makeCheckpoint(SNAP, { app: 'crm', journey: 'onboarding', env: 'dev', tags: ['bug-9'] }), createdAt: '2026-02-01' };
  assert.deepEqual(cp.filterCheckpoints([a, b], 'bug-9').map((x) => x.app), ['crm']);
  assert.deepEqual(cp.filterCheckpoints([a, b], 'REFUND').map((x) => x.app), ['billing']);
  assert.deepEqual(cp.sortCheckpoints([a, b], 'createdAt', 'desc').map((x) => x.app), ['crm', 'billing']);
  assert.deepEqual(cp.sortCheckpoints([a, b], 'app', 'asc').map((x) => x.app), ['billing', 'crm']);
  assert.deepEqual(cp.groupCheckpoints([a, b], 'env').map((g) => g.key), ['test', 'dev']);
  assert.deepEqual(cp.validateCheckpoint(a), []); assert.ok(cp.validateCheckpoint({ kind: 'nope' }).length >= 2);
});

// --- fixtures ----------------------------------------------------------------------
const ENTRIES = [
  { id: '1', method: 'GET', url: 'https://api.corp/api/invoices?page=1', status: 200, responseType: 'json', responseBody: [{ id: 1, total: 10 }], requestHeaders: { authorization: 'Bearer x', accept: 'application/json' }, responseHeaders: { 'content-type': 'application/json' }, duration: 12, startedAt: '2026-08-31T10:00:00.000Z' },
  { id: '2', method: 'GET', url: 'https://api.corp/api/invoices/42', status: 200, responseType: 'json', responseBody: { id: 42, lines: [{ sku: 'A' }] }, responseHeaders: { 'content-type': 'application/json' }, duration: 8 },
  { id: '3', method: 'GET', url: 'https://api.corp/api/invoices/43', status: 404, responseType: 'json', responseBody: { error: 'nf' }, duration: 4 },
  { id: '4', method: 'POST', url: 'https://api.corp/api/invoices', status: 201, responseType: 'json', requestBody: '{"total":5}', responseBody: { id: 44 }, requestHeaders: { 'content-type': 'application/json', cookie: 'sid=1' }, duration: 30 },
  { id: '5', method: 'GET', url: 'https://api.corp/v2/orders/3fa85f64-5717-4562-b3fc-2c963f66afa6/items/9', status: 200, responseType: 'text', responseBody: 'ok', responseHeaders: { 'content-type': 'text/plain' }, duration: 3 },
];
t('parameterize infers named params from numeric / uuid segments', () => {
  assert.deepEqual(fx.parameterize('/api/invoices/42'), { path: '/api/invoices/:invoiceId', params: ['invoiceId'] });
  assert.deepEqual(fx.parameterize('/v2/orders/3fa85f64-5717-4562-b3fc-2c963f66afa6/items/9'), { path: '/v2/orders/:orderId/items/:itemId', params: ['orderId', 'itemId'] });
  assert.deepEqual(fx.parameterize('/v1/123'), { path: '/v1/:id', params: ['id'] });
  assert.deepEqual(fx.parameterize('/api/categories/7'), { path: '/api/categories/:categoryId', params: ['categoryId'] });
});
t('dedupe groups by method + parameterized path, latest wins, variants kept', () => {
  const g = fx.dedupe(ENTRIES);
  assert.deepEqual(g.map((x) => `${x.method} ${x.path}`), ['GET /api/invoices', 'GET /api/invoices/:invoiceId', 'POST /api/invoices', 'GET /v2/orders/:orderId/items/:itemId']);
  const inv = g[1]; assert.equal(inv.variants.length, 2); assert.equal(inv.latest.status, 404); assert.equal(inv.best.status, 200, 'best prefers the newest 2xx');
});
t('toMSW emits one handler per endpoint with the right status and body', () => {
  const s = fx.toMSW(ENTRIES);
  assert.match(s, /^import \{ http, HttpResponse \} from 'msw';/);
  assert.match(s, /http\.get\('\/api\/invoices', \(\) => \{\n\s+return HttpResponse\.json\(\[\n/);
  assert.match(s, /http\.get\('\/api\/invoices\/:invoiceId', \(\) => \{ \/\/ params: invoiceId/);
  assert.match(s, /"id": 42/); assert.ok(!/status: 404/.test(s), 'happy path preferred for handlers'); assert.match(s, /http\.post\('\/api\/invoices'/); assert.match(s, /\{ status: 201 \}/);
  assert.match(s, /new HttpResponse\("ok", \{ status: 200, headers: \{ 'content-type': "text\/plain" \} \}\)/);
  assert.match(fx.toMSW(ENTRIES, { relative: false }), /http\.get\('https:\/\/api\.corp\/api\/invoices'/);
});
t('toPlaywright routes with method guard; toJsonFixtures keyed and typed; markdown lists shapes', () => {
  const pw = fx.toPlaywright(ENTRIES);
  assert.match(pw, /page\.route\('\*\*\/api\/invoices\/\*', \(route\) => \{/); assert.match(pw, /method\(\) !== 'POST'/); assert.match(pw, /status: 201/);
  const j = JSON.parse(fx.toJsonFixtures(ENTRIES));
  assert.deepEqual(Object.keys(j), ['GET /api/invoices', 'GET /api/invoices/:invoiceId', 'POST /api/invoices', 'GET /v2/orders/:orderId/items/:itemId']);
  assert.equal(j['GET /api/invoices/:invoiceId'].variants.length, 2); assert.equal(j['POST /api/invoices'].request, '{"total":5}');
  const md = fx.toApiMarkdown(ENTRIES);
  assert.match(md, /4 endpoint\(s\) from 5 recorded request\(s\)/); assert.match(md, /response shape: `\{ id: number, lines: \{ sku: string \}\[\] \}`/);
  assert.match(md, /request body shape: `\{ total: number \}`/); assert.match(md, /- query: `page`/); assert.match(md, /2 variants recorded \(statuses: 200, 404\)/);
});
t('toCurl strips auth by default and escapes quotes; toHAR is valid 1.2', () => {
  const c = fx.toCurl(ENTRIES[3]);
  assert.match(c, /^curl -X POST 'https:\/\/api\.corp\/api\/invoices'/); assert.ok(!/cookie/.test(c)); assert.match(c, /--data-raw '\{"total":5\}'/);
  assert.match(fx.toCurl(ENTRIES[0], { includeAuth: true }), /authorization: Bearer x/); assert.ok(!/authorization/.test(fx.toCurl(ENTRIES[0])));
  const har = JSON.parse(fx.toHAR(ENTRIES, { page: { title: 'p' } }));
  assert.equal(har.log.version, '1.2'); assert.equal(har.log.entries.length, 5); assert.equal(har.log.pages.length, 1);
  assert.deepEqual(har.log.entries[0].request.queryString, [{ name: 'page', value: '1' }]); assert.equal(har.log.entries[3].request.postData.text, '{"total":5}');
  assert.equal(har.log.entries[1].response.content.mimeType, 'application/json'); assert.equal(har.log.entries[0].pageref, 'page_1');
});
t('stripHeaders is case-insensitive', () => assert.deepEqual(fx.stripHeaders({ Authorization: 'x', Accept: 'y', 'X-Api-Key': 'z' }), { Accept: 'y' }));

// --- CSP ----------------------------------------------------------------------------
t('parseCSP, allowsConnect, scriptFlags', () => {
  const d = csp.parseCSP("default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://api.example.com http://localhost:*");
  assert.deepEqual(d['connect-src'], ["'self'", 'https://api.example.com', 'http://localhost:*']);
  assert.equal(csp.allowsConnect(d, 'http://localhost:7373', 'https://app.corp'), true);
  assert.equal(csp.allowsConnect(csp.parseCSP("connect-src 'self' https://api.example.com"), 'http://localhost:7373', 'https://app.corp'), false);
  assert.equal(csp.allowsConnect(csp.parseCSP("default-src 'self'"), 'http://localhost:7373', 'http://localhost:7373'), true, "'self' matches when the page is the hub origin");
  assert.equal(csp.allowsConnect(csp.parseCSP("script-src 'self'"), 'http://localhost:7373', 'https://app.corp'), null, 'no connect/default → unrestricted');
  assert.equal(csp.allowsConnect(csp.parseCSP('connect-src *'), 'http://localhost:7373', 'https://x'), true);
  assert.equal(csp.allowsConnect(csp.parseCSP('connect-src http:'), 'http://localhost:7373', 'https://x'), true);
  assert.equal(csp.allowsConnect(csp.parseCSP('connect-src *.corp'), 'https://api.corp', 'https://x'), true);
  assert.equal(csp.allowsConnect(csp.parseCSP('connect-src localhost:7373'), 'http://localhost:7373', 'https://x'), true);
  assert.equal(csp.allowsConnect(csp.parseCSP('connect-src localhost:8000'), 'http://localhost:7373', 'https://x'), false);
  assert.deepEqual(csp.scriptFlags(d), { restricted: true, inline: true, eval: false, nonce: false, strictDynamic: false });
  assert.equal(csp.scriptFlags(csp.parseCSP("script-src 'nonce-abc' 'strict-dynamic'")).inline, false);
  assert.equal(csp.scriptFlags(csp.parseCSP("img-src 'self'")).restricted, false);
});
t('splitPolicies separates comma-joined headers; report summarises across all of them', () => {
  const two = "script-src 'nonce-x' 'strict-dynamic'; object-src 'none', script-src 'self' 'unsafe-inline'; connect-src 'self'";
  const parts = csp.splitPolicies(two);
  assert.equal(parts.length, 2);
  const lines = csp.cspReport(parts.map((text, i) => ({ from: `header #${i + 1}`, text })), { hubOrigin: 'http://localhost:7373', pageOrigin: 'https://www.figma.com', hubPing: false }).join('\n');
  assert.match(lines, /2 policies apply.*hub fetch: BLOCKED · bookmarklet: BLOCKED/);
  assert.match(csp.cspReport([], { pageOrigin: 'https://x' }).join('\n'), /No Content-Security-Policy found/);
  // the real figma.com marketing header, as captured 2026-08-31
  const figma = csp.parseCSP("default-src 'self' https://accounts.google.com/gsi/ ; script-src 'self' 'unsafe-eval' 'unsafe-inline' ; connect-src 'self' https://static.figma.com https://o22594.ingest.sentry.io *.adora-cdn.com");
  assert.equal(csp.allowsConnect(figma, 'http://localhost:7373', 'https://www.figma.com'), false, 'figma marketing pages block the hub');
});

// --- mock engine -----------------------------------------------------------------------
t('patternToRegex: globs, regex literals, absolute URLs', () => {
  const re = mock.patternToRegex('/api/invoices/*');
  assert.equal(re.test('https://x.corp/api/invoices/12'), true); assert.equal(re.test('/api/invoices/12?x=1'), true); assert.equal(re.test('/api/invoices/12/lines'), false);
  assert.equal(mock.patternToRegex('/api/**').test('/api/a/b/c'), true);
  assert.equal(mock.patternToRegex('/^\\/api\\/inv/').test('/api/invoices'), true);
  assert.equal(mock.patternToRegex('https://api.corp/x').test('https://api.corp/x?y=1'), true); assert.equal(mock.patternToRegex('https://api.corp/x').test('https://other.corp/x'), false);
  assert.equal(mock.patternToRegex('').test('anything'), false);
});
t('matchRule respects enabled and method; decide handles fail-N, drop, counters, first-match-wins', () => {
  const rules = [
    { id: 'a', enabled: false, method: 'GET', url: '/api/a', status: 200, body: 'disabled' },
    { id: 'b', enabled: true, method: 'GET', url: '/api/a', status: 200, body: { ok: 1 }, failTimes: 2, failStatus: 503 },
    { id: 'c', enabled: true, method: '*', url: '/api/drop', drop: true },
    { id: 'd', enabled: true, method: 'POST', url: '/api/a', status: 201, body: 'posted', delay: 50 },
  ];
  const rec = (method, url) => ({ method, url: `https://x.corp${url}` });
  assert.equal(mock.matchRule(rules[0], rec('GET', '/api/a')), false); assert.equal(mock.matchRule(rules[3], rec('GET', '/api/a')), false);
  const counters = new Map();
  assert.equal(mock.decide(rules, rec('GET', '/api/a'), counters).mock.status, 503);
  assert.equal(mock.decide(rules, rec('GET', '/api/a'), counters).mock.status, 503);
  const third = mock.decide(rules, rec('GET', '/api/a'), counters); assert.equal(third.mock.status, 200); assert.deepEqual(third.mock.body, { ok: 1 });
  assert.equal(mock.decide(rules, rec('DELETE', '/api/drop'), counters).mock.drop, true);
  const post = mock.decide(rules, rec('POST', '/api/a'), counters); assert.equal(post.mock.status, 201); assert.equal(post.mock.delay, 50);
  assert.equal(mock.decide(rules, rec('GET', '/nothing'), counters), null);
});
t('rulesFromEntries: one enabled rule per endpoint, latest response wins', () => {
  const rules = mock.rulesFromEntries(ENTRIES, { app: 'billing' });
  assert.equal(rules.length, 5); assert.ok(rules.every((r) => r.enabled && r.app === 'billing'));
  const r42 = rules.find((r) => r.url === '/api/invoices/42'); assert.deepEqual(r42.body, { id: 42, lines: [{ sku: 'A' }] }); assert.equal(r42.headers['content-type'], 'application/json');
});

// --- interceptor helpers + ga4 ------------------------------------------------------------
t('headersToObject / bodyToText normalise the shapes fetch accepts', () => {
  assert.deepEqual(headersToObject([['Content-Type', 'a'], ['X-Y', 'b']]), { 'content-type': 'a', 'x-y': 'b' });
  assert.deepEqual(headersToObject({ Accept: 'x' }), { accept: 'x' }); assert.deepEqual(headersToObject(null), {});
  assert.equal(bodyToText('x'), 'x'); assert.equal(bodyToText(null), null); assert.equal(bodyToText(new URLSearchParams({ a: '1' })), 'a=1');
  assert.equal(bodyToText(new ArrayBuffer(8)), '‹binary 8b›'); assert.equal(bodyToText({ a: 1 }), '{"a":1}');
  assert.ok(bodyToText('x'.repeat(600 * 1024)).endsWith('‹truncated›'));
});
t('GA4 collect decoding: params, numeric params, user props, batched body', () => {
  const [e] = parseCollect('https://www.google-analytics.com/g/collect?v=2&tid=G-ABC&en=add_to_cart&ep.item_id=SKU9&epn.value=42&up.plan=pro&upn.seats=3&dl=https%3A%2F%2Fx');
  assert.equal(e.name, 'add_to_cart'); assert.deepEqual(e.params, { item_id: 'SKU9', value: 42 }); assert.deepEqual(e.user, { plan: 'pro', seats: 3 }); assert.equal(e.measurementId, 'G-ABC'); assert.equal(e.page, 'https://x');
  const batch = parseCollect('https://www.google-analytics.com/g/collect?v=2&tid=G-ABC', 'en=view_item&ep.id=1\nen=scroll&epn.percent=90');
  assert.deepEqual(batch.map((x) => x.name), ['view_item', 'scroll']); assert.equal(batch[1].params.percent, 90);
});

console.log(`${pass} unit checks passed`);
