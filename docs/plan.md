# BrowserCommandCenter — plan

> **The web developer's power house of tools.**
> One script. Paste it once. Every browser task a developer does by hand — capturing
> context for an AI, saving and restoring app state, recording and mocking API
> traffic, reading design and ticket sources — from one menu, on a machine where
> you cannot install anything.

Status: **built 2026-08-31** — phases 0–3 implemented as one bundle
(`dist/bcc.js`, 21 tools, ~203 KB minified) with a unit suite and a browser suite
driving the real bundle in Chromium; see §12 for what was verified and what
deviates from the text below. The plan is kept as written; §12 is the delta.

**Environment this is built for:** Microsoft Edge on a locked-down Windows
machine; DevTools console and Snippets available; Node.js installed (so the hub
is usable at work); target apps are React SPAs; AI target is Copilot Chat in the
IDE; single user for now.

---

## 1. Mission

Developers on locked-down corporate machines lose hours to browser chores that
have nothing to do with the change they are making: getting an app back into the
state where a bug shows, copying ticket text into a prompt, hand-typing the
styles from a Figma panel, re-clicking through a wizard on three environments,
faking an API error to see how the UI copes. Every one of those needs either a
browser extension, a local install, or a tab-juggling ritual.

BrowserCommandCenter (BCC) removes that constraint. Everything runs as plain
JavaScript injected into the page you are already on. No extension, no
permissions, no network dependency. The output of every tool is either a change
to the page in front of you, or text on your clipboard — structured so an AI
assistant (Copilot, Claude, whatever the machine allows) can act on it directly.

Four jobs, in priority order:

1. **Build AI context with ease.** Capture what the AI cannot see — live DOM
   styles, design intent, ticket scope, analytics contracts, API shapes,
   errors — and hand it over as one prompt. (This is what contextforge already
   does.)
2. **Own application state.** Snapshot where you are in an app — storage,
   cookies, URL — name it, file it by app / page / journey / environment, and
   get back there in one click, in any environment.
3. **Control the wire.** See what the app sends and receives; record it, replay
   it, break it on purpose. Turn real traffic into mocks and test fixtures.
4. **Replay the chores.** Where state has to be *created* server-side by
   clicking through forms, record the clicks once and replay them — or replay
   the requests they produced, which is sturdier.

Everything else is in service of those four.

## 2. Where we are (honest assessment of contextforge)

What is genuinely good and must be kept:

- The architecture is right for the constraint. Self-contained IIFE bundles,
  shadow-DOM overlay, per-origin `localStorage`, optional loopback hub. The
  code respects the host page (restores patched globals, capture-phase
  listeners, no CSS bleed).
- The **adapter → schema → export** split. `compare` never knows where a value
  came from. This generalises cleanly to network, storage and error captures.
- Selectors-out-of-logic for Figma and Octane, with `probe` and `diagnose` as
  the calibration loop. Those two tools have never been run against the real
  products; that stays true and is not a blocker for anything below.
- The test approach: pure logic in `smoke.mjs`, a real Chromium over CDP in
  `browser.mjs`. Extend, do not replace.

What is holding it back:

- **Ten separate pastes.** Each tool is its own bundle with its own paste; the
  shared core is duplicated ten times (140 KB total, ~60–80 KB deduplicated).
  Switching tools means going back to the launcher page. This is the single
  biggest usability problem and the first thing to fix.
- **Tools cannot coexist.** `teardown()` removes the whole shadow root, so
  opening `basket` kills a running `ga4` watcher. A network recorder that must
  run *while* you inspect makes this a hard requirement.
- **One store, one shape.** `store.js` is the basket and nothing else. State
  checkpoints, recordings and settings need namespaces, export/import of a
  whole namespace, and a migration path for the key prefix.
- **The hub is less reliable than it looks.** Console-injected code is exempt
  from `script-src`, but the `fetch()` it makes is still governed by the page's
  `connect-src`. On Figma (strict CSP) the silent "mirror to hub" almost
  certainly fails silently today. Clipboard / file export must be the primary
  cross-origin path; the hub is a convenience where it works. (Verify with a
  one-line `fetch('http://localhost:7373/ping')` on figma.com — recorded as a
  task in phase 0.)
- **Re-injection on every full page load.** Unavoidable for console-injected
  code, but the install story can be much better than "go back to the launcher
  and copy again" — see §4.2.

