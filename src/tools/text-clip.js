// Highlight text anywhere, press Alt+C (or click Clip), and it lands in the
// basket with its source URL. For discovery docs, wiki pages, Slack, anything.

import { panel, toast, el, teardown } from '../core/overlay/ui.js';
import { basket } from '../core/store.js';
import { htmlToMarkdown } from '../adapters/octane/scrape.js';

export function start() {
  const p = panel({ title: 'Text clipper', x: 16, y: 16, width: 300, onClose: stop });
  const status = el('div', { class: 'muted' },
    'Select text on the page, then press Alt+C.');
  const log = el('div', { style: 'margin-top:8px;max-height:220px;overflow:auto' });
  p.body.append(status, log);

  let autoClip = false;
  const autoBtn = el('button', {
    onclick: () => {
      autoClip = !autoClip;
      autoBtn.className = autoClip ? 'primary' : '';
      status.textContent = autoClip
        ? 'Auto: every selection is clipped when you release the mouse.'
        : 'Select text on the page, then press Alt+C.';
    },
  }, 'Auto-clip');

  p.foot.append(
    el('button', { class: 'primary', onclick: () => clip() }, 'Clip selection'),
    autoBtn,
    el('button', { onclick: () => { log.replaceChildren(); } }, 'Clear list'),
  );

  /** Preserve list structure when the selection spans real markup. */
  function selectionMarkdown(selection) {
    if (selection.rangeCount === 0) return '';
    const holder = document.createElement('div');
    holder.appendChild(selection.getRangeAt(0).cloneContents());
    const md = htmlToMarkdown(holder);
    return md || selection.toString().trim();
  }

  function clip() {
    const selection = getSelection();
    const body = selectionMarkdown(selection);
    if (!body) { toast('Nothing selected'); return; }

    const anchor = selection.anchorNode?.parentElement;
    const heading = anchor?.closest('section, article, div')
      ?.querySelector('h1, h2, h3')?.textContent?.trim();

    const item = basket.add({
      kind: 'note',
      title: heading?.slice(0, 120) || document.title.slice(0, 120),
      body,
      url: location.href,
    });
    log.prepend(el('div', { style: 'padding:4px 0;border-bottom:1px solid #262b33' },
      el('span', { class: 'muted' }, `${body.length} chars · `),
      el('span', {}, body.slice(0, 90) + (body.length > 90 ? '…' : '')),
    ));
    toast('Clipped');
    selection.removeAllRanges();
    return item;
  }

  function onKey(e) {
    if (e.altKey && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); clip(); }
    if (e.key === 'Escape') stop();
  }
  function onMouseUp() {
    if (!autoClip) return;
    // let the browser finish updating the selection before reading it
    setTimeout(() => { if (getSelection().toString().trim()) clip(); }, 10);
  }

  addEventListener('keydown', onKey, true);
  addEventListener('mouseup', onMouseUp, true);

  function stop() {
    removeEventListener('keydown', onKey, true);
    removeEventListener('mouseup', onMouseUp, true);
    teardown();
  }
  return { stop, clip };
}

start();
