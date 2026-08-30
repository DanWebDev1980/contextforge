// Observes the GA4 traffic a page actually produces.
//
// Scope note: this reads what the page *sends* — dataLayer pushes, gtag() calls
// and /g/collect hits. It does not read GA4 *reports*; that needs the Data API
// and OAuth, which is a different (server-side) tool. For checking that a change
// still fires the right events with the right params, this is the useful half.

const COLLECT = /google-analytics\.com\/(g\/collect|mp\/collect)|analytics\.google\.com\/g\/collect/;

/** GA4 encodes events as query params; decode them into something readable. */
export function parseCollect(url, body) {
  const events = [];
  const base = new URL(url, location.href);
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
    page: shared.dl ?? location.href,
    at: new Date().toISOString(),
    transport: 'collect',
  }));
}

/**
 * Patch the three ways a page can send a beacon, plus dataLayer.push.
 * Returns a stop() that restores every original — leaving these patched after
 * the tool closes would be rude to the host app.
 */
export function observe(onEvent) {
  const originals = {
    fetch: window.fetch,
    open: XMLHttpRequest.prototype.open,
    send: XMLHttpRequest.prototype.send,
    beacon: navigator.sendBeacon,
    push: null,
  };

  window.fetch = function patchedFetch(input, init) {
    try {
      const url = typeof input === 'string' ? input : input?.url ?? '';
      if (COLLECT.test(url)) {
        const body = typeof init?.body === 'string' ? init.body : null;
        parseCollect(url, body).forEach(onEvent);
      }
    } catch { /* never let instrumentation break the page */ }
    return originals.fetch.apply(this, arguments);
  };

  XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
    this.__cfUrl = url;
    return originals.open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function patchedSend(body) {
    try {
      if (this.__cfUrl && COLLECT.test(this.__cfUrl)) {
        parseCollect(this.__cfUrl, typeof body === 'string' ? body : null).forEach(onEvent);
      }
    } catch { /* ignore */ }
    return originals.send.apply(this, arguments);
  };

  navigator.sendBeacon = function patchedBeacon(url, data) {
    try {
      if (COLLECT.test(url)) {
        parseCollect(url, typeof data === 'string' ? data : null).forEach(onEvent);
      }
    } catch { /* ignore */ }
    return originals.beacon.apply(navigator, arguments);
  };

  // dataLayer pushes show intent even when the tag never fires
  const dl = (window.dataLayer ||= []);
  originals.push = dl.push;
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
    return originals.push.apply(this, args);
  };

  // replay what already fired before the tool loaded
  const backlog = [...dl].map((entry) => entry?.event && {
    name: entry.event, params: { ...entry, event: undefined }, user: {},
    at: null, transport: 'dataLayer (backlog)',
  }).filter(Boolean);

  return {
    backlog,
    stop() {
      window.fetch = originals.fetch;
      XMLHttpRequest.prototype.open = originals.open;
      XMLHttpRequest.prototype.send = originals.send;
      navigator.sendBeacon = originals.beacon;
      if (originals.push) dl.push = originals.push;
    },
  };
}
