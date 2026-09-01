#!/usr/bin/env node
// Put dist/bcc.js on the clipboard so the next step is just "paste into a
// Snippet". Tries the platform clipboard tools in turn; falls back to printing
// the path when none is available (WSL, headless).
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { fileURLToPath } from 'node:url';

// Resolved from the package, not the cwd, so this works under `npx`.
const file = fileURLToPath(new URL('../dist/bcc.js', import.meta.url));
let code;
try { code = await readFile(file, 'utf8'); } catch { console.error('dist/bcc.js not found — run `npm run build` first.'); process.exit(1); }

const candidates = platform() === 'win32' ? [['clip']]
  : platform() === 'darwin' ? [['pbcopy']]
    : [['wl-copy'], ['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard', '--input'], ['clip.exe']];   // clip.exe = WSL

async function tryCopy([cmd, ...args]) {
  return new Promise((done) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    p.on('error', () => done(false));
    p.on('exit', (c) => done(c === 0));
    p.stdin.on('error', () => {});
    p.stdin.end(code);
  });
}

let ok = false;
for (const c of candidates) { if (await tryCopy(c)) { ok = true; console.log(`Copied dist/bcc.js (${(code.length / 1024).toFixed(1)} KB) to the clipboard via ${c[0]}.`); break; } }
if (!ok) {
  console.log(`No clipboard tool found (tried ${candidates.map((c) => c[0]).join(', ')}).`);
  console.log(`Open dist/index.html and use "Copy bcc.js", or copy the file yourself:\n  ${file}`);
}
console.log(`
Next, in Edge or Chrome:
  F12 → Ctrl+Shift+P → "Show Snippets" → + New snippet → paste → Ctrl+S → name it "bcc"
  Then on any page: F12 → Ctrl+P → !bcc → Enter`);
