// Accessibility outline: the role / accessible-name tree of a region, the
// headings outline, and contrast flags. Cheaper than styles for describing
// *what* is on screen.

import { roleOf, accessibleName } from '../../core/journey.js';
import { color } from '../../core/schema/style.js';

const LANDMARKS = { header: 'banner', nav: 'navigation', main: 'main', footer: 'contentinfo', aside: 'complementary', form: 'form', section: 'region', article: 'article', dialog: 'dialog', table: 'table', ul: 'list', ol: 'list', li: 'listitem', img: 'img', h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading' };

export function effectiveRole(el) {
  const r = roleOf(el);
  if (r) return r;
  const tag = el.tagName.toLowerCase();
  if (tag === 'section' && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')) return null;
  if (tag === 'img' && el.getAttribute('alt') === '') return null;   // decorative
  return LANDMARKS[tag] ?? null;
}

function nameFor(el, role) {
  if (role === 'heading' || role === 'listitem' || role === 'option' || role === 'cell') return (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return accessibleName(el).slice(0, 80);
}

const isHidden = (el) => el.hidden || el.getAttribute('aria-hidden') === 'true' || getComputedStyle(el).display === 'none' || getComputedStyle(el).visibility === 'hidden';

/** Role tree for a region. */
export function roleTree(root, { maxNodes = 400 } = {}) {
  const lines = [];
  let count = 0;
  const walk = (el, depth) => {
    if (count >= maxNodes) return;
    if (isHidden(el)) return;
    const role = effectiveRole(el);
    let nextDepth = depth;
    if (role) {
      count += 1;
      const name = nameFor(el, role);
      const level = role === 'heading' ? el.getAttribute('aria-level') ?? el.tagName.slice(1) : null;
      const extra = [];
      if (role === 'textbox' || role === 'combobox' || role === 'checkbox' || role === 'radio') {
        if (el.required || el.getAttribute('aria-required') === 'true') extra.push('required');
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') extra.push('disabled');
        if (el.getAttribute('aria-invalid') === 'true') extra.push('invalid');
        if ((role === 'checkbox' || role === 'radio') && el.checked) extra.push('checked');
        if (!name) extra.push('⚠ no label');
      }
      if (role === 'img' && !el.getAttribute('alt')) extra.push('⚠ no alt');
      if ((role === 'button' || role === 'link') && !name) extra.push('⚠ no name');
      if (el.getAttribute('aria-expanded')) extra.push(`expanded=${el.getAttribute('aria-expanded')}`);
      lines.push({ depth, role, level, name, extra, el });
      nextDepth = depth + 1;
    }
    for (const child of el.children) walk(child, nextDepth);
  };
  walk(root, 0);
  return { lines, truncated: count >= maxNodes };
}

export function headings(root) {
  return [...root.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')].filter((h) => !isHidden(h)).map((h) => ({
    level: Number(h.getAttribute('aria-level') ?? h.tagName.slice(1)) || 2,
    text: (h.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 100),
  }));
}

// --- contrast -------------------------------------------------------------------

function parseRgb(s) {
  const hex = color(s);
  if (!hex || hex.length < 7) return null;
  const a = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1;
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16), a };
}
function luminance({ r, g, b }) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrastRatio(fg, bg) {
  const a = parseRgb(fg), b = parseRgb(bg);
  if (!a || !b) return null;
  const l1 = luminance(a), l2 = luminance(b);
  return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
}

/** Walk up to the first non-transparent background. */
export function backgroundOf(el) {
  let cur = el;
  while (cur && cur !== document.documentElement) {
    const bg = parseRgb(getComputedStyle(cur).backgroundColor);
    if (bg && bg.a > 0.9) return getComputedStyle(cur).backgroundColor;
    cur = cur.parentElement;
  }
  const html = getComputedStyle(document.documentElement).backgroundColor;
  return parseRgb(html)?.a > 0.9 ? html : '#ffffff';
}

export function contrastIssues(root, { max = 40 } = {}) {
  const out = [];
  const seen = new Set();
  for (const el of root.querySelectorAll('*')) {
    if (out.length >= max) break;
    if (isHidden(el)) continue;
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
    if (!text || text.length < 2) continue;
    const cs = getComputedStyle(el);
    const fg = cs.color, bg = backgroundOf(el);
    const ratio = contrastRatio(fg, bg);
    if (ratio == null) continue;
    const size = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const min = large ? 3 : 4.5;
    if (ratio < min) {
      const key = `${fg}|${bg}|${size}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text: text.slice(0, 60), fg: color(fg), bg: color(bg), ratio, min, fontSize: size, el });
    }
  }
  return out;
}

export function a11yMarkdown({ region, tree, heads, contrast }) {
  const lines = [`Region: \`${region}\``, ''];
  if (heads.length) { lines.push('**Headings**', '', ...heads.map((h) => `${'  '.repeat(Math.max(0, h.level - 1))}- h${h.level} ${h.text}`), ''); }
  lines.push('**Role tree**', '');
  for (const l of tree.lines) lines.push(`${'  '.repeat(l.depth)}- ${l.role}${l.level ? ` h${l.level}` : ''}${l.name ? ` "${l.name}"` : ''}${l.extra.length ? ` _(${l.extra.join(', ')})_` : ''}`);
  if (tree.truncated) lines.push('- … truncated');
  const warnings = tree.lines.filter((l) => l.extra.some((x) => x.startsWith('⚠')));
  lines.push('', `**Contrast** — ${contrast.length ? `${contrast.length} text style(s) below WCAG AA:` : 'no AA failures found in text nodes'}`, '');
  for (const c of contrast) lines.push(`- "${c.text}" ${c.fg} on ${c.bg} = ${c.ratio}:1 (needs ${c.min}:1 at ${c.fontSize}px)`);
  if (warnings.length) lines.push('', `**Labelling** — ${warnings.length} control(s) flagged above (no label / no name / no alt).`);
  return lines.join('\n');
}
