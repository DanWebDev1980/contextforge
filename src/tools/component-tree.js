// Component tree: click an element, walk the React fiber up to the root —
// component names, key props (sanitised), hook counts, source file when a dev
// build exposes it. Answers "what renders this?" — the question every AI prompt
// starts with. React only. Minified names are called out, not shown as `t`.

import { highlighter, toast, el, isOurs } from '../core/overlay/ui.js';
import { componentChain, isReactPage } from '../adapters/web/fiber.js';
import { selectorFor, labelFor } from '../adapters/web/inspect.js';
import { basket } from '../core/store/store.js';
import { copy } from '../core/clipboard.js';
import { toMarkdown } from '../core/export/markdown.js';

export default {
  id: 'components',
  title: 'Component tree',
  desc: 'Click an element: which React components render it, their props, hooks and source file.',
  icon: '🌳',
  group: 'context',
  sites: ['web'],
  keywords: ['react', 'fiber', 'component', 'props', 'what renders this'],

  start(ctx) {
    const p = ctx.panel({ width: 460, height: 460 });
    const hl = highlighter();
    let hovered = null;
    let lastItem = null;

    const info = el('div', { class: 'muted' }, isReactPage() ? 'Hover an element, click it.' : 'This does not look like a React page (no fiber keys, devtools hook or root container). Clicking will say so rather than guess.');
    const out = el('div', { style: 'margin-top:8px' });
    p.body.append(info, out);

    function render(item) {
      out.replaceChildren();
      if (!item.chain.length) { out.append(el('div', { class: 'warn' }, item.note ?? 'No components found.')); return; }
      if (item.minified) out.append(el('div', { class: 'warn', style: 'margin-bottom:6px' }, `Production build: ${item.minifiedCount} of ${item.chain.length} names are minified. Use a dev build for real names, or rely on the props and host tags below.`));
      item.chain.forEach((c, i) => {
        const props = Object.entries(c.props ?? {});
        const detail = el('div', { class: 'mono muted', style: 'display:none;padding:2px 0 4px 26px;white-space:pre-wrap' }, props.length ? props.map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n') : '(no props)');
        out.append(el('div', { class: 'item', style: `padding-left:${Math.min(i, 10) * 10}px` },
          el('div', { class: 'row', style: 'cursor:pointer', onclick: () => { detail.style.display = detail.style.display === 'none' ? 'block' : 'none'; } },
            el('span', { style: 'width:14px' }, i === 0 ? '▸' : '↑'),
            el('strong', {}, c.name),
            c.host ? el('code', { class: 'muted' }, `<${c.host}>`) : null,
            c.key != null ? el('span', { class: 'badge' }, `key=${c.key}`) : null,
            el('span', { class: 'grow' }),
            c.hooks ? el('span', { class: 'muted' }, `${c.hooks} hook${c.hooks === 1 ? '' : 's'}`) : null,
            c.source ? el('code', { class: 'muted', title: c.source }, c.source.split('/').pop()) : null,
            el('span', { class: 'muted' }, `${props.length} props`)),
          detail));
      });
    }

    function grab() {
      if (!hovered) return toast('Nothing selected');
      const r = componentChain(hovered);
      const item = {
        kind: 'component-tree', selector: selectorFor(hovered), url: location.href, chain: r.chain, react: r.react,
        minified: r.minified, minifiedCount: r.minifiedCount ?? 0, version: r.version ?? null,
        note: !r.chain.length ? r.reason : r.minified ? `production build — ${r.minifiedCount} minified names` : null,
      };
      lastItem = item;
      render(item);
      info.textContent = `${labelFor(hovered)} — ${item.chain.length} component(s)${item.version ? ` · React ${item.version}` : ''}`;
      return item;
    }

    function onMove(e) {
      const node = e.composedPath?.()[0] ?? e.target;
      if (!node || node.nodeType !== 1 || isOurs(node)) return;
      hovered = node;
      hl.show(node.getBoundingClientRect(), labelFor(node));
    }
    function onClick(e) {
      if (isOurs(e.composedPath?.()[0] ?? e.target)) return;
      e.preventDefault(); e.stopPropagation();
      grab();
    }
    function onKey(e) { if (e.key === 'Escape') ctx.stop(); }
    addEventListener('mousemove', onMove, true);
    addEventListener('click', onClick, true);
    addEventListener('keydown', onKey, true);

    p.foot.append(
      el('button', { class: 'primary', onclick: () => { const item = lastItem ?? grab(); if (!item) return; basket.add(item); toast('Added to basket'); } }, 'Add to basket'),
      el('button', { onclick: async () => { const item = lastItem ?? grab(); if (!item) return; await copy(toMarkdown([item])); toast('Copied'); } }, 'Copy markdown'),
      el('button', { onclick: () => { console.log(lastItem); toast('Logged'); } }, 'Log'),
    );

    return {
      stop() { removeEventListener('mousemove', onMove, true); removeEventListener('click', onClick, true); removeEventListener('keydown', onKey, true); hl.destroy(); p.close(); },
      grab, pick: (node) => { hovered = node; return grab(); }, get last() { return lastItem; },
    };
  },
};
