import { build, context } from 'esbuild';
import { readdir, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

const SRC = 'src/tools';
const OUT = 'dist';
const watch = process.argv.includes('--watch');

const DESCRIPTIONS = {
  'inspect-web': 'Hover any element, click it, capture the whole subtree\'s computed styles.',
  'inspect-figma': 'Watch the Figma selection and capture the right-hand panel\'s styles.',
  'figma-stickies': 'Harvest sticky-note / discovery text from a Figma or FigJam board.',
  'octane-story': 'Pull the whole open Octane work item — fields, description, AC, comments.',
  'text-clip': 'Select text anywhere, Alt+C, and it lands in the basket with its URL.',
  'ga4': 'Live view of the GA4 events this page fires, with their parameters.',
  'compare': 'Diff a Figma capture against a web capture and list what does not match.',
  'basket': 'The context builder: assemble everything into one Copilot-ready prompt.',
  'probe': 'Dump a region\'s DOM structure so selectors can be written for it.',
};

const ORDER = ['basket', 'inspect-web', 'inspect-figma', 'compare', 'octane-story', 'figma-stickies', 'text-clip', 'ga4', 'probe'];

async function entries() {
  const files = (await readdir(SRC)).filter((f) => f.endsWith('.js'));
  return files.sort((a, b) => {
    const ai = ORDER.indexOf(basename(a, '.js'));
    const bi = ORDER.indexOf(basename(b, '.js'));
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
}

const options = (files) => ({
  entryPoints: files.map((f) => join(SRC, f)),
  outdir: OUT,
  bundle: true,
  format: 'iife',
  target: ['chrome110', 'firefox110', 'safari16'],
  minify: !watch,
  legalComments: 'none',
  logLevel: 'info',
});

/**
 * Bookmarklet form. Bookmarklets are convenient but CSP-restricted sites
 * (Figma among them) block javascript: URLs, so the console paste is the
 * primary path and this is the shortcut for everywhere else.
 */
function bookmarklet(code) {
  return `javascript:${encodeURIComponent(`(function(){${code}})()`)}`;
}

async function launcher(files) {
  const tools = [];
  for (const file of files) {
    const name = basename(file, '.js');
    const code = await readFile(join(OUT, `${name}.js`), 'utf8');
    tools.push({ name, code, url: bookmarklet(code), size: code.length, desc: DESCRIPTIONS[name] ?? '' });
  }

  const cards = tools.map((t) => `
    <article class="tool">
      <h2>${t.name}</h2>
      <p>${t.desc}</p>
      <div class="actions">
        <button data-tool="${t.name}">Copy for console</button>
        <a class="bm" href="${t.url.replace(/"/g, '&quot;')}" onclick="return false" draggable="true">drag me to bookmarks</a>
        <span class="size">${(t.size / 1024).toFixed(1)} KB</span>
      </div>
      <script type="text/plain" id="src-${t.name}">${t.code.replace(/<\//g, '<\\/')}</script>
    </article>`).join('\n');

  const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>contextforge</title>
<style>
  :root { color-scheme: dark; --bg:#14161a; --card:#1b1e24; --line:#2c313a; --fg:#e7e9ee; --mute:#8b93a1; --accent:#3b6fe0; }
  * { box-sizing: border-box }
  body { margin:0; padding:32px; background:var(--bg); color:var(--fg); font:14px/1.5 ui-sans-serif,system-ui,sans-serif; max-width:900px; margin-inline:auto }
  h1 { font-size:20px; margin:0 0 4px }
  .lede { color:var(--mute); margin:0 0 24px }
  .how { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 18px; margin-bottom:24px }
  .how ol { margin:8px 0 0; padding-left:20px } .how li { margin:4px 0 }
  kbd { background:#262b33; border:1px solid var(--line); border-radius:4px; padding:1px 5px; font-size:12px }
  .tool { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 18px; margin-bottom:12px }
  .tool h2 { font-size:14px; margin:0 0 4px; font-family:ui-monospace,monospace; color:#9fc0ff }
  .tool p { margin:0 0 10px; color:var(--mute); font-size:13px }
  .actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap }
  button { font:inherit; font-size:12px; padding:5px 12px; border-radius:6px; border:1px solid var(--accent); background:var(--accent); color:#fff; cursor:pointer }
  button.done { background:#2f7a3f; border-color:#2f7a3f }
  a.bm { font-size:12px; color:var(--fg); border:1px dashed var(--line); border-radius:6px; padding:5px 12px; text-decoration:none; cursor:grab }
  .size { color:var(--mute); font-size:11px; margin-left:auto }
</style>
<h1>contextforge</h1>
<p class="lede">Capture design, DOM, analytics and ticket context; export one prompt.</p>
<div class="how">
  <strong>Console (works everywhere, including CSP-strict sites like Figma)</strong>
  <ol>
    <li>Open DevTools → Console on the target page.</li>
    <li>First time only: type <kbd>allow pasting</kbd> and press Enter.</li>
    <li>Hit <em>Copy for console</em> below, paste, Enter.</li>
  </ol>
  <p style="margin:10px 0 0;color:var(--mute)">Bookmarklets are quicker but a strict Content-Security-Policy will silently block them. If a bookmarklet does nothing, use the console.</p>
</div>
${cards}
<script>
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-tool]');
  if (!btn) return;
  const code = document.getElementById('src-' + btn.dataset.tool).textContent;
  await navigator.clipboard.writeText(code);
  const label = btn.textContent;
  btn.textContent = 'Copied ✓'; btn.classList.add('done');
  setTimeout(() => { btn.textContent = label; btn.classList.remove('done'); }, 1400);
});
</script>`;

  await writeFile(join(OUT, 'index.html'), html);
  return tools;
}

const files = await entries();
await mkdir(OUT, { recursive: true });

if (watch) {
  const ctx = await context({
    ...options(files),
    plugins: [{
      name: 'launcher',
      setup(b) { b.onEnd(async () => { await launcher(files); console.log('→ dist/index.html'); }); },
    }],
  });
  await ctx.watch();
  console.log('watching…');
} else {
  await build(options(files));
  const tools = await launcher(files);
  const total = tools.reduce((n, t) => n + t.size, 0);
  console.log(`\nBuilt ${tools.length} tools (${(total / 1024).toFixed(1)} KB total)`);
  console.log('Open dist/index.html to copy them.\n');
}
