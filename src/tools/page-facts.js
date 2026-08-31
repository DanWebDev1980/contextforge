// Page facts: one-click environment fingerprint — framework + version, build
// ids, viewport, UA, feature flags found in storage, web vitals so far.

import { toast, el } from '../core/overlay/ui.js';
import { collectFacts, factsMarkdown } from '../adapters/web/facts.js';
import { basket } from '../core/store/store.js';
import { copy } from '../core/clipboard.js';
import * as settings from '../app/settings.js';

export default {
  id: 'facts',
  title: 'Page facts',
  desc: 'Framework, build id, viewport, UA, feature flags in storage, web vitals so far — one click.',
  icon: '🧭',
  group: 'context',
  sites: ['web', '*'],
  keywords: ['environment', 'fingerprint', 'version', 'vitals', 'flags', 'framework', 'build'],

  start(ctx) {
    const p = ctx.panel({ width: 520, height: 420 });
    const out = el('pre', { style: 'font-size:11px;white-space:pre-wrap' });
    p.body.append(out);
    let facts = null;
    let md = '';

    function run() {
      facts = collectFacts(settings.flagRegex());
      md = factsMarkdown(facts);
      out.textContent = md.replace(/\*\*/g, '').replace(/`/g, '');
      return facts;
    }
    const item = () => ({ kind: 'facts', facts, markdown: md, url: location.href, title: facts.framework?.name });

    p.foot.append(
      el('button', { class: 'primary', onclick: () => { run(); basket.add(item()); toast('Added to basket'); } }, 'Add to basket'),
      el('button', { onclick: async () => { run(); await copy(md); toast('Copied markdown'); } }, 'Copy markdown'),
      el('button', { onclick: async () => { run(); await copy(JSON.stringify(facts, null, 2)); toast('Copied JSON'); } }, 'Copy JSON'),
      el('button', { onclick: () => { run(); toast('Refreshed'); } }, 'Refresh'),
    );

    run();
    return { stop: () => p.close(), run, get facts() { return facts; }, get markdown() { return md; } };
  },
};
