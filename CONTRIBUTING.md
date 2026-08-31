# Contributing

## Layout

```
src/app/            entry.js (dist/bcc.js) · main.js (boot, window.BCC) · registry · dock · palette · settings
src/core/
  overlay/ui.js     shadow-DOM UI kit + window manager (panels coexist, geometry remembered per tool)
  store/            Store(name) namespaces over localStorage, kv() settings, contextforge → bcc migration
  schema/           style.js (shared style schema) · checkpoint.js (pure checkpoint logic)
  export/           markdown.js (the prompt) · fixtures.js (MSW, Playwright, JSON, API markdown, curl, HAR)
  net/              intercept.js (THE fetch/XHR/beacon patch) · recording.js (replay) · mock-engine.js
  journey.js        selectors, recording, replay, pending-run persistence
  site.js · csp.js · clipboard.js · files.js · hub-client.js · compare.js
src/adapters/       one folder per data source; selector profiles live here (web/, figma/, octane/)
src/tools/          one file per tool, each exporting a definition; index.js is the catalogue
hub/server.mjs      optional loopback server: namespaced items + serves dist/
scripts/            copy · pack · doctor
test/               smoke.mjs (pure logic) · browser.mjs (real Chromium via CDP) · lib/ · fixtures/
```

## Adding a tool

Create `src/tools/<id>.js` exporting a definition and add it to `src/tools/index.js`:

```js
export default {
  id: 'thing', title: 'Thing', desc: 'One line for the palette.', icon: '🔧',
  group: 'context',              // context | state | wire | journeys | design | calibration | bcc
  sites: ['web', '*'],           // ranks first on these sites; '*' = generic; never hides
  keywords: ['synonyms', 'for', 'the palette'],
  start(ctx) {
    const p = ctx.panel({ width: 420 });      // geometry remembered per tool id; ✕ calls stop()
    // ... build p.body / p.foot with el()
    return { stop(reason) { /* remove listeners, restore patches */ p.close(); } };
  },
};
```

`stop(reason)` runs on panel close (`'close'`), `BCC.unload()` (`'unload'`), and
navigation (`'pagehide'`). Return whatever API the tests need on the instance;
`BCC.instance(id)` hands it back.

Need to run at boot without a panel (the mock engine, journey resume)? `onBoot(fn)` from
`app/main.js`. Want a row in the dock menu? `addMenuSection(title, () => rows)` from
`app/dock.js`.

## Rules that keep this maintainable

- **One interceptor.** Anything that needs `fetch`/XHR/`sendBeacon` subscribes to
  `core/net/intercept.js`. Never patch them yourself; three stacked patches restore in
  the wrong order.
- **Every tool declares what it touches** and undoes it in `stop()`. Listeners, patched
  globals, highlighters. Nothing leaks past navigation.
- **Restore by reference, not by name.** Minification renames functions; compare the
  installed function to the one you installed before putting the original back.
- **Selectors never live in scraping logic.** Figma and Octane change their DOM; strings
  that could break go in `adapters/<source>/selectors.js` or a constant at the top.
- **Anchor on accessibility attributes, not classes.**
- **Normalize at the adapter boundary.** `compare` and the markdown renderers never know
  where a value came from.
- **Fail visibly, not silently.** "Not a React page", "no panel accepted", "nothing to
  restore here" — say it in the panel.
- **Never let instrumentation break the host page.** Wrap everything in try/catch and
  always call through to the original.
- **Credentials stay on the machine by default.** New export paths go through
  `redactForExport` / `stripHeaders`.
- **Budget.** `dist/bcc.js` ≤ 250 KB minified; the build fails over it.

## Tests

```bash
npm test               # unit + browser
npm run test:unit      # pure logic only, no browser needed
node test/browser.mjs journeys mock   # only sections whose name contains these
```

`test/browser.mjs` needs `chromium` on PATH (override with `CHROME=...`). It starts a
throwaway profile and a no-store fixture app on two ports — both deliberate, as a
persistent profile silently carries `localStorage` and cached HTML between runs.

Pure logic belongs in `smoke.mjs` (it shims `localStorage`/`location` so core modules
load under Node). Anything touching the DOM, a patch, or navigation belongs in
`browser.mjs`: add a fixture page under `test/fixtures/` if the existing ones do not
exercise it, and drive the tool through `BCC.start(id)` / the instance API or the
`$click` / `$field` shadow-root helpers.

Figma and Octane cannot be covered without a live instance. Keep their logic thin and
their selector files fat, so a break is a data fix rather than a code fix.
