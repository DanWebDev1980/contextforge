// Reads the currently selected Figma node out of the right-hand properties
// panel's DOM and normalizes it into the shared style schema.
//
// Hard limits, stated plainly:
//   * The panel describes the SELECTED node only. Children need the layers tree
//     (see walkSelectionName / the layers helpers below) or several selections.
//   * Figma shows "Mixed" for multi-valued selections; that becomes null here.
//   * Percentage line-heights and "Auto" cannot be resolved to px from the DOM.

import { emptyNode, px, color, fontWeight, fontFamily } from '../../core/schema/style.js';
import { FIELD_ALIASES, SECTIONS, findPropertiesPanel, labelOf } from './selectors.js';

const HEX = /#?\b([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/;

/** Read every labelled control in the panel into a { label: value } bag. */
export function readFields(panel) {
  const fields = {};
  const controls = panel.querySelectorAll('input, [role="spinbutton"], [contenteditable="true"], select');
  for (const control of controls) {
    const label = labelOf(control);
    if (!label) continue;
    const value = control.tagName === 'SELECT'
      ? control.options[control.selectedIndex]?.text
      : (control.value ?? control.textContent ?? '').trim();
    if (value === '' || /^mixed$/i.test(value)) continue;
    if (!(label in fields)) fields[label] = value;
  }
  return fields;
}

function pick(fields, property) {
  for (const alias of FIELD_ALIASES[property] ?? []) {
    if (alias in fields) return fields[alias];
  }
  return null;
}

/**
 * Find colour swatches and attribute them to a section (fill / stroke / text).
 * Figma renders the hex as an editable text field next to the swatch; we read
 * the nearest section header above the row to decide what the colour is for.
 */
export function readColors(panel) {
  const out = { fill: null, stroke: null, effects: [] };
  const headers = [...panel.querySelectorAll('*')].filter((n) => {
    if (n.children.length) return false;
    const t = n.textContent?.trim().toLowerCase();
    return t && t.length < 24 && Object.values(SECTIONS).flat().includes(t);
  });

  function sectionFor(node) {
    const top = node.getBoundingClientRect().top;
    let best = null;
    for (const header of headers) {
      const ht = header.getBoundingClientRect().top;
      if (ht <= top && (!best || ht > best.top)) best = { top: ht, text: header.textContent.trim().toLowerCase() };
    }
    if (!best) return null;
    for (const [key, names] of Object.entries(SECTIONS)) {
      if (names.includes(best.text)) return key;
    }
    return null;
  }

  for (const control of panel.querySelectorAll('input, [contenteditable="true"]')) {
    const raw = (control.value ?? control.textContent ?? '').trim();
    const m = raw.match(HEX);
    if (!m) continue;
    const section = sectionFor(control);
    // Opacity for a colour sits in the input immediately after the hex field.
    const alphaRaw = control.parentElement?.nextElementSibling?.querySelector?.('input')?.value;
    const alpha = alphaRaw && /%$/.test(alphaRaw) ? parseFloat(alphaRaw) / 100 : null;
    let hex = color(`#${m[1]}`);
    if (hex && alpha != null && alpha < 1) {
      hex += Math.round(alpha * 255).toString(16).padStart(2, '0');
    }
    if (section === 'fill' && !out.fill) out.fill = hex;
    else if (section === 'stroke' && !out.stroke) out.stroke = hex;
    else if (section === 'effects') out.effects.push(hex);
    else if (!out.fill) out.fill = hex;
  }
  return out;
}

/** The selected layer's name, from the layers tree or the panel header. */
export function readSelectionName(doc = document) {
  const selectedRow = doc.querySelector('[aria-selected="true"], [data-selected="true"], [role="treeitem"][aria-selected="true"]');
  const fromTree = selectedRow?.textContent?.trim();
  if (fromTree && fromTree.length < 80) return fromTree;
  const heading = doc.querySelector('[role="heading"]')?.textContent?.trim();
  return heading && heading.length < 80 ? heading : 'Selection';
}

/**
 * Scrape the current selection into a normalized node.
 * Returns null when no properties panel can be found (nothing selected, or the
 * panel is collapsed — Figma hides it entirely with nothing on the canvas).
 */
export function scrapeSelection(doc = document) {
  const panel = findPropertiesPanel(doc);
  if (!panel) return null;

  const fields = readFields(panel);
  if (!Object.keys(fields).length) return null;
  const colors = readColors(panel);

  const num = (property) => px(pick(fields, property));
  const padV = num('paddingVertical');
  const padH = num('paddingHorizontal');
  const radius = num('radius');

  const node = emptyNode({
    name: readSelectionName(doc),
    ref: 'figma:selection',
    box: { width: num('width'), height: num('height') },
    layout: {
      display: pick(fields, 'gap') != null ? 'flex' : null,
      direction: null,     // Figma exposes direction as an icon toggle, not text
      justify: null,
      align: null,
      gap: num('gap'),
      padding: {
        top: num('paddingTop') ?? padV,
        right: num('paddingRight') ?? padH,
        bottom: num('paddingBottom') ?? padV,
        left: num('paddingLeft') ?? padH,
      },
    },
    typography: {
      fontFamily: fontFamily(pick(fields, 'fontFamily')),
      fontSize: num('fontSize'),
      fontWeight: fontWeight(pick(fields, 'fontStyle')),
      lineHeight: num('lineHeight'),
      letterSpacing: num('letterSpacing'),
      textAlign: null,
      textTransform: null,
      color: null,      // filled below when the node is text
    },
    fill: { background: colors.fill },
    border: {
      width: num('strokeWidth'),
      style: colors.stroke ? 'solid' : null,
      color: colors.stroke,
      radius: {
        tl: num('radiusTopLeft') ?? radius,
        tr: num('radiusTopRight') ?? radius,
        br: num('radiusBottomRight') ?? radius,
        bl: num('radiusBottomLeft') ?? radius,
      },
    },
    effects: colors.effects.filter(Boolean).map((c) => ({ type: 'shadow', color: c })),
    opacity: (() => {
      const raw = pick(fields, 'opacity');
      if (!raw) return null;
      const n = parseFloat(raw);
      return Number.isNaN(n) ? null : (/%/.test(raw) ? n / 100 : n);
    })(),
  });

  // A text layer's fill IS its colour; move it so comparisons line up with CSS.
  const isText = node.typography.fontSize != null || node.typography.fontFamily != null;
  if (isText && node.fill.background) {
    node.typography.color = node.fill.background;
    node.fill.background = null;
  }

  return { node, rawFields: fields, panel };
}

/**
 * Fire `onChange` whenever the selection appears to change. Figma re-renders the
 * panel on every selection, so a debounced subtree observer is enough — and it
 * survives the panel being torn down and rebuilt, which a direct observer would
 * not.
 */
export function watchSelection(onChange, { debounce = 180 } = {}) {
  let timer = null;
  let lastKey = null;

  const tick = () => {
    const result = scrapeSelection();
    if (!result) return;
    const key = JSON.stringify(result.rawFields) + result.node.name;
    if (key === lastKey) return;
    lastKey = key;
    onChange(result);
  };

  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(tick, debounce);
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  setTimeout(tick, 0);

  return () => { observer.disconnect(); clearTimeout(timer); };
}
