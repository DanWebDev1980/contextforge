#!/usr/bin/env node
// The `browser-command-center` / `bcc` command.
//
//   npx browser-command-center           copy the bundle, print the Snippet steps
//   npx browser-command-center hub       run the loopback hub (serves the launcher)
//   npx browser-command-center pack      write release/bcc-<version>/ into the cwd
//   npx browser-command-center path      print the path of the bundled bcc.js
//   npx browser-command-center doctor    check this install
//
// Everything it reads lives in the package; everything it writes goes to the cwd.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const at = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const pkg = JSON.parse(await readFile(at('package.json'), 'utf8'));

const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith('-'));
const cmd = argv.find((a) => !a.startsWith('-')) ?? 'copy';

const usage = `BrowserCommandCenter ${pkg.version} — the web developer's power house of tools.

Usage: browser-command-center [command] [options]

Commands:
  copy              build-free: put the bundle on your clipboard and print the
                    DevTools Snippet steps (default)
  hub               run the loopback hub on 127.0.0.1 and serve the launcher
  pack              write release/bcc-${pkg.version}/ into the current directory,
                    with INSTALL.txt, to carry to a machine without npm
  path              print the absolute path of the bundled dist/bcc.js
  doctor            check Node, the bundle and (in a checkout) the test setup

Options:
  --port <n>        hub port (default 7373, or $BCC_PORT)
  -v, --version     print the version
  -h, --help        this text

The hub stores captures in ./.bcc-hub of the current directory ($BCC_HUB_DIR
overrides). Docs: ${pkg.homepage ?? 'https://github.com/DanWebDev1980/browser-command-center'}`;

const has = (...names) => flags.some((f) => names.includes(f));

if (has('-h', '--help') || cmd === 'help') { console.log(usage); process.exit(0); }
if (has('-v', '--version') || cmd === 'version') { console.log(pkg.version); process.exit(0); }

switch (cmd) {
  case 'copy':
    await import('../scripts/copy.mjs');
    break;

  case 'hub':
  case 'serve': {
    const portFlag = argv[argv.indexOf('--port') + 1];
    const port = argv.includes('--port') ? Number(portFlag) : undefined;
    if (argv.includes('--port') && !Number.isInteger(port)) {
      console.error(`--port needs a number, got ${JSON.stringify(portFlag ?? null)}`);
      process.exit(2);
    }
    const { start } = await import('../hub/server.mjs');
    start(port === undefined ? {} : { port });
    break;
  }

  case 'pack':
    await import('../scripts/pack.mjs');
    break;

  case 'path':
    console.log(at('dist/bcc.js'));
    break;

  case 'doctor':
    await import('../scripts/doctor.mjs');
    break;

  default:
    console.error(`Unknown command: ${cmd}\n\n${usage}`);
    process.exit(2);
}
