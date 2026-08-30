// Scrapes an open ALM Octane work item out of the DOM.
//
// Octane is an Angular SPA with generated class names, so — as with Figma — this
// anchors on field *labels* rather than structure. Everything configurable lives
// in FIELD_LABELS; run `probe.js` on a story page to calibrate it against your
// workspace, which may rename or add fields.

const FIELD_LABELS = [
  'id', 'name', 'phase', 'type', 'story points', 'estimated hours', 'remaining hours',
  'invested hours', 'feature', 'epic', 'release', 'sprint', 'milestone', 'team',
  'owner', 'author', 'detected by', 'severity', 'priority', 'blocked', 'blocked reason',
  'application modules', 'tags', 'creation time', 'last modified', 'environment',
  'defect type', 'closed on', 'target release',
];

const LONG_TEXT_LABELS = ['description', 'acceptance criteria', 'steps to reproduce', 'comments'];

const normalize = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
const labelKey = (s) => normalize(s).replace(/[:*]+$/, '').toLowerCase();

/** Work item id and type from the URL, which Octane keeps addressable. */
export function readRoute(url = location.href) {
  const id = url.match(/[?&#]id=(\d+)/)?.[1] ?? url.match(/\/(\d+)(?:[/?#]|$)/)?.[1] ?? null;
  const entityType = url.match(/entityType=([a-z_]+)/i)?.[1]
    ?? url.match(/[?&#](?:type|entity)=([a-z_]+)/i)?.[1]
    ?? null;
  const sharedSpace = url.match(/[?&]p=(\d+)\/(\d+)/);
  return {
    id,
    entityType,
    sharedSpaceId: sharedSpace?.[1] ?? null,
    workspaceId: sharedSpace?.[2] ?? null,
  };
}

/**
 * Generic label→value harvester.
 *
 * Walks every leaf element whose text is a known field label, then looks for the
 * value in the three places form UIs put it: the next sibling, the label's own
 * container, or a cell to the right in the same row.
 */
export function readFields(root = document, labels = FIELD_LABELS) {
  const wanted = new Set(labels);
  const fields = {};

  for (const node of root.querySelectorAll('label, span, div, td, th, dt')) {
    if (node.children.length > 1) continue;
    const key = labelKey(node.textContent);
    if (!wanted.has(key) || key in fields) continue;

    const value = valueNear(node);
    if (value && labelKey(value) !== key) fields[key] = value;
  }
  return fields;
}

function valueNear(labelNode) {
  const candidates = [];

  // <label>Phase</label><span>In progress</span>
  if (labelNode.nextElementSibling) candidates.push(labelNode.nextElementSibling);

  // <dt>Phase</dt><dd>…</dd> and table rows
  const cell = labelNode.closest('td, th');
  if (cell?.nextElementSibling) candidates.push(cell.nextElementSibling);

  // wrapper holding both label and value
  const wrapper = labelNode.parentElement;
  if (wrapper) {
    for (const child of wrapper.children) {
      if (child !== labelNode) candidates.push(child);
    }
    if (wrapper.nextElementSibling) candidates.push(wrapper.nextElementSibling);
  }

  for (const candidate of candidates) {
    const input = candidate.matches?.('input, textarea, select')
      ? candidate
      : candidate.querySelector?.('input, textarea, select');
    if (input) {
      const v = input.tagName === 'SELECT'
        ? input.options[input.selectedIndex]?.text
        : input.value;
      if (normalize(v)) return normalize(v);
    }
    const text = normalize(candidate.textContent);
    if (text && text.length < 400) return text;
  }
  return null;
}

/**
 * Long-form fields (description, acceptance criteria). These live in rich-text
 * containers, so we find the label then take the biggest block beneath it and
 * convert it to markdown rather than flattening to text — bullet lists in an
 * acceptance criteria field carry meaning.
 */
export function readLongFields(root = document, labels = LONG_TEXT_LABELS) {
  const out = {};
  const wanted = new Set(labels);

  for (const node of root.querySelectorAll('label, span, div, h1, h2, h3, h4, legend')) {
    if (node.children.length > 1) continue;
    const key = labelKey(node.textContent);
    if (!wanted.has(key) || key in out) continue;

    const container = findRichContainer(node);
    if (container) {
      const md = htmlToMarkdown(container);
      if (md && md.length > 2) out[key] = md;
    }
  }
  return out;
}

function findRichContainer(labelNode) {
  const scopes = [labelNode.parentElement, labelNode.parentElement?.parentElement, labelNode.nextElementSibling];
  let best = null;
  for (const scope of scopes) {
    if (!scope) continue;
    for (const candidate of scope.querySelectorAll('[contenteditable], .rich-text, [class*="rich"], [class*="description"], textarea, p, ul, div')) {
      if (candidate.contains(labelNode)) continue;
      const len = normalize(candidate.textContent).length;
      if (len < 3) continue;
      if (!best || len > best.len) best = { node: candidate, len };
    }
    if (best) break;
  }
  return best?.node ?? null;
}

/** Minimal HTML→markdown so lists, links and emphasis survive into the prompt. */
export function htmlToMarkdown(node) {
  if (node.tagName === 'TEXTAREA' || node.tagName === 'INPUT') return normalize(node.value);
  const lines = [];

  (function walk(el, depth) {
    for (const child of el.childNodes) {
      if (child.nodeType === 3) {
        const t = normalize(child.textContent);
        if (t) lines.push(t);
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toLowerCase();
      if (tag === 'br') { lines.push('\n'); continue; }
      if (tag === 'li') { lines.push(`\n${'  '.repeat(depth)}- `); walk(child, depth + 1); continue; }
      if (/^(ul|ol)$/.test(tag)) { walk(child, depth + 1); lines.push('\n'); continue; }
      if (/^(p|div|tr)$/.test(tag)) { walk(child, depth); lines.push('\n'); continue; }
      if (/^h[1-6]$/.test(tag)) { lines.push(`\n${'#'.repeat(Number(tag[1]))} `); walk(child, depth); lines.push('\n'); continue; }
      if (/^(strong|b)$/.test(tag)) { lines.push('**'); walk(child, depth); lines.push('**'); continue; }
      if (/^(em|i)$/.test(tag)) { lines.push('_'); walk(child, depth); lines.push('_'); continue; }
      if (tag === 'code') { lines.push('`'); walk(child, depth); lines.push('`'); continue; }
      if (tag === 'a') {
        const href = child.getAttribute('href');
        lines.push('['); walk(child, depth); lines.push(href ? `](${href})` : ']');
        continue;
      }
      if (tag === 'img') { lines.push(`![${child.alt || 'image'}](${child.src})`); continue; }
      walk(child, depth);
    }
  })(node, 0);

  return lines.join(' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Comment threads, if a comments region is on screen. */
export function readComments(root = document) {
  const region = [...root.querySelectorAll('[class*="comment"], [id*="comment"], [aria-label*="omment"]')]
    .filter((n) => normalize(n.textContent).length > 20)
    .sort((a, b) => b.textContent.length - a.textContent.length)[0];
  if (!region) return [];

  const items = [...region.querySelectorAll('li, article, [class*="comment-item"], [class*="commentItem"]')]
    .filter((n) => normalize(n.textContent).length > 10);

  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (out.some((c) => item.contains(c.node))) continue;   // keep the innermost
    const body = htmlToMarkdown(item);
    if (!body || seen.has(body)) continue;
    seen.add(body);
    const author = normalize(item.querySelector('[class*="author"], [class*="user"], b, strong')?.textContent) || null;
    out.push({ node: item, author, body: body.slice(0, 4000) });
  }
  return out.map(({ author, body }) => ({ author, body }));
}

/** Everything, assembled into a basket-ready story item. */
export function scrapeStory(root = document) {
  const route = readRoute();
  const fields = readFields(root);
  const long = readLongFields(root);
  const comments = readComments(root);

  const title = fields.name
    || normalize(document.querySelector('h1, h2, [class*="entity-name"], [class*="title"]')?.textContent)
    || document.title;

  return {
    kind: 'story',
    storyId: fields.id || route.id,
    storyType: fields.type || route.entityType || 'work item',
    title: title?.slice(0, 300),
    url: location.href,
    fields: Object.fromEntries(Object.entries(fields).filter(([k]) => !['name', 'id', 'type'].includes(k))),
    description: long.description ?? null,
    acceptanceCriteria: long['acceptance criteria'] ?? long['steps to reproduce'] ?? null,
    comments,
    meta: { workspaceId: route.workspaceId, sharedSpaceId: route.sharedSpaceId },
  };
}
