// Recording helpers: what happened before injection, grouping, and request
// replay against the current environment — the sturdy way to recreate
// server-side state without touching the UI.

import { intercept } from './intercept.js';
import { rewriteOrigin } from '../site.js';
import { urlParts } from '../export/fixtures.js';

/** Requests made before BCC was injected: name/type/duration only, from the performance timeline. */
export function preInjectionResources() {
  try {
    return performance.getEntriesByType('resource')
      .filter((e) => e.initiatorType === 'fetch' || e.initiatorType === 'xmlhttprequest' || e.initiatorType === 'beacon')
      .map((e) => ({ url: e.name, initiator: e.initiatorType, duration: Math.round(e.duration), startedAt: Math.round(e.startTime), pre: true }));
  } catch { return []; }
}

export const endpointKey = (e) => `${e.method} ${urlParts(e.url).pathname}`;

export function groupByEndpoint(entries) {
  const map = new Map();
  for (const e of entries) {
    const k = endpointKey(e);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(e);
  }
  return map;
}

export function matchesFilter(e, { text = '', method = '', status = '' } = {}) {
  if (method && e.method !== method) return false;
  if (status) {
    const s = e.status ?? 0;
    if (status === '2xx' && !(s >= 200 && s < 300)) return false;
    if (status === '3xx' && !(s >= 300 && s < 400)) return false;
    if (status === '4xx' && !(s >= 400 && s < 500)) return false;
    if (status === '5xx' && !(s >= 500)) return false;
    if (status === 'err' && s !== 0) return false;
  }
  if (text) {
    const hay = `${e.method} ${e.url} ${e.status} ${typeof e.responseBody === 'string' ? e.responseBody : JSON.stringify(e.responseBody ?? '')}`.toLowerCase();
    if (!hay.includes(text.toLowerCase())) return false;
  }
  return true;
}

/**
 * Pick auth-ish headers from the most recent live request to the same host,
 * since recorded tokens are stale by definition.
 */
export function freshAuthHeaders(liveEntries, url, names = ['authorization', 'x-api-key', 'x-csrf-token', 'x-xsrf-token']) {
  let host = '';
  try { host = new URL(url).host; } catch { return {}; }
  for (const e of [...liveEntries].reverse()) {
    try { if (new URL(e.url).host !== host) continue; } catch { continue; }
    const out = {};
    for (const n of names) if (e.requestHeaders?.[n]) out[n] = e.requestHeaders[n];
    if (Object.keys(out).length) return out;
  }
  return {};
}

/**
 * Re-send a recorded request. Uses the un-patched fetch so the replay itself is
 * neither recorded nor mocked. Returns a new entry-shaped record.
 */
export async function replayRequest(entry, { targetOrigin = null, body = undefined, headers = {}, strip = ['cookie', 'content-length', 'host', 'origin', 'referer'] } = {}) {
  const url = targetOrigin ? rewriteOrigin(entry.url, targetOrigin) : entry.url;
  const reqHeaders = {};
  for (const [k, v] of Object.entries(entry.requestHeaders ?? {})) if (!strip.includes(k.toLowerCase())) reqHeaders[k] = v;
  Object.assign(reqHeaders, headers);
  const rawBody = body !== undefined ? body : entry.requestBody;
  const sendBody = rawBody == null || ['GET', 'HEAD'].includes(entry.method) ? undefined : typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);
  if (sendBody != null && !Object.keys(reqHeaders).some((k) => k.toLowerCase() === 'content-type')) reqHeaders['content-type'] = /^\s*[[{]/.test(sendBody) ? 'application/json' : 'text/plain';
  const t0 = performance.now();
  const out = { id: `rp_${Date.now().toString(36)}`, method: entry.method, url, requestHeaders: reqHeaders, requestBody: sendBody ?? null, transport: 'replay', startedAt: new Date().toISOString(), replayOf: entry.id };
  try {
    const res = await intercept.rawFetch(url, { method: entry.method, headers: reqHeaders, body: sendBody, credentials: 'include' });
    const text = await res.text();
    let parsed = text; let type = 'text';
    try { parsed = JSON.parse(text); type = 'json'; } catch { /* text */ }
    const responseHeaders = {}; res.headers.forEach((v, k) => { responseHeaders[k] = v; });
    Object.assign(out, { status: res.status, statusText: res.statusText, responseHeaders, responseBody: parsed, responseType: type, duration: Math.round(performance.now() - t0), endedAt: new Date().toISOString() });
  } catch (err) {
    Object.assign(out, { status: 0, error: err?.message ?? String(err), duration: Math.round(performance.now() - t0), endedAt: new Date().toISOString() });
  }
  return out;
}

/** Replay a sequence in order; stops at the first failure unless `continueOnError`. */
export async function replaySequence(entries, opts = {}, { continueOnError = false, onStep = () => {} } = {}) {
  const results = [];
  for (const e of entries) {
    const r = await replayRequest(e, opts);
    results.push(r);
    onStep(r, results.length - 1);
    if (!continueOnError && (r.status === 0 || r.status >= 400)) break;
  }
  return results;
}
