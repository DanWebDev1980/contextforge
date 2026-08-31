// Renders basket items into a single Copilot-ready markdown prompt.
// The goal is a document an LLM can act on: concrete values, no screenshots,
// no dumps of properties that were never set.

import { toApiMarkdown } from './fixtures.js';

function drop(obj) {
  // strip nulls / empty objects so the prompt is not 80% "null"
  if (Array.isArray(obj)) { const arr = obj.map(drop).filter((v) => v != null); return arr.length ? arr : null; }
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) { const cleaned = drop(v); if (cleaned != null) out[k] = cleaned; }
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
  for (const fx of node.effects || []) add('shadow', `${fx.inset ? 'inset ' : ''}${fx.x ?? 0} ${fx.y ?? 0} ${fx.blur ?? 0} ${fx.spread ?? 0} ${fx.color ?? ''}`.trim());
  add('opacity', node.opacity);
  return lines;
}

function nodeMarkdown(node, depth = 0) {
  const pad = '  '.repeat(depth);
  const out = [`${pad}**${node.name || 'node'}**${node.ref ? ` \`${node.ref}\`` : ''}`];
  if (node.text) out.push(`${pad}  > ${node.text}`);
  out.push(...styleLines(node, `${pad}  `));
  for (const child of node.children || []) out.push('', ...nodeMarkdown(child, depth + 1));
  return out;
}

const code = (lang, text) => ['```' + lang, text, '```'];
const clip = (s, n = 400) => { const t = typeof s === 'string' ? s : JSON.stringify(s); return t == null ? '' : t.length > n ? `${t.slice(0, n)}…` : t; };
const fmt = (v) => (v == null || v === '' ? '_—_' : `\`${v}\``);

export const ICONS = {
  story: '🎫', note: '📝', 'style-capture': '🎨', comparison: '🔍', analytics: '📊',
  checkpoint: '💾', recording: '⚡', errors: '🚨', facts: '🧭', a11y: '♿', 'component-tree': '🌳', journey: '🧭', request: '↗',
};

export function labelFor(item) {
  switch (item.kind) {
    case 'story': return `${item.storyId ? `#${item.storyId} ` : ''}${item.title ?? 'story'}`;
    case 'note': return item.title || (item.body ?? '').slice(0, 60);
    case 'style-capture': return `${item.source}: ${item.node?.name ?? 'node'}${item.meta?.nodeCount ? ` (${item.meta.nodeCount})` : ''}`;
    case 'comparison': return `${item.label} — ${item.summary?.mismatches ?? 0} mismatched`;
    case 'analytics': return item.label || 'analytics';
    case 'checkpoint': return `checkpoint: ${[item.app, item.journey, item.step].filter(Boolean).join(' › ')}`;
    case 'recording': return `recording: ${item.name ?? item.journey ?? ''} (${item.entries?.length ?? 0} requests)`;
    case 'errors': return `${item.entries?.length ?? 0} console/runtime errors`;
    case 'facts': return `page facts: ${item.facts?.framework?.name ?? item.title ?? ''}`;
    case 'a11y': return `a11y outline: ${item.region ?? ''}`;
    case 'component-tree': return `component tree: ${item.chain?.[0]?.name ?? item.selector ?? ''}`;
    case 'journey': return `journey: ${item.name ?? ''} (${item.steps?.length ?? 0} steps)`;
    case 'request': return `${item.entry?.method ?? ''} ${item.entry?.url ?? ''}`;
    default: return item.kind;
  }
}

