// The context builder. Everything the other tools captured, in one panel:
// reorder it, drop what you don't need, pick a preset, write the task, export
// one prompt. "Include" ticks persist, so a capture can live in the basket
// without bloating every export.

import { toast, el } from '../core/overlay/ui.js';
import { basket } from '../core/store/store.js';
import { hub } from '../core/hub-client.js';
import { toMarkdown, PRESETS, ICONS, labelFor } from '../core/export/markdown.js';
import { copy, readClipboard } from '../core/clipboard.js';
import { download, pickFile, stamp } from '../core/files.js';
import * as settings from '../app/settings.js';

export default {
  id: 'basket',
  title: 'Basket',
  desc: 'The context builder: assemble everything into one Copilot-ready prompt.',
  icon: '🧺',
  group: 'context',
  sites: ['*'],
  keywords: ['prompt', 'context', 'export', 'copilot', 'markdown'],

  start(ctx) {
    const p = ctx.panel({ width: 460, height: 520 });

    const task = el('textarea', { placeholder: 'What are you asking Copilot to do?', rows: '3', style: 'font-family:inherit' });
    const repo = el('input', { type: 'text', placeholder: 'target repo / component path (optional)', style: 'margin-top:6px' });
    const preset = el('select', { style: 'width:auto' }, Object.entries(PRESETS).map(([k, v]) => el('option', { value: k }, v.title)));
    const list = el('div', { style: 'margin-top:8px' });
    const empty = el('div', { class: 'muted', style: 'padding:10px 0' }, 'Nothing captured yet. Run Inspect element, Octane story, Checkpoints, Network recorder… then come back.');

    p.body.append(
      task, repo,
      el('div', { class: 'row', style: 'margin-top:8px' },
        el('span', { class: 'muted' }, 'preset'), preset,
        el('button', { class: 'sm', title: 'Tick every item the preset covers, untick the rest', onclick: applyPreset }, 'Apply'),
        el('span', { class: 'grow' }),
        el('button', { class: 'sm', onclick: () => setAll(true) }, 'all'),
        el('button', { class: 'sm', onclick: () => setAll(false) }, 'none')),
      list, empty,
    );

    const excluded = () => new Set(settings.get('basketExcluded'));
    const setExcluded = (set) => settings.set('basketExcluded', [...set]);

    function applyPreset() {
      const kinds = PRESETS[preset.value]?.kinds;
      const ex = new Set();
      for (const item of basket.all()) if (kinds && !kinds.includes(item.kind)) ex.add(item.id);
      setExcluded(ex); render();
    }
    function setAll(on) {
      setExcluded(on ? new Set() : new Set(basket.all().map((i) => i.id))); render();
    }

    function render() {
      const items = basket.all();
      const ex = excluded();
      empty.style.display = items.length ? 'none' : 'block';
      list.replaceChildren();
      items.forEach((item, index) => {
        const tick = el('input', { type: 'checkbox', checked: !ex.has(item.id), title: 'Include in the prompt' });
        tick.addEventListener('change', () => { const s = excluded(); tick.checked ? s.delete(item.id) : s.add(item.id); setExcluded(s); });
        const move = (delta) => () => {
          const next = [...items];
          const target = index + delta;
          if (target < 0 || target >= next.length) return;
          [next[index], next[target]] = [next[target], next[index]];
          basket.replaceAll(next);
        };
        list.append(el('div', { class: 'row item' },
          tick,
          el('span', {}, ICONS[item.kind] ?? '•'),
          el('span', { class: 'grow ellipsis', title: item.kind }, labelFor(item)),
          el('button', { class: 'sm', title: 'Up', onclick: move(-1) }, '↑'),
          el('button', { class: 'sm', title: 'Down', onclick: move(1) }, '↓'),
          el('button', { class: 'sm', title: 'Log to console', onclick: () => { console.log(item); toast('Logged'); } }, '⋯'),
          el('button', { class: 'sm danger', title: 'Remove', onclick: () => basket.remove(item.id) }, '✕'),
        ));
      });
    }

    const selected = () => { const ex = excluded(); return basket.all().filter((i) => !ex.has(i.id)); };
    const build = () => toMarkdown(selected(), { task: task.value.trim(), repoHint: repo.value.trim() });

    p.foot.append(
      el('button', { class: 'primary', onclick: async () => { const md = build(); await copy(md); toast(`Copied ${md.length} chars · ${selected().length} items`); } }, 'Copy prompt'),
      el('button', { onclick: () => download(`context-${stamp()}.md`, build(), 'text/markdown') }, 'Download .md'),
      el('button', { title: 'Save the basket as a JSON file (moves captures between origins / machines)', onclick: () => download(`basket-${stamp()}.json`, JSON.stringify(basket.export(), null, 2)) }, 'Export'),
      el('button', {
        title: 'Merge a basket JSON file in',
        onclick: async () => {
          const f = await pickFile();
          if (!f) return;
          try { const r = basket.import(f.text); toast(`Imported ${r.added} new (${r.total} total)`); } catch (err) { toast(`Import failed: ${err.message}`); }
        },
      }, 'Import'),
      el('button', { title: 'Copy the basket as JSON', onclick: async () => { await copy(JSON.stringify(basket.export())); toast('Basket JSON copied'); } }, 'Copy JSON'),
      el('button', {
        onclick: async () => {
          const raw = await readClipboard();
          if (!raw) return toast('Clipboard unreadable — use Import instead');
          try { const r = basket.import(raw); toast(`Merged ${r.added} new`); } catch (err) { toast(`Bad JSON: ${err.message}`); }
        },
      }, 'Paste JSON'),
      el('button', {
        title: 'Merge everything the local hub has collected, from every origin',
        onclick: async () => {
          const items = await hub.pull('basket');
          if (!items) return toast('No hub on :7373 (npm run hub) — or this page\'s CSP blocks it; see Diagnose');
          const r = basket.merge(items);
          toast(`Pulled ${items.length} from hub (${r.added} new)`);
        },
      }, 'Pull hub'),
      el('button', { class: 'danger', onclick: () => { if (confirm('Clear the whole basket?')) basket.clear(); } }, 'Clear'),
    );

    const off = basket.onChange(render);
    render();
    return { stop() { off(); p.close(); }, build, selected };
  },
};
