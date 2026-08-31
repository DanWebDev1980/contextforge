// Entry: migrate storage, register tools, mount the dock, bind the hotkey,
// expose window.BCC. Pasting the bundle twice unloads the first copy first.

import { migrate } from '../core/store/migrate.js';
import { stores, basket, Store, kv } from '../core/store/store.js';
import { unloadOverlay, toast, HOST_ID } from '../core/overlay/ui.js';
import { hub } from '../core/hub-client.js';
import { intercept } from '../core/net/intercept.js';
import { detectSite, describeOrigin } from '../core/site.js';
import * as registry from './registry.js';
import { openPalette, closePalette, togglePalette, isOpen as paletteOpen } from './palette.js';
import { mountDock, addMenuSection } from './dock.js';
import * as settings from './settings.js';

/* global __BCC_VERSION__, __BCC_BUILT__ */
export const VERSION = typeof __BCC_VERSION__ !== 'undefined' ? __BCC_VERSION__ : 'dev';
export const BUILT = typeof __BCC_BUILT__ !== 'undefined' ? __BCC_BUILT__ : new Date().toISOString().slice(0, 10);

const PENDING_SCROLL = 'bcc:pending-scroll';
const VERSION_KEY = 'bcc:version';

let hotkeyHandler = null;
let dock = null;
let booted = false;

function bindHotkey() {
  if (hotkeyHandler) removeEventListener('keydown', hotkeyHandler, true);
  hotkeyHandler = (e) => {
    if (settings.matchesHotkey(e, settings.get('hotkey'))) {
      e.preventDefault(); e.stopPropagation();
      togglePalette();
    } else if (e.key === 'Escape' && paletteOpen()) {
      e.preventDefault(); e.stopPropagation();
      closePalette();
    }
  };
  addEventListener('keydown', hotkeyHandler, true);
}

function restorePendingScroll() {
  try {
    const raw = sessionStorage.getItem(PENDING_SCROLL);
    if (!raw) return;
    sessionStorage.removeItem(PENDING_SCROLL);
    const { x, y, path } = JSON.parse(raw);
    if (path && path !== location.pathname) return;
    const go = () => scrollTo(x ?? 0, y ?? 0);
    go(); setTimeout(go, 150); setTimeout(go, 600);
  } catch { /* ignore */ }
}

/**
 * Boot BCC with a set of tool definitions.
 * `autoStart` (an id) is used by the --split build so each per-tool bundle
 * behaves like the old single-tool paste.
 */
export function boot({ tools = [], autoStart = null, quiet = false } = {}) {
  if (window.BCC?.unload && window.BCC.__booted) {
    try { window.BCC.unload({ silent: true }); } catch { /* ignore */ }
  }
  const migrated = migrate();
  for (const def of tools) { if (def && !registry.get(def.id)) registry.registerTool(def); }
  registry.bindLifecycle();
  bindHotkey();
  settings.settings.onChange(() => bindHotkey());

  dock = mountDock({ version: VERSION, built: BUILT, onUnload: () => api.unload() });

  try { localStorage.setItem(VERSION_KEY, JSON.stringify({ version: VERSION, built: BUILT, at: new Date().toISOString() })); } catch { /* ignore */ }

  const api = {
    __booted: true,
    version: VERSION,
    built: BUILT,
    site: detectSite(),
    // registry
    tools: () => registry.list().map((t) => ({ id: t.id, title: t.title, group: t.group, running: registry.isRunning(t.id) })),
    start: (id, options) => registry.start(id, options),
    stop: (id) => registry.stop(id),
    toggle: (id) => registry.toggle(id),
    running: () => registry.runningIds(),
    instance: (id) => registry.instance(id),
    registry,
    palette: { open: openPalette, close: closePalette, toggle: togglePalette },
    dock: { menuSection: addMenuSection, refresh: () => dock?.refresh() },
    // data
    store: basket, basket, stores, Store, kv,
    settings,
    hub,
    intercept,
    whereami: () => describeOrigin(settings.get('envMap')),
    unload({ silent = false } = {}) {
      registry.stopAll();
      dock?.destroy(); dock = null;
      closePalette();
      unloadOverlay();
      if (hotkeyHandler) { removeEventListener('keydown', hotkeyHandler, true); hotkeyHandler = null; }
      if (window.BCC === api) { try { delete window.BCC; } catch { window.BCC = undefined; } }
      if (!silent) console.info('[bcc] unloaded');
    },
  };
  window.BCC = api;
  booted = true;

  restorePendingScroll();
  for (const hook of bootHooks) { try { hook(api); } catch (err) { console.warn('[bcc] boot hook failed', err); } }

  if (autoStart) {
    try { registry.start(autoStart); } catch { /* toasted */ }
  } else if (!quiet) {
    const hk = settings.formatHotkey(settings.get('hotkey'));
    toast(`BCC ${VERSION} ready · ${hk} for the palette${migrated.length ? ' · migrated contextforge basket' : ''}`, 2600);
  }
  return api;
}

/** Modules that must run at boot (pending journey resume, mock engine) register here. */
const bootHooks = [];
export function onBoot(fn) { bootHooks.push(fn); }

export { HOST_ID, PENDING_SCROLL };
