// ONE shared fetch / XHR / sendBeacon patch. ga4, the network recorder and mock
// mode all subscribe here instead of patching on their own — three independent
// patches would stack and restore in the wrong order.
//
// Patched when the first subscriber arrives (i.e. after the app has booted, so
// we sit on top of the app's own instrumentation), restored when the last one
// leaves — unless someone else patched over us in the meantime, in which case
// we leave the chain alone rather than tear a stranger's patch out.
//
// Subscriber shape (all optional):
//   request(rec)  → may return a mock { status, headers, body, delay, drop }; first wins
//   response(rec) → rec now carries status / responseHeaders / responseBody / duration / mocked
//   beacon({ url, body, at })
//
// Known-bad: apps that captured `window.fetch` into a closure at boot bypass
// this entirely. The recorder's pre-injection list makes that visible.

const subs = new Set();
let originals = null;
let patchedRefs = null;
let seq = 0;
const MAX_BODY = 512 * 1024;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function headersToObject(h) {
  const out = {};
  if (!h) return out;
  try {
    if (typeof Headers !== 'undefined' && h instanceof Headers) { h.forEach((v, k) => { out[k.toLowerCase()] = v; }); return out; }
    if (Array.isArray(h)) { for (const [k, v] of h) out[String(k).toLowerCase()] = String(v); return out; }
    if (typeof h === 'object') { for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v); }
  } catch { /* ignore */ }
  return out;
}

export function bodyToText(body) {
  if (body == null) return null;
  if (typeof body === 'string') return body.length > MAX_BODY ? `${body.slice(0, MAX_BODY)}…‹truncated›` : body;
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return body.toString();
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const pairs = [];
    body.forEach((v, k) => pairs.push(`${k}=${typeof v === 'string' ? v : `‹file ${v.name ?? ''} ${v.size ?? ''}b›`}`));
    return pairs.join('&');
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) return `‹blob ${body.type || 'binary'} ${body.size}b›`;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return `‹binary ${body.byteLength}b›`;
  try { return JSON.stringify(body); } catch { return String(body); }
}

function absolute(url) {
  try { return new URL(url, location.href).toString(); } catch { return String(url); }
}

function record(method, url, headers, body, transport) {
  return {
    id: `rq_${(++seq).toString(36)}_${Date.now().toString(36)}`,
    method: String(method || 'GET').toUpperCase(),
    url: absolute(url),
    requestHeaders: headers,
    requestBody: body,
    transport,
    startedAt: new Date().toISOString(),
    _t0: now(),
  };
}

function askMock(rec) {
  let mock = null;
  for (const s of subs) {
    try { const m = s.request?.(rec); if (m && !mock) mock = m; } catch (e) { console.warn('[bcc] intercept subscriber threw', e); }
  }
  return mock;
}

function finish(rec, extra) {
  Object.assign(rec, extra, { endedAt: new Date().toISOString(), duration: Math.round(now() - rec._t0) });
  for (const s of subs) { try { s.response?.(rec); } catch (e) { console.warn('[bcc] intercept subscriber threw', e); } }
}

