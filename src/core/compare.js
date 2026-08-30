// Diffs a Figma capture against a web capture, property by property.
//
// Tolerances matter: designers round to whole pixels, browsers do not, and a
// line-height of 24 vs 24.0000038 is not a bug worth a row in the table.

const TOLERANCE = { default: 0.5, letterSpacing: 0.05, opacity: 0.01 };

const PROPERTIES = [
  ['width', (n) => n.box?.width, 'number'],
  ['height', (n) => n.box?.height, 'number'],
  ['padding-top', (n) => n.layout?.padding?.top, 'number'],
  ['padding-right', (n) => n.layout?.padding?.right, 'number'],
  ['padding-bottom', (n) => n.layout?.padding?.bottom, 'number'],
  ['padding-left', (n) => n.layout?.padding?.left, 'number'],
  ['gap', (n) => n.layout?.gap, 'number'],
  ['font-family', (n) => n.typography?.fontFamily, 'string'],
  ['font-size', (n) => n.typography?.fontSize, 'number'],
  ['font-weight', (n) => n.typography?.fontWeight, 'number'],
  ['line-height', (n) => n.typography?.lineHeight, 'number'],
  ['letter-spacing', (n) => n.typography?.letterSpacing, 'letterSpacing'],
  ['text-transform', (n) => n.typography?.textTransform, 'string'],
  ['color', (n) => n.typography?.color, 'color'],
  ['background', (n) => n.fill?.background, 'color'],
  ['border-width', (n) => n.border?.width, 'number'],
  ['border-color', (n) => n.border?.color, 'color'],
  ['border-radius', (n) => n.border?.radius?.tl, 'number'],
  ['opacity', (n) => n.opacity ?? 1, 'opacity'],
];

function equal(a, b, type) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (type === 'string') return String(a).toLowerCase() === String(b).toLowerCase();
  if (type === 'color') {
    // treat #rrggbb and #rrggbbff as the same colour
    const norm = (c) => String(c).toLowerCase().replace(/^(#[0-9a-f]{6})ff$/, '$1');
    return norm(a) === norm(b);
  }
  const tol = TOLERANCE[type] ?? TOLERANCE.default;
  return Math.abs(Number(a) - Number(b)) <= tol;
}

/**
 * Compare two normalized nodes.
 * `onlyDifferences` keeps the prompt short — matched properties are noise once
 * you are asking an LLM to fix the mismatches.
 */
export function compareNodes(designNode, webNode, { onlyDifferences = false } = {}) {
  const rows = [];
  for (const [property, get, type] of PROPERTIES) {
    const design = get(designNode) ?? null;
    const web = get(webNode) ?? null;
    if (design == null && web == null) continue;         // neither side set it
    const match = equal(design, web, type);
    if (onlyDifferences && match) continue;
    rows.push({ property, design, web, match, type });
  }
  const mismatches = rows.filter((r) => !r.match).length;
  return {
    kind: 'comparison',
    label: `${designNode?.name ?? 'design'} ↔ ${webNode?.name ?? 'web'}`,
    rows,
    summary: { compared: rows.length, mismatches, matched: rows.length - mismatches },
  };
}

/** Compare two captures (envelopes), matching them by their root nodes. */
export function compareCaptures(designCapture, webCapture, options) {
  const result = compareNodes(designCapture?.node, webCapture?.node, options);
  result.sources = { design: designCapture?.id, web: webCapture?.id };
  return result;
}
