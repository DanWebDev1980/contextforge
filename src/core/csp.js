// Content-Security-Policy analysis: will the hub fetch, a bookmarklet and
// eval work on this page? Header via a same-origin HEAD request (CSP is not a
// forbidden response header), plus any <meta http-equiv>.

export function parseCSP(text) {
  const directives = {};
  for (const part of String(text ?? '').split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const [name, ...values] = tokens;
    directives[name.toLowerCase()] = (directives[name.toLowerCase()] ?? []).concat(values);
  }
  return directives;
}

function sourceAllows(source, origin, pageOrigin) {
  const s = source.replace(/^'|'$/g, '').toLowerCase();
  let u;
  try { u = new URL(origin); } catch { return false; }
  if (s === '*') return true;
  if (s === 'self') return pageOrigin && new URL(pageOrigin).origin === u.origin;
  if (s === 'none') return false;
  if (/^[a-z]+:$/.test(s)) return `${u.protocol}` === s;                       // scheme only, e.g. http:
  // host-source: [scheme://]host[:port][/path]
  const m = s.match(/^(?:([a-z]+):\/\/)?(\*\.)?([^/:]+)(?::(\*|\d+))?/);
  if (!m) return false;
  const [, scheme, wildcardSub, host, port] = m;
  if (scheme && scheme !== u.protocol.replace(':', '') && !(scheme === 'http' && u.protocol === 'https:')) return false;
  const hostOk = wildcardSub ? u.hostname.endsWith(`.${host}`) : u.hostname === host;
  if (!hostOk) return false;
  const pagePort = u.port || (u.protocol === 'https:' ? '443' : '80');
  if (port === '*') return true;
  if (port) return port === pagePort;
  return !u.port || pagePort === (u.protocol === 'https:' ? '443' : '80');
}

/** Does the policy allow a connection (fetch/XHR) to `origin`? null = no policy / not restricted. */
export function allowsConnect(directives, origin, pageOrigin) {
  const list = directives['connect-src'] ?? directives['default-src'];
  if (!list) return null;
  return list.some((src) => sourceAllows(src, origin, pageOrigin));
}

export function scriptFlags(directives) {
  const list = directives['script-src'] ?? directives['default-src'];
  if (!list) return { restricted: false, inline: true, eval: true };
  const has = (t) => list.some((s) => s.replace(/'/g, '').toLowerCase() === t);
  return { restricted: true, inline: has('unsafe-inline'), eval: has('unsafe-eval'), nonce: list.some((s) => /^'nonce-/.test(s)), strictDynamic: has('strict-dynamic') };
}

/** Several policies can arrive in one header, comma-joined; each is enforced independently. */
export function splitPolicies(headerValue) {
  return String(headerValue ?? '').split(/,(?=\s*[a-z][a-z-]+\s)/i).map((s) => s.trim()).filter(Boolean);
}

/** Collect the page's effective policies: response header (HEAD) + meta tags. */
export async function collectCSP(rawFetch = fetch) {
  const sources = [];
  for (const meta of document.querySelectorAll('meta[http-equiv]')) {
    if (/^content-security-policy$/i.test(meta.getAttribute('http-equiv') ?? '')) sources.push({ from: 'meta', text: meta.getAttribute('content') ?? '' });
  }
  try {
    const res = await rawFetch(location.href, { method: 'HEAD', cache: 'no-store', credentials: 'include' });
    const h = res.headers.get('content-security-policy');
    if (h) splitPolicies(h).forEach((text, i, arr) => sources.push({ from: arr.length > 1 ? `header #${i + 1}` : 'header', text }));
    const ro = res.headers.get('content-security-policy-report-only');
    if (ro) splitPolicies(ro).forEach((text) => sources.push({ from: 'header (report-only)', text }));
  } catch (err) {
    sources.push({ from: 'header', text: null, error: err?.message ?? String(err) });
  }
  return sources;
}

/** Human-readable report lines. `hubOrigin` is what the hub client talks to. */
export function cspReport(sources, { hubOrigin = 'http://localhost:7373', pageOrigin = location.origin, hubPing = null } = {}) {
  const out = ['── CSP ─────────────────────────────────────────────────────'];
  const real = sources.filter((s) => s.text);
  if (!real.length) {
    out.push('No Content-Security-Policy found (header or meta).');
    out.push('→ hub fetch: allowed · bookmarklet: allowed · eval: allowed');
  } else if (real.length > 1) {
    // every policy must allow an action for it to work
    const ds = real.map((s) => parseCSP(s.text));
    const conn = ds.map((d) => allowsConnect(d, hubOrigin, pageOrigin)).every((v) => v !== false);
    const inline = ds.map((d) => scriptFlags(d)).every((f) => !f.restricted || f.inline);
    out.push(`${real.length} policies apply; an action must pass all of them → hub fetch: ${conn ? 'allowed' : 'BLOCKED'} · bookmarklet: ${inline ? 'works' : 'BLOCKED'}`);
  }
  for (const s of real) {
    const d = parseCSP(s.text);
    out.push(`policy from ${s.from}: ${Object.keys(d).length} directive(s)`);
    const conn = allowsConnect(d, hubOrigin, pageOrigin);
    out.push(`  connect-src → hub (${hubOrigin}): ${conn === null ? 'not restricted' : conn ? 'ALLOWED' : 'BLOCKED — use file export/import or Copy JSON instead'}`);
    const sf = scriptFlags(d);
    out.push(`  script-src  → bookmarklet (needs 'unsafe-inline'): ${!sf.restricted || sf.inline ? 'works' : 'BLOCKED — use a DevTools Snippet or the console'}`);
    out.push(`  script-src  → eval / new Function: ${!sf.restricted || sf.eval ? 'works' : 'blocked (BCC does not need it)'}`);
    if (/report-only/.test(s.from)) out.push('  (report-only: violations are logged, not enforced)');
    const raw = s.text.length > 600 ? `${s.text.slice(0, 600)}…` : s.text;
    out.push(`  raw: ${raw}`);
  }
  for (const s of sources.filter((x) => x.error)) out.push(`could not read the response header: ${s.error}`);
  if (hubPing !== null) out.push(`live hub ping: ${hubPing ? 'reachable ✓' : 'unreachable (not running, or blocked by connect-src)'}`);
  out.push('DevTools Snippets and console pastes are exempt from script-src on every site.');
  return out;
}