## 3. Product shape

### 3.1 One script

`dist/bcc.js` — everything, one paste. On load it mounts a small **dock**
(bottom-right pill, draggable, collapsible to an icon) and registers a hotkey
(`Ctrl+Shift+Space`, configurable) that opens a **command palette**: type to
filter tools, `Enter` to launch. The palette is the fast path; the dock is
discoverability and a place to see what is running.

```
┌ BCC ▸ ──────────────────────────────────────────────┐
│ > net                                               │
│  ⚡ Network recorder     record fetch/XHR traffic    │
│  🎭 Mock responses       replay / override recorded │
│  📊 GA4 events           live analytics view        │
└─────────────────────────────────────────────────────┘
```

Tools are **site-aware**: the registry ranks Figma tools first on figma.com,
Octane tools first on Octane, and hides nothing. Detection is the existing
`detectSite()` promoted to core, extended with the user's environment map (§5).

Individual per-tool bundles go away as a product. The build keeps the ability
(`node build.mjs --split`) because it costs nothing and is useful for the
browser test, but `index.html` offers one thing: `bcc.js`.

### 3.2 Multiple tools at once

The overlay becomes a **window manager** in miniature: every tool gets its own
panel, panels stack and remember position per tool (in settings), closing a
panel stops that tool only. `teardown()` becomes `bcc.unload()` — dock and all —
and is what `Esc` on the dock does. Panels are resizable; the basket and the
network recorder both need height.

### 3.3 Install paths, in order of preference

1. **DevTools Snippet** (recommended, and new). Sources → Snippets → New →
   paste `bcc.js` → save as `bcc`. From then on `Ctrl+P`, `!bcc`, Enter runs it
   on any tab, in any origin, CSP be damned. Snippets persist in the browser
   profile, need no install rights, and work in Chrome and Edge. This is the
   headline install instruction in the new README.
2. **Console paste** — as today; the fallback when Snippets are disabled by
   policy.
3. **Bookmarklet** — one click, but blocked by CSP on strict sites. Offered,
   documented as unreliable.

`bcc.js` also stores its own version and a SHA in `localStorage` so the dock can
say "you are running 1.3.0, built 2026-08-30" — useful when the bundle travels
by email or USB.

### 3.4 Naming

- Repo / package: `browser-command-center`. Display name **BrowserCommandCenter**,
  short **BCC**.
- Global: `window.BCC` (registry, `unload()`, `store`, `version`). Nothing else
  on `window`.
- Storage prefix: `bcc:` — `bcc:basket:v1`, `bcc:checkpoints:v1`,
  `bcc:recordings:v1`, `bcc:settings:v1`. One-time migration reads
  `contextforge:basket:v1` into `bcc:basket:v1` and deletes the old key.
- Overlay host id: `bcc-root`. Hub dir: `.bcc-hub/`. Port stays `7373`.
- Tagline everywhere: *The web developer's power house of tools.*

## 4. Architecture

```
src/
  app/
    main.js            entry: mount dock, register hotkey, migrate storage, expose window.BCC
    registry.js        registerTool({ id, title, desc, icon, group, sites, start }) + ranking
    dock.js            the pill + running-tools list
    palette.js         command palette
    settings.js        hotkey, env map, redaction rules, panel positions
  core/
    overlay/           ui kit (existing) + window manager (new): panels, focus, positions
    store/
      store.js         namespaced Store(name): all/add/remove/replaceAll/merge/onChange/export/import
      migrate.js       contextforge → bcc
    schema/            style.js (existing), checkpoint.js, recording.js, error.js (new)
    export/
      markdown.js      prompt (existing, extended with new kinds)
      fixtures.js      MSW handlers, Playwright routes, JSON fixtures, curl, HAR-lite
    net/
      intercept.js     ONE shared fetch/XHR/sendBeacon patch with subscribers (ga4 + recorder + mock share it)
    site.js            detectSite(), environment resolution from the env map
    clipboard.js, compare.js, hub-client.js   (existing)
  adapters/            web/, figma/, octane/ (existing) + web/storage.js, web/errors.js, web/fiber.js
  tools/               one file per tool, each exports a tool definition — no self-start
hub/server.mjs         namespaced items; serves dist/
test/                  smoke.mjs, browser.mjs (+ fixtures per tool)
```

