// Renders basket items into a single Copilot-ready markdown prompt.
// The goal is a document an LLM can act on: concrete values, no screenshots,
// no dumps of properties that were never set.

function drop(obj) {
  // strip nulls / empty objects so the prompt is not 80% "null"
  if (Array.isArray(obj)) {
    const arr = obj.map(drop).filter((v) => v != null);
    return arr.length ? arr : null;
  }
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const cleaned = drop(v);
      if (cleaned != null) out[k] = cleaned;
    }
    return Object.keys(out).length ? out : null;
  }
  return obj === '' ? null : obj;
}

function styleLines(node, indent = '') {
  const lines = [];
  const add = (label, value) => { if (value != null && value !== '') lines.push(`${indent}- ${label}: ${value}`); };
  const b = node.box || {};
  if (b.width != null || b.height != null) add('size', `${b.width ?? '?'} × ${b.height ?? '?'}`);

  const l = drop(node.layout);
  if (l) {
    const pad = l.padding;
    const padStr = pad ? [pad.top, pad.right, pad.bottom, pad.left].map((v) => v ?? 0).join(' ') : null;
    add('display', l.display);
    add('flex', [l.direction, l.justify && `justify:${l.justify}`, l.align && `align:${l.align}`, l.gap != null && `gap:${l.gap}`].filter(Boolean).join(' ') || null);
    if (padStr && padStr !== '0 0 0 0') add('padding', padStr);
  }

  const t = drop(node.typography);
  if (t) {
    add('font', [t.fontFamily, t.fontWeight, t.fontSize != null && `${t.fontSize}px`, t.lineHeight != null && `/ ${t.lineHeight}px`].filter(Boolean).join(' ') || null);
    add('letter-spacing', t.letterSpacing);
    add('text', [t.textAlign, t.textTransform].filter(Boolean).join(' ') || null);
    add('color', t.color);
  }

  add('background', node.fill?.background);

  const bd = drop(node.border);
  if (bd) {
    if (bd.width) add('border', `${bd.width}px ${bd.style ?? 'solid'} ${bd.color ?? ''}`.trim());
    const r = bd.radius;
    if (r) {
      const vals = [r.tl, r.tr, r.br, r.bl];
      if (vals.some((v) => v)) add('radius', vals.every((v) => v === vals[0]) ? `${vals[0]}px` : vals.map((v) => v ?? 0).join(' '));
    }
  }

  for (const fx of node.effects || []) {
    add('shadow', `${fx.inset ? 'inset ' : ''}${fx.x ?? 0} ${fx.y ?? 0} ${fx.blur ?? 0} ${fx.spread ?? 0} ${fx.color ?? ''}`.trim());
  }
  add('opacity', node.opacity);
  return lines;
}

function nodeMarkdown(node, depth = 0) {
  const pad = '  '.repeat(depth);
  const head = `${pad}**${node.name || 'node'}**${node.ref ? ` \`${node.ref}\`` : ''}`;
  const out = [head];
  if (node.text) out.push(`${pad}  > ${node.text}`);
  out.push(...styleLines(node, `${pad}  `));
  for (const child of node.children || []) out.push('', ...nodeMarkdown(child, depth + 1));
  return out;
}

const RENDERERS = {
  'style-capture': (item) => [
    `### ${item.source === 'figma' ? '🎨 Design' : '🌐 Implementation'}: ${item.node?.name || 'capture'}`,
    item.url ? `_${item.url}_` : null,
    '',
    ...nodeMarkdown(item.node),
  ],

  story: (item) => [
    `### 🎫 ${item.storyType || 'Story'} ${item.storyId ?? ''} — ${item.title || 'untitled'}`,
    item.url ? `_${item.url}_` : null,
    '',
    ...Object.entries(item.fields || {}).map(([k, v]) => `- **${k}**: ${v}`),
    item.description ? `\n**Description**\n\n${item.description}` : null,
    item.acceptanceCriteria ? `\n**Acceptance criteria**\n\n${item.acceptanceCriteria}` : null,
    item.comments?.length ? `\n**Comments**\n\n${item.comments.map((c) => `- ${c.author ? `**${c.author}**: ` : ''}${c.body}`).join('\n')}` : null,
  ],

  note: (item) => [
    `### 📝 ${item.title || 'Note'}`,
    item.url ? `_${item.url}_` : null,
    '',
    item.body,
  ],

  comparison: (item) => [
    `### 🔍 Design vs implementation: ${item.label || ''}`,
    '',
    '| Property | Design (Figma) | Built (web) | Match |',
    '| --- | --- | --- | --- |',
    ...item.rows.map((r) => `| ${r.property} | ${fmt(r.design)} | ${fmt(r.web)} | ${r.match ? '✅' : '❌'} |`),
  ],

  analytics: (item) => [
    `### 📊 Analytics: ${item.label || 'events'}`,
    item.url ? `_${item.url}_` : null,
    '',
    '```json',
    JSON.stringify(item.events ?? item.data, null, 2),
    '```',
  ],
};

function fmt(v) {
  if (v == null || v === '') return '_—_';
  return `\`${v}\``;
}

/** Render the whole basket into one prompt document. */
export function toMarkdown(items, { task = '', repoHint = '' } = {}) {
  const parts = ['# Implementation context', ''];
  if (task) parts.push('## Task', '', task, '');
  if (repoHint) parts.push(`**Target repo / area:** ${repoHint}`, '');

  const groups = [
    ['story', '## Ticket'],
    ['note', '## Notes & discovery'],
    ['style-capture', '## Styles captured'],
    ['comparison', '## Differences to fix'],
    ['analytics', '## Analytics'],
  ];

  for (const [kind, heading] of groups) {
    const matching = items.filter((i) => i.kind === kind);
    if (!matching.length) continue;
    parts.push(heading, '');
    for (const item of matching) {
      const render = RENDERERS[kind];
      parts.push(...render(item).filter((l) => l != null), '');
    }
  }

  parts.push(
    '---',
    '',
    '**Instructions:** implement the task above in this repository. Match the captured design values exactly where a comparison table marks a mismatch. Prefer existing components, tokens and utility classes in the codebase over new CSS.',
    ''
  );
  return parts.join('\n');
}
