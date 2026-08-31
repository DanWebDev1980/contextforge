// The tool registry. Tools export a definition instead of self-starting:
//   { id, title, desc, icon, group, sites, keywords, start(ctx) → { stop, ...api } }
// The registry enforces that `stop` runs on panel close, on unload() and on
// pagehide, so nothing leaks past navigation.

import { panel as makePanel, toast } from '../core/overlay/ui.js';
import { detectSite } from '../core/site.js';

export const GROUPS = [
  ['context', 'Context'],
  ['state', 'State'],
  ['wire', 'Wire'],
  ['journeys', 'Journeys'],
  ['design', 'Design & tickets'],
  ['calibration', 'Calibration'],
  ['bcc', 'BCC'],
];

const tools = new Map();
const running = new Map();
const listeners = new Set();

const emit = () => listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });

export function registerTool(def) {
  if (!def?.id || typeof def.start !== 'function') throw new Error('tool needs an id and a start()');
  tools.set(def.id, { group: 'context', sites: ['*'], keywords: [], icon: '•', ...def });
  return def;
}

export function get(id) { return tools.get(id) ?? null; }
export function all() { return [...tools.values()]; }

/** Site-aware ranking: tools built for this site first, generic next, others last. Hides nothing. */
export function list({ site = detectSite(), query = '' } = {}) {
  const q = query.trim().toLowerCase();
  const score = (t) => {
    let s = 0;
    if (t.sites.includes(site)) s += 200;
    else if (t.sites.includes('*')) s += 100;
    if (running.has(t.id)) s += 10;
    if (q) {
      const hay = `${t.id} ${t.title} ${t.desc ?? ''} ${(t.keywords ?? []).join(' ')} ${t.group}`.toLowerCase();
      if (t.title.toLowerCase().startsWith(q)) s += 60;
      else if (t.title.toLowerCase().includes(q) || t.id.includes(q)) s += 40;
      else if (hay.includes(q)) s += 15;
      else if (q.length >= 3 && fuzzy(`${t.id} ${t.title}`.toLowerCase(), q)) s += 5;
      else return -1;
    }
    return s;
  };
  const order = [...tools.values()];
  return order
    .map((t, i) => ({ t, s: score(t), i }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.t);
}

function fuzzy(text, q) {
  let i = 0;
  for (const ch of text) { if (ch === q[i]) i += 1; if (i === q.length) return true; }
  return false;
}

export function isRunning(id) { return running.has(id); }
export function runningIds() { return [...running.keys()]; }
export function instance(id) { return running.get(id)?.instance ?? null; }

/** Start a tool (or focus it if already running). Returns the tool's instance API. */
export function start(id, options = {}) {
  const def = tools.get(id);
  if (!def) throw new Error(`unknown tool "${id}"`);
  const existing = running.get(id);
  if (existing) { existing.panel?.focus(); return existing.instance; }

  const entry = { def, instance: null, panel: null, startedAt: Date.now() };
  running.set(id, entry);
  const ctx = {
    id,
    options,
    panel: (opts = {}) => {
      const p = makePanel({ id, title: def.title, icon: def.icon, ...opts, onClose: () => { opts.onClose?.(); stop(id, 'close'); } });
      entry.panel = p;
      return p;
    },
    stop: () => stop(id),
    toast,
    restart: () => { stop(id); return start(id, options); },
  };
  try {
    entry.instance = def.start(ctx) ?? {};
  } catch (err) {
    running.delete(id);
    console.error(`[bcc] ${id} failed to start`, err);
    toast(`${def.title} failed: ${err?.message ?? err}`);
    throw err;
  }
  emit();
  return entry.instance;
}

/** reason: 'api' | 'close' (panel ✕) | 'pagehide' (navigation) | 'unload' (BCC.unload). Tools may keep state across 'pagehide'. */
export function stop(id, reason = 'api') {
  const entry = running.get(id);
  if (!entry) return false;
  running.delete(id);            // before calling stop, so re-entrant panel.close → stop is a no-op
  try { entry.instance?.stop?.(reason); } catch (err) { console.warn(`[bcc] ${id} stop threw`, err); }
  try { entry.panel?.close(); } catch { /* ignore */ }
  emit();
  return true;
}

export function toggle(id) { return running.has(id) ? stop(id) : start(id); }

export function stopAll(reason = 'unload') { for (const id of [...running.keys()]) stop(id, reason); }

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

let pagehideBound = false;
export function bindLifecycle() {
  if (pagehideBound) return;
  pagehideBound = true;
  addEventListener('pagehide', () => stopAll('pagehide'), { capture: true });
}

export const registry = { registerTool, get, all, list, start, stop, toggle, stopAll, isRunning, runningIds, instance, onChange, GROUPS };
