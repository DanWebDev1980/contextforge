// The context builder. Everything the other tools captured, in one panel:
// reorder it, drop what you don't need, write the task, export one prompt.

import { panel, toast, el, teardown } from '../core/overlay/ui.js';
import { basket } from '../core/store.js';
import { hub } from '../core/hub-client.js';
import { toMarkdown } from '../core/export/markdown.js';
import { copy, readClipboard } from '../core/clipboard.js';

const ICONS = { story: '🎫', note: '📝', 'style-capture': '🎨', comparison: '🔍', analytics: '📊' };

function label(item) {
  switch (item.kind) {
    case 'story': return `${item.storyId ? `#${item.storyId} ` : ''}${item.title ?? 'story'}`;
    case 'note': return item.title || (item.body ?? '').slice(0, 60);
    case 'style-capture': return `${item.source}: ${item.node?.name ?? 'node'}${item.meta?.nodeCount ? ` (${item.meta.nodeCount})` : ''}`;
    case 'comparison': return `${item.label} — ${item.summary?.mismatches ?? 0} mismatched`;
    case 'analytics': return item.label || 'analytics';
    default: return item.kind;
  }
}

export function start() {
  const p = panel({ title: 'Context builder', x: 16, y: 16, width: 420, onClose: teardown });

  const task = el('textarea', {
    placeholder: 'What are you asking Copilot to do?',
    rows: '3',
    style: 'width:100%;background:#0e1013;color:#e7e9ee;border:1px solid #363d48;border-radius:6px;padding:6px;font:inherit;font-size:11px;resize:vertical',
  });
  const repo = el('input', {
    placeholder: 'target repo / component path (optional)',
    style: 'width:100%;margin-top:6px;background:#0e1013;color:#e7e9ee;border:1px solid #363d48;border-radius:6px;padding:5px 6px;font:inherit;font-size:11px',
  });
  const list = el('div', { style: 'margin-top:10px' });
  const empty = el('div', { class: 'muted', style: 'padding:10px 0' },
    'Nothing captured yet. Run inspect-web, octane-story, figma-stickies… then come back.');

  p.body.append(task, repo, list, empty);

  // Only items that are ticked go into the prompt, so you can keep a capture
  // around without it bloating every export.
  const excluded = new Set();

  function render() {
    const items = basket.all();
    empty.style.display = items.length ? 'none' : 'block';
    list.replaceChildren();

    items.forEach((item, index) => {
      const tick = el('input', { type: 'checkbox' });
      tick.checked = !excluded.has(item.id);
      tick.addEventListener('change', () => {
        tick.checked ? excluded.delete(item.id) : excluded.add(item.id);
      });

      const move = (delta) => () => {
        const next = [...items];
        const target = index + delta;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];
        basket.replaceAll(next);
      };

      list.append(el('div', {
        class: 'row',
        style: 'gap:6px;padding:5px 0;border-bottom:1px solid #262b33;align-items:center',
      },
        tick,
        el('span', {}, ICONS[item.kind] ?? '•'),
        el('span', { style: 'flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, label(item)),
        el('button', { title: 'Up', onclick: move(-1) }, '↑'),
        el('button', { title: 'Down', onclick: move(1) }, '↓'),
        el('button', { title: 'Inspect in console', onclick: () => { console.log(item); toast('Logged'); } }, '⋯'),
        el('button', { class: 'danger', title: 'Remove', onclick: () => basket.remove(item.id) }, '✕'),
      ));
    });
  }

  const selected = () => basket.all().filter((i) => !excluded.has(i.id));
  const build = () => toMarkdown(selected(), { task: task.value.trim(), repoHint: repo.value.trim() });

  p.foot.append(
    el('button', {
      class: 'primary',
      onclick: async () => {
        const md = build();
        await copy(md);
        toast(`Copied ${md.length} chars`);
      },
    }, 'Copy prompt'),
    el('button', {
      onclick: () => {
        const blob = new Blob([build()], { type: 'text/markdown' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `context-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.md`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      },
    }, 'Download .md'),
    el('button', {
      title: 'Move captures between origins by hand',
      onclick: async () => { await copy(JSON.stringify(basket.all())); toast('Basket JSON copied'); },
    }, 'Copy JSON'),
    el('button', {
      onclick: async () => {
        const raw = await readClipboard();
        if (!raw) return toast('Clipboard unreadable — paste into the console instead');
        try {
          const items = JSON.parse(raw);
          if (!Array.isArray(items)) throw new Error('not an array');
          basket.merge(items);
          toast(`Merged ${items.length}`);
        } catch (err) { toast(`Bad JSON: ${err.message}`); }
      },
    }, 'Paste JSON'),
    el('button', {
      title: 'Merge everything the local hub has collected, from every origin',
      onclick: async () => {
        const items = await hub.pull();
        if (!items) return toast('No hub on :7373 (npm run hub)');
        basket.merge(items);
        toast(`Pulled ${items.length} from hub`);
      },
    }, 'Pull hub'),
    el('button', {
      class: 'danger',
      onclick: () => { if (confirm('Clear the whole basket?')) basket.clear(); },
    }, 'Clear'),
  );

  basket.onChange(render);
  render();
  return { stop: teardown, build };
}

start();
