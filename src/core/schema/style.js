// The lingua franca. Every adapter (web DOM, Figma panel) normalizes into this
// shape so that `compare` can diff a design node against a live element without
// knowing where either came from.

export const STYLE_GROUPS = ['box', 'layout', 'typography', 'fill', 'border', 'effects'];

/** Create an empty normalized node. */
export function emptyNode(overrides = {}) {
  return {
    name: '',
    ref: '',          // css selector, figma node id, etc. — how to find it again
    text: null,
    box: { width: null, height: null },
    layout: {
      display: null,
      direction: null,      // row | column
      justify: null,
      align: null,
      gap: null,
      padding: { top: null, right: null, bottom: null, left: null },
    },
    typography: {
      fontFamily: null,
      fontSize: null,
      fontWeight: null,
      lineHeight: null,
      letterSpacing: null,
      textAlign: null,
      textTransform: null,
      color: null,
    },
    fill: { background: null },
    border: {
      width: null,
      style: null,
      color: null,
      radius: { tl: null, tr: null, br: null, bl: null },
    },
    effects: [],          // [{ type:'shadow', x, y, blur, spread, color, inset }]
    opacity: null,
    children: [],
    ...overrides,
  };
}

/** Wrap a node tree in a capture envelope. */
export function capture({ source, node, meta = {} }) {
  return {
    kind: 'style-capture',
    id: `cap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    source,                       // 'web' | 'figma'
    capturedAt: new Date().toISOString(),
    url: typeof location !== 'undefined' ? location.href : null,
    meta,
    node,
  };
}

// ---------------------------------------------------------------------------
// Value normalizers. Both adapters run everything through these so that
// "16px", "16", "1rem" and Figma's "16" all land on the same number, and
// "rgb(255,0,0)" / "#F00" / "#ff0000ff" all land on the same string.
// ---------------------------------------------------------------------------

/** Parse a length to a plain number of px. Returns null when not a length. */
export function px(value, { rootFontSize = 16, parentFontSize = 16 } = {}) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return round(value);
  const s = String(value).trim().toLowerCase();
  if (s === 'normal' || s === 'auto' || s === 'none' || s === 'mixed') return null;
  const m = s.match(/^(-?[\d.]+)\s*(px|rem|em|pt|%)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  switch (m[2]) {
    case 'rem': return round(n * rootFontSize);
    case 'em': return round(n * parentFontSize);
    case 'pt': return round(n * (96 / 72));
    case '%': return null;              // percentages are not comparable cross-source
    default: return round(n);
  }
}

function round(n) { return Math.round(n * 100) / 100; }

/**
 * Normalize any colour notation to `#rrggbb` or `#rrggbbaa` (lowercase).
 * Handles hex 3/4/6/8, rgb(), rgba(), and modern slash-alpha syntax.
 */
export function color(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim().toLowerCase();
  if (s === 'transparent') return '#00000000';
  if (s === 'none' || s === 'mixed') return null;

  const hex = s.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length === 6) return `#${h}`;
    if (h.length === 8) return h.slice(6) === 'ff' ? `#${h.slice(0, 6)}` : `#${h}`;
    return null;
  }

  const fn = s.match(/^rgba?\(([^)]+)\)$/);
  if (fn) {
    const parts = fn[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
    const [r, g, b] = parts;
    const a = parts.length > 3 ? parts[3] : 1;
    if ([r, g, b].some(Number.isNaN)) return null;
    const to2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    const base = `#${to2(r)}${to2(g)}${to2(b)}`;
    if (a >= 1) return base;
    return `${base}${Math.round(a * 255).toString(16).padStart(2, '0')}`;
  }
  return null;
}

/** Figma writes weights as names; CSS writes numbers. Land both on a number. */
const WEIGHTS = {
  thin: 100, extralight: 200, ultralight: 200, light: 300, book: 300,
  regular: 400, normal: 400, medium: 500, semibold: 600, demibold: 600,
  bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900,
};

export function fontWeight(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value;
  const s = String(value).trim().toLowerCase().replace(/[\s_-]/g, '');
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  for (const [name, n] of Object.entries(WEIGHTS)) {
    if (s.includes(name)) return n;
  }
  return null;
}

/** Strip quotes and fallback stacks so "Inter", sans-serif -> Inter */
export function fontFamily(value) {
  if (!value) return null;
  return String(value).split(',')[0].trim().replace(/^["']|["']$/g, '') || null;
}
