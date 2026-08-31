// Calibration tool.
//
// Figma and Octane both render obfuscated, build-specific class names, so no
// selector written blind will survive. Instead: run this, click the region that
// holds the data you want, and it dumps an annotated structural outline you can
// paste into an issue or a prompt. Real selectors get written from that outline.
//
// It records structure and text only — never values from password inputs.

import { highlighter, toast, el, isOurs } from '../core/overlay/ui.js';
import { copy } from '../core/clipboard.js';

const MAX_TEXT = 120;

function describe(node) {
  const bits = [node.tagName.toLowerCase()];
  if (node.id) bits.push(`#${node.id}`);
  if (node.classList.length) bits.push(`.${[...node.classList].join('.')}`);
  const attrs = [...node.attributes]
    .filter((a) => /^(data-|aria-|role|name|type|placeholder|title)/.test(a.name))
    .map((a) => `${a.name}="${String(a.value).slice(0, 60)}"`);
  if (attrs.length) bits.push(`[${attrs.join(' ')}]`);
  return bits.join('');
}

function ownText(node) {
  const t = [...node.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, MAX_TEXT) : '';
}

function valueOf(node) {
  const tag = node.tagName;
  if (tag === 'INPUT') {
    if (node.type === 'password') return '‹redacted›';
    return node.value ? `value="${String(node.value).slice(0, MAX_TEXT)}"` : '';
  }
  if (tag === 'TEXTAREA') return node.value ? `value="${String(node.value).slice(0, MAX_TEXT)}"` : '';
  if (tag === 'SELECT') return `selected="${node.options[node.selectedIndex]?.text ?? ''}"`;
  return '';
}

/** Render an outline of a subtree: indentation, selector-ish description, text. */
export function outline(root, { maxDepth = 8, maxNodes = 600 } = {}) {
  const lines = [];
  let count = 0;
  (function walk(node, depth) {
    if (count >= maxNodes || depth > maxDepth) return;
    count += 1;
    const text = ownText(node);
    const value = valueOf(node);
    const suffix = [text && `"${text}"`, value].filter(Boolean).join(' ');
    lines.push(`${'  '.repeat(depth)}${describe(node)}${suffix ? `  → ${suffix}` : ''}`);
    for (const child of node.children) {
      if (/^(SCRIPT|STYLE|SVG|CANVAS|NOSCRIPT)$/.test(child.tagName)) { lines.push(`${'  '.repeat(depth + 1)}<${child.tagName.toLowerCase()} …>`); continue; }
      walk(child, depth + 1);
    }
  })(root, 0);
  if (count >= maxNodes) lines.push(`… truncated at ${maxNodes} nodes`);
  return lines.join('\n');
}

export default {
  id: 'probe',
  title: 'Probe',
  desc: 'Dump a region\'s DOM structure so selectors can be written for it.',
  icon: '🧪',
  group: 'calibration',
  sites: ['figma', 'octane'],
  keywords: ['dom', 'outline', 'selectors', 'calibrate'],

  start(ctx) {
    let hovered = null;
    const hl = highlighter();
    const p = ctx.panel({ width: 340 });

    const info = el('div', { class: 'muted' }, 'Hover the panel or form you want selectors for, then click it.');
    const out = el('pre', { style: 'margin-top:8px;max-height:280px;font-size:10px;white-space:pre' });
    p.body.append(info, out);

    let lastDump = '';
    p.foot.append(
      el('button', { class: 'primary', onclick: async () => { if (!lastDump) return toast('Click a region first'); await copy(lastDump); toast('Outline copied'); } }, 'Copy outline'),
      el('button', { onclick: () => { console.log(lastDump); toast('Logged to console'); } }, 'Log to console'),
    );

    function onMove(e) {
      const node = e.composedPath?.()[0] ?? e.target;
      if (!node || node.nodeType !== 1 || isOurs(node)) return;
      hovered = node;
      hl.show(node.getBoundingClientRect(), describe(node).slice(0, 90));
    }

    function onClick(e) {
      const target = e.composedPath?.()[0] ?? e.target;
      if (isOurs(target)) return;
      e.preventDefault(); e.stopPropagation();
      if (!hovered) return;
      lastDump = [`# bcc probe`, `# url: ${location.href}`, `# ua: ${navigator.userAgent}`, `# captured: ${new Date().toISOString()}`, '', outline(hovered)].join('\n');
      out.textContent = lastDump;
      info.textContent = `Dumped ${lastDump.split('\n').length} lines. Copy and hand it over.`;
    }

    function onKey(e) { if (e.key === 'Escape') ctx.stop(); }

    addEventListener('mousemove', onMove, true);
    addEventListener('click', onClick, true);
    addEventListener('keydown', onKey, true);

    return {
      stop() {
        removeEventListener('mousemove', onMove, true);
        removeEventListener('click', onClick, true);
        removeEventListener('keydown', onKey, true);
        hl.destroy();
        p.close();
      },
      dump: () => lastDump,
    };
  },
};
