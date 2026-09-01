#!/usr/bin/env node
// Bundle a release folder to carry to the work machine (email, USB, share):
//   release/bcc-<version>/  bcc.js · index.html · INSTALL.txt · hub/ · package.json
// No zip dependency — the folder is small; zip it with whatever the machine has.
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Sources come from the package; the release folder is written into the cwd.
const from = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const pkg = JSON.parse(await readFile(from('package.json'), 'utf8'));
let code;
try { code = await readFile(from('dist/bcc.js'), 'utf8'); } catch { console.error('dist/bcc.js not found — run `npm run build` first.'); process.exit(1); }
const sha = createHash('sha256').update(code).digest('hex');
const dir = resolve('release', `bcc-${pkg.version}`);
await rm(dir, { recursive: true, force: true });
await mkdir(join(dir, 'hub'), { recursive: true });
await mkdir(join(dir, 'dist'), { recursive: true });
await cp(from('dist/bcc.js'), join(dir, 'dist/bcc.js'));
await cp(from('dist/index.html'), join(dir, 'dist/index.html'));
await cp(from('hub/server.mjs'), join(dir, 'hub/server.mjs'));
await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'browser-command-center', version: pkg.version, type: 'module', private: true, scripts: { hub: 'node hub/server.mjs' } }, null, 2));
await writeFile(join(dir, 'INSTALL.txt'), `BrowserCommandCenter ${pkg.version}
${'='.repeat(30)}
sha256(bcc.js) = ${sha}

INSTALL (Edge or Chrome, no admin rights, ~1 minute)
  1. Open dist/index.html in the browser (double-click). Click "Copy bcc.js".
     -- or open dist/bcc.js in Notepad, Ctrl+A, Ctrl+C.
  2. On any web page: F12 → Ctrl+Shift+P → type "snippets" → "Show Snippets".
  3. "+ New snippet" → paste → Ctrl+S → name it: bcc
  4. Done. From now on, on any tab: F12 → Ctrl+P → type  !bcc  → Enter.

USE
  Ctrl+Shift+Space opens the command palette (or click BCC in the dock, bottom-right).
  Type a few letters of a tool, Enter. Esc closes the palette. Panels coexist.
  After a full page load, run the snippet again (Ctrl+P, !bcc). Journeys resume by themselves.

OPTIONAL: the hub (needs Node.js)
  node hub/server.mjs        → http://localhost:7373 (serves this launcher, mirrors captures across origins)
  Diagnose → CSP tells you whether a given site lets the page reach it.

FALLBACK if Snippets are disabled by policy
  F12 → Console → type "allow pasting" (first time only) → paste bcc.js → Enter.
`);
console.log(`Packed → ${dir}\n  bcc.js ${(code.length / 1024).toFixed(1)} KB · sha256 ${sha.slice(0, 16)}…\n  Zip that folder and send it. INSTALL.txt has the 4 steps.`);
