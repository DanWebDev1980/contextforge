// Diff a Figma capture against a web capture. Pick one of each, get a table of
// what does not match, and drop that table into the basket so the prompt says
// exactly what to fix.

import { toast, el } from '../core/overlay/ui.js';
import { basket } from '../core/store/store.js';
import { compareCaptures } from '../core/compare.js';
import { copy } from '../core/clipboard.js';
import { toMarkdown } from '../core/export/markdown.js';

export default {
  id: 'compare',
  title: 'Compare design vs build',
  desc: 'Diff a Figma capture against a web capture and list what does not match.',
  icon: '🔍',
  group: 'design',
  sites: ['*'],
  keywords: ['diff', 'figma', 'styles', 'mismatch'],

  start(ctx) {
    const p = ctx.panel({ width: 460 });

    const captures = () => basket.all().filter((i) => i.kind === 'style-capture');
    const bySource = (source) => captures().filter((i) => i.source === source);

    function select(source) {
      const sel = el('select', { class: 'grow' });
      const options = bySource(source);
      if (!options.length) { sel.append(el('option', { value: '' }, `no ${source} captures yet`)); sel.disabled = true; }
      for (const item of options) {
        sel.append(el('option', { value: item.id }, `${item.node?.name ?? 'node'} — ${new Date(item.capturedAt).toLocaleTimeString()}`));
      }
      return sel;
    }

    const designSel = select('figma');
    const webSel = select('web');
    const onlyDiff = el('input', { type: 'checkbox', checked: true });
    const table = el('div', { class: 'mono', style: 'margin-top:10px;max-height:300px;overflow:auto' });

    p.body.append(
      el('div', { class: 'row' }, el('span', { style: 'width:52px' }, '🎨 design'), designSel),
      el('div', { class: 'row', style: 'margin-top:6px' }, el('span', { style: 'width:52px' }, '🌐 built'), webSel),
      el('label', { class: 'row', style: 'margin-top:8px' }, onlyDiff, el('span', { class: 'muted' }, 'only show mismatches')),
      table,
    );

    let result = null;

    function run() {
      const design = captures().find((i) => i.id === designSel.value);
      const web = captures().find((i) => i.id === webSel.value);
      if (!design || !web) { toast('Pick one of each'); return null; }
      result = compareCaptures(design, web, { onlyDifferences: onlyDiff.checked });
      table.replaceChildren();
      table.append(el('div', { class: 'row', style: 'font-weight:600;padding:4px 0;border-bottom:1px solid #363d48' },
        el('span', { style: 'flex:1.2' }, 'property'), el('span', { style: 'flex:1' }, 'design'), el('span', { style: 'flex:1' }, 'built')));
      for (const row of result.rows) {
        table.append(el('div', { class: 'row', style: `padding:3px 0;border-bottom:1px solid #1e222a;color:${row.match ? '#7f8794' : '#ffb4a8'}` },
          el('span', { style: 'flex:1.2' }, `${row.match ? '' : '✕ '}${row.property}`),
          el('span', { style: 'flex:1' }, String(row.design ?? '—')),
          el('span', { style: 'flex:1' }, String(row.web ?? '—'))));
      }
      if (!result.rows.length) table.append(el('div', { class: 'muted', style: 'padding:8px 0' }, 'Everything comparable matches. 🎉'));
      p.setTitle(`Design vs build — ${result.summary.mismatches} mismatch${result.summary.mismatches === 1 ? '' : 'es'}`);
      return result;
    }

    p.foot.append(
      el('button', { class: 'primary', onclick: run }, 'Compare'),
      el('button', { onclick: () => { const r = result ?? run(); if (!r) return; basket.add(r); toast('Comparison added to basket'); } }, 'Add to basket'),
      el('button', { onclick: async () => { const r = result ?? run(); if (!r) return; await copy(toMarkdown([r])); toast('Copied'); } }, 'Copy table'),
    );

    if (!designSel.disabled && !webSel.disabled) run();
    return { stop: () => p.close(), run };
  },
};
