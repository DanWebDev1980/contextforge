// Network recorder: every fetch / XHR after Record — method, URL, headers,
// bodies, status, timing. Filter, group by endpoint, replay against the current
// environment, export as MSW / Playwright / JSON / markdown / HAR, or save the
// recording alongside a checkpoint ("state + the traffic that produced it").

import { toast, el, relativeTime } from '../core/overlay/ui.js';
import { subscribe } from '../core/net/intercept.js';
import { recordings, basket, mocks } from '../core/store/store.js';
import { preInjectionResources, groupByEndpoint, matchesFilter, replayRequest, replaySequence, freshAuthHeaders } from '../core/net/recording.js';
import { FIXTURE_FORMATS, toCurl, stripHeaders, toApiMarkdown } from '../core/export/fixtures.js';
import { rulesFromEntries } from '../core/net/mock-engine.js';
import { describeOrigin, envsFor } from '../core/site.js';
import * as settings from '../app/settings.js';
import { copy } from '../core/clipboard.js';
import { download, pickFile, stamp, slug } from '../core/files.js';

const statusClass = (s) => (!s ? 'bad' : s >= 500 ? 'bad' : s >= 400 ? 'warn' : s >= 300 ? 'muted' : 'ok');
const pathOf = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return url; } };
const pretty = (v) => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v, null, 2));

