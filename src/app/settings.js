// User settings: hotkey, env map, redaction rules, panel positions, favourites.
// One flat bag at bcc:settings:v1. Everything has a default, so callers never
// branch on "unset".

import { kv } from '../core/store/store.js';

export const DEFAULTS = {
  hotkey: 'Ctrl+Shift+Space',
  envMap: {},                                            // { app: { env: origin } }
  redaction: ['token', 'auth', 'jwt', 'session', 'secret', 'password', 'bearer'],
  flagPattern: 'flag|feature|ff_|toggle|experiment',
  panels: {},                                            // { toolId: { x, y, width, height } }
  favourites: [],                                        // checkpoint ids pinned in the dock
  basketExcluded: [],                                    // item ids not included in the prompt
  untickedKeys: {},                                      // { app: [storage keys left out of checkpoints] }
  mockEnabled: {},                                       // { app: bool }
  dock: { x: null, y: null, collapsed: false },
  stripHeaders: ['authorization', 'cookie', 'set-cookie', 'x-api-key'],
  theme: 'dark',
};

export const settings = kv('settings');

export function get(key) { return settings.get(key, DEFAULTS[key]); }
export function set(key, value) { return settings.set(key, value); }
export function patch(obj) { return settings.patch(obj); }
export function reset() { return settings.replaceAll({}); }

/** The redaction list as one case-insensitive RegExp. */
export function redactionRegex(list = get('redaction')) {
  const parts = (list ?? []).map((s) => String(s).trim()).filter(Boolean);
  if (!parts.length) return /$^/;
  return new RegExp(parts.map((p) => {
    // allow either a plain word or a /regex/ literal
    const m = p.match(/^\/(.+)\/[a-z]*$/);
    return m ? m[1] : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('|'), 'i');
}

export function isSensitiveKey(key, list) {
  return redactionRegex(list).test(String(key ?? ''));
}

export function flagRegex(pattern = get('flagPattern')) {
  try { return new RegExp(pattern || '$^', 'i'); } catch { return /$^/; }
}

/** Persist a panel's geometry so it reopens where you left it. */
export function rememberPanel(id, geometry) {
  const panels = { ...get('panels') };
  panels[id] = { ...(panels[id] ?? {}), ...geometry };
  set('panels', panels);
}

export function panelGeometry(id) {
  return get('panels')?.[id] ?? null;
}

// --- hotkeys -----------------------------------------------------------------

/** 'Ctrl+Shift+Space' → { ctrl, shift, alt, meta, key:' ' } */
export function parseHotkey(text) {
  const parts = String(text ?? '').split('+').map((s) => s.trim()).filter(Boolean);
  const out = { ctrl: false, shift: false, alt: false, meta: false, key: '' };
  for (const p of parts) {
    const l = p.toLowerCase();
    if (l === 'ctrl' || l === 'control') out.ctrl = true;
    else if (l === 'shift') out.shift = true;
    else if (l === 'alt' || l === 'option') out.alt = true;
    else if (l === 'meta' || l === 'cmd' || l === 'command' || l === 'win') out.meta = true;
    else out.key = l === 'space' ? ' ' : l === 'esc' ? 'escape' : l;
  }
  return out;
}

export function matchesHotkey(event, text) {
  const h = typeof text === 'string' ? parseHotkey(text) : text;
  if (!h.key) return false;
  const key = String(event.key ?? '').toLowerCase();
  const code = String(event.code ?? '').toLowerCase();
  const keyOk = key === h.key || code === h.key || (h.key === ' ' && code === 'space') || code === `key${h.key}`;
  return keyOk && !!event.ctrlKey === h.ctrl && !!event.shiftKey === h.shift && !!event.altKey === h.alt && !!event.metaKey === h.meta;
}

export function formatHotkey(text) {
  return String(text ?? '').split('+').map((s) => s.trim()).filter(Boolean).join(' + ');
}
