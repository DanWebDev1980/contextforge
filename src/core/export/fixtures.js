// Turn recorded traffic into test fixtures: MSW handlers, Playwright routes,
// plain JSON fixtures, an "API contract" markdown section, curl, HAR 1.2.
// Pure functions over recording entries:
//   { method, url, status, requestHeaders, requestBody, responseHeaders, responseBody, responseType, duration, startedAt }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC = /^\d+$/;
const HASHY = /^[0-9a-f]{16,}$/i;

const singular = (s) => s.replace(/ies$/, 'y').replace(/s$/, '');
const camel = (s) => s.replace(/[-_\s]+(.)/g, (_, c) => c.toUpperCase()).replace(/[^\w]/g, '');

/** /api/invoices/123/lines/abc-uuid → /api/invoices/:invoiceId/lines/:lineId */
export function parameterize(pathname) {
  const segs = pathname.split('/');
  const params = [];
  const out = segs.map((seg, i) => {
    if (!seg) return seg;
    if (NUMERIC.test(seg) || UUID.test(seg) || HASHY.test(seg)) {
      const prev = segs[i - 1];
      let name = prev && !/^v\d+$/.test(prev) && !/^:/.test(prev) ? `${camel(singular(prev))}Id` : 'id';
      if (params.includes(name)) name = `${name}${params.length + 1}`;
      params.push(name);
      return `:${name}`;
    }
    return seg;
  });
  return { path: out.join('/'), params };
}

export function urlParts(url) {
  try {
    const u = new URL(url, 'http://localhost/');
    return { origin: u.origin, pathname: u.pathname, search: u.search, query: Object.fromEntries(u.searchParams) };
  } catch { return { origin: '', pathname: String(url), search: '', query: {} }; }
}

const STRIP_DEFAULT = ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'proxy-authorization'];
export function stripHeaders(headers = {}, list = STRIP_DEFAULT) {
  const out = {};
  const strip = new Set(list.map((s) => s.toLowerCase()));
  for (const [k, v] of Object.entries(headers ?? {})) if (!strip.has(k.toLowerCase())) out[k] = v;
  return out;
}

const bodyLiteral = (body, indent = '') => {
  if (body == null) return 'null';
  if (typeof body === 'string') return JSON.stringify(body);
  return JSON.stringify(body, null, 2).split('\n').join(`\n${indent}`);
};

/**
 * One entry per method+parameterized path. `latest` is the newest response;
 * `best` prefers the newest 2xx (the happy path a fixture should default to).
 */
export function dedupe(entries) {
  const byKey = new Map();
  for (const e of entries) {
    const { pathname, query } = urlParts(e.url);
    const { path, params } = parameterize(pathname);
    const key = `${e.method} ${path}`;
    const variant = { url: e.url, query, status: e.status, responseBody: e.responseBody, requestBody: e.requestBody, duration: e.duration };
    if (!byKey.has(key)) byKey.set(key, { method: e.method, path, params, origin: urlParts(e.url).origin, latest: e, variants: [variant] });
    else { const g = byKey.get(key); g.latest = e; g.variants.push(variant); }
  }
  for (const g of byKey.values()) {
    const ok = [...g.variants].reverse().find((v) => v.status >= 200 && v.status < 300);
    g.best = ok ? entries.slice().reverse().find((e) => e.url === ok.url && e.status === ok.status && e.method === g.method) ?? g.latest : g.latest;
  }
  return [...byKey.values()];
}

