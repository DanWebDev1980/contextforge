// Figma ships obfuscated, build-specific class names, so nothing here keys off a
// class. Instead we anchor on things Figma has to keep stable for its own
// accessibility: input `aria-label`s, tooltip `title`s, and section header text.
//
// If a Figma release renames a label, fix it here — this file is the whole
// maintenance surface. Run `probe.js` on the properties panel to see the truth.

/** Property → the labels Figma might use for it, lowercased, matched loosely. */
export const FIELD_ALIASES = {
  width: ['w', 'width'],
  height: ['h', 'height'],
  x: ['x', 'x position'],
  y: ['y', 'y position'],
  paddingTop: ['padding top', 'top padding'],
  paddingRight: ['padding right', 'right padding'],
  paddingBottom: ['padding bottom', 'bottom padding'],
  paddingLeft: ['padding left', 'left padding'],
  paddingVertical: ['vertical padding', 'padding vertical'],
  paddingHorizontal: ['horizontal padding', 'padding horizontal'],
  gap: ['gap between objects', 'item spacing', 'gap', 'spacing'],
  radius: ['corner radius', 'radius', 'border radius'],
  radiusTopLeft: ['top left corner radius'],
  radiusTopRight: ['top right corner radius'],
  radiusBottomRight: ['bottom right corner radius'],
  radiusBottomLeft: ['bottom left corner radius'],
  opacity: ['opacity', 'layer opacity'],
  fontFamily: ['font family', 'font'],
  fontStyle: ['font style', 'font weight', 'weight'],
  fontSize: ['font size', 'size'],
  lineHeight: ['line height', 'line spacing'],
  letterSpacing: ['letter spacing', 'letter-spacing', 'tracking'],
  strokeWidth: ['stroke width', 'stroke weight', 'weight'],
};

/** Section headers, used to attribute a colour swatch to fill vs stroke. */
export const SECTIONS = {
  fill: ['fill', 'fills', 'background'],
  stroke: ['stroke', 'strokes', 'border'],
  effects: ['effects', 'effect'],
  typography: ['typography', 'text', 'type'],
  layout: ['auto layout', 'layout', 'frame'],
};

/** Alignment button tooltips → the CSS value they correspond to. */
export const ALIGN_HINTS = {
  'align left': 'flex-start', 'align horizontal centers': 'center', 'align right': 'flex-end',
  'align top': 'flex-start', 'align vertical centers': 'center', 'align bottom': 'flex-end',
  'packed': 'flex-start', 'space between': 'space-between',
};

/**
 * Find the right-hand properties panel without relying on a class name.
 * Scores every candidate container that hugs the right edge of the viewport by
 * how many recognisable property inputs it holds; the winner is the panel.
 */
export function findPropertiesPanel(doc = document) {
  const ranked = rankPanelCandidates(doc).filter((c) => c.accepted);
  return ranked.length ? ranked[0].node : null;
}

/**
 * Every plausible container, scored, with the reason any was rejected.
 * `findPropertiesPanel` takes the winner; the diagnose tool prints the lot,
 * which is what turns "it found nothing" into an actionable bug report.
 */
export function rankPanelCandidates(doc = document) {
  const allLabels = new Set(Object.values(FIELD_ALIASES).flat());
  const candidates = [];

  for (const node of doc.querySelectorAll('div, aside, section')) {
    const r = node.getBoundingClientRect();
    const controls = node.querySelectorAll('input, [role="spinbutton"], [contenteditable="true"]');
    if (!controls.length) continue;

    const labels = [];
    let score = 0;
    for (const input of controls) {
      const label = labelOf(input);
      if (label) labels.push(label);
      if (label && allLabels.has(label)) score += 1;
    }

    const reasons = [];
    if (Math.abs(r.right - window.innerWidth) >= 12) reasons.push(`not flush right (right=${Math.round(r.right)}, vw=${window.innerWidth})`);
    if (r.width < 180 || r.width > 460) reasons.push(`width ${Math.round(r.width)} outside 180-460`);
    if (r.height <= window.innerHeight * 0.35) reasons.push(`height ${Math.round(r.height)} under 35% of ${window.innerHeight}`);
    if (!score) reasons.push('no recognised field labels');

    candidates.push({
      node,
      score,
      depth: depthOf(node),
      rect: { right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) },
      controlCount: controls.length,
      labels,
      accepted: reasons.length === 0,
      reasons,
    });
  }

  // Highest score wins; on a tie prefer the deepest (tightest) container.
  candidates.sort((a, b) => Number(b.accepted) - Number(a.accepted) || b.score - a.score || b.depth - a.depth);
  return candidates;
}

function depthOf(node) {
  let d = 0;
  while ((node = node.parentElement)) d += 1;
  return d;
}

/** Best-effort human label for a control, from aria, title, or a sibling. */
export function labelOf(input) {
  const direct = input.getAttribute('aria-label')
    || input.getAttribute('title')
    || input.getAttribute('placeholder')
    || input.getAttribute('name');
  if (direct) return direct.trim().toLowerCase();

  const labelledBy = input.getAttribute('aria-labelledby');
  if (labelledBy) {
    const target = document.getElementById(labelledBy);
    if (target?.textContent) return target.textContent.trim().toLowerCase();
  }

  // Figma frequently puts an icon or single-letter label immediately before the
  // input inside a shared wrapper ("W" 240, "H" 48).
  const wrapper = input.closest('label, div');
  if (wrapper) {
    const own = [...wrapper.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim()).join(' ').trim();
    if (own && own.length <= 24) return own.toLowerCase();
    const sibling = input.previousElementSibling;
    const text = sibling?.textContent?.trim();
    if (text && text.length <= 24) return text.toLowerCase();
    const svgTitle = wrapper.querySelector('svg title')?.textContent?.trim();
    if (svgTitle) return svgTitle.toLowerCase();
  }
  return null;
}
