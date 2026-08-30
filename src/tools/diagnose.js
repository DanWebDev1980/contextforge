// Reports what the Figma and Octane adapters actually resolved on this page,
// and why they failed if they did.
//
// `probe` shows the DOM as it is; this shows what the code made of it. Together
// they turn "the Figma tool found nothing" into a one-line fix in a selector
// file. Paste the report into an issue or a prompt.

import { panel, toast, el, teardown } from '../core/overlay/ui.js';
import { copy } from '../core/clipboard.js';
import { rankPanelCandidates, labelOf, FIELD_ALIASES } from '../adapters/figma/selectors.js';
import { readFields as figmaFields, readColors, readSelectionName, scrapeSelection } from '../adapters/figma/scrape.js';
import { findLayersList, looksLikeSticky } from '../adapters/figma/layers.js';
import { readRoute, readFields as octaneFields, readLongFields, readComments, scrapeStory } from '../adapters/octane/scrape.js';

const line = (s = '') => s;
const rule = (t) => `\n── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`;

function detectSite() {
  const host = location.hostname;
  if (/figma\.com$/.test(host)) return 'figma';
  if (/octane|almoctane|saas\.microfocus|opentext/i.test(host + location.pathname)) return 'octane';
  return 'unknown';
}

/** Your Octane hostname is internal infrastructure; keep it out of the report. */
const stripHost = (url) => (url == null ? url : String(url).replace(/\/\/[^/]+/, '//\u2039host\u203a'));

