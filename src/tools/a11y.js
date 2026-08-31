// Accessibility outline: role / accessible-name tree of a region (click to pick,
// or the whole page), headings outline, contrast flags.

import { highlighter, toast, el, isOurs } from '../core/overlay/ui.js';
import { roleTree, headings, contrastIssues, a11yMarkdown } from '../adapters/web/a11y.js';
import { selectorFor, labelFor } from '../adapters/web/inspect.js';
import { basket } from '../core/store/store.js';
import { copy } from '../core/clipboard.js';

export default {
  id: 'a11y',
  title: 'Accessibility outline',
  desc: 'Role / name tree of a region, headings outline, contrast failures — what is on screen, cheaply.',
  icon: '♿',
  group: 'context',
  sites: ['web', '*'],
  keywords: ['accessibility', 'aria', 'roles', 'headings', 'contrast', 'wcag', 'outline'],

  start(ctx) {
    const p = ctx.panel({ width: 520, height: 460 });
    const hl = highlighter();
    let hovered = null;
    let picking = true;
    let last = null;

    const info = el('div', { class: 'muted' }, 'Hover a region and click it, or "Whole page".');
    const out = el('pre', { style: 'margin-top:8px;font-size:10px;white-space:pre-wrap' });
    p.body.append(info, out);

    function analyse(root) {
      const region = root === document.body ? 'body' : selectorFor(root) || labelFor(root);
      const tree = roleTree(root);
      const heads = headings(root);
      const contrast = contrastIssues(root);
      const md = a11yMarkdown({ region, tree, heads, contrast });
      last = { kind: 'a11y', region, markdown: md, url: location.href, summary: { roles: tree.lines.length, headings: heads.length, contrastFailures: contrast.length, warnings: tree.lines.filter((l) => l.extra.some((x) => x.startsWith('⚠'))).length }, contrast: contrast.map(({ el: _e, ...c }) => c) };
      out.textContent = md.replace(/\*\*/g, '').replace(/`/g, '');
      info.textContent = `${region}: ${last.summary.roles} roles · ${heads.length} headings · ${contrast.length} contrast failure(s) · ${last.summary.warnings} labelling warning(s)`;
      picking = false;
      hl.hide();
      return last;
    }

    function onMove(e) {
      if (!picking) return;
      const node = e.composedPath?.()[0] ?? e.target;
      if (!node || node.nodeType !== 1 || isOurs(node)) return;
      hovered = node;
      hl.show(node.getBoundingClientRect(), labelFor(node));
    }
    function onClick(e) {
      if (!picking || isOurs(e.composedPath?.()[0] ?? e.target)) return;
      e.preventDefault(); e.stopPropagation();
      if (hovered) analyse(hovered);
    }
    function onKey(e) { if (e.key === 'Escape') ctx.stop(); }
    addEventListener('mousemove', onMove, true);
    addEventListener('click', onClick, true);
    addEventListener('keydown', onKey, true);

    p.foot.append(
      el('button', { class: 'primary', onclick: () => analyse(document.body) }, 'Whole page'),
      el('button', { onclick: () => { picking = true; info.textContent = 'Hover a region and click it.'; } }, 'Pick region'),
      el('button', { onclick: () => { if (!last) return toast('Analyse first'); basket.add(last); toast('Added to basket'); } }, 'Add to basket'),
      el('button', { onclick: async () => { if (!last) return toast('Analyse first'); await copy(last.markdown); toast('Copied'); } }, 'Copy markdown'),
    );

    return {
      stop() { removeEventListener('mousemove', onMove, true); removeEventListener('click', onClick, true); removeEventListener('keydown', onKey, true); hl.destroy(); p.close(); },
      analyse, get last() { return last; },
    };
  },
};