export function toMSW(entries, { relative = true } = {}) {
  const groups = dedupe(entries);
  const lines = [`import { http, HttpResponse } from 'msw';`, '', 'export const handlers = ['];
  for (const g of groups) {
    const e = g.best;
    const path = relative ? g.path : `${g.origin}${g.path}`;
    const status = e.status || 200;
    const isJson = e.responseType === 'json' || typeof e.responseBody === 'object';
    const body = e.responseBody == null ? null : isJson ? `HttpResponse.json(${bodyLiteral(e.responseBody, '    ')}${status !== 200 ? `, { status: ${status} }` : ''})`
      : `new HttpResponse(${JSON.stringify(String(e.responseBody))}, { status: ${status}, headers: { 'content-type': ${JSON.stringify(e.responseHeaders?.['content-type'] ?? 'text/plain')} } })`;
    const paramsNote = g.params.length ? ` // params: ${g.params.join(', ')}` : '';
    lines.push(`  http.${g.method.toLowerCase()}('${path}', () => {${paramsNote}`);
    lines.push(`    return ${body ?? `new HttpResponse(null, { status: ${status} })`};`);
    lines.push('  }),');
  }
  lines.push('];', '');
  return lines.join('\n');
}

export function toPlaywright(entries) {
  const groups = dedupe(entries);
  const lines = ['// Playwright route mocks — call inside a test with the page object', 'export async function mockApi(page) {'];
  for (const g of groups) {
    const e = g.best;
    const glob = `**${g.path.replace(/:\w+/g, '*')}${g.variants.length > 1 ? '' : ''}`;
    const isJson = e.responseType === 'json' || typeof e.responseBody === 'object';
    lines.push(`  await page.route('${glob}', (route) => {`);
    lines.push(`    if (route.request().method() !== '${g.method}') return route.fallback();`);
    lines.push(`    return route.fulfill({ status: ${e.status || 200}, contentType: ${JSON.stringify(e.responseHeaders?.['content-type'] ?? (isJson ? 'application/json' : 'text/plain'))}, body: ${isJson ? `JSON.stringify(${bodyLiteral(e.responseBody, '      ')})` : JSON.stringify(String(e.responseBody ?? ''))} });`);
    lines.push('  });');
  }
  lines.push('}', '');
  return lines.join('\n');
}

export function toJsonFixtures(entries) {
  const out = {};
  for (const g of dedupe(entries)) {
    const key = `${g.method} ${g.path}`;
    out[key] = {
      method: g.method,
      path: g.path,
      params: g.params,
      status: g.best.status,
      response: g.best.responseBody,
      request: g.best.requestBody ?? undefined,
      variants: g.variants.length > 1 ? g.variants.map((v) => ({ query: v.query, status: v.status, response: v.responseBody })) : undefined,
    };
  }
  return JSON.stringify(out, null, 2);
}

function shape(value, depth = 0) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `${value.length ? shape(value[0], depth + 1) : 'unknown'}[]`;
  if (typeof value === 'object') {
    if (depth > 3) return 'object';
    const keys = Object.keys(value);
    const inner = keys.slice(0, 12).map((k) => `${k}: ${shape(value[k], depth + 1)}`).join(', ');
    return `{ ${inner}${keys.length > 12 ? ', …' : ''} }`;
  }
  return typeof value;
}

const truncate = (s, n = 1200) => (s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} more chars)` : s);

/** The most useful thing an AI can get about a backend it cannot see. */
export function toApiMarkdown(entries, { title = 'API contract' } = {}) {
  const groups = dedupe(entries);
  const lines = [`#### ${title}`, '', `${groups.length} endpoint(s) from ${entries.length} recorded request(s).`, ''];
  for (const g of groups) {
    const e = g.best;
    lines.push(`**\`${g.method} ${g.path}\`** → ${e.status ?? '?'}${e.duration != null ? ` · ${e.duration} ms` : ''}${e.mocked ? ' · mocked' : ''}`);
    if (g.params.length) lines.push(`- params: ${g.params.map((p) => `\`${p}\``).join(', ')}`);
    const qs = Object.keys(g.variants[0]?.query ?? {});
    if (qs.length) lines.push(`- query: ${qs.map((q) => `\`${q}\``).join(', ')}`);
    if (e.requestBody != null) {
      const rb = typeof e.requestBody === 'string' ? safeJson(e.requestBody) : e.requestBody;
      lines.push(`- request body shape: \`${shape(rb)}\``);
    }
    if (e.responseBody != null) {
      const body = typeof e.responseBody === 'object' ? e.responseBody : safeJson(String(e.responseBody));
      lines.push(`- response shape: \`${shape(body)}\``);
      lines.push('', '```json', truncate(typeof body === 'object' ? JSON.stringify(body, null, 2) : String(body)), '```');
    }
    if (g.variants.length > 1) lines.push(`- ${g.variants.length} variants recorded (statuses: ${[...new Set(g.variants.map((v) => v.status))].join(', ')})`);
    lines.push('');
  }
  return lines.join('\n');
}

