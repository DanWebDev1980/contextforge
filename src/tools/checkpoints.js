// State checkpoints — the flagship. Snapshot storage + cookies + URL, name it,
// file it by app / env / page / journey / step, get back there in one click.
// Restore is always undoable (an automatic "before restore" checkpoint) and
// always targets the origin you are on; the env switcher gets you elsewhere.

import { toast, el, field, envBadge, relativeTime } from '../core/overlay/ui.js';
import { checkpoints, basket } from '../core/store/store.js';
import { snapshot, writeArea, writeCookies, byteSize, humanSize, preview } from '../adapters/web/storage.js';
import {
  makeCheckpoint, redactForExport, diffAgainst, valuesContaining, rewriteValues, restoreUrl,
  filterCheckpoints, sortCheckpoints, groupCheckpoints, keyCount, validateCheckpoint, entries as cpEntries,
} from '../core/schema/checkpoint.js';
import { describeOrigin, resolveEnv } from '../core/site.js';
import * as settings from '../app/settings.js';
import { download, pickFile, stamp, slug } from '../core/files.js';
import { copy } from '../core/clipboard.js';
import { addMenuSection } from '../app/dock.js';
import { PENDING_SCROLL, VERSION } from '../app/main.js';

const nameOf = (cp) => [cp.journey, cp.step].filter(Boolean).join(' › ') || cp.page || cp.id;
const fullName = (cp) => `${cp.app} › ${nameOf(cp)}`;

/**
 * Restore a checkpoint into the current origin. Exposed so the dock's
 * quick-restore and the journey tool can call it without the panel.
 */
export function restoreCheckpoint(cp, { mode = 'replace', rewrite = 'auto', undo = true, navigate = true } = {}) {
  const envMap = settings.get('envMap');
  const here = describeOrigin(envMap);
  const from = cp.url?.origin;
  const to = location.origin;

  const shouldRewrite = rewrite === true || (rewrite === 'auto' && from && from !== to && valuesContaining(cp, from).length > 0);
  const effective = shouldRewrite ? rewriteValues(cp, from, to) : cp;

  if (undo) {
    const snap = snapshot();
    const before = makeCheckpoint(snap, {
      app: here.app, env: here.env, journey: 'undo', step: `before restoring ${nameOf(cp)}`,
      tags: ['auto', 'before-restore'], isSensitive: (k) => settings.isSensitiveKey(k), bccVersion: VERSION,
    });
    checkpoints.add(before);
    pruneUndo();
  }

  const written = {
    local: writeArea('local', effective.storage?.local, { mode }),
    session: writeArea('session', effective.storage?.session, { mode }),
    cookies: writeCookies(effective.cookies, { mode }),
  };
  checkpoints.update(cp.id, { lastRestoredAt: new Date().toISOString(), restoreCount: (cp.restoreCount ?? 0) + 1 });

  const target = restoreUrl(cp, to);
  try { sessionStorage.setItem(PENDING_SCROLL, JSON.stringify({ ...cp.scroll, path: cp.url?.path })); } catch { /* ignore */ }
  if (navigate) location.assign(target);
  return { written, target, rewrote: shouldRewrite };
}