/** Read a Response body without disturbing the page's copy. */
async function describeResponse(res) {
  const responseHeaders = headersToObject(res.headers);
  const type = (responseHeaders['content-type'] ?? '').toLowerCase();
  let responseBody = null;
  let responseType = 'text';
  try {
    if (/json|text|xml|javascript|x-www-form|html|csv/.test(type) || !type) {
      const text = await res.text();
      responseBody = text.length > MAX_BODY ? `${text.slice(0, MAX_BODY)}…‹truncated›` : text;
      if (/json/.test(type) || (!type && /^\s*[[{]/.test(text))) {
        responseType = 'json';
        try { responseBody = JSON.parse(text); } catch { responseType = 'text'; }
      }
    } else {
      const buf = await res.arrayBuffer();
      responseType = 'binary';
      responseBody = `‹binary ${type} ${buf.byteLength}b›`;
    }
  } catch { responseBody = null; }
  return { status: res.status, statusText: res.statusText, responseHeaders, responseBody, responseType };
}

function mockResponse(mock) {
  const headers = { 'content-type': 'application/json', ...(mock.headers ?? {}) };
  const body = mock.body == null ? '' : typeof mock.body === 'string' ? mock.body : JSON.stringify(mock.body);
  return { status: mock.status ?? 200, statusText: mock.statusText ?? '', headers, body };
}

function patch() {
  originals = {
    fetch: window.fetch,
    open: XMLHttpRequest.prototype.open,
    send: XMLHttpRequest.prototype.send,
    setRequestHeader: XMLHttpRequest.prototype.setRequestHeader,
    beacon: navigator.sendBeacon,
  };

  const patchedFetch = async function bccFetch(input, init) {
    let rec;
    try {
      const isReq = typeof Request !== 'undefined' && input instanceof Request;
      const url = isReq ? input.url : String(input);
      const method = init?.method ?? (isReq ? input.method : 'GET');
      const headers = { ...(isReq ? headersToObject(input.headers) : {}), ...headersToObject(init?.headers) };
      let body = init?.body;
      if (body === undefined && isReq && input.body && !input.bodyUsed) {
        try { body = await input.clone().text(); } catch { body = null; }
      }
      rec = record(method, url, headers, bodyToText(body), 'fetch');
    } catch { rec = null; }

    if (rec) {
      const mock = askMock(rec);
      if (mock) {
        if (mock.delay) await sleep(mock.delay);
        if (mock.drop) {
          finish(rec, { status: 0, error: 'dropped by BCC mock', mocked: true });
          throw new TypeError('Failed to fetch (dropped by BCC mock)');
        }
        const m = mockResponse(mock);
        const res = new Response(m.body, { status: m.status, statusText: m.statusText, headers: m.headers });
        describeResponse(res.clone()).then((d) => finish(rec, { ...d, mocked: true }));
        return res;
      }
    }

    let res;
    try {
      res = await originals.fetch.apply(this, arguments);
    } catch (err) {
      if (rec) finish(rec, { status: 0, error: err?.message ?? String(err), mocked: false });
      throw err;
    }
    if (rec) {
      try { describeResponse(res.clone()).then((d) => finish(rec, { ...d, mocked: false })); }
      catch { finish(rec, { status: res.status, mocked: false }); }
    }
    return res;
  };

  XMLHttpRequest.prototype.open = function bccOpen(method, url) {
    try { this.__bcc = { method, url, headers: {} }; } catch { /* ignore */ }
    return originals.open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function bccSetHeader(k, v) {
    try { if (this.__bcc) this.__bcc.headers[String(k).toLowerCase()] = String(v); } catch { /* ignore */ }
    return originals.setRequestHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function bccSend(body) {
    const meta = this.__bcc;
    if (!meta) return originals.send.apply(this, arguments);
    const rec = record(meta.method, meta.url, meta.headers, bodyToText(body), 'xhr');
    const xhr = this;
    const mock = askMock(rec);
    if (mock) {
      const deliver = () => {
        if (mock.drop) {
          define(xhr, { readyState: 4, status: 0, statusText: '', responseText: '', response: '' });
          finish(rec, { status: 0, error: 'dropped by BCC mock', mocked: true });
          xhr.dispatchEvent(new Event('readystatechange'));
          xhr.dispatchEvent(new ProgressEvent('error'));
          xhr.dispatchEvent(new ProgressEvent('loadend'));
          return;
        }
        const m = mockResponse(mock);
        const wantsJson = xhr.responseType === 'json';
        let response = m.body;
        if (wantsJson) { try { response = JSON.parse(m.body); } catch { response = null; } }
        define(xhr, {
          readyState: 4, status: m.status, statusText: m.statusText,
          responseText: wantsJson ? undefined : m.body, response, responseURL: rec.url,
          getResponseHeader: (k) => m.headers[String(k).toLowerCase()] ?? null,
          getAllResponseHeaders: () => Object.entries(m.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n'),
        });
        finish(rec, {
          status: m.status, statusText: m.statusText, responseHeaders: m.headers,
          responseBody: safeJson(m.body), responseType: 'json', mocked: true,
        });
        xhr.dispatchEvent(new Event('readystatechange'));
        xhr.dispatchEvent(new ProgressEvent('load'));
        xhr.dispatchEvent(new ProgressEvent('loadend'));
      };
      setTimeout(deliver, mock.delay ?? 0);
      return undefined;
    }
    try {
      xhr.addEventListener('loadend', () => {
        let responseBody = null;
        let responseType = 'text';
        try {
          if (xhr.responseType === '' || xhr.responseType === 'text') {
            responseBody = xhr.responseText;
            const parsed = safeJson(responseBody);
            if (parsed !== responseBody) { responseBody = parsed; responseType = 'json'; }
          } else if (xhr.responseType === 'json') { responseBody = xhr.response; responseType = 'json'; }
          else responseBody = `‹${xhr.responseType}›`;
        } catch { responseBody = null; }
        const responseHeaders = {};
        try {
          for (const line of (xhr.getAllResponseHeaders() || '').trim().split(/[\r\n]+/)) {
            const i = line.indexOf(':');
            if (i > 0) responseHeaders[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
          }
        } catch { /* ignore */ }
        finish(rec, { status: xhr.status, statusText: xhr.statusText, responseHeaders, responseBody, responseType, mocked: false, error: xhr.status === 0 ? 'network error' : undefined });
      });
    } catch { /* ignore */ }
    return originals.send.apply(this, arguments);
  };

  const patchedBeacon = function bccBeacon(url, data) {
    for (const s of subs) { try { s.beacon?.({ url: absolute(url), body: bodyToText(data), at: new Date().toISOString() }); } catch { /* ignore */ } }
    return originals.beacon.apply(navigator, arguments);
  };

  window.fetch = patchedFetch;
  navigator.sendBeacon = patchedBeacon;
  patchedRefs = { fetch: patchedFetch, beacon: patchedBeacon, open: XMLHttpRequest.prototype.open, send: XMLHttpRequest.prototype.send, setRequestHeader: XMLHttpRequest.prototype.setRequestHeader };
}

function safeJson(text) {
  if (typeof text !== 'string' || !/^\s*[[{"]/.test(text)) return text;
  try { return JSON.parse(text); } catch { return text; }
}

function define(obj, props) {
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    try { Object.defineProperty(obj, k, { value: v, configurable: true, writable: true }); } catch { /* ignore */ }
  }
}

function unpatch() {
  if (!originals) return;
  // Only restore what is still ours; someone patching over us keeps their chain.
  if (window.fetch === patchedRefs.fetch) window.fetch = originals.fetch;
  if (navigator.sendBeacon === patchedRefs.beacon) navigator.sendBeacon = originals.beacon;
  if (XMLHttpRequest.prototype.open === patchedRefs.open) XMLHttpRequest.prototype.open = originals.open;
  if (XMLHttpRequest.prototype.send === patchedRefs.send) XMLHttpRequest.prototype.send = originals.send;
  if (XMLHttpRequest.prototype.setRequestHeader === patchedRefs.setRequestHeader) XMLHttpRequest.prototype.setRequestHeader = originals.setRequestHeader;
  originals = null;
  patchedRefs = null;
}

/** Subscribe. Returns an unsubscribe function. */
export function subscribe(sub) {
  subs.add(sub);
  if (!originals) patch();
  return () => {
    subs.delete(sub);
    if (!subs.size) unpatch();
  };
}

export const intercept = {
  subscribe,
  get active() { return !!originals; },
  get subscribers() { return subs.size; },
  /** The un-patched fetch, for our own traffic (replay, hub) so it is never recorded or mocked. */
  get rawFetch() { return (originals?.fetch ?? window.fetch).bind(window); },
};
