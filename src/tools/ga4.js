// Live view of the GA4 events this page fires, with their parameters.
// Useful for "does my change still fire the right event with the right params?"

import { panel, toast, el, teardown } from '../core/overlay/ui.js';
import { observe } from '../adapters/web/ga4.js';
import { basket } from '../core/store.js';
import { copy } from '../core/clipboard.js';

export function start() {
  const events = [];
  let filter = '';

  const p = panel({ title: 'GA4 events', x: 16, y: 16, width: 420, onClose: stop });
  const filterInput = el('input', {
    placeholder: 'filter by event name or param…',
    style: 'width:100%;background:#0e1013;color:#e7e9ee;border:1px solid #363d48;border-radius:6px;padding:5px 6px;font:inherit;font-size:11px',
  });
  filterInput.addEventListener('input', () => { filter = filterInput.value.toLowerCase(); render(); });

  const list = el('div', { style: 'margin-top:8px' });
  const status = el('div', { class: 'muted' }, 'Listening… interact with the page.');
  p.body.append(filterInput, status, list);

  const countEl = el('span', { class: 'muted' }, '');

  function matches(event) {
    if (!filter) return true;
    return JSON.stringify(event).toLowerCase().includes(filter);
  }

  function render() {
    const shown = events.filter(matches);
    countEl.textContent = `${shown.length}/${events.length}`;
    list.replaceChildren();
    for (const event of [...shown].reverse().slice(0, 100)) {
      const params = Object.entries(event.params ?? {}).filter(([, v]) => v !== undefined);
      const detail = el('div', {
        class: 'muted',
        style: 'padding-left:14px;font-family:ui-monospace,monospace;display:none',
      }, params.map(([k, v]) => el('div', {}, `${k}: ${JSON.stringify(v)}`)));

      const row = el('div', { style: 'padding:4px 0;border-bottom:1px solid #262b33' },
        el('div', {
          class: 'row',
          style: 'cursor:pointer',
          onclick: () => { detail.style.display = detail.style.display === 'none' ? 'block' : 'none'; },
        },
          el('span', { style: 'flex:1 1 auto;font-weight:600' }, event.name),
          el('span', { class: 'muted' }, `${params.length} params · ${event.transport}`)),
        detail);
      list.append(row);
    }
  }

  const watcher = observe((event) => { events.push(event); render(); });
  events.push(...watcher.backlog);
  status.textContent = watcher.backlog.length
    ? `Listening. ${watcher.backlog.length} dataLayer entries already present.`
    : 'Listening… interact with the page.';
  render();

  p.foot.append(
    el('button', {
      class: 'primary',
      onclick: () => {
        const shown = events.filter(matches);
        if (!shown.length) return toast('Nothing to add');
        basket.add({ kind: 'analytics', label: `${shown.length} GA4 events`, events: shown, url: location.href });
        toast('Added to basket');
      },
    }, 'Add to basket'),
    el('button', { onclick: async () => { await copy(JSON.stringify(events.filter(matches), null, 2)); toast('Copied JSON'); } }, 'Copy JSON'),
    el('button', { onclick: () => { events.length = 0; render(); } }, 'Clear'),
    countEl,
  );

  function stop() { watcher.stop(); teardown(); }
  return { stop };
}

start();
