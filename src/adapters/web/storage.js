// Read and write the three storage areas a checkpoint covers: localStorage,
// sessionStorage, document.cookie. Strings as stored — no parsing.
//
// Limits: HttpOnly cookies are invisible to JavaScript (auth cookies usually
// are). document.cookie yields name=value only; path/domain/expiry are not
// readable, so restore writes `path=/` and a session cookie unless told otherwise.

import { PREFIX } from '../../core/store/store.js';

const isOurKey = (k) => k.startsWith(PREFIX);

export function readArea(area) {
  const store = area === 'session' ? sessionStorage : localStorage;
  const out = {};
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k == null || isOurKey(k)) continue;
      out[k] = store.getItem(k);
    }
  } catch { /* storage disabled */ }
  return out;
}

export function parseCookies(text = document.cookie) {
  if (!text) return [];
  return text.split(';').map((part) => {
    const i = part.indexOf('=');
    const name = (i < 0 ? part : part.slice(0, i)).trim();
    const value = i < 0 ? '' : part.slice(i + 1).trim();
    return name ? { name, value, path: null, domain: null, expires: null, sameSite: null } : null;
  }).filter(Boolean);
}

/** Everything a checkpoint can capture from this page, right now. */
export function snapshot() {
  return {
    storage: { local: readArea('local'), session: readArea('session') },
    cookies: parseCookies(),
    url: { origin: location.origin, path: location.pathname, search: location.search, hash: location.hash },
    scroll: { x: Math.round(scrollX), y: Math.round(scrollY) },
    meta: { title: document.title, userAgent: navigator.userAgent, viewport: `${innerWidth}×${innerHeight}` },
  };
}

/** Write an area. mode 'replace' clears app keys first (never bcc:* keys); 'merge' overlays. */
export function writeArea(area, values, { mode = 'replace' } = {}) {
  const store = area === 'session' ? sessionStorage : localStorage;
  const written = [];
  try {
    if (mode === 'replace') {
      for (const k of Object.keys(readArea(area))) store.removeItem(k);
    }
    for (const [k, v] of Object.entries(values ?? {})) {
      if (isOurKey(k)) continue;
      store.setItem(k, v == null ? '' : String(v));
      written.push(k);
    }
  } catch (err) { console.warn(`[bcc] write ${area} failed:`, err.message); }
  return written;
}

export function writeCookies(cookies, { mode = 'replace' } = {}) {
  const written = [];
  if (mode === 'replace') for (const c of parseCookies()) deleteCookie(c.name);
  for (const c of cookies ?? []) {
    if (!c?.name) continue;
    let s = `${c.name}=${c.value ?? ''}; path=${c.path ?? '/'}`;
    if (c.domain) s += `; domain=${c.domain}`;
    if (c.expires) s += `; expires=${new Date(c.expires).toUTCString()}`;
    if (c.sameSite) s += `; samesite=${c.sameSite}`;
    if (location.protocol === 'https:' && (c.secure || /^(none)$/i.test(c.sameSite ?? ''))) s += '; secure';
    try { document.cookie = s; written.push(c.name); } catch { /* ignore */ }
  }
  return written;
}

export function deleteCookie(name, { path = '/', domain = null } = {}) {
  const base = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${path}`;
  document.cookie = base;
  if (domain) document.cookie = `${base}; domain=${domain}`;
  // also try the parent domain, where many apps set them
  const parts = location.hostname.split('.');
  if (parts.length > 2) document.cookie = `${base}; domain=.${parts.slice(-2).join('.')}`;
}

export function setItem(area, key, value) {
  const store = area === 'session' ? sessionStorage : localStorage;
  store.setItem(key, value);
}
export function removeItem(area, key) {
  const store = area === 'session' ? sessionStorage : localStorage;
  store.removeItem(key);
}

export const byteSize = (s) => (s == null ? 0 : new Blob([String(s)]).size);
export const humanSize = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Pretty-print JSON-looking values for previews; leave others alone. */
export function preview(value, max = 80) {
  if (value == null) return '';
  const s = String(value).replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// --- watch mode ---------------------------------------------------------------
// Patch Storage.prototype.setItem / removeItem / clear and log every write with
// a stack. "Who keeps resetting this key?" answered in seconds. Restores on stop.

let watchOriginals = null;
let watchPatched = null;
const watchers = new Set();

export function watchStorage(onWrite) {
  watchers.add(onWrite);
  if (!watchOriginals) {
    const proto = Storage.prototype;
    watchOriginals = { setItem: proto.setItem, removeItem: proto.removeItem, clear: proto.clear };
    const areaOf = (store) => (store === sessionStorage ? 'session' : store === localStorage ? 'local' : 'other');
    const emit = (evt) => { for (const fn of watchers) { try { fn(evt); } catch { /* ignore */ } } };
    const stackOf = () => {
      const lines = (new Error().stack ?? '').split('\n').slice(2).map((l) => l.trim()).filter((l) => !/bcc\.js|bccSet|bccRemove|bccClear/.test(l));
      return lines.slice(0, 8).join('\n');
    };
    proto.setItem = function bccSetItem(key, value) {
      if (typeof key === 'string' && !isOurKey(key)) {
        let prev = null;
        try { prev = this.getItem(key); } catch { /* ignore */ }
        emit({ op: 'set', area: areaOf(this), key, value: String(value), prev, at: new Date().toISOString(), stack: stackOf() });
      }
      return watchOriginals.setItem.apply(this, arguments);
    };
    proto.removeItem = function bccRemoveItem(key) {
      if (typeof key === 'string' && !isOurKey(key)) emit({ op: 'remove', area: areaOf(this), key, prev: this.getItem(key), at: new Date().toISOString(), stack: stackOf() });
      return watchOriginals.removeItem.apply(this, arguments);
    };
    proto.clear = function bccClear() {
      emit({ op: 'clear', area: areaOf(this), key: '*', at: new Date().toISOString(), stack: stackOf() });
      return watchOriginals.clear.apply(this, arguments);
    };
    watchPatched = { setItem: proto.setItem, removeItem: proto.removeItem, clear: proto.clear };
  }
  return () => {
    watchers.delete(onWrite);
    if (!watchers.size && watchOriginals) {
      const proto = Storage.prototype;
      // restore only what is still ours (minification renames functions, so compare by reference)
      if (proto.setItem === watchPatched.setItem) proto.setItem = watchOriginals.setItem;
      if (proto.removeItem === watchPatched.removeItem) proto.removeItem = watchOriginals.removeItem;
      if (proto.clear === watchPatched.clear) proto.clear = watchOriginals.clear;
      watchOriginals = null; watchPatched = null;
    }
  };
}
