// Mock responses: rules per app, answered from the interceptor instead of the
// network. Latency, "fail N times then succeed", "drop connection". A switch in
// the dock, so "prod API returning 500 on save" is a toggle, not a setup.

import { toast, el, field } from '../core/overlay/ui.js';
import { mocks, recordings } from '../core/store/store.js';
import { mockEngine, rulesFromEntries, patternToRegex } from '../core/net/mock-engine.js';
import { describeOrigin } from '../core/site.js';
import * as settings from '../app/settings.js';
import { addMenuSection } from '../app/dock.js';
import { onBoot } from '../app/main.js';
import { download, pickFile, stamp, slug } from '../core/files.js';

const appHere = () => describeOrigin(settings.get('envMap')).app;

export function setMockEnabled(on, app = appHere()) {
  settings.set('mockEnabled', { ...settings.get('mockEnabled'), [app]: !!on });
  if (on) mockEngine.enable(app); else mockEngine.disable();
  return mockEngine.enabled;
}

// Re-arm at boot if it was on for this app; the dock shows the switch.
onBoot(() => { const app = appHere(); if (settings.get('mockEnabled')?.[app]) mockEngine.enable(app); });
addMenuSection('Mock mode', () => {
  const app = appHere();
  const n = mockEngine.rulesFor(app).filter((r) => r.enabled).length;
  return [{ label: `Mock responses for ${app}`, icon: '🎭', on: mockEngine.enabled, hint: `${n} rule${n === 1 ? '' : 's'}`, onclick: () => { setMockEnabled(!mockEngine.enabled, app); toast(mockEngine.enabled ? 'Mock mode ON' : 'Mock mode off'); } }];
});

