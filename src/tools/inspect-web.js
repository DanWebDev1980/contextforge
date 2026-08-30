// Hover an element, click it, get the whole subtree's styles.
//
// Keys: Esc exit · ↑/↓ widen/narrow to parent/child · Space freeze · [/] depth

import { panel, highlighter, toast, el, teardown } from '../core/overlay/ui.js';
import { normalizeTree, labelFor, selectorFor } from '../adapters/web/inspect.js';
import { capture } from '../core/schema/style.js';
import { basket } from '../core/store.js';
import { toMarkdown } from '../core/export/markdown.js';
import { copy } from '../core/clipboard.js';

export function start(options = {}) {
  let depth = options.maxDepth ?? 4;
  let hovered = null;
  let frozen = false;

  const hl = highlighter();
  const p = panel({ title: 'Inspect element', x: 16, y: 16, width: 320, onClose: stop });

  const info = el('div', { class: 'muted' }, 'Move over the page…');
  const depthLabel = el('span', {}, String(depth));
  p.body.append(
    info,
    el('div', { class: 'row', style: 'margin-top:8px' },
      el('span', { class: 'muted' }, 'depth'),
      el('button', { onclick: () => setDepth(depth - 1) }, '−'),
      depthLabel,
      el('button', { onclick: () => setDepth(depth + 1) }, '+')),
    el('div', { class: 'muted', style: 'margin-top:8px' },
      el('kbd', {}, 'Esc'), ' exit · ', el('kbd', {}, '↑↓'), ' parent/child · ',
      el('kbd', {}, 'Space'), ' freeze'),
  );

  const countEl = el('span', { class: 'muted' }, '');
  p.foot.append(
    el('button', { class: 'primary', onclick: () => grab() }, 'Capture'),
    el('button', { onclick: () => grab({ copyNow: true }) }, 'Capture + copy'),
    countEl,
  );

  function setDepth(d) {
    depth = Math.max(0, Math.min(12, d));
    depthLabel.textContent = String(depth);
  }

  function refreshCount() {
    const n = basket.all().length;
    countEl.textContent = n ? `${n} in basket` : '';
  }
  refreshCount();

  // Our own overlay must never be a capture target.
  function isOurs(node) {
    return !!node?.closest?.('#contextforge-root');
  }

  function setHovered(node) {
    if (!node || isOurs(node)) return;
    hovered = node;
    hl.show(node.getBoundingClientRect(), labelFor(node), { locked: frozen });
    info.textContent = selectorFor(node) || labelFor(node);
  }

  function onMove(e) {
    if (frozen) return;
    const node = e.composedPath?.()[0] ?? e.target;
    setHovered(node.nodeType === 1 ? node : node.parentElement);
  }

  function onClick(e) {
    if (isOurs(e.composedPath?.()[0] ?? e.target)) return;   // let panel buttons work
    e.preventDefault();
    e.stopPropagation();
    grab();
  }

  function onKey(e) {
    if (e.key === 'Escape') { stop(); return; }
    if (!hovered) return;
    if (e.key === 'ArrowUp' && hovered.parentElement) {
      e.preventDefault(); frozen = true; setHovered(hovered.parentElement);
    } else if (e.key === 'ArrowDown' && hovered.firstElementChild) {
      e.preventDefault(); frozen = true; setHovered(hovered.firstElementChild);
    } else if (e.key === ' ') {
      e.preventDefault(); frozen = !frozen; setHovered(hovered);
      toast(frozen ? 'Frozen — Space to release' : 'Following cursor');
    } else if (e.key === '[') { setDepth(depth - 1); }
    else if (e.key === ']') { setDepth(depth + 1); }
  }

  async function grab({ copyNow = false } = {}) {
    if (!hovered) { toast('Nothing selected'); return; }
    const { tree, nodeCount, truncated } = normalizeTree(hovered, { maxDepth: depth });
    const item = capture({
      source: 'web',
      node: tree,
      meta: { nodeCount, truncated, selector: selectorFor(hovered) },
    });
    basket.add(item);
    refreshCount();
    toast(`Captured ${nodeCount} node${nodeCount === 1 ? '' : 's'}${truncated ? ' (truncated)' : ''}`);
    if (copyNow) {
      await copy(toMarkdown([item]));
      toast('Copied to clipboard');
    }
  }

  // capture-phase listeners so the host app's own handlers never see these events
  addEventListener('mousemove', onMove, true);
  addEventListener('click', onClick, true);
  addEventListener('keydown', onKey, true);
  addEventListener('scroll', () => hovered && setHovered(hovered), true);

  function stop() {
    removeEventListener('mousemove', onMove, true);
    removeEventListener('click', onClick, true);
    removeEventListener('keydown', onKey, true);
    hl.destroy();
    teardown();
  }

  return { stop, grab };
}

start();
