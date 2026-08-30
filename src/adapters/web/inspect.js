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
