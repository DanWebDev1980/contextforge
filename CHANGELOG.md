# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-09-01

First public release on npm.

### Added

- **`npx browser-command-center`** — no clone, no build. Puts `dist/bcc.js` on
  the clipboard and prints the DevTools Snippet steps. Also `hub`, `pack`,
  `path` and `doctor` subcommands, and a `bcc` alias.
- **21 tools** in one pasteable bundle behind a command palette
  (`Ctrl+Shift+Space`) and a dock: basket, inspect element, component tree,
  errors, page facts, a11y outline, text clip, checkpoints, storage editor,
  env switcher, network recorder, mock responses, GA4 events, journeys,
  compare, inspect Figma, Figma stickies, Octane story, probe, diagnose,
  settings.
- **Checkpoints** — save and restore localStorage, sessionStorage, cookies,
  form values and scroll position, with undo, credential redaction and
  cross-origin import that rewrites origins.
- **Wire** — record fetch/XHR/beacon traffic and export it as MSW handlers,
  Playwright routes, JSON, API markdown, curl or HAR; mock responses from glob
  rules with latency, failure and drop modes that survive a reload.
- **Journeys** — record a form journey and replay it, including across hard
  navigations.
- **The hub** — an optional loopback server that mirrors captures between
  origins and serves the launcher page.
- **Experimental ESM exports** so you can build your own bundle from a subset
  of tools: `browser-command-center`, `.../tools`, `.../tools/<id>`.
- CI running 33 unit checks on Node 20 and 22, 110 browser checks against the
  real bundle in headless Chromium on Node 22, and a packaging job that installs
  the built tarball and drives the CLI from an unrelated directory.

### Known limitations

- **Inspect Figma, Figma stickies and Octane story are uncovered by tests** and
  have never been run against the real products. Their selectors are a best
  guess anchored on the most stable hooks; run **Diagnose** once against each
  and adjust `src/adapters/`. See [docs/calibration.md][cal].
- The library exports are experimental: the build-time version define falls
  back to `'dev'` under a consumer's bundler, and the surface may move before
  2.0.
- Checkpoints do not cover IndexedDB.

[cal]: https://github.com/DanWebDev1980/browser-command-center/blob/main/docs/calibration.md
[Unreleased]: https://github.com/DanWebDev1980/browser-command-center/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/DanWebDev1980/browser-command-center/releases/tag/v1.0.0
