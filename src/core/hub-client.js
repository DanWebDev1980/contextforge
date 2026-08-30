// Optional bridge to the local hub (hub/server.mjs). Absent hub = silent no-op.
//
// Chrome exempts http://localhost from mixed-content blocking, so an https page
// such as figma.com can talk to it. The hub replies with `Access-Control-Allow-
// Origin: *`, which is safe because it only ever binds to 127.0.0.1.

const BASE = 'http://localhost:7373';
const TIMEOUT = 1200;

let available = null;   // null = untested, true/false once probed

async function req(path, options = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(BASE + path, { ...options, signal: ctl.signal, mode: 'cors' });
    if (!res.ok) throw new Error(`hub ${res.status}`);
    available = true;
    return await res.json();
  } catch {
    available = false;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const hub = {
  get status() { return available; },
  ping: () => req('/ping'),
  push: (item) => req('/items', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(item),
  }),
  pull: async () => (await req('/items'))?.items ?? null,
  clear: () => req('/items', { method: 'DELETE' }),
};
