// The fixture web app: static pages from test/fixtures plus a tiny JSON API and
// two form handlers that record what they received. Served on any number of
// ports so cross-origin behaviour can be tested with the same app.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export function fixtureApp() {
  const received = [];
  let slowMs = 0;
  const invoices = [{ id: 1, total: 120.5, status: 'open' }, { id: 2, total: 80, status: 'paid' }];

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost/');
    const send = (status, body, headers = {}) => { res.writeHead(status, { 'cache-control': 'no-store', ...headers }); res.end(body); };
    const json = (status, obj, headers = {}) => send(status, JSON.stringify(obj), { 'content-type': 'application/json', ...headers });
    const body = await new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b)); });

    if (url.pathname === '/api/invoices' && req.method === 'GET') return json(200, invoices);
    if (url.pathname === '/api/invoices' && req.method === 'POST') { const inv = { id: 3, ...safe(body) }; return json(201, inv); }
    if (/^\/api\/invoices\/\d+$/.test(url.pathname)) { const id = Number(url.pathname.split('/').pop()); const inv = invoices.find((i) => i.id === id); return inv ? json(200, inv) : json(404, { error: 'not found' }); }
    if (url.pathname === '/api/error') return json(500, { error: 'boom' });
    if (url.pathname === '/api/text') return send(200, 'plain text body', { 'content-type': 'text/plain' });
    if (url.pathname === '/api/slow') { await new Promise((r) => setTimeout(r, slowMs)); return json(200, { slow: true }); }
    if (url.pathname === '/api/echo') return json(200, { method: req.method, headers: req.headers, body: safe(body) });
    if (url.pathname === '/submit' && req.method === 'POST') { received.push({ path: '/submit', form: Object.fromEntries(new URLSearchParams(body)) }); return send(303, '', { location: '/form2.html' }); }
    if (url.pathname === '/submit2' && req.method === 'POST') { received.push({ path: '/submit2', form: Object.fromEntries(new URLSearchParams(body)) }); return send(303, '', { location: '/done.html' }); }
    if (url.pathname === '/received') return json(200, received);
    if (url.pathname === '/reset') { received.length = 0; return json(200, { ok: true }); }

    const page = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const headers = { 'content-type': 'text/html' };
    let file = page;
    if (page === 'csp.html') { file = 'index.html'; headers['content-security-policy'] = "default-src 'self'; script-src 'self'; connect-src 'self' https://api.example.com"; }
    try { return send(200, await readFile(resolve('test/fixtures', file)), headers); }
    catch { return send(404, 'not found'); }
  };

  const servers = [];
  return {
    received,
    setSlow: (ms) => { slowMs = ms; },
    listen(port) { const s = createServer(handler).listen(port, '127.0.0.1'); servers.push(s); return s; },
    close() { for (const s of servers) s.close(); },
  };
}

function safe(text) { try { return JSON.parse(text); } catch { return text || null; } }
