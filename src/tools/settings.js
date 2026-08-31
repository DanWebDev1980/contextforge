// Settings: hotkey, env map, redaction rules, flag pattern, stripped headers,
// panel positions. Export/import as JSON so a second machine matches the first.

import { toast, el, field } from '../core/overlay/ui.js';
import * as settings from '../app/settings.js';
import { validateEnvMap } from '../core/site.js';
import { download, pickFile, stamp } from '../core/files.js';
import { copy } from '../core/clipboard.js';

export default {
  id: 'settings',
  title: 'Settings',
  desc: 'Hotkey, env map, redaction rules, panel positions. Export to match another machine.',
  icon: '⚙️',
  group: 'bcc',
  sites: ['*'],
  keywords: ['hotkey', 'env map', 'redaction', 'preferences', 'config'],

  start(ctx) {
    const p = ctx.panel({ width: 520, height: 520 });

    const hotkeyIn = el('input', { type: 'text', value: settings.get('hotkey'), placeholder: 'Ctrl+Shift+Space' });
    const captureBtn = el('button', { class: 'sm', title: 'Press the combination you want' }, 'Press keys…');
    captureBtn.addEventListener('click', () => {
      captureBtn.textContent = 'press now…';
      const onKey = (e) => {
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        const parts = [e.ctrlKey && 'Ctrl', e.shiftKey && 'Shift', e.altKey && 'Alt', e.metaKey && 'Meta', e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key].filter(Boolean);
        hotkeyIn.value = parts.join('+');
        captureBtn.textContent = 'Press keys…';
        removeEventListener('keydown', onKey, true);
      };
      addEventListener('keydown', onKey, true);
    });

    const envMapIn = el('textarea', { rows: '8', value: JSON.stringify(settings.get('envMap'), null, 2) });
    const envMsg = el('div', { class: 'muted' }, 'Per app: { "billing": { "dev": "http://localhost:3000", "test": "https://billing-test.corp", "prod": "https://billing.corp" } }');
    const redactionIn = el('input', { type: 'text', value: settings.get('redaction').join(', ') });
    const flagIn = el('input', { type: 'text', value: settings.get('flagPattern') });
    const stripIn = el('input', { type: 'text', value: settings.get('stripHeaders').join(', ') });

    p.body.append(
      field('palette hotkey', el('div', { class: 'row' }, hotkeyIn, captureBtn)),
      el('div', { class: 'muted', style: 'margin:2px 0 10px' }, 'Ctrl+Shift+Space is unbound in Edge and Chrome. If a corporate IME claims it, Ctrl+Shift+K is a good fallback.'),
      field('environment map (JSON)', envMapIn), envMsg,
      el('div', { style: 'margin-top:10px' }, field('redaction rules — keys/cookies matching any of these are withheld from exports (comma-separated words or /regex/)', redactionIn)),
      el('div', { style: 'margin-top:10px' }, field('feature-flag key pattern (regex) — used by Page facts and the storage editor', flagIn)),
      el('div', { style: 'margin-top:10px' }, field('request headers stripped from recordings and exports', stripIn)),
    );

    function save() {
      let envMap;
      try { envMap = JSON.parse(envMapIn.value || '{}'); } catch (err) { envMsg.textContent = `env map is not valid JSON: ${err.message}`; envMsg.className = 'bad'; return false; }
      const problems = validateEnvMap(envMap);
      if (problems.length) { envMsg.textContent = problems.join(' · '); envMsg.className = 'bad'; return false; }
      envMsg.className = 'muted';
      const hk = hotkeyIn.value.trim();
      if (!settings.parseHotkey(hk).key) return toast('Hotkey needs a key, e.g. Ctrl+Shift+Space');
      settings.patch({
        hotkey: hk, envMap,
        redaction: redactionIn.value.split(',').map((s) => s.trim()).filter(Boolean),
        flagPattern: flagIn.value.trim(),
        stripHeaders: stripIn.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      });
      toast('Settings saved');
      return true;
    }

    p.foot.append(
      el('button', { class: 'primary', onclick: save }, 'Save'),
      el('button', { title: 'Panels reopen at their default positions', onclick: () => { settings.set('panels', {}); settings.set('dock', {}); toast('Positions reset — reopen panels to see it'); } }, 'Reset positions'),
      el('button', { onclick: () => download(`bcc-settings-${stamp()}.json`, JSON.stringify(settings.settings.all(), null, 2)) }, 'Export'),
      el('button', { onclick: async () => { const f = await pickFile(); if (!f) return; try { const obj = JSON.parse(f.text); if (!obj || typeof obj !== 'object') throw new Error('not an object'); settings.patch(obj); toast('Settings imported'); ctx.restart(); } catch (err) { toast(`Import failed: ${err.message}`); } } }, 'Import'),
      el('button', { onclick: async () => { await copy(JSON.stringify(settings.settings.all(), null, 2)); toast('Copied'); } }, 'Copy JSON'),
      el('button', { class: 'danger', onclick: () => { if (confirm('Reset every BCC setting to defaults? (Checkpoints, recordings and the basket are kept.)')) { settings.reset(); toast('Reset'); ctx.restart(); } } }, 'Reset all'),
    );

    return { stop: () => p.close(), save };
  },
};
