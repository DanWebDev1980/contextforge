// Observes the GA4 traffic a page actually produces.
//
// Scope note: this reads what the page *sends* — dataLayer pushes, gtag() calls
// and /g/collect hits. It does not read GA4 *reports*; that needs the Data API
// and OAuth, which is a different (server-side) tool. For checking that a change
// still fires the right events with the right params, this is the useful half.
//
// Network hooks come from the shared interceptor (core/net/intercept.js); only
// dataLayer.push is patched here, and restored on stop().

import { subscribe } from '../../core/net/intercept.js';

const COLLECT = /google-analytics\.com\/(g\/collect|mp\/collect)|analytics\.google\.com\/g\/collect/;

/** GA4 encodes events as query params; decode them into something readable. */
export function parseCollect(url, body) {
  const events = [];
  const base = new URL(url, typeof location !== 'undefined' ? location.href : 'http://localhost/');
  const shared = Object.fromEntries(base.searchParams);

  const decodeOne = (params) => {
    const event = { name: params.get('en') ?? shared.en ?? '(page_view)', params: {}, user: {} };
    for (const [key, value] of params) {
      if (key.startsWith('ep.')) event.params[key.slice(3)] = value;
      else if (key.startsWith('epn.')) event.params[key.slice(4)] = Number(value);
      else if (key.startsWith('up.')) event.user[key.slice(3)] = value;
      else if (key.startsWith('upn.')) event.user[key.slice(4)] = Number(value);
    }
    return event;
  };

  if (body && typeof body === 'string' && body.trim()) {
    // batched hits: one urlencoded param string per line
    for (const line of body.split('\n').filter(Boolean)) {
      events.push(decodeOne(new URLSearchParams(line)));
    }
  }
  if (!events.length) events.push(decodeOne(base.searchParams));

  return events.map((e) => ({
    ...e,
    measurementId: shared.tid ?? null,
    page: shared.dl ?? (typeof location !== 'undefined' ? location.href : null),
    at: new Date().toISOString(),
    transport: 'collect',
  }));
}

/**
 * Subscribe to the interceptor for /g/collect hits and patch dataLayer.push.
 * Returns { backlog, stop } — stop() unsubscribes and restores dataLayer.push.
 */
export function observe(onEvent) {
  const seen = new Set();
  const emit = (rec) => {
    try {
      if (!COLLECT.test(rec.url) || seen.has(rec.id)) return;
      seen.add(rec.id);
      parseCollect(rec.url, typeof rec.requestBody === 'string' ? rec.requestBody : null).forEach(onEvent);
    } catch { /* never let instrumentation break the page */ }
  };
  const unsubscribe = subscribe({
    request: (rec) => { emit(rec); return null; },
    beacon: ({ url, body }) => { try { if (COLLECT.test(url)) parseCollect(url, body).forEach(onEvent); } catch { /* ignore */ } },
  });

  // dataLayer pushes show intent even when the tag never fires
  const dl = (window.dataLayer ||= []);
  const originalPush = dl.push;
  dl.push = function patchedPush(...args) {
    for (const arg of args) {
      try {
        const name = arg?.event ?? (Array.isArray(arg) && arg[0] === 'event' ? arg[1] : null);
        if (name) {
          onEvent({
            name,
            params: Array.isArray(arg) ? (arg[2] ?? {}) : { ...arg, event: undefined },
            user: {},
            at: new Date().toISOString(),
            transport: 'dataLayer',
          });
        }
      } catch { /* ignore */ }
    }
    return originalPush.apply(this, args);
  };

  // replay what already fired before the tool loaded
  const backlog = [...dl].map((entry) => entry?.event && {
    name: entry.event, params: { ...entry, event: undefined }, user: {},
    at: null, transport: 'dataLayer (backlog)',
  }).filter(Boolean);

  return {
    backlog,
    stop() {
      unsubscribe();
      if (dl.push === arguments.callee?.patchedPush) { /* noop */ }
      if (window.dataLayer === dl) dl.push = originalPush;
    },
  };
}
