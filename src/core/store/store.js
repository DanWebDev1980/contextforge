// Namespaced persistence. Every collection BCC keeps — basket, checkpoints,
// recordings, journeys, mock rules — is a `Store(name)` over one localStorage
// key, `bcc:<name>:v1`. Settings use `kv('settings')`, a flat key/value bag on
// the same scheme.
//
// localStorage is per-origin, so a Figma capture and an Octane story cannot
// share one store automatically. Escape hatches, in order: file export/import
// (always works), copy/paste JSON, and the optional local hub (`npm run hub`),
// which every mirrored store pushes to when it is reachable.

import { hub } from '../hub-client.js';

export const PREFIX = 'bcc:';
export const VERSION = 'v1';

export const keyFor = (name) => `${PREFIX}${name}:${VERSION}`;

const newId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

function safeParse(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

/** All stores, so a `storage` event from another tab can fan out. */
const registry = new Map();
let crossTab = false;
function ensureCrossTab() {
  if (crossTab || typeof addEventListener !== 'function') return;
  crossTab = true;
  addEventListener('storage', (e) => {
    const store = e.key && registry.get(e.key);
    if (store) store._emit();
  });
}

export class Store {
  /**
   * @param {string} name   namespace, e.g. 'basket'
   * @param {{ mirror?: boolean, idPrefix?: string, sortBy?: string }} opts
   *   mirror: also push writes to the hub when one is running
   */
  constructor(name, { mirror = false, idPrefix = 'it', sortBy = 'addedAt' } = {}) {
    this.name = name;
    this.key = keyFor(name);
    this.mirror = mirror;
    this.idPrefix = idPrefix;
    this.sortBy = sortBy;
    this.listeners = new Set();
    registry.set(this.key, this);
    ensureCrossTab();
  }

  all() {
    const items = safeParse(localStorage.getItem(this.key), []);
    return Array.isArray(items) ? items : [];
  }

  get(id) { return this.all().find((i) => i.id === id) ?? null; }

  count() { return this.all().length; }

  _write(items) {
    try {
      localStorage.setItem(this.key, JSON.stringify(items));
    } catch (err) {
      console.warn(`[bcc] could not persist ${this.name}:`, err.message);
    }
    this._emit(items);
    return items;
  }

  _emit(items = this.all()) {
    this.listeners.forEach((fn) => { try { fn(items); } catch (e) { console.warn('[bcc] listener threw', e); } });
  }

  /** Add an item. Mirrors to the hub when one is running; never blocks on it. */
  add(item) {
    const entry = {
      id: item.id || newId(this.idPrefix),
      addedAt: new Date().toISOString(),
      origin: typeof location !== 'undefined' ? location.origin : null,
      ...item,
    };
    this._write([...this.all(), entry]);
    if (this.mirror) hub.push(entry, this.name);
    return entry;
  }

  /** Shallow-patch one item by id. Returns the updated item or null. */
  update(id, patch) {
    let updated = null;
    const items = this.all().map((i) => {
      if (i.id !== id) return i;
      updated = { ...i, ...(typeof patch === 'function' ? patch(i) : patch), updatedAt: new Date().toISOString() };
      return updated;
    });
    if (updated) {
      this._write(items);
      if (this.mirror) hub.push(updated, this.name);
    }
    return updated;
  }

  remove(id) {
    const ids = Array.isArray(id) ? new Set(id) : new Set([id]);
    return this._write(this.all().filter((i) => !ids.has(i.id)));
  }

  clear() { return this._write([]); }
  replaceAll(items) { return this._write(items); }

  /** Merge items in, keyed by id, newest wins. Used by paste-JSON, file import and hub pull. */
  merge(items) {
    const byId = new Map(this.all().map((i) => [i.id, i]));
    let added = 0;
    for (const i of items) {
      if (!i || typeof i !== 'object') continue;
      const id = i.id || newId(this.idPrefix);
      const prev = byId.get(id);
      if (prev && (prev.updatedAt ?? prev.addedAt ?? '') > (i.updatedAt ?? i.addedAt ?? '')) continue;
      if (!prev) added += 1;
      byId.set(id, { ...i, id });
    }
    const sorted = [...byId.values()].sort((a, b) => String(a[this.sortBy] ?? '').localeCompare(String(b[this.sortBy] ?? '')));
    this._write(sorted);
    return { total: sorted.length, added };
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** Portable envelope. `filter` narrows to a selection; `map` lets callers redact. */
  export({ ids = null, map = (x) => x } = {}) {
    const items = this.all().filter((i) => !ids || ids.includes(i.id)).map(map);
    return {
      kind: 'bcc-export',
      namespace: this.name,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      origin: typeof location !== 'undefined' ? location.origin : null,
      count: items.length,
      items,
    };
  }

  /** Accepts an envelope from export(), a bare array, or the JSON text of either. */
  import(payload) {
    const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const items = Array.isArray(data) ? data : data?.items;
    if (!Array.isArray(items)) throw new Error('not a BCC export (expected an array or { items })');
    if (data?.namespace && data.namespace !== this.name) {
      throw new Error(`this file holds "${data.namespace}" items, not "${this.name}"`);
    }
    return this.merge(items);
  }
}

/**
 * Flat key/value bag on the same key scheme — for settings. Values are plain
 * JSON. `get` takes a default so callers never see undefined.
 */
export function kv(name) {
  const key = keyFor(name);
  const listeners = new Set();
  const read = () => {
    const obj = safeParse(localStorage.getItem(key), {});
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  };
  const write = (obj) => {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (err) { console.warn(`[bcc] could not persist ${name}:`, err.message); }
    listeners.forEach((fn) => { try { fn(obj); } catch { /* ignore */ } });
    return obj;
  };
  const api = {
    key,
    all: read,
    get: (k, dflt) => { const v = read()[k]; return v === undefined ? dflt : v; },
    set: (k, v) => write({ ...read(), [k]: v }),
    patch: (obj) => write({ ...read(), ...obj }),
    delete: (k) => { const o = read(); delete o[k]; return write(o); },
    replaceAll: (obj) => write(obj ?? {}),
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    _emit: () => listeners.forEach((fn) => { try { fn(read()); } catch { /* ignore */ } }),
  };
  registry.set(key, api);
  ensureCrossTab();
  return api;
}

/** The context basket — every capture from every tool on this origin. */
export const basket = new Store('basket', { mirror: true, idPrefix: 'it' });
export const checkpoints = new Store('checkpoints', { idPrefix: 'cp', sortBy: 'createdAt' });
export const recordings = new Store('recordings', { idPrefix: 'rec', sortBy: 'createdAt' });
export const journeys = new Store('journeys', { idPrefix: 'jr', sortBy: 'createdAt' });
export const mocks = new Store('mocks', { idPrefix: 'mk', sortBy: 'createdAt' });

export const stores = { basket, checkpoints, recordings, journeys, mocks };