/** Values may be ticket content; redaction keeps shape but drops the text. */
function redactValue(value, on) {
  if (!on || value == null) return value;
  const s = String(value);
  if (/^[\d\s.,%#-]*$/.test(s)) return s;              // numbers and hex are never sensitive
  return `‹${s.length} chars›`;
}

function figmaReport(redact) {
  const out = [];
  out.push(rule('FIGMA: properties panel detection'));

  const candidates = rankPanelCandidates();
  const accepted = candidates.filter((c) => c.accepted);
  out.push(`candidates with controls: ${candidates.length}, accepted: ${accepted.length}`);

  for (const c of candidates.slice(0, 6)) {
    out.push('');
    out.push(`  ${c.accepted ? '✓ ACCEPTED' : '✗ rejected'}  score=${c.score} depth=${c.depth} controls=${c.controlCount}`);
    out.push(`    rect: right=${c.rect.right} width=${c.rect.width} height=${c.rect.height} (viewport ${innerWidth}×${innerHeight})`);
    if (c.reasons.length) out.push(`    why not: ${c.reasons.join('; ')}`);
    const shown = [...new Set(c.labels)].slice(0, 30);
    out.push(`    resolved labels (${c.labels.length} controls): ${shown.length ? shown.map((l) => JSON.stringify(l)).join(', ') : '‹none resolved›'}`);
  }

  const panelNode = accepted[0]?.node;
  if (!panelNode) {
    out.push('');
    out.push('  → No panel accepted. Compare the rejection reasons above against');
    out.push('    findPropertiesPanel() in src/adapters/figma/selectors.js.');
    out.push('    If a container looks right but scored 0, its labels are listed');
    out.push('    above — those strings need adding to FIELD_ALIASES.');
    return out;
  }

  out.push(rule('FIGMA: fields read from the accepted panel'));
  const fields = figmaFields(panelNode);
  const keys = Object.keys(fields);
  out.push(`raw label→value pairs (${keys.length}):`);
  for (const [k, v] of Object.entries(fields)) out.push(`  ${JSON.stringify(k)}: ${JSON.stringify(redactValue(v, redact))}`);

  out.push('');
  const known = new Set(Object.values(FIELD_ALIASES).flat());
  const unknown = keys.filter((k) => !known.has(k));
  out.push(`labels NOT in FIELD_ALIASES (candidates to add): ${unknown.length ? unknown.map((k) => JSON.stringify(k)).join(', ') : 'none'}`);

  const mapped = Object.entries(FIELD_ALIASES)
    .map(([prop, aliases]) => [prop, aliases.find((a) => a in fields)])
    .filter(([, hit]) => hit);
  out.push(`properties successfully mapped: ${mapped.map(([p]) => p).join(', ') || 'NONE'}`);
  out.push(`properties NOT found: ${Object.keys(FIELD_ALIASES).filter((p) => !mapped.some(([m]) => m === p)).join(', ')}`);

  out.push(rule('FIGMA: colours'));
  out.push(JSON.stringify(readColors(panelNode), null, 2));

  out.push(rule('FIGMA: selection name + final normalized node'));
  out.push(`readSelectionName(): ${JSON.stringify(readSelectionName())}`);
  const scraped = scrapeSelection();
  out.push(scraped ? JSON.stringify(scraped.node, null, 2) : 'scrapeSelection() returned null');

  out.push(rule('FIGMA: layers list (used for sticky harvesting)'));
  const list = findLayersList();
  if (!list) {
    out.push('findLayersList() → null. Is the left panel open (Alt+1)?');
  } else {
    const r = list.getBoundingClientRect();
    const rows = [...list.querySelectorAll('[role="treeitem"], [role="row"], [role="option"]')];
    out.push(`found: left=${Math.round(r.left)} width=${Math.round(r.width)} height=${Math.round(r.height)}`);
    out.push(`scrollable: ${list.scrollHeight > list.clientHeight + 4} (scrollHeight=${list.scrollHeight}, clientHeight=${list.clientHeight})`);
    out.push(`rows currently in DOM: ${rows.length}`);
    out.push('first 15 rows (text → passes looksLikeSticky?):');
    for (const row of rows.slice(0, 15)) {
      const text = row.textContent.replace(/\s+/g, ' ').trim();
      out.push(`  ${looksLikeSticky(text) ? '✓' : '·'} lvl${row.getAttribute('aria-level') ?? '?'} ${JSON.stringify(redactValue(text, redact))}`);
    }
  }
  return out;
}

function octaneReport(redact) {
  const out = [];
  out.push(rule('OCTANE: route parsing'));
  out.push(JSON.stringify(readRoute(), null, 2));
  out.push(`(from URL: ${stripHost(location.href)})`);

  out.push(rule('OCTANE: short fields'));
  const fields = octaneFields();
  const keys = Object.keys(fields);
  out.push(`found ${keys.length}:`);
  for (const [k, v] of Object.entries(fields)) out.push(`  ${JSON.stringify(k)}: ${JSON.stringify(redactValue(v, redact))}`);
  if (!keys.length) {
    out.push('  ‹none› — either the labels differ from FIELD_LABELS, or valueNear()');
    out.push('  cannot reach the value from the label. Run probe on the form.');
  }

  out.push(rule('OCTANE: long fields'));
  const long = readLongFields();
  for (const [k, v] of Object.entries(long)) {
    out.push(`  ${JSON.stringify(k)}: ${redact ? `‹${v.length} chars›` : `${v.length} chars`}`);
    if (!redact) out.push(v.split('\n').map((l) => `      ${l}`).join('\n'));
  }
  if (!Object.keys(long).length) out.push('  ‹none found›');

  out.push(rule('OCTANE: comments'));
  const comments = readComments();
  out.push(`found ${comments.length}`);
  for (const c of comments.slice(0, 5)) {
    out.push(`  author=${JSON.stringify(c.author)} body=${JSON.stringify(redactValue(c.body.slice(0, 200), redact))}`);
  }

  out.push(rule('OCTANE: assembled story object'));
  const story = { ...scrapeStory() };
  story.url = stripHost(story.url);          // never echo the internal hostname
  out.push(JSON.stringify(redact
    ? { ...story, title: redactValue(story.title, true), description: redactValue(story.description, true),
        acceptanceCriteria: redactValue(story.acceptanceCriteria, true),
        fields: Object.fromEntries(Object.entries(story.fields).map(([k, v]) => [k, redactValue(v, true)])),
        comments: `${story.comments.length} comments` }
    : story, null, 2));

  out.push(rule('OCTANE: unmatched label-like text on the page'));
  out.push('(short bold/label elements whose text is NOT in FIELD_LABELS — likely custom fields)');
  const seen = new Set();
  for (const node of document.querySelectorAll('label, dt, th, [class*="label"]')) {
    if (node.children.length > 1) continue;
    const t = node.textContent?.replace(/\s+/g, ' ').trim().replace(/[:*]+$/, '').toLowerCase();
    if (!t || t.length > 40 || t.length < 2 || seen.has(t) || t in fields) continue;
    seen.add(t);
  }
  out.push([...seen].slice(0, 60).map((t) => `  ${JSON.stringify(t)}`).join('\n') || '  ‹none›');
  return out;
}

export function start() {
  const site = detectSite();
  const p = panel({ title: `Diagnose — ${site}`, x: 16, y: 16, width: 520, onClose: teardown });

  const redactBox = el('input', { type: 'checkbox' });
  redactBox.checked = site === 'octane';   // ticket text is likelier to be sensitive than hex codes

  const out = el('pre', {
    style: 'margin:8px 0 0;max-height:340px;overflow:auto;background:#0e1013;padding:8px;border-radius:6px;font-size:10px;white-space:pre-wrap',
  });

  p.body.append(
    el('div', { class: 'muted' },
      site === 'unknown'
        ? 'Not on Figma or Octane — both reports will run anyway.'
        : `Detected ${site}. Select a layer / open a story first, then Run.`),
    el('label', { class: 'row', style: 'margin-top:6px' }, redactBox,
      el('span', { class: 'muted' }, 'redact text values (keeps labels + shapes)')),
    out,
  );

  let report = '';
  function run() {
    const redact = redactBox.checked;
    const lines = [
      '# contextforge diagnose',
      `# url: ${stripHost(location.href)}`,
      `# viewport: ${innerWidth}×${innerHeight}  dpr=${devicePixelRatio}`,
      `# ua: ${navigator.userAgent}`,
      `# at: ${new Date().toISOString()}`,
      `# redacted: ${redact}`,
    ];
    for (const [name, fn] of [['figma', figmaReport], ['octane', octaneReport]]) {
      if (site !== 'unknown' && site !== name) continue;
      try {
        lines.push(...fn(redact));
      } catch (err) {
        lines.push(rule(`${name.toUpperCase()}: THREW`), String(err?.stack ?? err));
      }
    }
    report = lines.join('\n');
    out.textContent = report;
    return report;
  }

  p.foot.append(
    el('button', { class: 'primary', onclick: () => { run(); toast('Report rebuilt'); } }, 'Run'),
    el('button', { onclick: async () => { await copy(report || run()); toast('Report copied'); } }, 'Copy report'),
    el('button', { onclick: () => { console.log(report || run()); toast('Logged'); } }, 'Log to console'),
  );

  run();
  return { stop: teardown, run };
}

start();