const RENDERERS = {
  'style-capture': (item) => {
    const out = [`### ${item.source === 'figma' ? '🎨 Design' : '🌐 Implementation'}: ${item.node?.name || 'capture'}`, item.url ? `_${item.url}_` : null, '', ...nodeMarkdown(item.node)];
    const tokens = item.meta?.context?.tokens ?? [];
    if (tokens.length) out.push('', '**Design tokens in effect**', '', ...tokens.map((t) => `- \`${t.name}\`: ${t.value ?? '—'}${t.definedIn ? ` _(from \`${t.definedIn}\`)_` : ''}`));
    const scoped = (item.meta?.context?.rules ?? []).filter((r) => r.context?.length);
    if (scoped.length) out.push('', '**Conditional rules**', '', ...scoped.map((r) => `- ${r.context.map((c) => c.label).join(' › ')} → \`${r.selector}\``));
    if (item.meta?.media) out.push('', `_Captured at ${item.meta.media.viewport}, dpr ${item.meta.media.dpr}, ${item.meta.media.colorScheme} scheme._`);
    return out;
  },

  story: (item) => [
    `### 🎫 ${item.storyType || 'Story'} ${item.storyId ?? ''} — ${item.title || 'untitled'}`,
    item.url ? `_${item.url}_` : null, '',
    ...Object.entries(item.fields || {}).map(([k, v]) => `- **${k}**: ${v}`),
    item.description ? `\n**Description**\n\n${item.description}` : null,
    item.acceptanceCriteria ? `\n**Acceptance criteria**\n\n${item.acceptanceCriteria}` : null,
    item.comments?.length ? `\n**Comments**\n\n${item.comments.map((c) => `- ${c.author ? `**${c.author}**: ` : ''}${c.body}`).join('\n')}` : null,
  ],

  note: (item) => [`### 📝 ${item.title || 'Note'}`, item.url ? `_${item.url}_` : null, '', item.body],

  comparison: (item) => [
    `### 🔍 Design vs implementation: ${item.label || ''}`, '',
    '| Property | Design (Figma) | Built (web) | Match |', '| --- | --- | --- | --- |',
    ...item.rows.map((r) => `| ${r.property} | ${fmt(r.design)} | ${fmt(r.web)} | ${r.match ? '✅' : '❌'} |`),
  ],

  analytics: (item) => [`### 📊 Analytics: ${item.label || 'events'}`, item.url ? `_${item.url}_` : null, '', ...code('json', JSON.stringify(item.events ?? item.data, null, 2))],

  checkpoint: (item) => {
    const sensitive = new Set(item.sensitive ?? []);
    const rows = [];
    for (const [area, obj] of Object.entries(item.storage ?? {})) {
      for (const [k, v] of Object.entries(obj ?? {})) rows.push(`| ${area} | \`${k}\` | ${sensitive.has(k) ? '_‹redacted›_' : `\`${clip(v, 160).replace(/\|/g, '\\|').replace(/\n/g, ' ')}\``} |`);
    }
    for (const c of item.cookies ?? []) rows.push(`| cookie | \`${c.name}\` | ${sensitive.has(c.name) ? '_‹redacted›_' : `\`${clip(c.value, 120)}\``} |`);
    return [
      `### 💾 State checkpoint: ${[item.app, item.env && `(${item.env})`, item.journey, item.step].filter(Boolean).join(' › ')}`,
      item.url ? `_${item.url.origin ?? ''}${item.url.path ?? ''}${item.url.search ?? ''}${item.url.hash ?? ''}_` : null,
      item.page ? `Page: ${item.page}` : null,
      item.notes ? `\n${item.notes}` : null, '',
      '| Area | Key | Value |', '| --- | --- | --- |', ...rows,
      sensitive.size ? `\n_${sensitive.size} credential-looking key(s) withheld._` : null,
    ];
  },

  recording: (item) => [
    `### ⚡ Network recording: ${[item.name, item.app, item.env].filter(Boolean).join(' · ')}`,
    item.url ? `_${item.url}_` : null, '',
    toApiMarkdown(item.entries ?? [], { title: 'Endpoints' }),
  ],

  request: (item) => [
    `### ↗ Request: ${item.entry?.method} ${item.entry?.url}`, '',
    toApiMarkdown([item.entry], { title: 'Detail' }),
  ],

  errors: (item) => [
    `### 🚨 Errors captured (${item.entries?.length ?? 0})`, item.url ? `_${item.url}_` : null, '',
    ...(item.entries ?? []).flatMap((e) => [
      `- **${e.level}** ${e.message}${e.url && e.url !== item.url ? ` _(at ${e.url})_` : ''}${e.count > 1 ? ` ×${e.count}` : ''}`,
      e.stack ? `  \`\`\`\n  ${String(e.stack).split('\n').slice(0, 8).join('\n  ')}\n  \`\`\`` : null,
    ]),
  ],

  facts: (item) => [`### 🧭 Page facts`, item.url ? `_${item.url}_` : null, '', item.markdown ?? JSON.stringify(item.facts, null, 2)],

  a11y: (item) => [`### ♿ Accessibility outline: ${item.region ?? ''}`, item.url ? `_${item.url}_` : null, '', item.markdown ?? ''],

  'component-tree': (item) => [
    `### 🌳 Component tree for \`${item.selector ?? ''}\``, item.url ? `_${item.url}_` : null,
    item.note ? `_${item.note}_` : null, '',
    ...(item.chain ?? []).map((c, i) => {
      const props = c.props && Object.keys(c.props).length ? ` props: ${clip(JSON.stringify(c.props), 200)}` : '';
      const hooks = c.hooks ? ` · ${c.hooks} hook${c.hooks === 1 ? '' : 's'}` : '';
      const src = c.source ? ` · \`${c.source}\`` : '';
      return `${'  '.repeat(Math.min(i, 8))}- **${c.name}**${c.host ? ` (\`<${c.host}>\`)` : ''}${hooks}${src}${props}`;
    }),
  ],

  journey: (item) => [
    `### 🧭 Journey: ${item.name ?? ''}`, '',
    ...(item.steps ?? []).map((s, i) => `${i + 1}. ${s.action} \`${s.selectors?.[0]?.value ?? ''}\`${s.value != null ? ` = "${s.value}"` : ''}${s.url ? ` _(${s.url})_` : ''}`),
  ],
};

const GROUPS = [
  ['story', '## Ticket'],
  ['note', '## Notes & discovery'],
  ['facts', '## Environment'],
  ['component-tree', '## Components'],
  ['style-capture', '## Styles captured'],
  ['comparison', '## Differences to fix'],
  ['a11y', '## Accessibility'],
  ['checkpoint', '## Application state'],
  ['recording', '## API traffic'],
  ['request', '## Requests'],
  ['analytics', '## Analytics'],
  ['errors', '## Errors'],
  ['journey', '## Journeys'],
];

export const PRESETS = {
  everything: { title: 'Everything', kinds: null },
  styles: { title: 'Styles only', kinds: ['style-capture', 'comparison'] },
  ticket: { title: 'Ticket + notes', kinds: ['story', 'note'] },
  wire: { title: 'Wire (API, analytics, errors)', kinds: ['recording', 'request', 'analytics', 'errors'] },
  state: { title: 'State (checkpoints, journeys)', kinds: ['checkpoint', 'journey'] },
  debug: { title: 'Debug (errors, facts, components, state)', kinds: ['errors', 'facts', 'component-tree', 'checkpoint', 'recording'] },
};

/** Render the whole basket into one prompt document. */
export function toMarkdown(items, { task = '', repoHint = '' } = {}) {
  const parts = ['# Implementation context', ''];
  if (task) parts.push('## Task', '', task, '');
  if (repoHint) parts.push(`**Target repo / area:** ${repoHint}`, '');

  for (const [kind, heading] of GROUPS) {
    const matching = items.filter((i) => i.kind === kind);
    if (!matching.length) continue;
    parts.push(heading, '');
    for (const item of matching) {
      const render = RENDERERS[kind];
      try { parts.push(...render(item).filter((l) => l != null), ''); }
      catch (err) { parts.push(`_(could not render ${kind}: ${err.message})_`, ''); }
    }
  }
  const unknown = items.filter((i) => !RENDERERS[i.kind]);
  if (unknown.length) {
    parts.push('## Other', '');
    for (const item of unknown) parts.push(`### ${item.kind}`, '', ...code('json', JSON.stringify(item, null, 2)), '');
  }

  parts.push('---', '',
    '**Instructions:** implement the task above in this repository. Match the captured design values exactly where a comparison table marks a mismatch. Treat the API contract and application state as the real backend behaviour. Prefer existing components, tokens and utility classes in the codebase over new CSS.',
    '');
  return parts.join('\n');
}
