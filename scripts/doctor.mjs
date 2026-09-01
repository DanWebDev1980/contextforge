#!/usr/bin/env node
// Is this install ready? Checks Node, the bundle, and (in a git checkout)
// dependencies, a Chromium for the browser tests and the unit suite. Prints
// what to do about anything missing. `--fix` installs deps and builds.
//
// Works both from a checkout and from an installed package: everything is
// resolved against the package root, never the cwd.
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const at = (...p) => join(ROOT, ...p);
/** A checkout has the build and the tests; an installed package has neither. */
const DEV = existsSync(at('build.mjs'));

const fix = process.argv.includes('--fix');
const ok = (m) => console.log(`  ✓ ${m}`);
const note = (m) => console.log(`  · ${m}`);
const bad = (m, hint) => { console.log(`  ✗ ${m}`); if (hint) console.log(`      → ${hint}`); problems++; };
let problems = 0;
const run = (cmd, opts = {}) => { try { return execSync(cmd, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8', ...opts }).trim(); } catch (e) { return { error: e.stderr?.toString() || e.message }; } };

console.log(`BrowserCommandCenter doctor  (${DEV ? 'checkout' : 'installed package'}: ${ROOT})\n`);

const [major] = process.versions.node.split('.').map(Number);
major >= 20 ? ok(`Node ${process.versions.node}`) : bad(`Node ${process.versions.node} is too old`, 'install Node 20+ (needed for the built-in WebSocket used by the browser tests)');

if (DEV) {
  if (!existsSync(at('node_modules/esbuild'))) {
    if (fix) { console.log('  … npm install'); run('npm install', { stdio: 'inherit' }); }
    existsSync(at('node_modules/esbuild')) ? ok('dependencies installed') : bad('dependencies missing', 'npm install');
  } else ok('dependencies installed');

  const chrome = process.env.CHROME ?? 'chromium';
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', [chrome], { encoding: 'utf8' });
  if (which.status === 0) ok(`browser for tests: ${which.stdout.trim().split('\n')[0]}`);
  else bad(`no "${chrome}" on PATH`, 'install Chromium, or set CHROME=/path/to/chrome (Edge works: CHROME=msedge). Unit tests still run without it.');

  if (fix || !existsSync(at('dist/bcc.js'))) { console.log('  … building'); const r = run('node build.mjs --quiet'); if (r.error) bad('build failed', r.error.split('\n')[0]); }
}

if (existsSync(at('dist/bcc.js'))) {
  const size = statSync(at('dist/bcc.js')).size;
  size <= 250 * 1024 ? ok(`dist/bcc.js ${(size / 1024).toFixed(1)} KB (budget 250 KB)`) : bad(`dist/bcc.js is ${(size / 1024).toFixed(1)} KB`, 'over the 250 KB budget — the build should have failed');
  const pkg = JSON.parse(await readFile(at('package.json'), 'utf8'));
  const banner = (await readFile(at('dist/bcc.js'), 'utf8')).slice(0, 200);
  banner.includes(pkg.version) ? ok(`bundle version ${pkg.version} matches package.json`) : bad('bundle version does not match package.json', DEV ? 'npm run build' : 'reinstall the package');
} else bad('dist/bcc.js missing', DEV ? 'npm run build' : 'the published package should ship it — please open an issue');

if (DEV) {
  const unit = spawnSync(process.execPath, [at('test/smoke.mjs')], { cwd: ROOT, encoding: 'utf8' });
  unit.status === 0 ? ok(unit.stdout.trim().split('\n').pop()) : bad('unit tests failed', (unit.stderr || unit.stdout).split('\n').find((l) => l.startsWith('✗')) ?? 'node test/smoke.mjs');
}

const port = Number(process.env.BCC_PORT ?? 7373);
try {
  const res = await fetch(`http://localhost:${port}/ping`, { signal: AbortSignal.timeout(800) });
  const j = await res.json();
  ok(`hub running on :${port} (${j.name} v${j.version})`);
} catch { note(`hub not running (optional) — ${DEV ? 'npm run hub' : 'npx browser-command-center hub'}`); }

const next = DEV ? 'npm run copy' : 'npx browser-command-center';
console.log(problems
  ? `\n${problems} problem(s). Fix the above${DEV ? ', or run: npm run doctor -- --fix' : ''}`
  : `\nAll good. Next: ${next}   (puts bcc.js on the clipboard, prints the Snippet steps)`);
process.exitCode = problems ? 1 : 0;
