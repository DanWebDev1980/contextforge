// The "basket": everything you have collected, from any tool, on this origin.
//
// localStorage is per-origin, so a Figma capture and an Octane story cannot
// share one basket automatically. Two escape hatches:
//   1. Copy/Paste JSON — always works, zero infrastructure.
//   2. The optional local hub (`npm run hub`) — if it is reachable, every write
//      is mirrored to it and `pull()` merges everything from every origin.

import { hub } from './hub-client.js';

const KEY = 'contextforge:basket:v1';

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function write(items) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch (err) {
    console.warn('[contextforge] could not persist basket:', err.message);
  }
  listeners.forEach((fn) => fn(items));
  return items;
}

const listeners = new Set();

export const basket = {
  all: () => read(),

  /** Add an item. Mirrors to the hub when one is running; never blocks on it. */
  add(item) {
    const entry = {
      id: item.id || `it_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      addedAt: new Date().toISOString(),
      origin: location.origin,
      ...item,
    };
    write([...read(), entry]);
    hub.push(entry);
    return entry;
  },

  remove(id) { return write(read().filter((i) => i.id !== id)); },
  clear() { return write([]); },
  replaceAll(items) { return write(items); },

  /** Merge items in, keyed by id, newest wins. Used by paste-JSON and hub pull. */
  merge(items) {
    const byId = new Map(read().map((i) => [i.id, i]));
    for (const i of items) byId.set(i.id, i);
    return write([...byId.values()].sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || '')));
  },

  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
