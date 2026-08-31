// One button: grab the whole open Octane work item into the basket.
// Also handles "I have a story number" by rewriting the id in the current URL.

import { toast, el } from '../core/overlay/ui.js';
import { scrapeStory, readRoute } from '../adapters/octane/scrape.js';
import { basket } from '../core/store/store.js';
import { copy } from '../core/clipboard.js';
import { toMarkdown } from '../core/export/markdown.js';

export default {
  id: 'octane-story',
  title: 'Octane story',
  desc: 'Pull the whole open Octane work item — fields, description, AC, comments.',
  icon: '🎫',
  group: 'design',
  sites: ['octane'],
  keywords: ['ticket', 'alm', 'work item', 'acceptance criteria'],

  start(ctx) {
    const p = ctx.panel({ width: 380 });
    const preview = el('pre', { style: 'max-height:300px;font-size:11px' });
    const idInput = el('input', { type: 'text', placeholder: 'story #', style: 'width:80px' });
    const route = readRoute();

    p.body.append(
      el('div', { class: 'row', style: 'margin-bottom:8px' },
        idInput,
        el('button', {
          onclick: () => {
            const id = idInput.value.trim();
            if (!/^\d+$/.test(id)) return toast('Numbers only');
            if (!route.id) return toast('Open any story first so the URL shape is known');
            // Octane keeps the item addressable in the URL; swap the id and let the
            // SPA route to it, then re-scrape once it has settled.
            location.href = location.href.replace(/([?&#]id=)\d+/, `$1${id}`);
            setTimeout(refresh, 2500);
          },
        }, 'Go to story'),
        el('span', { class: 'muted' }, route.id ? `now on #${route.id}` : 'no id in URL')),
      preview,
    );

    let story = null;

    function refresh() {
      story = scrapeStory();
      const found = [
        story.storyId && `#${story.storyId}`,
        story.title,
        `${Object.keys(story.fields).length} fields`,
        story.description && 'description',
        story.acceptanceCriteria && 'acceptance criteria',
        story.comments.length && `${story.comments.length} comments`,
      ].filter(Boolean).join(' · ');
      preview.textContent = `${found}\n\n${toMarkdown([story]).slice(0, 4000)}`;
      return story;
    }

    p.foot.append(
      el('button', { class: 'primary', onclick: () => { refresh(); toast('Re-read the page'); } }, 'Read story'),
      el('button', { onclick: () => { if (!story) refresh(); basket.add(story); toast('Added to basket'); } }, 'Add to basket'),
      el('button', { onclick: async () => { if (!story) refresh(); await copy(toMarkdown([story])); toast('Copied as markdown'); } }, 'Copy markdown'),
      el('button', { onclick: () => { console.log(story ?? refresh()); toast('Logged'); } }, 'Debug'),
    );

    refresh();
    return { stop: () => p.close(), refresh };
  },
};
