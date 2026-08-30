// Harvests text from the left-hand layers / objects list.
//
// Why this and not the canvas: Figma renders the canvas to WebGL, so sticky
// notes have no DOM at all. But the layers list is ordinary DOM, and FigJam
// names a sticky after its own text — so the list is a readable index of every
// sticky in the file. The list is virtualized, so we scroll it to harvest.

/** Find the scrollable layers list: left edge, tall, full of tree rows. */
export function findLayersList(doc = document) {
  const candidates = [];
  for (const node of doc.querySelectorAll('div, aside, nav')) {
    const r = node.getBoundingClientRect();
    if (r.left > 40 || r.width < 140 || r.width > 460) continue;
    if (r.height < window.innerHeight * 0.3) continue;
    const rows = node.querySelectorAll('[role="treeitem"], [role="row"], [role="option"]').length;
    if (rows >= 2) candidates.push({ node, rows, scrollable: node.scrollHeight > node.clientHeight + 4 });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => (b.scrollable - a.scrollable) || (b.rows - a.rows));
  return candidates[0].node;
}

function rowsIn(container) {
  return [...container.querySelectorAll('[role="treeitem"], [role="row"], [role="option"]')];
}

function textOf(row) {
  return row.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

/**
 * Scroll the virtualized list end to end, collecting every row's text.
 * Returns rows in document order, de-duplicated.
 */
export async function harvestLayers(container, { step = 0.8, settleMs = 90, maxPasses = 200 } = {}) {
  const seen = new Map();
  const collect = () => {
    for (const row of rowsIn(container)) {
      const text = textOf(row);
      if (!text) continue;
      const key = `${row.getAttribute('aria-level') ?? ''}|${text}`;
      if (!seen.has(key)) {
        seen.set(key, {
          text,
          depth: Number(row.getAttribute('aria-level') ?? 0),
          selected: row.getAttribute('aria-selected') === 'true',
        });
      }
    }
  };

  const start = container.scrollTop;
  container.scrollTop = 0;
  collect();
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const before = container.scrollTop;
    container.scrollTop += container.clientHeight * step;
    await new Promise((r) => setTimeout(r, settleMs));
    collect();
    if (container.scrollTop <= before) break;      // hit the bottom
  }
  container.scrollTop = start;
  return [...seen.values()];
}

/** The currently selected row's text — what you clicked on the canvas. */
export function selectedLayerText(doc = document) {
  const container = findLayersList(doc) ?? doc;
  const row = container.querySelector('[aria-selected="true"]');
  return row ? textOf(row) : null;
}

/**
 * Rows that read like sticky-note content rather than structural layers.
 * Frames, groups, sections and shapes get generic names; stickies get sentences.
 */
export function looksLikeSticky(text) {
  if (!text || text.length < 3) return false;
  if (/^(frame|group|section|rectangle|ellipse|line|vector|arrow|slide|component|instance|image|table)\b/i.test(text)) return false;
  if (/^[\d\s.,#/-]+$/.test(text)) return false;
  return /\s/.test(text) || text.length > 12;
}