/** Keep only the last 10 automatic undo checkpoints. */
function pruneUndo() {
  const undos = checkpoints.all().filter((c) => c.tags?.includes('before-restore')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (undos.length > 10) checkpoints.remove(undos.slice(10).map((c) => c.id));
}

/** Save the current page as a checkpoint. `include` = { local, session, cookies } key lists or null for everything. */
export function saveCheckpoint(fields = {}, include = null) {
  const here = describeOrigin(settings.get('envMap'));
  const cp = makeCheckpoint(snapshot(), {
    app: here.app, env: here.env, ...fields, include,
    isSensitive: (k) => settings.isSensitiveKey(k), bccVersion: VERSION,
  });
  return checkpoints.add(cp);
}

export function exportCheckpoints(list, { includeSensitive = false } = {}) {
  const items = list.map((cp) => redactForExport(cp, { includeSensitive }));
  const apps = [...new Set(list.map((c) => c.app))];
  const envMap = settings.get('envMap');
  return {
    kind: 'bcc-export', namespace: 'checkpoints', version: 'v1', exportedAt: new Date().toISOString(),
    origin: location.origin, count: items.length,
    envMap: Object.fromEntries(Object.entries(envMap).filter(([app]) => apps.includes(app))),
    withheld: items.flatMap((i) => i.withheld.map((k) => `${i.id}:${k}`)),
    items,
  };
}

export function importCheckpoints(text) {
  const data = JSON.parse(text);
  const items = Array.isArray(data) ? data : data?.items;
  if (!Array.isArray(items)) throw new Error('not a checkpoint export');
  const bad = items.filter((cp) => validateCheckpoint(cp).length);
  if (bad.length === items.length && items.length) throw new Error(`no valid checkpoints (${validateCheckpoint(items[0]).join(', ')})`);
  const r = checkpoints.merge(items.filter((cp) => !validateCheckpoint(cp).length));
  if (data?.envMap && typeof data.envMap === 'object') {
    const merged = { ...settings.get('envMap') };
    for (const [app, envs] of Object.entries(data.envMap)) merged[app] = { ...(merged[app] ?? {}), ...envs };
    settings.set('envMap', merged);
  }
  return { ...r, skipped: bad.length };
}

// Dock quick-restore for starred checkpoints — one click, no panel.
addMenuSection('Quick restore', () => checkpoints.all().filter((c) => c.starred).slice(0, 8).map((cp) => ({
  label: fullName(cp), icon: '★', hint: cp.env, onclick: () => { toast(`Restoring ${nameOf(cp)}…`); restoreCheckpoint(cp); },
})));

export default {
  id: 'checkpoints',
  title: 'Checkpoints',
  desc: 'Save where you are in the app (storage, cookies, URL) and get back there in one click.',
  icon: '💾',
  group: 'state',
  sites: ['web', '*'],
  keywords: ['state', 'save', 'restore', 'snapshot', 'localStorage', 'cookies', 'undo'],

  start(ctx) {
    const p = ctx.panel({ width: 620, height: 560 });
    const here = describeOrigin(settings.get('envMap'));

    const tabs = el('div', { class: 'tabs' });
    const view = el('div');
    p.body.append(tabs, view);
    let tab = checkpoints.count() ? 'library' : 'save';
    let selectedId = null;
    let sortBy = 'createdAt', sortDir = 'desc', groupBy = '', filter = '';
    const bulk = new Set();

    const renderTabs = () => {
      tabs.replaceChildren(
        el('button', { class: tab === 'save' ? 'on' : '', onclick: () => { tab = 'save'; render(); } }, '＋ Save current state'),
        el('button', { class: tab === 'library' ? 'on' : '', onclick: () => { tab = 'library'; render(); } }, `Library (${checkpoints.count()})`),
        el('span', { class: 'grow' }),
        el('span', { class: 'muted row' }, here.app, envBadge(here.env)),
      );
    };

    // --- save ----------------------------------------------------------------
    function renderSave() {
      const snap = snapshot();
      const unticked = new Set(settings.get('untickedKeys')?.[here.app] ?? []);
      const journeys = [...new Set(checkpoints.all().map((c) => c.journey).filter(Boolean))];
      const pages = [...new Set(checkpoints.all().map((c) => c.page).filter(Boolean))];

      const appIn = el('input', { type: 'text', value: here.app });
      const envIn = el('input', { type: 'text', value: here.env, list: 'bcc-envs' });
      const pageIn = el('input', { type: 'text', value: document.title, list: 'bcc-pages' });
      const journeyIn = el('input', { type: 'text', placeholder: 'e.g. refund flow', list: 'bcc-journeys', autofocus: true });
      const stepIn = el('input', { type: 'text', placeholder: 'e.g. after amount entered' });
      const tagsIn = el('input', { type: 'text', placeholder: 'bug-1234, wizard' });
      const notesIn = el('textarea', { rows: '2', placeholder: 'anything the next person should know', style: 'font-family:inherit' });
      const dl = (id, vals) => el('datalist', { id }, vals.map((v) => el('option', { value: v })));

      const keyBoxes = { local: new Map(), session: new Map(), cookies: new Map() };
      const keySection = (title, area, rows) => {
        const boxes = keyBoxes[area];
        const list = el('div');
        for (const { key, value } of rows) {
          const sensitive = settings.isSensitiveKey(key);
          const box = el('input', { type: 'checkbox', checked: !unticked.has(key) });
          boxes.set(key, box);
          list.append(el('label', { class: 'row', style: 'padding:2px 0' },
            box,
            el('code', { class: 'ellipsis', style: 'max-width:200px', title: key }, key),
            sensitive ? el('span', { class: 'badge badge--env-prod', title: `matches redaction rule — kept locally, withheld from exports unless you opt in` }, '🔒 sensitive') : null,
            el('span', { class: 'muted', style: 'width:56px;text-align:right' }, humanSize(byteSize(value))),
            el('span', { class: 'muted ellipsis grow mono', title: String(value ?? '') }, preview(value, 70))));
        }
        const setAll = (on) => { for (const b of boxes.values()) b.checked = on; };
        return el('details', { open: rows.length > 0 && rows.length <= 25 },
          el('summary', {}, `${title} (${rows.length}) `, el('button', { class: 'sm ghost', onclick: (e) => { e.preventDefault(); setAll(true); } }, 'all'), el('button', { class: 'sm ghost', onclick: (e) => { e.preventDefault(); setAll(false); } }, 'none')),
          rows.length ? list : el('div', { class: 'muted', style: 'padding:4px 0 4px 14px' }, 'nothing here'));
      };
      const toRows = (obj) => Object.entries(obj).map(([key, value]) => ({ key, value }));

      const total = Object.keys(snap.storage.local).length + Object.keys(snap.storage.session).length + snap.cookies.length;
      view.replaceChildren(
        dl('bcc-envs', ['dev', 'test', 'uat', 'staging', 'prod', 'local']), dl('bcc-pages', pages), dl('bcc-journeys', journeys),
        el('div', { style: 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px' }, field('app', appIn), field('env', envIn), field('page', pageIn)),
        el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px' }, field('journey', journeyIn), field('step', stepIn)),
        el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px' }, field('tags (comma-separated)', tagsIn), field('notes', notesIn)),
        el('div', { class: 'muted', style: 'margin:10px 0 4px' }, `Keys to include — ${total} found on ${location.origin}. Unticked keys are remembered for ${here.app}. URL ${snap.url.path}${snap.url.search} and scroll ${snap.scroll.y}px are always saved.`),
        keySection('localStorage', 'local', toRows(snap.storage.local)),
        keySection('sessionStorage', 'session', toRows(snap.storage.session)),
        keySection('cookies (JS-visible only — HttpOnly cookies cannot be saved)', 'cookies', snap.cookies.map((c) => ({ key: c.name, value: c.value }))),
      );

      const collect = () => {
        const include = {};
        const nowUnticked = [];
        for (const area of ['local', 'session', 'cookies']) {
          include[area] = [];
          for (const [k, b] of keyBoxes[area]) (b.checked ? include[area] : nowUnticked).push(k);
        }
        settings.set('untickedKeys', { ...settings.get('untickedKeys'), [here.app]: nowUnticked });
        return {
          fields: {
            app: appIn.value.trim() || here.app, env: envIn.value.trim() || 'unknown', page: pageIn.value.trim(),
            journey: journeyIn.value.trim(), step: stepIn.value.trim(),
            tags: tagsIn.value.split(',').map((s) => s.trim()).filter(Boolean), notes: notesIn.value.trim(),
          },
          include,
        };
      };

      p.foot.replaceChildren(
        el('button', { class: 'primary', onclick: () => { const { fields, include } = collect(); const cp = saveCheckpoint(fields, include); toast(`Saved "${nameOf(cp)}" · ${keyCount(cp)} keys${cp.sensitive.length ? ` · ${cp.sensitive.length} sensitive` : ''}`); selectedId = cp.id; tab = 'library'; render(); } }, 'Save checkpoint'),
        el('button', { onclick: async () => { const { fields, include } = collect(); const cp = saveCheckpoint(fields, include); await copy(JSON.stringify(exportCheckpoints([cp]), null, 2)); toast('Saved and JSON copied'); render(); } }, 'Save + copy JSON'),
        el('span', { class: 'muted' }, 'journey and step are the two you actually type'),
      );
      setTimeout(() => journeyIn.focus(), 0);
    }

    // --- library -------------------------------------------------------------
    function renderLibrary() {
      const all = checkpoints.all();
      const shown = sortCheckpoints(filterCheckpoints(all, filter), sortBy, sortDir);
      const groups = groupCheckpoints(shown, groupBy);
      const envMap = settings.get('envMap');

      const filterIn = el('input', { type: 'search', placeholder: 'filter across app, env, page, journey, step, tags…', value: filter, style: 'width:auto;flex:1' });
      filterIn.addEventListener('input', () => { filter = filterIn.value; renderLibrary(); filterIn.focus(); });
      const groupSel = el('select', { style: 'width:auto', onchange: (e) => { groupBy = e.target.value; renderLibrary(); } },
        [['', 'no grouping'], ['app', 'by app'], ['journey', 'by journey'], ['env', 'by env'], ['page', 'by page']].map(([v, t]) => el('option', { value: v, selected: groupBy === v }, t)));

      const th = (key, text) => el('th', { onclick: () => { if (sortBy === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc'; else { sortBy = key; sortDir = key === 'createdAt' ? 'desc' : 'asc'; } renderLibrary(); } }, `${text}${sortBy === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}`);
      const table = el('table', { class: 'table' }, el('thead', {}, el('tr', {},
        el('th', {}, el('input', { type: 'checkbox', title: 'select all shown', checked: shown.length > 0 && shown.every((c) => bulk.has(c.id)), onchange: (e) => { shown.forEach((c) => e.target.checked ? bulk.add(c.id) : bulk.delete(c.id)); renderLibrary(); } })),
        el('th', {}, '★'), th('app', 'app'), th('env', 'env'), th('journey', 'journey › step'), th('page', 'page'), th('keys', 'keys'), th('createdAt', 'when'), el('th', {}, ''))));
      const tbody = el('tbody');
      table.append(tbody);

      for (const g of groups) {
        if (g.key != null) tbody.append(el('tr', {}, el('td', { colspan: '9', style: 'color:#9fc0ff;font-weight:600;padding-top:8px' }, `${groupBy}: ${g.key} (${g.items.length})`)));
        for (const cp of g.items) {
          const foreign = cp.url?.origin && cp.url.origin !== location.origin && resolveEnv(envMap, cp.url.origin)?.app !== here.app;
          const isUndo = cp.tags?.includes('before-restore');
          tbody.append(el('tr', { class: cp.id === selectedId ? 'sel' : '', style: foreign || isUndo ? 'opacity:.6' : '', onclick: () => { selectedId = cp.id === selectedId ? null : cp.id; renderLibrary(); } },
            el('td', {}, el('input', { type: 'checkbox', checked: bulk.has(cp.id), onclick: (e) => e.stopPropagation(), onchange: (e) => { e.target.checked ? bulk.add(cp.id) : bulk.delete(cp.id); refreshBulk(); } })),
            el('td', {}, el('button', { class: 'ghost sm', title: cp.starred ? 'Unstar' : 'Star — pins it to the dock\'s Quick restore menu', onclick: (e) => { e.stopPropagation(); checkpoints.update(cp.id, { starred: !cp.starred }); } }, cp.starred ? '★' : '☆')),
            el('td', { class: 'ellipsis', style: 'max-width:110px', title: cp.app }, cp.app),
            el('td', {}, envBadge(cp.env)),
            el('td', { class: 'ellipsis', style: 'max-width:170px', title: nameOf(cp) }, isUndo ? el('span', { class: 'muted' }, `↶ ${cp.step}`) : nameOf(cp), cp.tags?.length ? el('span', { class: 'muted' }, ` #${cp.tags.join(' #')}`) : null),
            el('td', { class: 'ellipsis muted', style: 'max-width:120px', title: cp.page }, cp.page),
            el('td', { class: 'muted' }, String(keyCount(cp))),
            el('td', { class: 'muted', title: cp.createdAt }, relativeTime(cp.createdAt)),
            el('td', {}, el('button', { class: 'primary sm', title: foreign ? 'Saved on another origin that is not mapped to this app — restore anyway (with a warning)' : 'Restore into this origin (replace), then reload the page at its URL', onclick: (e) => { e.stopPropagation(); doRestore(cp, {}); } }, foreign ? 'Restore⚠' : 'Restore')),
          ));
        }
      }
      if (!shown.length) tbody.append(el('tr', {}, el('td', { colspan: '9', class: 'muted', style: 'padding:14px' }, all.length ? 'No checkpoint matches the filter.' : 'No checkpoints yet. Use "Save current state".')));

      const detail = el('div', { style: 'margin-top:10px' });
      const sel = all.find((c) => c.id === selectedId);
      if (sel) renderDetail(sel, detail);

      view.replaceChildren(el('div', { class: 'row' }, filterIn, groupSel), el('div', { style: 'overflow:auto;max-height:260px;margin-top:8px' }, table), detail);

      const bulkBtns = el('span', { class: 'row' });
      const refreshBulk = () => {
        bulkBtns.replaceChildren();
        if (!bulk.size) return;
        bulkBtns.append(
          el('span', { class: 'muted' }, `${bulk.size} selected`),
          el('button', { class: 'sm', onclick: () => exportSome(all.filter((c) => bulk.has(c.id))) }, 'Export selected'),
          el('button', { class: 'sm danger', onclick: () => { if (confirm(`Delete ${bulk.size} checkpoint(s)?`)) { checkpoints.remove([...bulk]); bulk.clear(); } } }, 'Delete selected'),
        );
      };
      refreshBulk();
      p.foot.replaceChildren(
        el('button', { class: 'primary', onclick: () => { tab = 'save'; render(); } }, '＋ Save current state'),
        el('button', { title: 'Every checkpoint (or the selection) to a JSON file. Sensitive keys are withheld unless you opt in.', onclick: () => exportSome(bulk.size ? all.filter((c) => bulk.has(c.id)) : all) }, 'Export…'),
        el('button', { title: 'Merge a checkpoint JSON file in (by id, newest wins). Its env map comes along.', onclick: async () => { const f = await pickFile(); if (!f) return; try { const r = importCheckpoints(f.text); toast(`Imported ${r.added} new, ${r.total} total${r.skipped ? `, ${r.skipped} invalid skipped` : ''}`); } catch (err) { toast(`Import failed: ${err.message}`); } } }, 'Import'),
        el('button', { title: 'Paste checkpoint JSON from the clipboard', onclick: async () => { const t = prompt('Paste checkpoint JSON'); if (!t) return; try { const r = importCheckpoints(t); toast(`Imported ${r.added} new`); } catch (err) { toast(err.message); } } }, 'Paste JSON'),
        bulkBtns,
      );
    }

    function exportSome(list) {
      if (!list.length) return toast('Nothing to export');
      const sensitive = list.flatMap((c) => c.sensitive ?? []);
      let includeSensitive = false;
      if (sensitive.length) includeSensitive = confirm(`${sensitive.length} credential-looking key(s) (${[...new Set(sensitive)].slice(0, 5).join(', ')}…) would be withheld.\n\nOK = include them in the file anyway.\nCancel = withhold them (recommended for anything leaving this machine).`);
      const payload = exportCheckpoints(list, { includeSensitive });
      const name = list.length === 1 ? `checkpoint-${slug(list[0].app)}-${slug(nameOf(list[0]))}-${stamp()}.json` : `checkpoints-${list.length}-${stamp()}.json`;
      download(name, JSON.stringify(payload, null, 2));
      toast(`Exported ${list.length}${payload.withheld.length ? ` · ${payload.withheld.length} keys withheld` : ''}`);
    }

    function doRestore(cp, { mode = 'replace' } = {}) {
      const from = cp.url?.origin, to = location.origin;
      const envMap = settings.get('envMap');
      let msg = `Restore "${nameOf(cp)}" into ${to}?\n\nMode: ${mode}. An undo checkpoint is saved first. The page will reload at ${cp.url?.path ?? '/'}.`;
      if (from && from !== to) {
        const src = resolveEnv(envMap, from), dst = resolveEnv(envMap, to);
        const hits = valuesContaining(cp, from);
        msg += `\n\nSaved on ${from}${src ? ` (${src.app}/${src.env})` : ''}; restoring on ${to}${dst ? ` (${dst.app}/${dst.env})` : ''}.`;
        if (!src || !dst || src.app !== dst.app) msg += `\n⚠ These origins are not mapped to the same app in the env map.`;
        if (hits.length) msg += `\n${hits.length} value(s) contain the old origin and will be rewritten to ${to}: ${hits.map((h) => h.key).slice(0, 5).join(', ')}.`;
      }
      if (!confirm(msg)) return;
      toast('Restoring…');
      restoreCheckpoint(cp, { mode });
    }

    function renderDetail(cp, host) {
      const snap = snapshot();
      const diff = diffAgainst(cp, snap);
      const hits = cp.url?.origin && cp.url.origin !== location.origin ? valuesContaining(cp, cp.url.origin) : [];
      const editable = (key, value, placeholder) => {
        const input = el('input', { type: 'text', value: value ?? '', placeholder, style: 'width:auto;flex:1' });
        input.addEventListener('change', () => checkpoints.update(cp.id, { [key]: key === 'tags' ? input.value.split(',').map((s) => s.trim()).filter(Boolean) : input.value.trim() }));
        return input;
      };
      const colour = { same: 'muted', changed: 'warn', missing: 'bad', added: 'ok' };
      const label = { same: 'same', changed: 'changed since', missing: 'missing now', added: 'new on page' };
      const rows = diff.rows.filter((r) => r.status !== 'same' || diff.rows.length <= 12);
      host.replaceChildren(
        el('hr'),
        el('div', { class: 'row' }, el('strong', {}, fullName(cp)), envBadge(cp.env), el('span', { class: 'muted grow' }, `${cp.url?.origin ?? ''}${cp.url?.path ?? ''}${cp.url?.search ?? ''} · scroll ${cp.scroll?.y ?? 0} · ${relativeTime(cp.createdAt)}${cp.restoreCount ? ` · restored ${cp.restoreCount}×` : ''}`)),
        el('div', { class: 'row', style: 'margin-top:6px' }, el('span', { class: 'muted', style: 'width:52px' }, 'journey'), editable('journey', cp.journey, 'journey'), el('span', { class: 'muted' }, 'step'), editable('step', cp.step, 'step')),
        el('div', { class: 'row', style: 'margin-top:4px' }, el('span', { class: 'muted', style: 'width:52px' }, 'tags'), editable('tags', (cp.tags ?? []).join(', '), 'comma-separated'), el('span', { class: 'muted' }, 'notes'), editable('notes', cp.notes, 'notes')),
        el('div', { style: 'margin-top:8px;font-weight:600' }, `Saved keys vs this page now — ${diff.summary.changed ?? 0} changed, ${diff.summary.missing ?? 0} missing, ${diff.summary.added ?? 0} new on page, ${diff.summary.same ?? 0} same`),
        el('div', { style: 'max-height:160px;overflow:auto;margin-top:4px' },
          el('table', { class: 'table' }, el('tbody', {}, rows.map((r) => el('tr', {},
            el('td', { class: 'muted' }, r.area),
            el('td', {}, el('code', {}, r.key), cp.sensitive?.includes(r.key) ? ' 🔒' : ''),
            el('td', { class: colour[r.status] }, label[r.status]),
            el('td', { class: 'mono muted ellipsis', style: 'max-width:180px', title: r.saved ?? '' }, r.status === 'added' ? '' : cp.sensitive?.includes(r.key) ? '‹redacted›' : preview(r.saved, 60)),
            el('td', { class: 'mono muted ellipsis', style: 'max-width:180px', title: r.current ?? '' }, r.status === 'missing' ? '' : preview(r.current, 60)),
          ))))),
        hits.length ? el('div', { class: 'warn', style: 'margin-top:6px' }, `${hits.length} value(s) contain ${cp.url.origin} — Restore rewrites them to ${location.origin}: ${hits.map((h) => h.key).join(', ')}`) : null,
        !diff.restorable ? el('div', { class: 'muted', style: 'margin-top:6px' }, 'Nothing to restore here: none of the saved keys exist on this origin (it would still write them).') : null,
        el('div', { class: 'row', style: 'margin-top:8px;flex-wrap:wrap' },
          el('button', { class: 'primary', onclick: () => doRestore(cp, { mode: 'replace' }) }, 'Restore (replace)'),
          el('button', { title: 'Overlay saved keys on top of what the page has now', onclick: () => doRestore(cp, { mode: 'merge' }) }, 'Restore (merge)'),
          el('button', { onclick: () => exportSome([cp]) }, 'Export'),
          el('button', { title: 'Copy this checkpoint as JSON (sensitive keys withheld)', onclick: async () => { await copy(JSON.stringify(exportCheckpoints([cp]), null, 2)); toast('Copied'); } }, 'Copy JSON'),
          el('button', { title: 'Add to the basket so the prompt carries the app state', onclick: () => { basket.add({ ...redactForExport(cp), kind: 'checkpoint' }); toast('Added to basket'); } }, 'Add to basket'),
          el('button', { onclick: () => { checkpoints.add({ ...cp, id: undefined, journey: cp.journey, step: `${cp.step} (copy)`, createdAt: new Date().toISOString(), starred: false, tags: (cp.tags ?? []).filter((t) => t !== 'before-restore' && t !== 'auto') }); toast('Duplicated'); } }, 'Duplicate'),
          el('button', { class: 'danger', onclick: () => { if (confirm(`Delete "${nameOf(cp)}"?`)) { checkpoints.remove(cp.id); selectedId = null; } } }, 'Delete'),
        ),
      );
    }

    function render() { renderTabs(); tab === 'save' ? renderSave() : renderLibrary(); }
    const off = checkpoints.onChange(() => { if (!p.closed) render(); });
    render();

    return {
      stop() { off(); p.close(); },
      save: saveCheckpoint, restore: restoreCheckpoint, export: exportCheckpoints, import: importCheckpoints,
      diff: (cp) => diffAgainst(cp, snapshot()), entries: cpEntries,
    };
  },
};