Rules carried over from `CONTRIBUTING.md` still hold. Two new ones:

- **One interceptor.** `ga4`, the network recorder and mock mode all need
  `fetch`/XHR patched. Three independent patches would stack and restore in the
  wrong order. `core/net/intercept.js` patches once, refcounts subscribers, and
  restores when the last one leaves.
- **Every tool declares what it touches.** `start()` returns `{ stop }` and the
  registry enforces that stop is called on panel close, on `unload()`, and on
  `pagehide`. Nothing leaks past navigation.

## 5. Feature: state checkpoints

The flagship new capability.

### 5.1 What a checkpoint is

```js
{
  kind: 'checkpoint', id, createdAt, updatedAt,
  app:      'billing-portal',        // user-named; defaults from env map, else hostname
  env:      'test',                  // resolved from env map; 'unknown' if no match
  page:     'Invoices › Detail',     // defaults to document.title, editable
  journey:  'refund flow',           // free text, autocomplete from existing
  step:     'after amount entered',  // free text
  tags:     ['bug-1234'],
  notes:    '',
  url:      { origin, path, search, hash },      // origin kept for provenance; path/search/hash restored
  storage:  { local: {k:v}, session: {k:v} },    // strings as stored, no parsing
  cookies:  [{ name, value, path, domain, expires, sameSite }],   // document.cookie only — see limits
  scroll:   { x, y },
  meta:     { title, userAgent, viewport, bccVersion }
}
```

**Not** included in v1: IndexedDB, Cache Storage, service-worker state,
`history.state`, in-memory app state. IndexedDB is phase 3 (it is doable for
small DBs but every schema is different and the restore ordering is fiddly).

### 5.2 Capture

`Checkpoints` tool → **Save current state**. A form pre-filled with app / env /
page from the env map and `document.title`; journey and step are the two you
actually type. A **keys** section lists every storage key and cookie with a
tick box, size, and a preview — so a checkpoint for "wizard step 3" can be just
the three keys that matter, not the 40 that happen to exist. Untick state is
remembered per app.

**Redaction by default.** Keys or cookie names matching
`/token|auth|jwt|session|secret|password|bearer/i` are captured but flagged, and
excluded from *export* unless you opt in per checkpoint. Restoring on the same
origin uses them; a JSON file that leaves the machine does not carry them
unless you said so. The pattern list lives in settings.

### 5.3 Restore

- **Same origin:** write storage (merge or replace — replace is the default,
  merge is a toggle), write cookies, then `location.assign(path+search+hash)`.
  Scroll restored after `load` via a one-shot `bcc:pending-scroll` key.
- **Different environment, same app:** the env map is **per app** (there is no
  shared host pattern across apps), e.g.
  `{ billing: { dev: 'http://localhost:3000', test: 'https://billing-test.corp', prod: 'https://billing.corp' } }`.
  The current origin is looked up across every app's hosts to resolve
  `app` + `env` automatically; unknown origins prompt once to be added. Restoring
  a `test` checkpoint while on `dev` rewrites only the origin. Storage values
  that *contain* the source origin are shown in a **diff** before restore, with
  a one-click "rewrite origin inside values" — common for API base URLs cached
  in storage. The env map has a small settings UI and exports as JSON.
- **Different origin, no mapping:** allowed, with a warning.
- Before any restore, an automatic **"before restore"** checkpoint is taken, so
  restore is always undoable.

A checkpoint whose storage keys are all missing on the current origin is shown
greyed with "nothing to restore here" rather than failing quietly.

### 5.4 Library

The checkpoints panel is a table: app › journey › step, with env badge,
relative time, tags. Sort by any column; filter box matches across all fields;
group by app / journey / env / page. Star favourites to pin them to the top of
the dock's quick-restore menu (one click, no panel). Bulk export selected to
JSON; import merges by id. Clicking a row shows the full record with a
key-level diff against the *current* page state — that alone is a debugging
tool ("what changed in storage since I saved this?").

### 5.5 Cross-machine / cross-environment transport

Primary: **Export JSON → file** and **Import JSON ← file** (file input inside
the panel — works everywhere, no clipboard permission games). Secondary:
copy/paste JSON. Tertiary: the hub — Node is available on the work machine, so
`npm run hub` is a real option there for the apps whose CSP allows a loopback
`fetch`; Diagnose reports which do. Environment maps export with the
checkpoints so the same file resolves the same names on another machine.
Single user for now: import merges by id, newest wins, no conflict UI.

