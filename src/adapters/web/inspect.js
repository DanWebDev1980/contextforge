// Turns a live DOM element (and its subtree) into a normalized style capture.

import { emptyNode, px, color, fontWeight, fontFamily } from '../../core/schema/style.js';

/** Elements that carry no visual meaning worth capturing. */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE']);

/**
 * A short, stable-ish selector for an element — enough to find it again by hand
 * and enough for Copilot to grep the codebase for it.
 */
export function selectorFor(node) {
  if (!node || node.nodeType !== 1) return '';
  const parts = [];
  let cur = node;
  while (cur && cur.nodeType === 1 && parts.length < 4) {
    let part = cur.tagName.toLowerCase();
    if (cur.id) { parts.unshift(`#${cur.id}`); break; }
    const cls = [...cur.classList]
      // drop hashed CSS-module / styled-components classes: they change per build
      .filter((c) => !/^(css-|sc-|jsx-)/.test(c) && !/^[a-z0-9]{6,}$/i.test(c) && !/\d{4,}/.test(c))
      .slice(0, 2);
    if (cls.length) part += `.${cls.join('.')}`;
    else if (cur.parentElement) {
      const sibs = [...cur.parentElement.children].filter((s) => s.tagName === cur.tagName);
      if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
    }
    parts.unshift(part);
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}

/** A friendly label for the hover tag and the capture tree. */
export function labelFor(node) {
  if (!node || node.nodeType !== 1) return '?';
  const tag = node.tagName.toLowerCase();
  const id = node.id ? `#${node.id}` : '';
  const cls = [...node.classList].slice(0, 2).map((c) => `.${c}`).join('');
  const testId = node.getAttribute('data-testid') || node.getAttribute('data-test-id');
  const rect = node.getBoundingClientRect();
  const dims = `${Math.round(rect.width)}×${Math.round(rect.height)}`;
  return `${tag}${id}${cls}${testId ? ` [${testId}]` : ''}  ${dims}`;
}

/** Direct text of an element, ignoring text inside child elements. */
function ownText(node) {
  const t = [...node.childNodes]
    .filter((n) => n.nodeType === 3)
    .map((n) => n.textContent.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t || null;
}

function parseShadows(value) {
  if (!value || value === 'none') return [];
  // split on commas that are not inside rgb(...)
  return value.split(/,(?![^(]*\))/).map((raw) => {
    const s = raw.trim();
    const col = s.match(/(rgba?\([^)]+\)|#[0-9a-f]{3,8})/i);
    const nums = s.replace(col?.[0] ?? '', '').match(/-?[\d.]+px/g) || [];
    return {
      type: 'shadow',
      inset: /inset/.test(s),
      x: px(nums[0]), y: px(nums[1]), blur: px(nums[2]), spread: px(nums[3]),
      color: color(col?.[0]),
    };
  });
}

/** Normalize one element (no children) into the shared schema. */
export function normalizeElement(node) {
  const cs = getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const parentFontSize = node.parentElement
    ? parseFloat(getComputedStyle(node.parentElement).fontSize) || rootFontSize
    : rootFontSize;
  const unit = { rootFontSize, parentFontSize };

  const isFlex = cs.display.includes('flex') || cs.display.includes('grid');
  const bgImage = cs.backgroundImage !== 'none' ? cs.backgroundImage : null;

  return emptyNode({
    name: node.tagName.toLowerCase(),
    ref: selectorFor(node),
    text: ownText(node),
    box: { width: px(rect.width), height: px(rect.height) },
    layout: {
      display: cs.display,
      direction: isFlex ? (cs.flexDirection || cs.gridAutoFlow) : null,
      justify: isFlex ? cs.justifyContent : null,
      align: isFlex ? cs.alignItems : null,
      gap: isFlex ? px(cs.rowGap === cs.columnGap ? cs.rowGap : `${cs.rowGap} ${cs.columnGap}`, unit) : null,
      padding: {
        top: px(cs.paddingTop, unit), right: px(cs.paddingRight, unit),
        bottom: px(cs.paddingBottom, unit), left: px(cs.paddingLeft, unit),
      },
    },
    typography: {
      fontFamily: fontFamily(cs.fontFamily),
      fontSize: px(cs.fontSize, unit),
      fontWeight: fontWeight(cs.fontWeight),
      lineHeight: px(cs.lineHeight, unit),
      letterSpacing: px(cs.letterSpacing, unit),
      textAlign: cs.textAlign,
      textTransform: cs.textTransform === 'none' ? null : cs.textTransform,
      color: color(cs.color),
    },
    fill: { background: bgImage || color(cs.backgroundColor) },
    border: {
      width: px(cs.borderTopWidth, unit),
      style: cs.borderTopStyle === 'none' ? null : cs.borderTopStyle,
      color: cs.borderTopStyle === 'none' ? null : color(cs.borderTopColor),
      radius: {
        tl: px(cs.borderTopLeftRadius, unit), tr: px(cs.borderTopRightRadius, unit),
        br: px(cs.borderBottomRightRadius, unit), bl: px(cs.borderBottomLeftRadius, unit),
      },
    },
    effects: parseShadows(cs.boxShadow),
    opacity: cs.opacity === '1' ? null : parseFloat(cs.opacity),
    children: [],
  });
}

/**
 * Walk an element and its descendants into a normalized tree.
 *
 * `maxDepth` and `maxNodes` exist because "grab all child elements" on a page
 * section can otherwise mean ten thousand nodes and a prompt nobody can use.
 * Invisible elements are skipped — they carry no styles worth reimplementing.
 */
export function normalizeTree(root, { maxDepth = 6, maxNodes = 400, skipHidden = true } = {}) {
  let count = 0;
  let truncated = false;

  function visible(node) {
    if (!skipHidden) return true;
    const cs = getComputedStyle(node);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const r = node.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  }

  function walk(node, depth) {
    if (count >= maxNodes) { truncated = true; return null; }
    count += 1;
    const out = normalizeElement(node);
    if (depth < maxDepth) {
      for (const child of node.children) {
        if (SKIP_TAGS.has(child.tagName)) continue;
        if (!visible(child)) continue;
        const c = walk(child, depth + 1);
        if (c) out.children.push(c);
      }
    } else if (node.children.length) {
      truncated = true;
    }
    return out;
  }

  const tree = walk(root, 0);
  return { tree, nodeCount: count, truncated };
}

// ---------------------------------------------------------------------------
// Design tokens and rule context. Cross-origin stylesheets throw on .cssRules;
// those are skipped and counted so the panel can say "n sheets unreadable".
// ---------------------------------------------------------------------------

function* walkRules(rules, ctx = []) {
  for (const rule of rules) {
    if (rule.type === 1 /* STYLE */) yield { rule, ctx };
    else if (rule.cssRules) {
      const label = rule.type === 4 ? `@media ${rule.conditionText ?? rule.media?.mediaText ?? ''}`
        : rule.type === 12 ? `@supports ${rule.conditionText ?? ''}`
          : rule.constructor?.name === 'CSSContainerRule' ? `@container ${rule.conditionText ?? ''}`
            : rule.constructor?.name === 'CSSLayerBlockRule' ? `@layer ${rule.name ?? ''}`
              : null;
      yield* walkRules(rule.cssRules, label ? [...ctx, { label, rule }] : ctx);
    }
  }
}

function safeMatches(node, selector) {
  try { return node.matches(selector); } catch { return false; }
}

function conditionMatches(ctxEntry) {
  const r = ctxEntry.rule;
  try {
    if (r.type === 4) return matchMedia(r.conditionText ?? r.media.mediaText).matches;
    if (r.type === 12) return CSS.supports(r.conditionText);
  } catch { /* unknown */ }
  return null;
}

/**
 * Every rule that applies to `node`, with the @media / @container / @supports
 * context each lives under, plus the CSS custom properties in effect on the node.
 */
export function ruleContext(node) {
  const matched = [];
  const varsUsed = new Set();
  const varsDefined = new Map();     // name → { value, from }
  let unreadable = 0;
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { unreadable += 1; continue; }
    if (!rules) continue;
    const from = sheet.href ? sheet.href.split('/').pop() : '<style>';
    for (const { rule, ctx } of walkRules(rules)) {
      const hitsNode = safeMatches(node, rule.selectorText);
      const hitsRoot = /(^|,)\s*(:root|html)\s*(,|$)/.test(rule.selectorText ?? '');
      if (!hitsNode && !hitsRoot) continue;
      for (const name of rule.style) {
        if (name.startsWith('--')) varsDefined.set(name, { value: rule.style.getPropertyValue(name).trim(), from, selector: rule.selectorText });
      }
      // var() references live in the declaration text; shorthands hide them from longhand iteration
      if (hitsNode) for (const m of (rule.style.cssText ?? '').matchAll(/var\((--[\w-]+)/g)) varsUsed.add(m[1]);
      if (hitsNode) {
        matched.push({
          selector: rule.selectorText,
          from,
          context: ctx.map((c) => ({ label: c.label, matches: conditionMatches(c) })),
          declarations: [...rule.style].filter((n) => !n.startsWith('--')).map((n) => `${n}: ${rule.style.getPropertyValue(n).trim()}${rule.style.getPropertyPriority(n) ? ' !important' : ''}`),
        });
      }
    }
  }
  const cs = getComputedStyle(node);
  const tokens = [...varsUsed].map((name) => ({
    name,
    value: cs.getPropertyValue(name).trim() || varsDefined.get(name)?.value || null,
    definedIn: varsDefined.get(name)?.selector ?? null,
  }));
  return { rules: matched, tokens, unreadableSheets: unreadable };
}

/** A normalized node back to CSS a developer can paste. */
export function toCSS(node, { selector } = {}) {
  const lines = [];
  const add = (prop, value) => { if (value != null && value !== '' && value !== 'none') lines.push(`  ${prop}: ${value};`); };
  const pxv = (v) => (v == null ? null : `${v}px`);
  const l = node.layout ?? {};
  add('display', l.display);
  if (l.direction && /flex/.test(l.display ?? '')) add('flex-direction', l.direction);
  if (l.justify && l.justify !== 'normal') add('justify-content', l.justify);
  if (l.align && l.align !== 'normal') add('align-items', l.align);
  add('gap', pxv(l.gap));
  const pd = l.padding;
  if (pd && [pd.top, pd.right, pd.bottom, pd.left].some((v) => v)) add('padding', `${pd.top ?? 0}px ${pd.right ?? 0}px ${pd.bottom ?? 0}px ${pd.left ?? 0}px`);
  if (node.box?.width != null) add('width', pxv(node.box.width));
  if (node.box?.height != null) add('height', pxv(node.box.height));
  const t = node.typography ?? {};
  if (t.fontFamily) add('font-family', /\s/.test(t.fontFamily) ? `"${t.fontFamily}"` : t.fontFamily);
  add('font-size', pxv(t.fontSize));
  add('font-weight', t.fontWeight);
  add('line-height', pxv(t.lineHeight));
  if (t.letterSpacing) add('letter-spacing', pxv(t.letterSpacing));
  if (t.textAlign && t.textAlign !== 'start') add('text-align', t.textAlign);
  add('text-transform', t.textTransform);
  add('color', t.color);
  if (node.fill?.background && node.fill.background !== '#00000000') add('background', node.fill.background);
  const b = node.border ?? {};
  if (b.width) add('border', `${b.width}px ${b.style ?? 'solid'} ${b.color ?? 'currentColor'}`);
  const r = b.radius ?? {};
  const rv = [r.tl, r.tr, r.br, r.bl];
  if (rv.some((v) => v)) add('border-radius', rv.every((v) => v === rv[0]) ? pxv(rv[0]) : rv.map((v) => `${v ?? 0}px`).join(' '));
  for (const fx of node.effects ?? []) add('box-shadow', `${fx.inset ? 'inset ' : ''}${fx.x ?? 0}px ${fx.y ?? 0}px ${fx.blur ?? 0}px ${fx.spread ?? 0}px ${fx.color ?? ''}`.trim());
  if (node.opacity != null) add('opacity', node.opacity);
  return `${selector ?? node.ref ?? node.name ?? '.element'} {\n${lines.join('\n')}\n}`;
}
