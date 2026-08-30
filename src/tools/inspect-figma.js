// Watches the Figma selection and captures the right-hand panel's styles.
// Click a layer on the canvas → its styles land in the basket, in the same
// schema as a web capture, so `compare.js` can diff the two.

import { panel, toast, el, teardown } from '../core/overlay/ui.js';
import { scrapeSelection, watchSelection } from '../adapters/figma/scrape.js';
import { capture } from '../core/schema/style.js';
import { basket } from '../core/store.js';
import { copy } from '../core/clipboard.js';
import { toMarkdown } from '../core/export/markdown.js';

export function start() {
  let current = null;
  let auto = false;

  const p = panel({ title: 'Figma capture', x: 16, y: 16, width: 330, onClose: stop });
  const nameEl = el('div', { style: 'font-weight:600' }, 'Nothing selected');
  const summary = el('div', { class: 'muted', style: 'margin-top:6px;white-space:pre-wrap' },
    'Click a layer on the canvas.');
  const warn = el('div', { class: 'muted', style: 'margin-top:8px' });
  p.body.append(nameEl, summary, warn);

  const autoBtn = el('button', { onclick: () => { auto = !auto; autoBtn.className = auto ? 'primary' : ''; toast(auto ? 'Auto-capturing every selection' : 'Auto-capture off'); } }, 'Auto');
  const countEl = el('span', { class: 'muted' }, '');
  p.foot.append(
    el('button', { class: 'primary', onclick: () => grab() }, 'Capture'),
    autoBtn,
    el('button', { onclick: () => { console.log(current?.rawFields); toast('Raw fields logged'); } }, 'Debug'),
    countEl,
  );

  function refreshCount() {
    const n = basket.all().length;
    countEl.textContent = n ? `${n} in basket` : '';
  }

  function render(result) {
    current = result;
    const n = result.node;
    nameEl.textContent = n.name;
    const bits = [
      n.box.width != null && `${n.box.width} × ${n.box.height}`,
      n.typography.fontFamily && `${n.typography.fontFamily} ${n.typography.fontWeight ?? ''} ${n.typography.fontSize ?? ''}`.trim(),
      n.typography.color && `text ${n.typography.color}`,
      n.fill.background && `fill ${n.fill.background}`,
      n.border.radius.tl && `radius ${n.border.radius.tl}`,
    ].filter(Boolean);
    summary.textContent = bits.join('\n') || 'No recognised properties — run the probe tool.';
    if (auto) grab({ quiet: true });
  }

  async function grab({ quiet = false, copyNow = false } = {}) {
    const result = current ?? scrapeSelection();
    if (!result) { toast('Nothing readable — is a layer selected?'); return; }
    const item = capture({ source: 'figma', node: result.node, meta: { rawFields: result.rawFields } });
    basket.add(item);
    refreshCount();
    if (!quiet) toast(`Captured "${result.node.name}"`);
    if (copyNow) { await copy(toMarkdown([item])); toast('Copied'); }
  }

  const first = scrapeSelection();
  if (!first) {
    warn.textContent = 'Could not find the properties panel. Select a layer so the panel is visible, then reload this tool. If it still fails, run the probe tool on the panel.';
  } else {
    render(first);
  }
  refreshCount();

  const unwatch = watchSelection(render);
  function stop() { unwatch(); teardown(); }
  return { stop, grab };
}

start();
