// Optional cross-origin bridge, namespaced.
//
// localStorage is per-origin, so a Figma capture and an Octane story land in
// different baskets. Run this and every mirrored store pushes here; then
// "Pull hub" merges the lot, wherever you are. Also serves dist/ so the
// launcher is one command away.
//
// Binds to 127.0.0.1 only. Chrome exempts http://localhost from mixed-content
// blocking, so an https page can reach it — unless its connect-src says no
// (Diagnose → CSP tells you).
//
//   GET  /ping                 → { ok, version, name }
//   GET  /namespaces           → { namespaces: [...] }
//   GET  /items?ns=basket      → { items }
//   POST /items?ns=basket      → upsert one item (by id)
//   DELETE /items?ns=basket    → clear the namespace

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const PORT = Number(process.env.BCC_PORT ?? process.env.CONTEXTFORGE_PORT ?? 7373);
const DIR = resolve(process.env.BCC_HUB_DIR ?? '.bcc-hub');
const LEGACY = resolve('.contextforge-hub/items.json');
const DIST = resolve('dist');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/markdown' };
const NS = /^[a-z0-9_-]{1,40}$/i;

const file = (ns) => join(DIR, `${ns}.json`);

async function load(ns) {
  try { return JSON.parse(await readFile(file(ns), 'utf8')); }
  catch {
    if (ns === 'basket' && existsSync(LEGACY)) { try { return JSON.parse(await readFile(LEGACY, 'utf8')); } catch { /* fall through */ } }
    return [];
  }
}
async function save(ns, items) {
  await mkdir(DIR, { recursive: true });
  await writeFile(file(ns), JSON.stringify(items, null, 2));
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
}
function json(res, status, body) {
  cors(res);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
async function readBody(req, limit = 16 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('payload too large'); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const ns = url.searchParams.get('ns') ?? 'basket';

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }
  if (url.pathname === '/ping') return json(res, 200, { ok: true, version: 2, name: 'bcc-hub' });
  if (url.pathname === '/namespaces') {
    let names = [];
    try { names = (await readdir(DIR)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)); } catch { /* none yet */ }
    return json(res, 200, { namespaces: names });
  }

  if (url.pathname === '/items') {
    if (!NS.test(ns)) return json(res, 400, { error: 'bad namespace' });
    if (req.method === 'GET') return json(res, 200, { namespace: ns, items: await load(ns) });
    if (req.method === 'DELETE') { await save(ns, []); return json(res, 200, { ok: true }); }
    if (req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req));
        const incoming = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : [body];
        const items = await load(ns);
        for (const item of incoming) {
          if (!item?.id) continue;
          const index = items.findIndex((i) => i.id === item.id);
          if (index >= 0) items[index] = item; else items.push(item);
        }
        await save(ns, items);
        return json(res, 200, { ok: true, namespace: ns, count: items.length });
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
  }

  // also serve dist/ so the launcher page is one command away
  const path = url.pathname === '/' ? '/index.html' : url.pathname;
  const target = join(DIST, path.replace(/^\/+/, ''));
  if (target.startsWith(DIST) && existsSync(target)) {
    cors(res);
    res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(target).pipe(res);
    return;
  }
  json(res, 404, { error: 'not found' });
});

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`bcc hub        →  http://localhost:${PORT}`);
    console.log(`  launcher     →  http://localhost:${PORT}/`);
    console.log(`  store        →  ${DIR}/<namespace>.json`);
  });
}