export default {
  id: 'mock',
  title: 'Mock responses',
  desc: 'Answer matching requests from rules: bodies, status, latency, fail-N-times, dropped connections.',
  icon: '🎭',
  group: 'wire',
  sites: ['web', '*'],
  keywords: ['mock', 'stub', 'fake', 'api', 'error', 'latency', 'offline', '500'],

  start(ctx) {
    const p = ctx.panel({ width: 600, height: 540 });
    const app = appHere();
    let editing = null;                 // rule id being edited, or 'new'

    const view = el('div');
    p.body.append(view);

    const rulesHere = () => mocks.all().filter((r) => r.app === app);

    function ruleForm(rule = {}) {
      const method = el('select', { style: 'width:auto' }, ['*', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => el('option', { value: m, selected: (rule.method ?? 'GET') === m }, m)));
      const url = el('input', { type: 'text', value: rule.url ?? '', placeholder: '/api/invoices/* — glob (* one segment, ** any) or /regex/' });
      const status = el('input', { type: 'number', value: rule.status ?? 200, style: 'width:70px' });
      const delay = el('input', { type: 'number', value: rule.delay ?? 0, style: 'width:80px', title: 'latency in ms' });
      const failTimes = el('input', { type: 'number', value: rule.failTimes ?? 0, style: 'width:60px', title: 'fail this many times, then succeed' });
      const failStatus = el('input', { type: 'number', value: rule.failStatus ?? 500, style: 'width:70px' });
      const drop = el('input', { type: 'checkbox', checked: !!rule.drop });
      const name = el('input', { type: 'text', value: rule.name ?? '', placeholder: 'name (optional)' });
      const body = el('textarea', { rows: '6', value: rule.body == null ? '' : typeof rule.body === 'string' ? rule.body : JSON.stringify(rule.body, null, 2), placeholder: '{ "ok": true }  — JSON or plain text' });
      const test = el('input', { type: 'text', placeholder: 'test a URL against the pattern…' });
      const testOut = el('span', { class: 'muted' });
      test.addEventListener('input', () => { const ok = patternToRegex(url.value).test(test.value) || (() => { try { const u = new URL(test.value, location.href); return patternToRegex(url.value).test(u.pathname + u.search); } catch { return false; } })(); testOut.textContent = test.value ? (ok ? '✓ matches' : '✗ no match') : ''; testOut.className = ok ? 'ok' : 'bad'; });
      const save = () => {
        if (!url.value.trim()) return toast('URL pattern is required');
        let parsed = body.value;
        try { parsed = body.value.trim() ? JSON.parse(body.value) : null; } catch { /* keep text */ }
        const data = {
          app, enabled: rule.enabled ?? true, method: method.value, url: url.value.trim(), status: Number(status.value) || 200, delay: Number(delay.value) || 0,
          failTimes: Number(failTimes.value) || 0, failStatus: Number(failStatus.value) || 500, drop: drop.checked, body: parsed, name: name.value.trim() || `${method.value} ${url.value.trim()}`,
          headers: typeof parsed === 'object' && parsed !== null ? { 'content-type': 'application/json' } : { 'content-type': 'text/plain' },
        };
        if (rule.id) mocks.update(rule.id, data); else mocks.add(data);
        mockEngine.resetCounters();
        editing = null; render();
      };
      return el('div', { style: 'border:1px solid #3b6fe0;border-radius:8px;padding:8px;margin:6px 0' },
        el('div', { class: 'row' }, method, url),
        el('div', { class: 'row', style: 'margin-top:6px;flex-wrap:wrap' },
          field('status', status), field('latency ms', delay), field('fail N times', failTimes), field('…with status', failStatus),
          el('label', { class: 'row', style: 'margin-top:12px', title: 'Simulate a network failure (fetch rejects / XHR errors)' }, drop, el('span', { class: 'muted' }, 'drop connection')), el('span', { class: 'grow' }), name),
        el('div', { style: 'margin-top:6px' }, body),
        el('div', { class: 'row', style: 'margin-top:6px' }, test, testOut),
        el('div', { class: 'row', style: 'margin-top:6px' }, el('button', { class: 'primary sm', onclick: save }, rule.id ? 'Save rule' : 'Add rule'), el('button', { class: 'sm', onclick: () => { editing = null; render(); } }, 'Cancel')),
      );
    }

    function render() {
      const rules = rulesHere();
      const on = mockEngine.enabled;
      view.replaceChildren(
        el('div', { class: 'row', style: 'margin-bottom:8px' },
          el('button', { class: `primary ${on ? 'on' : ''}`, onclick: () => { setMockEnabled(!on, app); render(); } }, on ? '● Mock mode ON' : '○ Mock mode off'),
          el('span', { class: 'muted grow' }, `for ${app} · ${rules.filter((r) => r.enabled).length}/${rules.length} rules active · ${mockEngine.hits.length} hit(s)`),
          el('button', { class: 'sm', onclick: () => { mockEngine.resetCounters(); toast('fail-N counters reset'); } }, 'Reset counters')),
        el('div', { class: 'muted', style: 'margin-bottom:6px' }, 'Covers fetch/XHR made after injection. Not the initial HTML, <img>/<script>, or service-worker responses. Unmatched requests pass through.'),
      );
      if (editing === 'new') view.append(ruleForm({}));
      for (const r of rules) {
        if (editing === r.id) { view.append(ruleForm(r)); continue; }
        view.append(el('div', { class: 'row item' },
          el('input', { type: 'checkbox', checked: !!r.enabled, title: 'enabled', onchange: (e) => mocks.update(r.id, { enabled: e.target.checked }) }),
          el('span', { class: 'mono', style: 'width:46px;font-weight:600' }, r.method ?? 'GET'),
          el('span', { class: 'mono grow ellipsis', title: r.url }, r.url),
          el('span', { class: 'muted ellipsis', style: 'max-width:120px' }, r.name !== `${r.method} ${r.url}` ? r.name : ''),
          r.drop ? el('span', { class: 'badge badge--env-prod' }, 'drop') : el('span', { class: `badge ${r.status >= 400 ? 'badge--env-prod' : ''}` }, String(r.status ?? 200)),
          r.delay ? el('span', { class: 'badge' }, `${r.delay}ms`) : null,
          r.failTimes ? el('span', { class: 'badge badge--env-test' }, `fail ×${r.failTimes}`) : null,
          el('button', { class: 'sm ghost', onclick: () => { editing = r.id; render(); } }, 'edit'),
          el('button', { class: 'sm ghost danger', onclick: () => mocks.remove(r.id) }, '✕'),
        ));
      }
      if (!rules.length && editing !== 'new') view.append(el('div', { class: 'muted', style: 'padding:10px 0' }, 'No rules for this app yet. Add one, or create them from a saved recording.'));
      if (mockEngine.hits.length) {
        view.append(el('details', { style: 'margin-top:8px' }, el('summary', {}, `Recent hits (${mockEngine.hits.length})`),
          ...[...mockEngine.hits].reverse().slice(0, 30).map((h) => el('div', { class: 'row mono muted', style: 'padding:1px 0' }, el('span', {}, h.at.slice(11, 19)), el('span', { style: 'width:40px' }, h.method), el('span', { class: 'grow ellipsis' }, h.url), el('span', { class: h.status >= 400 || !h.status ? 'bad' : 'ok' }, String(h.status || 'DROP'))))));
      }
    }

    const recSel = el('select', { style: 'width:auto' });
    const refreshRec = () => { recSel.replaceChildren(el('option', { value: '' }, 'from saved recording…'), recordings.all().map((r) => el('option', { value: r.id }, `${r.name} (${r.entries.length})`))); };
    recSel.addEventListener('change', () => {
      const r = recordings.get(recSel.value);
      if (!r) return;
      const rules = rulesFromEntries(r.entries, { app, source: r.id });
      rules.forEach((x) => mocks.add(x));
      toast(`${rules.length} rule(s) created from "${r.name}"`);
      recSel.value = '';
    });
    refreshRec();

    p.foot.append(
      el('button', { class: 'primary', onclick: () => { editing = 'new'; render(); } }, '＋ Rule'),
      recSel,
      el('button', { onclick: () => download(`mocks-${slug(app)}-${stamp()}.json`, JSON.stringify(mocks.export({ ids: rulesHere().map((r) => r.id) }), null, 2)) }, 'Export'),
      el('button', { onclick: async () => { const f = await pickFile(); if (!f) return; try { const data = JSON.parse(f.text); const items = (Array.isArray(data) ? data : data.items).map((r) => ({ ...r, app })); const res = mocks.merge(items); toast(`Imported ${res.added}`); } catch (err) { toast(err.message); } } }, 'Import'),
      el('button', { class: 'danger', onclick: () => { if (confirm(`Delete all ${rulesHere().length} rules for ${app}?`)) mocks.remove(rulesHere().map((r) => r.id)); } }, 'Delete all'),
    );

    const offs = [mocks.onChange(() => { if (!p.closed) render(); }), mockEngine.onChange(() => { if (!p.closed) render(); }), recordings.onChange(refreshRec)];
    render();
    return {
      stop() { offs.forEach((f) => f()); p.close(); },
      enable: () => setMockEnabled(true, app), disable: () => setMockEnabled(false, app),
      addRule: (rule) => { const r = mocks.add({ app, enabled: true, method: 'GET', status: 200, delay: 0, failTimes: 0, drop: false, ...rule, name: rule.name ?? `${rule.method ?? 'GET'} ${rule.url}` }); mockEngine.resetCounters(); return r; },
      rules: rulesHere, engine: mockEngine,
    };
  },
};
