#!/usr/bin/env node
// Is this checkout ready? Checks Node, dependencies, a Chromium for the browser
// tests, builds, runs the unit suite and pings a running hub. Prints what to do
// about anything that is missing. `--fix` installs deps and builds.
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const fix = process.argv.includes('--fix');
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m, hint) => { console.log(`  ✗ ${m}`); if (hint) console.log(`      → ${hint}`); problems++; };
let problems = 0;
const run = (cmd, opts = {}) => { try { return execSync(cmd, { stdio: 'pipe', encoding: 'utf8', ...opts }).trim(); } catch (e) { return { error: e.stderr?.toString() || e.message }; } };

console.log('BrowserCommandCenter doctor\n');
const [major] = process.versions.node.split('.').map(Number);
major >= 20 ? ok(`Node ${process.versions.node}`) : bad(`Node ${process.versions.node} is too old`, 'install Node 20+ (needed for the built-in WebSocket used by the browser tests)');

if (!existsSync('node_modules/esbuild')) {
  if (fix) { console.log('  … npm install'); run('npm install', { stdio: 'inherit' }); }
  existsSync('node_modules/esbuild') ? ok('dependencies installed') : bad('dependencies missing', 'npm install');
} else ok('dependencies installed');

const chrome = process.env.CHROME ?? 'chromium';
const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', [chrome], { encoding: 'utf8' });
if (which.status === 0) ok(`browser for tests: ${which.stdout.trim().split('\n')[0]}`);
else bad(`no "${chrome}" on PATH`, 'install Chromium, or set CHROME=/path/to/chrome (Edge works: CHROME=msedge). Unit tests still run without it.');

if (fix || !existsSync('dist/bcc.js')) { console.log('  … building'); const r = run('node build.mjs --quiet'); if (r.error) bad('build failed', r.error.split('\n')[0]); }
if (existsSync('dist/bcc.js')) {
  const size = statSync('dist/bcc.js').size;
  size <= 250 * 1024 ? ok(`dist/bcc.js ${(size / 1024).toFixed(1)} KB (budget 250 KB)`) : bad(`dist/bcc.js is ${(size / 1024).toFixed(1)} KB`, 'over the 250 KB budget — the build should have failed');
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const banner = (await readFile('dist/bcc.js', 'utf8')).slice(0, 200);
  banner.includes(pkg.version) ? ok(`bundle version ${pkg.version} matches package.json`) : bad('bundle version does not match package.json', 'npm run build');
} else bad('dist/bcc.js missing', 'npm run build');

const unit = spawnSync(process.execPath, ['test/smoke.mjs'], { encoding: 'utf8' });
unit.status === 0 ? ok(unit.stdout.trim().split('\n').pop()) : bad('unit tests failed', (unit.stderr || unit.stdout).split('\n').find((l) => l.startsWith('✗')) ?? 'node test/smoke.mjs');

try {
  const res = await fetch('http://localhost:7373/ping', { signal: AbortSignal.timeout(800) });
  const j = await res.json();
  ok(`hub running on :7373 (${j.name} v${j.version})`);
} catch { console.log('  · hub not running (optional) — npm run hub'); }

console.log(problems ? `\n${problems} problem(s). Fix the above, or run: npm run doctor -- --fix` : `\nAll good. Next: npm run copy   (puts bcc.js on the clipboard, prints the Snippet steps)`);
process.exitCode = problems ? 1 : 0;
