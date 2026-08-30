// Pulls discovery text out of a Figma / FigJam board without dev mode.
//
// Mechanism: the canvas is WebGL, but the left-hand layers list is DOM and
// FigJam names each sticky after its own text. So we scroll that virtualized
// list end to end and harvest the names. Click-a-sticky also works: selecting on
// canvas selects the matching row, and we read that.

import { panel, toast, el, teardown } from '../core/overlay/ui.js';
import { findLayersList, harvestLayers, selectedLayerText, looksLikeSticky } from '../adapters/figma/layers.js';
import { basket } from '../core/store.js';
import { copy } from '../core/clipboard.js';

export function start() {
  const p = panel({ title: 'Figma discovery capture', x: 16, y: 16, width: 380, onClose: teardown });
  const status = el('div', { class: 'muted' }, 'Open the layers panel on the left, then Harvest.');
  const list = el('div', { style: 'margin-top:8px;max-height:320px;overflow:auto' });
  p.body.append(status, list);

  let rows = [];
  let chosen = new Set();

  function render() {
    list.replaceChildren();
    if (!rows.length) return;
    for (const row of rows) {
      const id = row.text;
      const box = el('input', { type: 'checkbox' });
      box.checked = chosen.has(id);
      box.addEventListener('change', () => { box.checked ? chosen.add(id) : chosen.delete(id); updateFoot(); });
      list.append(el('label', {
        class: 'row',
        style: `align-items:flex-start;gap:6px;padding:3px 0;padding-left:${row.depth * 10}px`,
      }, box, el('span', {}, row.text)));
    }
  }

  const countEl = el('span', { class: 'muted' }, '');
  function updateFoot() { countEl.textContent = `${chosen.size}/${rows.length} selected`; }

  p.foot.append(
    el('button', {
      class: 'primary',
      onclick: async () => {
        const container = findLayersList();
        if (!container) { toast('No layers list found — open it (⌥1 / Alt+1)'); return; }
        status.textContent = 'Scrolling the list…';
        const all = await harvestLayers(container);
        rows = all.filter((r) => looksLikeSticky(r.text));
        chosen = new Set(rows.map((r) => r.text));
        status.textContent = `${rows.length} text-like layers of ${all.length} rows. Untick anything structural.`;
        render(); updateFoot();
      },
    }, 'Harvest all'),
    el('button', {
      onclick: () => {
        const text = selectedLayerText();
        if (!text) { toast('Nothing selected'); return; }
        if (!rows.some((r) => r.text === text)) rows.push({ text, depth: 0 });
        chosen.add(text);
        render(); updateFoot();
        toast('Added selection');
      },
    }, 'Add selected'),
    el('button', {
      onclick: () => {
        if (!chosen.size) { toast('Nothing ticked'); return; }
        basket.add({
          kind: 'note',
          title: `Figma discovery — ${document.title.replace(/\s*[–|-]\s*Figma.*$/i, '').trim()}`,
          body: [...chosen].map((t) => `- ${t}`).join('\n'),
          url: location.href,
        });
        toast(`Added ${chosen.size} notes to basket`);
      },
    }, 'Add to basket'),
    el('button', {
      onclick: async () => {
        await copy([...chosen].map((t) => `- ${t}`).join('\n'));
        toast('Copied');
      },
    }, 'Copy'),
    countEl,
  );

  return { stop: teardown };
}

start();
