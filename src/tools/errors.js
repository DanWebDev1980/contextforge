// Errors: console.error/warn, uncaught errors, unhandled rejections, failed
// resource loads — with stacks and the URL at the time, from injection onwards.

import { toast, el } from '../core/overlay/ui.js';
import { captureErrors } from '../adapters/web/errors.js';
import { basket } from '../core/store/store.js';
import { copy } from '../core/clipboard.js';
import { toMarkdown } from '../core/export/markdown.js';

const CLASS = { error: 'bad', uncaught: 'bad', unhandledrejection: 'bad', warn: 'warn', resource: 'warn' };

export default {
  id: 'errors',
  title: 'Errors',
  desc: 'Capture console errors/warnings, uncaught exceptions and rejected promises with stacks.',
  icon: '🚨',
  group: 'context',
  sites: ['web', '*'],
  keywords: ['console', 'exception', 'stack', 'rejection', 'warn', 'log'],

  start(ctx) {
    const p = ctx.panel({ width: 520, height: 420 });
    let filter = '';
    let includeWarn = true;
    const status = el('div', { class: 'muted' }, 'Listening from now. There is no API for past console output — reproduce the problem with this open.');
    const filterIn = el('input', { type: 'search', placeholder: 'filter…', style: 'margin-top:6px' });
    filterIn.addEventListener('input', () => { filter = filterIn.value.toLowerCase(); render(); });
    const list = el('div', { style: 'margin-top:6px' });
    p.body.append(status, filterIn, list);

    const cap = captureErrors(() => { if (!p.closed) render(); });
    const shown = () => cap.entries.filter((e) => (includeWarn || e.level !== 'warn') && (!filter || `${e.level} ${e.message} ${e.stack ?? ''}`.toLowerCase().includes(filter)));

    function render() {
      const items = shown();
      status.textContent = cap.entries.length ? `${cap.entries.length} captured${items.length !== cap.entries.length ? `, ${items.length} shown` : ''}.` : 'Listening from now. There is no API for past console output — reproduce the problem with this open.';
      list.replaceChildren();
      for (const e of [...items].reverse().slice(0, 150)) {
        const stack = el('pre', { style: 'display:none;font-size:10px;margin-top:4px' }, e.stack || '(no stack)');
        list.append(el('div', { class: 'item', style: 'cursor:pointer', onclick: () => { stack.style.display = stack.style.display === 'none' ? 'block' : 'none'; } },
          el('div', { class: 'row' },
            el('span', { class: `badge ${CLASS[e.level] ?? ''}`, style: 'min-width:52px;text-align:center' }, e.level),
            el('span', { class: 'grow ellipsis', title: e.message }, e.message),
            e.count > 1 ? el('span', { class: 'badge' }, `×${e.count}`) : null,
            el('span', { class: 'muted' }, e.at.slice(11, 19))),
          stack));
      }
      if (!items.length) list.append(el('div', { class: 'muted', style: 'padding:8px 0' }, 'Nothing yet.'));
    }

    const warnBtn = el('button', { class: 'on sm', onclick: () => { includeWarn = !includeWarn; warnBtn.className = includeWarn ? 'on sm' : 'sm'; render(); } }, 'warnings');
    p.foot.append(
      el('button', { class: 'primary', onclick: () => { const items = shown(); if (!items.length) return toast('Nothing to add'); basket.add({ kind: 'errors', entries: items, url: location.href }); toast(`Added ${items.length} to basket`); } }, 'Add to basket'),
      el('button', { onclick: async () => { await copy(toMarkdown([{ kind: 'errors', entries: shown(), url: location.href }])); toast('Copied'); } }, 'Copy markdown'),
      el('button', { onclick: async () => { await copy(JSON.stringify(shown(), null, 2)); toast('Copied JSON'); } }, 'Copy JSON'),
      warnBtn,
      el('button', { onclick: () => { cap.entries.length = 0; render(); } }, 'Clear'),
    );

    render();
    return { stop() { cap.stop(); p.close(); }, entries: cap.entries };
  },
};
