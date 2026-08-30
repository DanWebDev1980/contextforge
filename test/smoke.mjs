// Pure-logic smoke tests. The DOM adapters need a browser; these cover the
// normalizers, the comparison engine and the markdown export, which is where a
// silent bug would poison every prompt.
import assert from 'node:assert/strict';
import { px, color, fontWeight, fontFamily, emptyNode, capture } from '../src/core/schema/style.js';
import { compareNodes } from '../src/core/compare.js';
import { toMarkdown } from '../src/core/export/markdown.js';

let pass = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; } };

t('px units', () => {
  assert.equal(px('16px'), 16);
  assert.equal(px('1.5rem'), 24);
  assert.equal(px('2em', { parentFontSize: 20 }), 40);
  assert.equal(px('12pt'), 16);
  assert.equal(px('normal'), null);
  assert.equal(px('Mixed'), null);
  assert.equal(px('50%'), null);
  assert.equal(px(24), 24);
  assert.equal(px(''), null);
});

t('color normalisation', () => {
  assert.equal(color('#FFF'), '#ffffff');
  assert.equal(color('rgb(255, 0, 0)'), '#ff0000');
  assert.equal(color('rgba(0,0,0,0.5)'), '#00000080');
  assert.equal(color('#ff0000ff'), '#ff0000');
  assert.equal(color('transparent'), '#00000000');
  assert.equal(color('rgb(59 111 224 / 1)'), '#3b6fe0');
  assert.equal(color('Mixed'), null);
});

t('font weight and family', () => {
  assert.equal(fontWeight('Semi Bold'), 600);
  assert.equal(fontWeight('700'), 700);
  assert.equal(fontWeight('Regular'), 400);
  assert.equal(fontFamily('"Inter", sans-serif'), 'Inter');
});

t('compare finds real mismatches and tolerates float noise', () => {
  const design = emptyNode({ name: 'Button' });
  design.box = { width: 120, height: 40 };
  design.typography = { ...design.typography, fontSize: 16, fontWeight: 600, color: '#ffffff', lineHeight: 24 };
  design.fill.background = '#3b6fe0';
  design.border.radius.tl = 8;

  const web = emptyNode({ name: 'button.btn' });
  web.box = { width: 120.0003, height: 40 };
  web.typography = { ...web.typography, fontSize: 14, fontWeight: 600, color: '#ffffffff', lineHeight: 24 };
  web.fill.background = '#3b6fe0';
  web.border.radius.tl = 4;

  const all = compareNodes(design, web);
  const diffs = compareNodes(design, web, { onlyDifferences: true }).rows.map((r) => r.property);
  assert.deepEqual(diffs.sort(), ['border-radius', 'font-size']);
  assert.equal(all.summary.mismatches, 2);
  assert.ok(all.rows.find((r) => r.property === 'width').match, 'sub-pixel width should match');
  assert.ok(all.rows.find((r) => r.property === 'color').match, '#fff vs #ffffffff should match');
});

t('markdown export omits nulls and includes real values', () => {
  const node = emptyNode({ name: 'div.card', ref: 'div.card', text: 'Hello' });
  node.typography = { ...node.typography, fontSize: 16, fontFamily: 'Inter', color: '#111111' };
  node.border.radius = { tl: 8, tr: 8, br: 8, bl: 8 };
  const md = toMarkdown([capture({ source: 'web', node })], { task: 'Build the card' });
  assert.ok(md.includes('Build the card'));
  assert.ok(md.includes('Inter'));
  assert.ok(md.includes('radius: 8px'));
  assert.ok(md.includes('> Hello'));
  assert.ok(!md.includes('null'), 'no nulls should leak into the prompt');
});

t('markdown renders a comparison table', () => {
  const cmp = { kind: 'comparison', label: 'Button', rows: [{ property: 'font-size', design: 16, web: 14, match: false }] };
  const md = toMarkdown([cmp]);
  assert.ok(md.includes('| font-size | `16` | `14` | ❌ |'));
});

t('markdown renders a story', () => {
  const md = toMarkdown([{
    kind: 'story', storyId: 4821, storyType: 'story', title: 'Add filter chips',
    fields: { phase: 'In progress' }, description: 'Body text',
    acceptanceCriteria: '- one\n- two', comments: [{ author: 'QA', body: 'looks off' }],
  }]);
  assert.ok(md.includes('🎫 story 4821 — Add filter chips'));
  assert.ok(md.includes('**phase**: In progress'));
  assert.ok(md.includes('**QA**: looks off'));
});

console.log(`${pass} checks passed`);
