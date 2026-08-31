// Live view of the GA4 events this page fires, with their parameters.
// Useful for "does my change still fire the right event with the right params?"

import { toast, el } from '../core/overlay/ui.js';
import { observe } from '../adapters/web/ga4.js';
import { basket } from '../core/store/store.js';
import { copy } from '../core/clipboard.js';

export default {
  id: 'ga4',
  title: 'GA4 events',
  desc: 'Live view of the GA4 events this page fires, with their parameters.',
  icon: '📊',
  group: 'wire',
  sites: ['web'],
  keywords: ['analytics', 'gtag', 'dataLayer', 'tracking'],

  start(ctx) {
    const events = [];
    let filter = '';

    const p = ctx.panel({ width: 420 });
    const filterInput = el('input', { type: 'search', placeholder: 'filter by event name or param…' });
    filterInput.addEventListener('input', () => { filter = filterInput.value.toLowerCase(); render(); });

    const list = el('div', { style: 'margin-top:8px' });
    const status = el('div', { class: 'muted' }, 'Listening… interact with the page.');
    p.body.append(filterInput, status, list);

    const countEl = el('span', { class: 'muted' }, '');

    const matches = (event) => !filter || JSON.stringify(event).toLowerCase().includes(filter);

    function render() {
      const shown = events.filter(matches);
      countEl.textContent = `${shown.length}/${events.length}`;
      list.replaceChildren();
      for (const event of [...shown].reverse().slice(0, 100)) {
        const params = Object.entries(event.params ?? {}).filter(([, v]) => v !== undefined);
        const detail = el('div', { class: 'muted mono', style: 'padding-left:14px;display:none' },
          params.map(([k, v]) => el('div', {}, `${k}: ${JSON.stringify(v)}`)));
        list.append(el('div', { class: 'item' },
          el('div', { class: 'row', style: 'cursor:pointer', onclick: () => { detail.style.display = detail.style.display === 'none' ? 'block' : 'none'; } },
            el('span', { class: 'grow', style: 'font-weight:600' }, event.name),
            el('span', { class: 'muted' }, `${params.length} params · ${event.transport}`)),
          detail));
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

    return { stop() { watcher.stop(); p.close(); }, events };
  },
};
