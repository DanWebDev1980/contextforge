// Optional bridge to the local hub (hub/server.mjs). Absent hub = silent no-op.
//
// Console-injected code is exempt from `script-src`, but the fetch() it makes is
// still governed by the page's `connect-src`. Sites with a strict CSP (Figma)
// block this silently — Diagnose's CSP report says whether it will work here.
// Chrome exempts http://localhost from mixed-content blocking, so an https page
// can otherwise reach it. The hub replies `Access-Control-Allow-Origin: *`,
// which is safe because it only ever binds to 127.0.0.1.

export const HUB_BASE = 'http://localhost:7373';
const TIMEOUT = 1200;

let available = null;   // null = untested, true/false once probed
let lastError = null;

async function req(path, options = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(HUB_BASE + path, { ...options, signal: ctl.signal, mode: 'cors' });
    if (!res.ok) throw new Error(`hub ${res.status}`);
    available = true;
    lastError = null;
    return await res.json();
  } catch (err) {
    available = false;
    lastError = err?.message ?? String(err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const hub = {
  get status() { return available; },
  get lastError() { return lastError; },
  ping: () => req('/ping'),
  push: (item, ns = 'basket') => req(`/items?ns=${encodeURIComponent(ns)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(item),
  }),
  pull: async (ns = 'basket') => (await req(`/items?ns=${encodeURIComponent(ns)}`))?.items ?? null,
  clear: (ns = 'basket') => req(`/items?ns=${encodeURIComponent(ns)}`, { method: 'DELETE' }),
  namespaces: async () => (await req('/namespaces'))?.namespaces ?? null,
};
