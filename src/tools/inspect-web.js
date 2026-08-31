// Hover an element, click it, get the whole subtree's styles — plus the design
// tokens (CSS custom properties) in effect, the @media / @container context
// its rules live under, and a "copy as CSS" of the normalized node.
//
// Keys: Esc exit · ↑/↓ widen/narrow to parent/child · Space freeze · [/] depth

import { highlighter, toast, el, isOurs } from '../core/overlay/ui.js';
import { normalizeTree, labelFor, selectorFor, ruleContext, toCSS } from '../adapters/web/inspect.js';
import { capture } from '../core/schema/style.js';
import { basket } from '../core/store/store.js';
import { toMarkdown } from '../core/export/markdown.js';
import { copy } from '../core/clipboard.js';

export default {
  id: 'inspect-web',
  title: 'Inspect element',
  desc: 'Hover any element, click it, capture the subtree\'s computed styles, tokens and rule context.',
  icon: '🔎',
  group: 'context',
  sites: ['web', 'octane'],
  keywords: ['styles', 'css', 'computed', 'tokens', 'dom', 'element'],

  start(ctx) {
    let depth = ctx.options.maxDepth ?? 4;
    let hovered = null;
    let frozen = false;
    let lastItem = null;

    const hl = highlighter();
    const p = ctx.panel({ width: 360 });

    const info = el('div', { class: 'muted ellipsis' }, 'Move over the page…');
    const depthLabel = el('span', {}, String(depth));
    const detail = el('div', { style: 'margin-top:8px;max-height:260px;overflow:auto' });
    p.body.append(
      info,
      el('div', { class: 'row', style: 'margin-top:8px' },
        el('span', { class: 'muted' }, 'depth'),
        el('button', { class: 'sm', onclick: () => setDepth(depth - 1) }, '−'), depthLabel,
        el('button', { class: 'sm', onclick: () => setDepth(depth + 1) }, '+'),
        el('span', { class: 'muted', style: 'margin-left:auto' }, el('kbd', {}, 'Esc'), ' exit · ', el('kbd', {}, '↑↓'), ' parent/child · ', el('kbd', {}, 'Space'), ' freeze')),
      detail,
    );

    const countEl = el('span', { class: 'muted' }, '');
    p.foot.append(
      el('button', { class: 'primary', onclick: () => grab() }, 'Capture'),
      el('button', { onclick: () => grab({ copyNow: true }) }, 'Capture + copy'),
      el('button', { title: 'The normalized styles of the last capture as a CSS block', onclick: copyCss }, 'Copy as CSS'),
      countEl,
    );

    function setDepth(d) { depth = Math.max(0, Math.min(12, d)); depthLabel.textContent = String(depth); }
    function refreshCount() { const n = basket.count(); countEl.textContent = n ? `${n} in basket` : ''; }
    refreshCount();

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
      if (isOurs(e.composedPath?.()[0] ?? e.target)) return;
      e.preventDefault(); e.stopPropagation();
      grab();
    }
    function onKey(e) {
      if (e.key === 'Escape') { ctx.stop(); return; }
      if (!hovered) return;
      if (e.key === 'ArrowUp' && hovered.parentElement) { e.preventDefault(); frozen = true; setHovered(hovered.parentElement); }
      else if (e.key === 'ArrowDown' && hovered.firstElementChild) { e.preventDefault(); frozen = true; setHovered(hovered.firstElementChild); }
      else if (e.key === ' ') { e.preventDefault(); frozen = !frozen; setHovered(hovered); toast(frozen ? 'Frozen — Space to release' : 'Following cursor'); }
      else if (e.key === '[') setDepth(depth - 1);
      else if (e.key === ']') setDepth(depth + 1);
    }

    function renderDetail(item) {
      detail.replaceChildren();
      const { tokens, rules, unreadableSheets } = item.meta.context ?? { tokens: [], rules: [] };
      if (tokens.length) {
        detail.append(el('div', { style: 'font-weight:600;margin-bottom:3px' }, `Tokens in effect (${tokens.length})`));
        detail.append(el('div', { class: 'kv mono' }, tokens.map((t) => [el('span', { class: 'k' }, t.name), el('span', {}, t.value ?? '—')])));
      }
      const scoped = rules.filter((r) => r.context.length);
      if (scoped.length) {
        detail.append(el('div', { style: 'font-weight:600;margin:8px 0 3px' }, 'Rules under a condition'));
        for (const r of scoped) {
          detail.append(el('div', { class: 'mono muted' },
            r.context.map((c) => el('span', { class: c.matches === false ? 'bad' : c.matches ? 'ok' : '' }, `${c.label} `)),
            el('span', {}, `→ ${r.selector}`)));
        }
      }
      if (!tokens.length && !scoped.length) detail.append(el('div', { class: 'muted' }, `No custom properties or conditional rules apply. ${rules.length} rule(s) matched.`));
      if (unreadableSheets) detail.append(el('div', { class: 'muted', style: 'margin-top:4px' }, `${unreadableSheets} cross-origin stylesheet(s) unreadable.`));
    }

    async function grab({ copyNow = false } = {}) {
      if (!hovered) { toast('Nothing selected'); return null; }
      const { tree, nodeCount, truncated } = normalizeTree(hovered, { maxDepth: depth });
      let context = { rules: [], tokens: [], unreadableSheets: 0 };
      try { context = ruleContext(hovered); } catch { /* fine — tokens are a bonus */ }
      const item = capture({
        source: 'web',
        node: tree,
        meta: {
          nodeCount, truncated, selector: selectorFor(hovered),
          context: { tokens: context.tokens, rules: context.rules.slice(0, 40), unreadableSheets: context.unreadableSheets },
          media: { viewport: `${innerWidth}×${innerHeight}`, dpr: devicePixelRatio, colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' },
        },
      });
      lastItem = item;
      basket.add(item);
      refreshCount();
      renderDetail(item);
      toast(`Captured ${nodeCount} node${nodeCount === 1 ? '' : 's'}${truncated ? ' (truncated)' : ''}`);
      if (copyNow) { await copy(toMarkdown([item])); toast('Copied to clipboard'); }
      return item;
    }

    async function copyCss() {
      const item = lastItem ?? (hovered ? await grab() : null);
      if (!item) return;
      await copy(toCSS(item.node, { selector: item.meta.selector }));
      toast('CSS copied');
    }

    addEventListener('mousemove', onMove, true);
    addEventListener('click', onClick, true);
    addEventListener('keydown', onKey, true);
    const onScroll = () => hovered && setHovered(hovered);
    addEventListener('scroll', onScroll, true);

    return {
      stop() {
        removeEventListener('mousemove', onMove, true);
        removeEventListener('click', onClick, true);
        removeEventListener('keydown', onKey, true);
        removeEventListener('scroll', onScroll, true);
        hl.destroy();
        p.close();
      },
      grab, setHovered, toCSS: () => (lastItem ? toCSS(lastItem.node, { selector: lastItem.meta.selector }) : null),
    };
  },
};