### 5.6 Limits, stated plainly

- `HttpOnly` cookies are invisible to JavaScript. Auth cookies usually are.
  A checkpoint restores *application* state; it does not log you in. If login
  lives in `localStorage` (many SPAs), it does restore it — hence redaction.
- Tokens expire. A week-old checkpoint restores the token that was valid a week
  ago. Expected; the diff view makes it obvious.
- Restore triggers a full navigation. In-memory state the app never persisted
  is not recoverable by anything.

## 6. Feature: network recorder and mock mode

The second new pillar; shares the interceptor with `ga4`.

### 6.1 Recorder

Start recording → every `fetch` / XHR after that point is captured: method, URL,
request headers (minus `authorization`/`cookie` by default), request body,
status, response headers, response body (cloned; JSON parsed, text kept, binary
noted with size only), timing. Filter by URL / method / status; group by
endpoint; click for a pretty-printed body. Requests before injection are
listed from `performance.getEntriesByType('resource')` with name/type/duration
only, greyed, so you can see what you missed and reload with the recorder
armed if it matters (the SPA routes usually re-fetch on navigation anyway).

Save a recording (namespace `recordings`, same app / env / journey metadata as
checkpoints — the two are designed to be saved together: "state + the traffic
that produced it").

**Replay request(s).** Any recorded request — or a selected sequence of them —
can be re-sent against the current environment: origin rewritten via the env
map, auth headers taken from the *current* page's matching requests where
possible (recorded tokens are stale by definition), bodies editable before
send. This is the robust way to recreate server-side state: the three POSTs a
wizard makes, replayed in order, without touching the UI. It costs almost
nothing on top of the recorder and is the recommended fallback when a UI
journey (§6.4) breaks.

### 6.2 Export as fixtures

From a recording, or a selection within it. First three are the stack in use
and ship together; the rest follow.

- **MSW handlers** (`http.get('/api/invoices/:id', …)`) with path params
  inferred from numeric / UUID segments.
- **Playwright `page.route()`** block.
- **Plain JSON fixtures** (Jest / Vitest) — one object per endpoint,
  de-duplicated by method+path, query params as variants.
- **Markdown** for the basket: an "API contract" section listing endpoints,
  shapes, and example responses — often the most useful context an AI can get
  about a backend it cannot see.
- **curl** for a single request (auth headers stripped unless opted in).
- **HAR 1.2** — importable into DevTools and Charles/Proxyman, for the cases
  where a colleague *does* have tools.

### 6.3 Mock mode

Load a recording (or hand-edit rules) → matching requests are answered from the
recording instead of the network. Per rule: match on method + URL pattern;
response body (editable JSON), status, latency, "fail N times then succeed",
"drop connection". Unmatched requests pass through. Rules persist per app and
can be toggled from the dock without opening the panel, so "prod API returning
500 on save" is a switch, not a setup.

This only covers requests made *after* injection through `fetch`/XHR — not
initial HTML, not `<img>`/`<script>`, not service-worker-served responses.
Document it; it is still the 90% case for SPAs.

### 6.4 Journeys (minimal UI replay)

In scope because some server-side state only exists after clicking through a
few pages of forms. Scoped to exactly that: **form fills and submits across a
few pages**. Not a general automation engine.

**Record.** Start → every `input`/`change`/`click`/`submit` on the page is
captured as a step `{ action, selector, value?, url }`. Selector strategy, in
priority order, all computed at record time and stored together so replay can
fall through: `data-testid` → `label` text / `aria-label` → `role` + accessible
name → `id` → short CSS path (the existing `selectorFor`). Password fields
record `‹prompt›` instead of the value and ask at replay. Steps are editable
in the panel: delete, reorder, change a value, mark a value as "ask me each
run" (for the invoice number you want different every time).

**Replay.** Step through: wait for the selector (up to 10 s, polling), scroll
into view, dispatch the real events React listens to (native setter +
`input`/`change` for controlled inputs — the usual React gotcha), click, then
wait for either a route change or the next step's selector. Failures stop the
run with the step highlighted and a "skip / retry / abort" choice — no silent
partial journeys.

**The hard-navigation problem.** BCC lives in the page; a full page load kills
it. SPA route changes are fine. Where a journey crosses a real navigation
(login redirect, a legacy page), the pending run is written to
`sessionStorage` (`bcc:journey:pending`) and BCC **auto-resumes** it the moment
it is re-injected — `Ctrl+P`, `!bcc`, Enter, and it carries on from the next
step. That is one keystroke per hard navigation, which is acceptable for "a
few pages"; if it turns out journeys routinely cross many hard loads, the
answer is request replay (§6.1), not a smarter recorder.

Journeys share the app / env / journey / step metadata and the library UI with
checkpoints. A journey can end by taking a checkpoint automatically, so "run
journey → save state" is one action.

## 7. Tool catalogue

Grouped as the palette shows them. **(kept)** = exists today, moves into the
shell; **(new)** = this plan.

**Context** (build the prompt)
- Basket — (kept) gains: item kinds for checkpoints, recordings, errors,
  a11y, component trees; per-item "include" is persisted; export presets
  ("styles only", "everything").
- Inspect element — (kept) gains: CSS custom properties in effect on the node
  (design tokens), the `@media`/container context, and "copy as CSS".
- Text clipper — (kept).
- Component tree — (new) from a clicked node, walk React fiber
  (`__reactFiber$*`) up to the root: component names, key props (sanitised,
  truncated), hooks state count, source file when dev builds expose
  `_debugSource`. React only — the target apps are React; no Angular/Vue
  branches to maintain. Answers "what renders this?" — the question every AI
  prompt starts with. In production builds names may be minified; the tool
  says so rather than showing `t`.
- Errors — (new) captures `console.error/warn`, `window.onerror`,
  `unhandledrejection` with stacks and the URL at the time, from injection
  onwards; backlog from nothing (there is no API for past console output).
- Page facts — (new) one-click environment fingerprint: framework + version,
  build id from meta/script hashes, viewport, UA, feature flags found in
  storage (by the flag pattern in settings), web vitals so far
  (LCP/CLS/INP/TTFB via `PerformanceObserver`), long-task count.
- Accessibility outline — (new) role / accessible-name tree of a region,
  headings outline, contrast flags. Cheaper than styles for describing *what*
  is on screen.

**State**
- Checkpoints — (new) §5.
- Storage editor — (new) live view/edit of local/session/cookies with JSON
  pretty-print, plus **watch mode**: patch `Storage.prototype.setItem` /
  `removeItem` and log every write with a stack trace. "Who keeps resetting
  this key?" answered in seconds.
- Environment switcher — (new) same path on another env of the same app from
  the env map; also lives in the dock menu.

**Wire**
- Network recorder — (new) §6.1, including request replay.
- Mock responses — (new) §6.3.
- GA4 events — (kept) re-based on the shared interceptor.

**Journeys**
- Journey recorder — (new) §6.4. Record, edit, replay; auto-resume across
  hard navigations.

**Design & tickets** (unchanged logic, unchanged caveats)
- Inspect Figma, Figma stickies, Compare, Octane story — (kept).

**Calibration**
- Probe, Diagnose — (kept). Diagnose gains a "CSP report" section: reads the
  page's CSP header/meta and states whether hub, bookmarklet, and `eval` will
  work here.

Deliberately **out of scope** for now, with reasons:

- **A general automation engine** (drag/drop, conditional branches, loops,
  visual assertions). The journey recorder is deliberately limited to forms
  and clicks; anything beyond that is request replay or a Playwright script
  generated from the recording — a possible phase 3 export.
- **Screenshots.** `getDisplayMedia` works without installs but prompts every
  time and captures the whole screen; `html2canvas` is 40 KB and wrong about
  half of modern CSS. Phase 3 candidate, low priority: the AI tools on a
  locked-down machine usually cannot take images anyway.
- **IndexedDB in checkpoints.** Phase 3, see §5.1.
- **GA4 reports / any API that needs OAuth.** Server-side by definition.

## 8. Phases

Each phase ships a working `bcc.js`; nothing is half-migrated at a phase end.

**Phase 0 — rename and shell** (foundation, no new capability)
1. Rename: package, README, CONTRIBUTING, storage keys with migration, host id,
   hub dir, `window.BCC`.
2. `Store(name)` with namespaces + export/import; basket moves onto it.
3. Registry, dock, palette, hotkey, site ranking. Tools export definitions
   instead of self-starting. Window manager: panels coexist, per-tool stop.
4. Shared interceptor; `ga4` moves onto it.
5. Build: `dist/bcc.js` + `index.html` with the Snippet instructions; `--split`
   kept for tests.
6. Tests: browser test drives the palette to launch each tool; existing
   assertions pass unchanged. Verify the Figma `connect-src` hypothesis and
   record the result in the README.

**Phase 1 — state**
1. Checkpoints: capture, library, same-origin restore, undo checkpoint.
2. Env map in settings; cross-env restore with origin rewrite and value diff.
3. Redaction rules; JSON file export/import.
4. Storage editor + watch mode.
5. Environment switcher in dock.
6. Tests: fixture app that writes storage and cookies; save → clear → restore →
   assert; cross-origin restore between the two fixture ports.

**Phase 2 — wire and journeys**
1. Recorder with body capture and pre-injection resource listing.
2. Request replay against the current env.
3. Fixture exports: MSW, Playwright, plain JSON, markdown first; curl and HAR
   after.
4. Mock mode with rules, latency, failure injection, dock toggle.
5. Journey recorder: record, edit, replay, React-safe input dispatch,
   auto-resume after hard navigation, end-with-checkpoint.
6. Tests: fixture page that fetches; record → export → assert handler text;
   mock → assert the page received the mocked body; a two-page fixture form
   with a hard navigation between pages — record → replay → assert the server
   (fixture) received both submits, including the resume path.

**Phase 3 — context depth**
1. Component tree (React fiber; Angular if `ng` present).
2. Errors, Page facts, Accessibility outline.
3. Inspect element: tokens, copy-as-CSS.
4. Basket: new renderers, presets.
5. Then reassess: IndexedDB, screenshots, journey replay — against real usage.

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| DevTools disabled by group policy on the work machine | Nothing here works then; confirm before building (Q1). Bookmarklet is the only other path and CSP-limited. |
| Bundle grows past what a bookmarklet URL tolerates | Chromium handles multi-MB `javascript:` URLs; Snippet and console have no practical limit. Budget: `bcc.js` ≤ 250 KB minified; the build fails over that. |
| Two patches of `fetch` fighting (ours vs the app's own instrumentation) | Single interceptor, always calls through, patched *after* the app's, restored in reverse. Documented known-bad: apps that capture `window.fetch` into a closure at boot — the recorder sees nothing; the pre-injection list says so. |
| Checkpoint files carrying credentials off the machine | Redaction by default, opt-in per export, pattern list visible in settings, exported file lists which keys were withheld. |
| Restoring storage that breaks the app (schema drift between versions) | Automatic undo checkpoint before every restore; key-level selection on both save and restore. |
| Figma / Octane adapters still uncalibrated | Unchanged in this plan; grouped separately; not on the critical path. |
| Journey replay breaks whenever the UI changes | Multi-strategy selectors with fall-through; re-recording is cheap by design; request replay is the sturdier alternative and is built first. |
| Journey crosses a hard navigation and BCC dies with the page | Pending run persisted in `sessionStorage`, auto-resume on re-inject; documented as one keystroke per hard load. |
| React controlled inputs ignore synthetic `value =` writes | Use the native `HTMLInputElement.prototype.value` setter then dispatch `input`; covered by the browser test against a React-style fixture. |
| Scope: this is a lot | Phases are independently shippable; phase 0 is pure consolidation and makes every later phase cheaper. |

## 10. Decisions

- One bundle, palette + dock, per-tool panels that coexist. Individual bundles
  are a build flag, not a product.
- DevTools Snippets are the recommended install (confirmed available on the
  work machine, Edge); console paste second; bookmarklet third.
- File export/import is the primary cross-origin transport. The hub stays and
  is usable at work (Node present); Diagnose tells you when CSP blocks it.
- Checkpoints capture credential-looking keys, restore them locally, and
  redact them from exports unless opted in per export.
- Env map is per app, with a settings UI; app + env resolve from the current
  origin.
- Local/session/cookies in phase 1; IndexedDB deferred to phase 3 (confirmed
  nice-to-have).
- Journey recorder is **in**, scoped to forms + submits across a few pages,
  phase 2; request replay is built alongside as the sturdier path.
- Fixture exports target MSW, Playwright and plain JSON first.
- Component tree is React-only.
- Copilot Chat via clipboard markdown remains the sole AI export.
- Single user: simple merge, no conflict UI.
- Palette hotkey `Ctrl+Shift+Space`, configurable in settings (unbound in Edge
  and Chrome; if a corporate IME claims it, `Ctrl+Shift+K` is the fallback).
- Figma/Octane code is untouched beyond the rename.

## 11. Review record

### 11.1 Questions asked and answered (2026-08-31)

| Question | Answer | Effect |
| --- | --- | --- |
| Work machine capabilities | Edge; DevTools console + Snippets work; Node installed | Snippet install is primary; hub is real at work |
| Framework | React only | Component tree = fiber walk only |
| Where state lives | local, session, cookies, IDB | First three phase 1; IDB confirmed nice-to-have → phase 3 |
| Meaning of "mock web data" | Both live mocking and fixtures | §6.2 + §6.3 both in phase 2 |
| Auth in checkpoints | Capture, restore locally, redact from export | §5.2 as written |
| Environments | Per-app hosts, no shared pattern | Per-app env map with settings UI |
| Journey replay | Needed: server-side state created by clicking; forms + submits across a few pages | §6.4 added; minimal recorder in phase 2 |
| Test stack | MSW, Playwright, Jest/Vitest JSON | Export order in §6.2 |
| Audience | Solo for now | Simple merge |
| AI target | Copilot Chat in IDE | Clipboard markdown stays |

### 11.2 Remaining assumption to confirm

- **Journeys mostly stay inside the SPA.** The auto-resume design (§6.4)
  assumes a hard navigation is the exception — a login redirect, one legacy
  page — not every step. If the journey that matters is *all* full page
  loads, say so: the plan would then lead with request replay for that journey
  and treat UI replay as secondary.

## 12. Build record (2026-08-31)

Everything in phases 0–3 shipped. Deviations and confirmations:

- **Figma `connect-src` hypothesis (§2, phase 0 task 6) — verified against the live
  headers.** `www.figma.com/` (marketing) sends `connect-src 'self' https://static.figma.com …`
  with no localhost: the hub is blocked there. The editor pages (`/files`, `/design`)
  send a policy restricting `script-src` only, so the hub *works* there. Both block
  bookmarklets (`nonce` + `strict-dynamic`). Diagnose's CSP report handles
  multiple comma-joined policies and reports the combined verdict. Recorded in the README.
- **Cross-env restore always targets the current origin** (§5.3 clarified). Storage is
  per-origin, so BCC cannot write into another environment from here; the env switcher
  takes you there first. Values containing the checkpoint's origin are rewritten to the
  current one, shown before confirming.
- **Request replay across environments is CORS-bound** (§6.1 caveat added). Replays run
  from the page; the current origin always works, another env only if its API allows
  the page's origin. The UI defaults to the current origin and says why.
- **Fixture exports prefer the newest 2xx response per endpoint** rather than the
  latest response, so a handler defaults to the happy path; other statuses are listed
  as variants.
- **Journey recording also survives hard navigations** (not only the pending run):
  the in-progress step list is persisted to `sessionStorage` and resumed on re-inject.
  Tools receive a `stop(reason)` (`close` / `pagehide` / `unload`) so they can keep
  state across navigation and drop it on an explicit close.
- **The registry's ranking hides nothing**, as specified; fuzzy matching is limited to
  title/id so `insp` does not match every tool.
- **Bundle:** 202.6 KB minified against the 250 KB budget; the build fails over budget.
- **Tests:** `npm test` → 33 unit checks (store, migration, hotkeys, redaction, env map,
  checkpoint schema, fixture generators incl. HAR, CSP incl. the captured Figma header,
  mock matching, GA4 decoding, every markdown renderer) and 110 browser checks
  (see README → Verification status). Figma/Octane adapters remain uncovered by design.
- **Helper scripts:** `npm run copy` (clipboard + Snippet steps), `npm run pack`
  (release folder with INSTALL.txt), `npm run doctor` (environment check, `--fix`).
- **§11.2 still open:** journeys are assumed to be mostly in-SPA. The fixture journey
  crosses two hard loads and resumes with one re-inject each; if real journeys are
  all hard loads, lead with request replay.
- **Not built (as planned):** IndexedDB in checkpoints, screenshots, a general
  automation engine, GA4 reports.
