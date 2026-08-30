# Contributing

## Layout

```
src/core/           overlay UI kit, basket store, schema, markdown export, compare
src/adapters/       one folder per data source; selector profiles live here
src/tools/          one file per tool — each is a build entry point
hub/                optional loopback server for cross-origin captures
test/               smoke.mjs (pure logic) + browser.mjs (real Chromium via CDP)
```

Adding a file to `src/tools/` is all it takes to add a tool; `build.mjs` picks it
up. Add a line to `DESCRIPTIONS` there so it is labelled on the launcher page.

## Rules that keep this maintainable

- **Selectors never live in scraping logic.** Figma and Octane change their DOM;
  put every string that could break in `adapters/<source>/selectors.js` or an
  equivalent constant at the top of the file.
- **Anchor on accessibility attributes, not classes.** `aria-label`, `title`,
  `role` and visible text survive rebuilds; hashed class names do not.
- **Normalize at the adapter boundary.** Everything becomes the schema in
  `core/schema/style.js` — px numbers, `#rrggbb` colours, numeric font weights —
  so `compare` never has to know where a value came from.
- **Restore what you patch.** `ga4` monkey-patches three globals; its `stop()`
  puts all three back. Anything similar must do the same.
- **Fail visibly, not silently.** If an adapter finds nothing, say so in the
  panel and point at `probe`. A capture full of `null` is worse than an error.
- **Never let instrumentation break the host page.** Wrap patched globals in
  try/catch and always call through to the original.

## Tests

```bash
npm test          # both suites
npm run test:unit # pure logic only, no browser needed
```

`test/browser.mjs` needs `chromium` on PATH (override with `CHROME=...`). It
starts a throwaway profile and a no-store fixture server — both deliberate, as a
persistent profile silently carries `localStorage` and cached HTML between runs
and corrupts every assertion.

If you add a tool that touches the DOM, add browser coverage. Pure-logic helpers
belong in `smoke.mjs`.

Figma and Octane cannot be covered this way without a live instance. Keep their
logic thin and their selector files fat, so a break is a data fix rather than a
code fix.