function safeJson(s) { try { return JSON.parse(s); } catch { return s; } }

export function toCurl(entry, { includeAuth = false, strip = STRIP_DEFAULT } = {}) {
  const parts = [`curl -X ${entry.method} '${entry.url}'`];
  const headers = includeAuth ? (entry.requestHeaders ?? {}) : stripHeaders(entry.requestHeaders, strip);
  for (const [k, v] of Object.entries(headers)) parts.push(`  -H '${k}: ${String(v).replace(/'/g, "'\\''")}'`);
  if (entry.requestBody != null && entry.requestBody !== '') {
    const body = typeof entry.requestBody === 'string' ? entry.requestBody : JSON.stringify(entry.requestBody);
    parts.push(`  --data-raw '${body.replace(/'/g, "'\\''")}'`);
  }
  return parts.join(' \\\n');
}

export function toHAR(entries, { creator = 'BCC', version = '1', page = null } = {}) {
  const toHeaders = (h = {}) => Object.entries(h).map(([name, value]) => ({ name, value: String(value) }));
  return JSON.stringify({
    log: {
      version: '1.2',
      creator: { name: creator, version },
      pages: page ? [{ startedDateTime: page.startedAt ?? new Date().toISOString(), id: 'page_1', title: page.title ?? '', pageTimings: {} }] : [],
      entries: entries.map((e) => {
        const { query } = urlParts(e.url);
        const resBody = e.responseBody == null ? '' : typeof e.responseBody === 'string' ? e.responseBody : JSON.stringify(e.responseBody);
        const reqBody = e.requestBody == null ? null : typeof e.requestBody === 'string' ? e.requestBody : JSON.stringify(e.requestBody);
        return {
          startedDateTime: e.startedAt ?? new Date().toISOString(),
          time: e.duration ?? 0,
          request: {
            method: e.method, url: e.url, httpVersion: 'HTTP/1.1', cookies: [],
            headers: toHeaders(e.requestHeaders), queryString: Object.entries(query).map(([name, value]) => ({ name, value })),
            postData: reqBody == null ? undefined : { mimeType: e.requestHeaders?.['content-type'] ?? 'application/json', text: reqBody },
            headersSize: -1, bodySize: reqBody?.length ?? 0,
          },
          response: {
            status: e.status ?? 0, statusText: e.statusText ?? '', httpVersion: 'HTTP/1.1', cookies: [],
            headers: toHeaders(e.responseHeaders), redirectURL: '',
            content: { size: resBody.length, mimeType: e.responseHeaders?.['content-type'] ?? (e.responseType === 'json' ? 'application/json' : 'text/plain'), text: resBody },
            headersSize: -1, bodySize: resBody.length,
          },
          cache: {}, timings: { send: 0, wait: e.duration ?? 0, receive: 0 },
          ...(page ? { pageref: 'page_1' } : {}),
        };
      }),
    },
  }, null, 2);
}

export const FIXTURE_FORMATS = [
  { id: 'msw', title: 'MSW handlers', ext: 'js', mime: 'text/javascript', render: toMSW },
  { id: 'playwright', title: 'Playwright routes', ext: 'js', mime: 'text/javascript', render: toPlaywright },
  { id: 'json', title: 'JSON fixtures', ext: 'json', mime: 'application/json', render: toJsonFixtures },
  { id: 'markdown', title: 'API contract (markdown)', ext: 'md', mime: 'text/markdown', render: (e) => toApiMarkdown(e) },
  { id: 'har', title: 'HAR 1.2', ext: 'har', mime: 'application/json', render: (e) => toHAR(e) },
];