export default {
  id: 'net',
  title: 'Network recorder',
  desc: 'Record fetch/XHR traffic; replay requests; export MSW, Playwright, JSON fixtures, markdown, HAR.',
  icon: '⚡',
  group: 'wire',
  sites: ['web', '*'],
  keywords: ['network', 'fetch', 'xhr', 'api', 'har', 'msw', 'playwright', 'replay', 'record'],

  start(ctx) {
    const p = ctx.panel({ width: 640, height: 560 });
    const here = describeOrigin(settings.get('envMap'));
    const strip = settings.get('stripHeaders');

    const entries = [];
    const selected = new Set();
    let recording = false;
    let unsubscribe = null;
    let filter = { text: '', method: '', status: '' };
    let openId = null;
    let tab = 'live';
    let loaded = null;                       // a saved recording being viewed
    const pre = preInjectionResources();

    const view = el('div');
    const tabs = el('div', { class: 'tabs' });
    p.body.append(tabs, view);

    function startRecording() {
      if (recording) return;
      recording = true;
      unsubscribe = subscribe({
        response: (rec) => {
          const { _t0, ...clean } = rec;
          clean.requestHeaders = stripHeaders(clean.requestHeaders, strip);
          clean.responseHeaders = stripHeaders(clean.responseHeaders, strip);
          entries.push(clean);
          if (!p.closed) render();
        },
      });
      render();
    }
    function stopRecording() {
      recording = false;
      unsubscribe?.(); unsubscribe = null;
      render();
    }

    const shown = () => (loaded ? loaded.entries : entries).filter((e) => matchesFilter(e, filter));
    const chosen = () => { const list = loaded ? loaded.entries : entries; const s = list.filter((e) => selected.has(e.id)); return s.length ? s : shown(); };

    function renderTabs() {
      tabs.replaceChildren(
        el('button', { class: tab === 'live' ? 'on' : '', onclick: () => { tab = 'live'; loaded = null; render(); } }, `Live (${entries.length})`),
        el('button', { class: tab === 'saved' ? 'on' : '', onclick: () => { tab = 'saved'; render(); } }, `Saved (${recordings.count()})`),
        el('span', { class: 'grow' }),
        el('span', { class: recording ? 'ok' : 'muted' }, recording ? '● recording' : '■ stopped'),
      );
    }

    function renderList() {
      const list = shown();
      const groups = groupByEndpoint(list);
      const textIn = el('input', { type: 'search', placeholder: 'filter url, method, status, body…', value: filter.text, style: 'flex:1;width:auto' });
      textIn.addEventListener('input', () => { filter.text = textIn.value; renderList(); textIn.focus(); });
      const methodSel = el('select', { style: 'width:auto', onchange: (e) => { filter.method = e.target.value; renderList(); } }, ['', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => el('option', { value: m, selected: filter.method === m }, m || 'any method')));
      const statusSel = el('select', { style: 'width:auto', onchange: (e) => { filter.status = e.target.value; renderList(); } }, [['', 'any status'], ['2xx', '2xx'], ['3xx', '3xx'], ['4xx', '4xx'], ['5xx', '5xx'], ['err', 'network error']].map(([v, t]) => el('option', { value: v, selected: filter.status === v }, t)));

      const rows = el('div', { style: 'margin-top:6px;max-height:230px;overflow:auto' });
      if (!loaded && pre.length) {
        rows.append(el('details', {}, el('summary', {}, `${pre.length} request(s) before injection — name and timing only. Reload with the recorder armed if they matter.`),
          ...pre.slice(0, 40).map((r) => el('div', { class: 'row muted mono', style: 'opacity:.6;padding:1px 0' }, el('span', { style: 'width:36px' }, r.initiator === 'xmlhttprequest' ? 'XHR' : r.initiator), el('span', { class: 'grow ellipsis' }, pathOf(r.url)), el('span', {}, `${r.duration} ms`)))));
      }
      for (const [key, list2] of groups) {
        const grp = el('details', { open: groups.size <= 8 }, el('summary', { class: 'mono' }, `${key} `, el('span', { class: 'muted' }, `×${list2.length}`)));
        for (const e of list2) {
          const isOpen = openId === e.id;
          const row = el('div', { class: `row item${isOpen ? ' sel' : ''}`, style: 'cursor:pointer;padding-left:12px', onclick: () => { openId = isOpen ? null : e.id; renderList(); } },
            el('input', { type: 'checkbox', checked: selected.has(e.id), onclick: (ev) => ev.stopPropagation(), onchange: (ev) => { ev.target.checked ? selected.add(e.id) : selected.delete(e.id); refreshFoot(); } }),
            el('span', { class: 'mono', style: 'width:46px;font-weight:600' }, e.method),
            el('span', { class: 'mono grow ellipsis', title: e.url }, pathOf(e.url)),
            e.mocked ? el('span', { class: 'badge' }, 'mock') : null,
            e.transport === 'replay' ? el('span', { class: 'badge' }, 'replay') : null,
            el('span', { class: `mono ${statusClass(e.status)}`, style: 'width:32px' }, e.status || 'ERR'),
            el('span', { class: 'muted', style: 'width:56px;text-align:right' }, e.duration != null ? `${e.duration} ms` : ''));
          grp.append(row);
          if (isOpen) grp.append(renderDetail(e));
        }
        rows.append(grp);
      }
      if (!list.length) rows.append(el('div', { class: 'muted', style: 'padding:12px 0' }, recording ? 'Recording — interact with the page.' : loaded ? 'This recording is empty.' : 'Press Record, then use the page. Requests appear here.'));
      const info = el('div', { class: 'muted', style: 'margin-top:4px' }, `${list.length} shown · ${(loaded ? loaded.entries : entries).length} total · ${groups.size} endpoint(s)${selected.size ? ` · ${selected.size} selected` : ''}`);
      view.replaceChildren(el('div', { class: 'row' }, textIn, methodSel, statusSel), rows, info);
    }

    function renderDetail(e) {
      const envs = envsFor(settings.get('envMap'), here.app);
      let entryOrigin = ''; try { entryOrigin = new URL(e.url).origin; } catch { /* keep */ }
      const foreign = entryOrigin && entryOrigin !== location.origin;
      const targetSel = el('select', { style: 'width:auto', title: 'Replays run from this page, so the browser\'s CORS rules apply: the current origin always works; another env only if its API allows this origin.' },
        el('option', { value: foreign ? location.origin : '', selected: true }, foreign ? `current origin (${location.origin})` : 'as recorded (same origin)'),
        foreign ? el('option', { value: '' }, `as recorded (${entryOrigin}) — cross-origin`) : null,
        envs.filter((x) => x.origin !== location.origin).map((x) => el('option', { value: x.origin }, `${x.env} — ${x.origin} (cross-origin)`)));
      const bodyIn = el('textarea', { rows: '3', value: pretty(e.requestBody), placeholder: 'request body (editable before replay)' });
      const result = el('pre', { style: 'display:none;font-size:10px;max-height:120px' });
      const kv = (obj) => el('div', { class: 'kv mono muted' }, Object.entries(obj ?? {}).map(([k, v]) => [el('span', { class: 'k' }, k), el('span', { class: 'ellipsis' }, String(v))]));
      return el('div', { style: 'padding:6px 0 8px 32px;border-bottom:1px solid #2c313a' },
        el('div', { class: 'row muted' }, el('span', {}, e.url), el('span', { class: 'grow' }), el('span', {}, e.startedAt?.slice(11, 19)), e.error ? el('span', { class: 'bad' }, e.error) : null),
        el('details', {}, el('summary', {}, `request headers (${Object.keys(e.requestHeaders ?? {}).length})`), kv(e.requestHeaders)),
        e.requestBody != null && e.requestBody !== '' && e.transport !== 'replay' ? null : null,
        el('details', {}, el('summary', {}, `response headers (${Object.keys(e.responseHeaders ?? {}).length})`), kv(e.responseHeaders)),
        el('div', { class: 'muted', style: 'margin-top:4px' }, `response body (${e.responseType ?? 'text'})`),
        el('pre', { style: 'max-height:160px;font-size:10px' }, pretty(e.responseBody).slice(0, 6000)),
        el('div', { class: 'row', style: 'margin-top:6px;flex-wrap:wrap' },
          el('button', { class: 'sm', onclick: async () => { await copy(toCurl(e, { strip })); toast('curl copied (auth stripped)'); } }, 'Copy curl'),
          el('button', { class: 'sm', onclick: async () => { await copy(pretty(e.responseBody)); toast('Response copied'); } }, 'Copy response'),
          el('button', { class: 'sm', onclick: () => { basket.add({ kind: 'request', entry: e, url: location.href }); toast('Added to basket'); } }, 'Add to basket'),
          el('button', { class: 'sm', title: 'Create a mock rule answering this endpoint with this response', onclick: () => { const [rule] = rulesFromEntries([e], { app: here.app, source: 'recorder' }); mocks.add(rule); toast(`Mock rule added for ${rule.name} — enable mock mode to use it`); } }, 'Mock this'),
        ),
        el('div', { class: 'row', style: 'margin-top:6px' }, el('span', { class: 'muted' }, 'replay →'), targetSel, el('button', {
          class: 'sm primary',
          onclick: async () => {
            result.style.display = 'block'; result.textContent = 'sending…';
            let body;
            try { body = bodyIn.value.trim() === '' ? null : bodyIn.value; } catch { body = bodyIn.value; }
            const headers = freshAuthHeaders(entries, targetSel.value ? e.url.replace(new URL(e.url).origin, targetSel.value) : e.url);
            const r = await replayRequest(e, { targetOrigin: targetSel.value || null, body, headers });
            entries.push(r);
            result.textContent = `${r.status || 'ERR'} ${r.statusText ?? ''} · ${r.duration} ms\n${pretty(r.responseBody).slice(0, 3000)}${r.error ? `\n${r.error}` : ''}`;
            refreshFoot();
          },
        }, 'Replay')),
        ['GET', 'HEAD'].includes(e.method) ? null : bodyIn,
        result,
      );
    }

    function renderSaved() {
      const list = recordings.all().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      view.replaceChildren();
      if (!list.length) { view.append(el('div', { class: 'muted', style: 'padding:12px 0' }, 'No saved recordings. Record some traffic, then "Save recording".')); return; }
      for (const r of list) {
        view.append(el('div', { class: 'row item' },
          el('strong', { class: 'ellipsis', style: 'max-width:200px' }, r.name),
          el('span', { class: 'muted' }, `${r.app}/${r.env}`),
          el('span', { class: 'muted grow' }, `${r.entries.length} requests · ${relativeTime(r.createdAt)}`),
          el('button', { class: 'sm primary', onclick: () => { loaded = r; tab = 'live'; render(); } }, 'Open'),
          el('button', { class: 'sm', title: 'Create mock rules for this app from every endpoint in the recording', onclick: () => { const rules = rulesFromEntries(r.entries, { app: here.app, source: r.id }); rules.forEach((x) => mocks.add(x)); toast(`${rules.length} mock rule(s) created`); } }, 'Mock from this'),
          el('button', { class: 'sm', onclick: () => download(`recording-${slug(r.name)}-${stamp()}.json`, JSON.stringify({ kind: 'bcc-export', namespace: 'recordings', items: [r] }, null, 2)) }, 'Export'),
          el('button', { class: 'sm danger', onclick: () => { if (confirm(`Delete "${r.name}"?`)) recordings.remove(r.id); } }, '✕'),
        ));
      }
      view.append(el('div', { class: 'row', style: 'margin-top:8px' }, el('button', { onclick: async () => { const f = await pickFile(); if (!f) return; try { const r = recordings.import(f.text); toast(`Imported ${r.added}`); } catch (err) { toast(err.message); } } }, 'Import recording file')));
    }

    function save() {
      const list = chosen();
      if (!list.length) return toast('Nothing to save');
      const name = prompt('Name this recording', loaded?.name ?? `${here.app} ${document.title}`.slice(0, 60));
      if (name == null) return null;
      const journey = prompt('Journey (optional — matches checkpoints)', loaded?.journey ?? '') ?? '';
      const rec = recordings.add({ kind: 'recording', name, app: here.app, env: here.env, journey, url: location.href, createdAt: new Date().toISOString(), entries: list });
      toast(`Saved "${name}" (${list.length} requests)`);
      return rec;
    }

    function exportAs(fmtId, list = chosen(), { toClipboard = false } = {}) {
      const fmt = FIXTURE_FORMATS.find((f) => f.id === fmtId);
      if (!fmt) throw new Error(`unknown format ${fmtId}`);
      if (!list.length) { toast('Nothing to export'); return null; }
      const text = fmt.render(list);
      if (toClipboard) { copy(text).then(() => toast(`${fmt.title} copied`)); }
      else download(`${slug(here.app)}-${fmt.id}-${stamp()}.${fmt.ext}`, text, fmt.mime);
      return text;
    }

    const fmtSel = el('select', { style: 'width:auto' }, FIXTURE_FORMATS.map((f) => el('option', { value: f.id }, f.title)));
    const recBtn = el('button', { class: 'primary' });
    const selInfo = el('span', { class: 'muted' });
    function refreshFoot() {
      recBtn.textContent = recording ? '■ Stop' : '● Record';
      recBtn.className = recording ? 'danger' : 'primary';
      selInfo.textContent = selected.size ? `${selected.size} selected` : 'all shown';
    }
    recBtn.addEventListener('click', () => (recording ? stopRecording() : startRecording()));
    p.foot.append(
      recBtn,
      el('button', { onclick: () => { entries.length = 0; selected.clear(); openId = null; render(); } }, 'Clear'),
      el('button', { title: 'Save the shown (or selected) requests as a named recording', onclick: save }, 'Save recording'),
      fmtSel,
      el('button', { title: 'Download the shown (or selected) requests in this format', onclick: () => exportAs(fmtSel.value) }, 'Export'),
      el('button', { title: 'Copy instead of download', onclick: () => exportAs(fmtSel.value, chosen(), { toClipboard: true }) }, 'Copy'),
      el('button', { title: 'API contract section for the prompt', onclick: () => { const list = chosen(); if (!list.length) return toast('Nothing to add'); basket.add({ kind: 'recording', name: loaded?.name ?? `${list.length} requests`, app: here.app, env: here.env, url: location.href, entries: list }); toast('API contract added to basket'); } }, 'Add to basket'),
      el('button', { title: 'Re-send the selected requests in order (stops at the first failure)', onclick: async () => { const list = chosen(); if (!list.length) return toast('Select requests first'); toast(`Replaying ${list.length}…`); const res = await replaySequence(list, {}, { onStep: (r) => entries.push(r) }); const bad = res.filter((r) => !r.status || r.status >= 400).length; toast(bad ? `${res.length} sent, ${bad} failed` : `${res.length} replayed OK`); render(); } }, 'Replay selected'),
      selInfo,
    );

    function render() { renderTabs(); tab === 'saved' ? renderSaved() : renderList(); refreshFoot(); }
    const off = recordings.onChange(() => { if (!p.closed) render(); });
    render();
    if (ctx.options.autoRecord !== false) startRecording();

    return {
      stop() { stopRecording(); off(); p.close(); },
      entries, get recording() { return recording; }, startRecording, stopRecording, save, exportAs, replay: replayRequest, replaySequence,
      select: (ids) => { selected.clear(); ids.forEach((i) => selected.add(i)); render(); }, pre, apiMarkdown: () => toApiMarkdown(chosen()),
    };
  },
};
