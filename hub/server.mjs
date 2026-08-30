// Optional cross-origin bridge.
//
// localStorage is per-origin, so a Figma capture and an Octane story land in
// different baskets. Run this and every tool mirrors its captures here; then
// "Pull hub" in the context builder merges the lot, wherever you are.
//
// Binds to 127.0.0.1 only. Chrome exempts http://localhost from mixed-content
// blocking, so an https page can reach it.

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const PORT = Number(process.env.CONTEXTFORGE_PORT ?? 7373);
const STORE = resolve('.contextforge-hub/items.json');
const DIST = resolve('dist');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/markdown' };

async function load() {
  try { return JSON.parse(await readFile(STORE, 'utf8')); } catch { return []; }
}
async function save(items) {
  await mkdir(resolve('.contextforge-hub'), { recursive: true });
  await writeFile(STORE, JSON.stringify(items, null, 2));
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

async function readBody(req, limit = 8 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('payload too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }
  if (url.pathname === '/ping') return json(res, 200, { ok: true, version: 1 });

  if (url.pathname === '/items') {
    if (req.method === 'GET') return json(res, 200, { items: await load() });
    if (req.method === 'DELETE') { await save([]); return json(res, 200, { ok: true }); }
    if (req.method === 'POST') {
      try {
        const item = JSON.parse(await readBody(req));
        const items = await load();
        const index = items.findIndex((i) => i.id === item.id);
        if (index >= 0) items[index] = item; else items.push(item);
        await save(items);
        return json(res, 200, { ok: true, count: items.length });
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
  }

  // also serve dist/ so the launcher page is one command away
  const path = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = join(DIST, path.replace(/^\/+/, ''));
  if (file.startsWith(DIST) && existsSync(file)) {
    cors(res);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
    return;
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`contextforge hub  →  http://localhost:${PORT}`);
  console.log(`  launcher        →  http://localhost:${PORT}/`);
  console.log(`  store           →  ${STORE}`);
});
