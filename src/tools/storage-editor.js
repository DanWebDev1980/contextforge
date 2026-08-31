// Live view/edit of localStorage, sessionStorage and cookies, with JSON
// pretty-print — plus watch mode: every write logged with a stack trace.

import { toast, el } from '../core/overlay/ui.js';
import { readArea, parseCookies, setItem, removeItem, writeCookies, deleteCookie, byteSize, humanSize, preview, watchStorage } from '../adapters/web/storage.js';
import { copy } from '../core/clipboard.js';
import { download, stamp } from '../core/files.js';
import * as settings from '../app/settings.js';

const pretty = (v) => { try { const o = JSON.parse(v); return typeof o === 'object' && o !== null ? JSON.stringify(o, null, 2) : v; } catch { return v; } };
const compact = (v) => { try { const o = JSON.parse(v); return typeof o === 'object' && o !== null ? JSON.stringify(o) : v; } catch { return v; } };

export default {
  id: 'storage',
  title: 'Storage editor',
  desc: 'View and edit local/session storage and cookies; watch mode logs every write with a stack.',
  icon: '🗄️',
  group: 'state',
  sites: ['web', '*'],
  keywords: ['localStorage', 'sessionStorage', 'cookies', 'watch', 'setItem', 'edit'],

  start(ctx) {
    const p = ctx.panel({ width: 560, height: 500 });
    let area = 'local';
    let filter = '';
    let editing = null;
    let watching = null;
    const log = [];

    const tabs = el('div', { class: 'tabs' });
    const filterIn = el('input', { type: 'search', placeholder: 'filter keys and values…' });
    filterIn.addEventListener('input', () => { filter = filterIn.value.toLowerCase(); renderList(); });
    const list = el('div', { style: 'margin-top:8px' });
    const watchLog = el('div', { style: 'margin-top:8px;display:none' });
    p.body.append(tabs, filterIn, list, watchLog);

    const rowsFor = () => {
      if (area === 'cookie') return parseCookies().map((c) => ({ key: c.name, value: c.value }));
      return Object.entries(readArea(area)).map(([key, value]) => ({ key, value }));
    };
    const write = (key, value) => {
      if (area === 'cookie') writeCookies([{ name: key, value }], { mode: 'merge' });
      else setItem(area, key, value);
    };
    const remove = (key) => (area === 'cookie' ? deleteCookie(key) : removeItem(area, key));

    function renderTabs() {
      tabs.replaceChildren(
        ...[['local', 'localStorage'], ['session', 'sessionStorage'], ['cookie', 'cookies']].map(([id, t]) =>
          el('button', { class: area === id ? 'on' : '', onclick: () => { area = id; editing = null; renderTabs(); renderList(); } }, `${t} (${id === 'cookie' ? parseCookies().length : Object.keys(readArea(id)).length})`)),
        el('span', { class: 'grow' }),
        el('button', { class: `sm ${watching ? 'on' : ''}`, title: 'Patch Storage.prototype.setItem/removeItem and log every write with a stack trace', onclick: toggleWatch }, watching ? `● watching (${log.length})` : 'Watch writes'),
      );
    }

    function renderList() {
      const rows = rowsFor().filter((r) => !filter || `${r.key} ${r.value}`.toLowerCase().includes(filter)).sort((a, b) => a.key.localeCompare(b.key));
      list.replaceChildren();
      const flag = settings.flagRegex();
      for (const r of rows) {
        const sensitive = settings.isSensitiveKey(r.key);
        const isFlag = flag.test(r.key);
        if (editing === r.key) {
          const ta = el('textarea', { rows: '6', value: pretty(r.value) });
          list.append(el('div', { class: 'item' },
            el('div', { class: 'row' }, el('code', {}, r.key), el('span', { class: 'grow' }),
              el('button', { class: 'sm primary', onclick: () => { write(r.key, compact(ta.value)); editing = null; toast('Saved'); refresh(); } }, 'Save'),
              el('button', { class: 'sm', onclick: () => { editing = null; renderList(); } }, 'Cancel')),
            ta));
          setTimeout(() => ta.focus(), 0);
          continue;
        }
        list.append(el('div', { class: 'row item', style: 'cursor:pointer', onclick: () => { editing = r.key; renderList(); } },
          el('code', { class: 'ellipsis', style: 'max-width:180px', title: r.key }, r.key),
          sensitive ? el('span', { title: 'matches a redaction rule' }, '🔒') : null,
          isFlag ? el('span', { class: 'badge' }, 'flag') : null,
          el('span', { class: 'muted', style: 'width:56px;text-align:right' }, humanSize(byteSize(r.value))),
          el('span', { class: 'muted mono ellipsis grow', title: preview(r.value, 500) }, preview(r.value, 90)),
          el('button', { class: 'sm ghost', title: 'Copy value', onclick: async (e) => { e.stopPropagation(); await copy(r.value); toast('Copied'); } }, '⧉'),
          el('button', { class: 'sm ghost danger', title: 'Delete', onclick: (e) => { e.stopPropagation(); remove(r.key); refresh(); } }, '✕')));
      }
      if (!rows.length) list.append(el('div', { class: 'muted', style: 'padding:10px 0' }, filter ? 'No key matches.' : 'Empty.'));
    }

    function renderLog() {
      watchLog.style.display = watching ? 'block' : 'none';
      if (!watching) return;
      watchLog.replaceChildren(el('div', { class: 'row', style: 'font-weight:600' }, `Writes since watching started (${log.length})`, el('span', { class: 'grow' }), el('button', { class: 'sm', onclick: () => { log.length = 0; renderLog(); renderTabs(); } }, 'Clear')));
      for (const e of [...log].reverse().slice(0, 60)) {
        const stack = el('pre', { style: 'display:none;font-size:10px;margin-top:4px' }, e.stack || '(no stack)');
        watchLog.append(el('div', { class: 'item', style: 'cursor:pointer', onclick: () => { stack.style.display = stack.style.display === 'none' ? 'block' : 'none'; } },
          el('div', { class: 'row' },
            el('span', { class: e.op === 'remove' ? 'bad' : e.op === 'clear' ? 'warn' : 'ok', style: 'width:48px' }, e.op),
            el('span', { class: 'muted' }, e.area), el('code', {}, e.key),
            el('span', { class: 'muted mono ellipsis grow' }, e.op === 'set' ? preview(e.value, 80) : ''),
            el('span', { class: 'muted' }, e.at.slice(11, 19))),
          stack));
      }
    }

    function toggleWatch() {
      if (watching) { watching(); watching = null; }
      else watching = watchStorage((evt) => { log.push(evt); if (!p.closed) { renderLog(); renderTabs(); refresh(); } });
      renderTabs(); renderLog();
    }

    const refresh = () => { renderTabs(); renderList(); };

    p.foot.append(
      el('button', { class: 'primary', onclick: () => { const k = prompt(`New ${area === 'cookie' ? 'cookie' : area + 'Storage'} key`); if (!k) return; const v = prompt(`Value for ${k}`, ''); if (v == null) return; write(k, v); refresh(); } }, '＋ Add'),
      el('button', { title: 'Copy this area as JSON', onclick: async () => { await copy(JSON.stringify(Object.fromEntries(rowsFor().map((r) => [r.key, r.value])), null, 2)); toast('Copied'); } }, 'Copy JSON'),
      el('button', { onclick: () => download(`storage-${area}-${stamp()}.json`, JSON.stringify(Object.fromEntries(rowsFor().map((r) => [r.key, r.value])), null, 2)) }, 'Download'),
      el('button', { onclick: refresh }, 'Refresh'),
      el('button', { class: 'danger', onclick: () => { if (confirm(`Delete every key in ${area}? (BCC's own keys are kept)`)) { rowsFor().forEach((r) => remove(r.key)); refresh(); } } }, 'Clear area'),
    );

    refresh();
    const onStorage = () => { if (!p.closed && !editing) refresh(); };
    addEventListener('storage', onStorage);

    return {
      stop() { removeEventListener('storage', onStorage); if (watching) { watching(); watching = null; } p.close(); },
      log, setArea: (a) => { area = a; refresh(); },
    };
  },
};
