// Builds dist/bcc.js (everything, one paste) and dist/index.html (the launcher).
// `--split` additionally builds one bundle per tool, each booting the shell with
// only that tool and auto-starting it — used by the browser test, kept because
// it costs nothing. `--watch` rebuilds on change.

import { build, context } from 'esbuild';
import { readdir, writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { join, basename } from 'node:path';

const OUT = 'dist';
const TOOLS_DIR = 'src/tools';
const SPLIT_DIR = '.build-split';
const BUDGET = 250 * 1024;                       // bcc.js must stay under this, minified

const args = new Set(process.argv.slice(2));
const watch = args.has('--watch');
const split = args.has('--split');
const quiet = args.has('--quiet');

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const VERSION = pkg.version;
const BUILT = new Date().toISOString().slice(0, 10);
let sha = 'nogit';
try { sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* fine */ }

const TAGLINE = 'The web developer\'s power house of tools.';

const common = {
  bundle: true,
  format: 'iife',
  target: ['chrome110', 'edge110', 'firefox110', 'safari16'],
  minify: !watch,
  legalComments: 'none',
  logLevel: quiet ? 'warning' : 'info',
  define: { __BCC_VERSION__: JSON.stringify(`${VERSION}+${sha}`), __BCC_BUILT__: JSON.stringify(BUILT) },
  banner: { js: `/* BrowserCommandCenter ${VERSION} (${sha}) — ${TAGLINE} — built ${BUILT} — MIT */` },
};

const mainOptions = { ...common, entryPoints: ['src/app/entry.js'], outfile: join(OUT, 'bcc.js') };

async function toolIds() {
  return (await readdir(TOOLS_DIR)).filter((f) => f.endsWith('.js') && f !== 'index.js').map((f) => basename(f, '.js'));
}

/** Per-tool entries: the shell with one tool registered and auto-started. */
async function splitEntries() {
  await rm(SPLIT_DIR, { recursive: true, force: true });
  await mkdir(SPLIT_DIR, { recursive: true });
  const ids = await toolIds();
  const files = [];
  for (const id of ids) {
    const file = join(SPLIT_DIR, `${id}.js`);
    await writeFile(file, [
      `import { boot } from '../src/app/main.js';`,
      `import { TOOLS } from '../src/tools/index.js';`,
      `boot({ tools: TOOLS, autoStart: ${JSON.stringify(id)}, quiet: true });`,
    ].join('\n'));
    files.push(file);
  }
  return files;
}

function bookmarklet(code) {
  return `javascript:${encodeURIComponent(`(function(){${code}})()`)}`;
}

async function launcher() {
  const code = await readFile(join(OUT, 'bcc.js'), 'utf8');
  const hash = createHash('sha256').update(code).digest('hex').slice(0, 12);
  const kb = (code.length / 1024).toFixed(1);
  const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BrowserCommandCenter</title>
<style>
  :root { color-scheme: dark; --bg:#14161a; --card:#1b1e24; --line:#2c313a; --fg:#e7e9ee; --mute:#8b93a1; --accent:#3b6fe0; --ok:#2f7a3f; }
  * { box-sizing: border-box }
  body { margin:0; padding:32px 20px 60px; background:var(--bg); color:var(--fg); font:14px/1.55 ui-sans-serif,system-ui,sans-serif; max-width:860px; margin-inline:auto }
  h1 { font-size:24px; margin:0 } h1 small { color:var(--mute); font-weight:400; font-size:13px; margin-left:8px }
  .lede { color:var(--mute); margin:4px 0 22px; font-size:15px }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 20px; margin-bottom:14px }
  .card h2 { font-size:15px; margin:0 0 8px } .card h2 .tag { font-size:11px; color:var(--mute); font-weight:400; margin-left:8px }
  ol { margin:6px 0 0; padding-left:22px } li { margin:5px 0 }
  kbd { background:#262b33; border:1px solid var(--line); border-radius:4px; padding:1px 6px; font-size:12px; font-family:ui-monospace,monospace }
  .actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:12px }
  button { font:inherit; font-size:13px; padding:8px 16px; border-radius:8px; border:1px solid var(--accent); background:var(--accent); color:#fff; cursor:pointer }
  button.alt { background:transparent; color:var(--fg); border-color:var(--line) }
  button.done { background:var(--ok); border-color:var(--ok) }
  a.bm { font-size:12px; color:var(--fg); border:1px dashed var(--line); border-radius:8px; padding:7px 14px; text-decoration:none; cursor:grab }
  .size { color:var(--mute); font-size:12px; margin-left:auto; font-family:ui-monospace,monospace }
  .muted { color:var(--mute) } .small { font-size:12px }
  table { border-collapse:collapse; width:100%; font-size:13px } td, th { text-align:left; padding:4px 8px; border-bottom:1px solid var(--line); vertical-align:top } th { color:var(--mute); font-weight:600 }
  code { font-family:ui-monospace,monospace; font-size:12px; background:#262b33; padding:1px 5px; border-radius:4px }
  details summary { cursor:pointer; color:var(--mute) }
  textarea { width:100%; height:120px; background:#0e1013; color:var(--fg); border:1px solid var(--line); border-radius:8px; font:12px ui-monospace,monospace; padding:8px }
</style>
<h1>BrowserCommandCenter <small>BCC ${VERSION} · ${sha} · built ${BUILT}</small></h1>
<p class="lede">${TAGLINE} One script, pasted once.</p>

<div class="card">
  <h2>1. Copy the script <span class="tag">${kb} KB · sha256 ${hash}</span></h2>
  <div class="actions">
    <button id="copy">Copy bcc.js</button>
    <button class="alt" id="dl">Download bcc.js</button>
    <a class="bm" href="${bookmarklet(code).replace(/"/g, '&quot;')}" onclick="return false" draggable="true" title="Blocked by strict CSP (Figma). Snippet or console are reliable.">drag me to bookmarks</a>
    <span class="size">v${VERSION}</span>
  </div>
</div>

<div class="card">
  <h2>2. Install it as a DevTools Snippet <span class="tag">recommended · Edge and Chrome · survives restarts</span></h2>
  <ol>
    <li>On any page press <kbd>F12</kbd>, then <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>, type <code>snippets</code>, pick <em>Show Snippets</em>.</li>
    <li><em>+ New snippet</em>, paste, then <kbd>Ctrl</kbd>+<kbd>S</kbd>. Name it <code>bcc</code>.</li>
    <li>From now on, on any tab: <kbd>F12</kbd> → <kbd>Ctrl</kbd>+<kbd>P</kbd> → type <code>!bcc</code> → <kbd>Enter</kbd>.</li>
  </ol>
  <p class="muted small">Snippets run under DevTools, so a page's Content-Security-Policy cannot block them. They live in the browser profile: no install rights needed.</p>
</div>

<div class="card">
  <h2>3. Or paste into the console <span class="tag">fallback when Snippets are disabled by policy</span></h2>
  <ol>
    <li><kbd>F12</kbd> → Console. First time in a profile: type <code>allow pasting</code>, <kbd>Enter</kbd>.</li>
    <li>Paste, <kbd>Enter</kbd>. The dock appears bottom-right.</li>
  </ol>
</div>

<div class="card">
  <h2>Using it</h2>
  <table>
    <tr><th>Open the palette</th><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> (change in Settings), or click <strong>BCC</strong> in the dock</td></tr>
    <tr><th>Launch a tool</th><td>type a few letters, <kbd>Enter</kbd>. Tools coexist; closing a panel stops that tool only</td></tr>
    <tr><th>Move captures</th><td>every panel has Export / Import (JSON file). The hub (<code>npm run hub</code>) mirrors automatically where the page's CSP allows</td></tr>
    <tr><th>Unload</th><td>dock menu ≡ → Unload, or focus the dock and press <kbd>Esc</kbd></td></tr>
    <tr><th>After a full page load</th><td>run the snippet again (<kbd>Ctrl</kbd>+<kbd>P</kbd>, <code>!bcc</code>). A journey mid-run resumes by itself</td></tr>
  </table>
</div>

<details class="card"><summary>Show the script</summary><textarea readonly id="src">${code.replace(/<\//g, '<\\/')}</textarea></details>

<script>
const src = document.getElementById('src').value;
const flash = (btn, text) => { const l = btn.textContent; btn.textContent = text; btn.classList.add('done'); setTimeout(() => { btn.textContent = l; btn.classList.remove('done'); }, 1600); };
document.getElementById('copy').addEventListener('click', async (e) => { try { await navigator.clipboard.writeText(src); flash(e.target, 'Copied ✓ — now paste it into a Snippet'); } catch { const ta = document.getElementById('src'); ta.parentElement.open = true; ta.select(); document.execCommand('copy'); flash(e.target, 'Copied ✓'); } });
document.getElementById('dl').addEventListener('click', () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([src], { type: 'text/javascript' })); a.download = 'bcc.js'; a.click(); });
</script>`;
  await writeFile(join(OUT, 'index.html'), html);
  return { size: code.length, hash };
}

await mkdir(OUT, { recursive: true });

if (watch) {
  const ctx = await context({
    ...mainOptions,
    plugins: [{ name: 'launcher', setup(b) { b.onEnd(async () => { const { size } = await launcher(); console.log(`→ dist/bcc.js ${(size / 1024).toFixed(1)} KB, dist/index.html`); }); } }],
  });
  await ctx.watch();
  console.log('watching…');
} else {
  await build(mainOptions);
  const { size, hash } = await launcher();
  if (size > BUDGET) {
    console.error(`\n✗ dist/bcc.js is ${(size / 1024).toFixed(1)} KB — over the ${BUDGET / 1024} KB budget.`);
    process.exit(1);
  }
  if (split) {
    const files = await splitEntries();
    await build({ ...common, entryPoints: files, outdir: OUT, logLevel: 'warning' });
    await rm(SPLIT_DIR, { recursive: true, force: true });
    if (!quiet) console.log(`Split: ${files.length} per-tool bundles in dist/ (for tests)`);
  }
  if (!quiet) {
    console.log(`\nBCC ${VERSION} (${sha}) → dist/bcc.js  ${(size / 1024).toFixed(1)} KB  sha256 ${hash}`);
    console.log('Open dist/index.html, or `npm run copy` to put it on the clipboard.\n');
  }
}
