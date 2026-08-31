# BrowserCommandCenter (BCC)

> **The web developer's power house of tools.**
> One script. Paste it once. Every browser chore a developer does by hand — capturing
> context for an AI, saving and restoring app state, recording and mocking API traffic,
> replaying form journeys, reading design and ticket sources — from one command
> palette, on a machine where you cannot install anything.

No extension. No install. No permissions. Plain JavaScript injected into the page you
are already on. Every tool's output is either a change to the page in front of you or
text on your clipboard, structured so Copilot Chat (or any AI) can act on it directly.

```
                    ┌──────────────── BCC dock · Ctrl+Shift+Space ────────────────┐
  Octane story ──┐  │  Context   basket · inspect element · component tree ·      │
  Figma styles ──┤  │            errors · page facts · a11y outline · text clip   │
  Figma notes  ──┼─►│  State     checkpoints · storage editor · env switcher      │──► one prompt
  page styles  ──┤  │  Wire      network recorder · mock responses · GA4 events   │    fixtures (MSW…)
  API traffic  ──┘  │  Journeys  record → replay across pages                    │    checkpoints (JSON)
                    └────────────────────────────────────────────────────────────┘
```

## Install (Edge or Chrome, ~1 minute, no admin rights)

```bash
git clone <your-fork> && cd browser-command-center
npm install
npm run copy          # builds, puts dist/bcc.js on your clipboard, prints the steps below
```

Then, **as a DevTools Snippet** (recommended — survives restarts, immune to CSP):

1. On any page: `F12` → `Ctrl+Shift+P` → type `snippets` → **Show Snippets**.
2. **+ New snippet** → paste → `Ctrl+S` → name it `bcc`.
3. From now on, on any tab: `F12` → `Ctrl+P` → `!bcc` → `Enter`.

The dock appears bottom-right. `Ctrl+Shift+Space` (configurable) opens the palette:
type a few letters, `Enter`. Tools coexist in their own panels; closing a panel stops
that tool only. Dock menu **≡ → Unload** removes everything.

Other paths, in order of preference:

- **Console paste** — `F12` → Console → `allow pasting` (first time) → paste → `Enter`.
  The fallback when Snippets are disabled by policy.
- **Bookmarklet** — one click, offered on `dist/index.html`, but blocked by any site
  with a strict `script-src` (Figma included). **Diagnose → CSP** tells you.
- **Carry it somewhere**: `npm run pack` makes `release/bcc-<version>/` with the script,
  the launcher, the hub and a four-step `INSTALL.txt`. Zip it and send it.

Console-injected code dies with a full page load. Re-run the snippet (`Ctrl+P`, `!bcc`)
— a journey mid-run or mid-recording resumes on its own.

## The tools

| Group | Tool | What it does |
| --- | --- | --- |
| Context | **Basket** | The context builder: every capture, tick what to include, presets, one Copilot-ready prompt. Export/Import JSON. |
| | **Inspect element** | Hover, click, capture the subtree's computed styles — plus the CSS custom properties (design tokens) in effect, the `@media`/`@container` context of its rules, and **Copy as CSS**. |
| | **Component tree** | Click an element: which React components render it, their props (sanitised), hook counts, source file on dev builds. Says so when names are minified. |
| | **Errors** | `console.error/warn`, uncaught exceptions, unhandled rejections, failed resource loads — with stacks, from injection onwards. |
| | **Page facts** | Framework + version, build ids, viewport, UA, feature flags found in storage, web vitals so far. |
| | **Accessibility outline** | Role / accessible-name tree of a region, headings outline, WCAG AA contrast failures. |
| | **Text clipper** | Select text anywhere, `Alt+C`, it lands in the basket with its URL. |
| State | **Checkpoints** | Snapshot storage + cookies + URL + scroll; name it by app / env / page / journey / step; restore in one click; automatic undo; key-level diff against the page now; JSON export with credential redaction. |
| | **Storage editor** | View/edit local/session/cookies with JSON pretty-print. **Watch mode** logs every write with a stack trace. |
| | **Environment switcher** | Same path on another env of this app, from your env map. Also in the dock menu. |
| Wire | **Network recorder** | Every fetch/XHR after Record: headers, bodies, status, timing. Filter, group by endpoint. **Replay** requests against the current env. Export **MSW · Playwright · JSON fixtures · API-contract markdown · HAR**. |
| | **Mock responses** | Rules per app: body, status, latency, fail-N-times-then-succeed, drop connection. A switch in the dock. |
| | **GA4 events** | Live view of the events the page fires, decoded from `/g/collect` and `dataLayer`. |
| Journeys | **Journey recorder** | Record form fills and clicks across a few pages; edit steps; replay with React-safe input dispatch; auto-resumes across hard navigations; can end with a checkpoint. |
| Design & tickets | **Inspect Figma**, **Figma stickies**, **Compare**, **Octane story** | Unchanged from contextforge — see [How each source is read](#how-each-source-is-read). |
| Calibration | **Probe**, **Diagnose** | DOM outline for writing selectors; what the adapters resolved and why they failed; **CSP report** (will the hub, a bookmarklet, `eval` work here?). |
| BCC | **Settings** | Hotkey, env map, redaction rules, flag pattern, stripped headers. Export to match another machine. |

Tools are site-aware: Figma tools rank first on figma.com, Octane tools on Octane;
nothing is hidden.

### A typical run

```
your app   → Checkpoints    → Save current state          "refund flow › step 3"
your app   → Network        → Record → click around → Save recording · Export MSW
your app   → Inspect element → click the component → Capture
Figma      → Inspect Figma  → click the same component → Capture
your app   → Compare        → Add to basket
Octane     → Octane story   → Add to basket
your app   → Basket         → preset · write the task → Copy prompt
```

Paste into Copilot Chat with the repo open. Tomorrow: **Checkpoints → Restore** and
you are back at step 3, on whichever environment you are on.

## Checkpoints, in detail

A checkpoint is `{ app, env, page, journey, step, tags, notes, url, storage: { local, session }, cookies, scroll }`.
`app` and `env` resolve from your **env map** — per app, because there is no shared host
pattern across apps:

```json
{ "billing": { "dev": "http://localhost:3000", "test": "https://billing-test.corp", "prod": "https://billing.corp" } }
```

Set it in **Settings**, or let the **Environment switcher** add the current origin
in two fields. It travels with checkpoint exports so another machine resolves the same names.

- **Save**: the form is pre-filled; journey and step are the two you type. Every key and
  cookie has a tick box with size and preview; unticked keys are remembered per app.
- **Restore** writes storage and cookies into the origin you are on (replace by default,
  merge on request), then loads the checkpoint's path. Scroll is restored after the load.
  An automatic **before-restore** checkpoint is taken first, so restore is always undoable.
- **Across environments**: restore always targets the current origin. Values that
  contain the checkpoint's origin (API base URLs cached in storage) are rewritten to
  the current one and shown before you confirm. Use the env switcher to go elsewhere first.
- **Redaction**: keys or cookies matching `token|auth|jwt|session|secret|password|bearer`
  (editable) are captured and restored locally but **withheld from exports** unless you
  opt in per export. The file lists what was withheld.
- **Transport**: Export / Import JSON files (works everywhere); Copy / Paste JSON; the hub.
- **Limits, plainly**: `HttpOnly` cookies are invisible to JavaScript — a checkpoint
  restores *application* state, it does not log you in (unless login lives in
  `localStorage`, which is why redaction exists). Tokens expire; the diff view makes
  that obvious. Restore is a full navigation; in-memory state the app never persisted
  is not recoverable by anything. IndexedDB is not captured (yet).

## Wire, in detail

One shared interceptor patches `fetch`, `XMLHttpRequest` and `sendBeacon` when the
first of GA4 / recorder / mock needs it and restores them when the last one leaves —
unless something patched over us, in which case the chain is left alone. Known-bad:
apps that captured `window.fetch` into a closure at boot bypass it; the recorder's
greyed **pre-injection** list (from the performance timeline) shows what you missed.

- **Recorder** strips `authorization`/`cookie` (configurable). **Replay** re-sends a
  request (body editable) using the un-patched fetch — replays are never recorded or
  mocked. Replays run from the page, so CORS applies: the current origin always works;
  another env only if its API allows it. Auth headers come from the latest live request
  to the same host, since recorded tokens are stale by definition.
- **Exports**: MSW handlers with path params inferred from numeric/UUID segments
  (`/api/invoices/:invoiceId`), Playwright `page.route()` block, plain JSON fixtures
  de-duplicated by method+path, an **API contract** markdown section for the basket,
  curl per request, HAR 1.2. Fixtures prefer the newest 2xx response per endpoint.
- **Mock mode** covers fetch/XHR made after injection — not the initial HTML, not
  `<img>`/`<script>`, not service-worker responses. Unmatched requests pass through.
  Rules persist per app and re-arm at boot; the dock switch needs no panel.

## Journeys, in detail

Scoped to **form fills, selects, ticks, clicks and submits across a few pages**. Not
an automation engine — for anything else, replay the requests instead.

Selectors are computed at record time, all of them, and replay falls through:
`data-testid` → label / `aria-label` → role + accessible name → `id` → short CSS path.
Password fields record `‹prompt›` and ask at replay; any value can be marked
"ask each run". Replay waits up to 10 s per step, scrolls into view, uses the native
value setter plus `input`/`change` events (the React controlled-input gotcha), and
stops visibly on failure with Retry / Skip / Abort.

**Hard navigations**: the pending run — and an in-progress recording — live in
`sessionStorage`. A full page load kills BCC; `Ctrl+P`, `!bcc`, `Enter` and it carries
on from the next step. One keystroke per hard load. If a journey is *all* hard loads,
request replay is the sturdier tool.

## Moving captures between origins

`localStorage` is per-origin. Every store (basket, checkpoints, recordings, journeys,
mock rules) has **Export / Import** (JSON file) and **Copy / Paste JSON**. The optional
**hub** (`npm run hub`, loopback `:7373`) mirrors the basket automatically and serves
the launcher; **Pull hub** merges everything from every origin.

Console-injected code is exempt from `script-src`, but the `fetch()` it makes is still
governed by the page's `connect-src`. **Verified 2026-08-31 against figma.com**: the
marketing pages (`www.figma.com/`) send `connect-src 'self' https://static.figma.com …`
with no localhost, so the hub is **blocked** there; the editor pages (`/files`, `/design`)
send a policy that restricts `script-src` only, so the hub **works** there. Both block
bookmarklets (`nonce` + `strict-dynamic`). Run **Diagnose → CSP** on any page to know
before you rely on it.

## How each source is read

### Your app — Inspect element

`getComputedStyle` on the clicked element and its descendants, normalized into a shared
schema (px numbers, `#rrggbb` colours, numeric font weights). Depth defaults to 4 and
caps at 400 nodes; adjust with `[` / `]`. Invisible elements are skipped. Custom
properties and rule context come from `document.styleSheets`; cross-origin sheets are
counted as unreadable rather than guessed.

### Figma styles — Inspect Figma

**The Figma canvas is WebGL. It has no DOM.** The right-hand properties panel is
React-rendered DOM, so that is what gets read, anchored on `aria-label`, `title` and
section headers — never hashed class names. All of it lives in
[`src/adapters/figma/selectors.js`](src/adapters/figma/selectors.js). The panel
describes the selected node only; multi-select becomes `null`; auto-layout direction
and alignment are icon toggles and are not read; `Auto`/percentage line-heights cannot
be resolved. If it reads nothing, run **Diagnose**, then **Probe**. See
[docs/calibration.md](docs/calibration.md).

### Figma discovery notes — Figma stickies

FigJam names each sticky layer after its own text and the left-hand layers list is real
DOM, so the tool scrolls that virtualized list end to end and harvests the names. The
layers panel must be open (`Alt+1`).

### Octane — Octane story

Label-anchored: finds elements whose text is a known field name and reads the value
beside them; rich text becomes markdown. Field names live in
[`src/adapters/octane/scrape.js`](src/adapters/octane/scrape.js).

### GA4

Reads what the page **sends** — `dataLayer` pushes and `/g/collect` hits — via the
shared interceptor. It does not read GA4 *reports*; that needs OAuth and a server.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run build` | `dist/bcc.js` + `dist/index.html`. Fails over the 250 KB budget. |
| `npm run copy` | Build, then put `bcc.js` on the clipboard and print the Snippet steps. |
| `npm run pack` | Build, then write `release/bcc-<version>/` with `INSTALL.txt` to carry elsewhere. |
| `npm run serve` | Build and start the hub (`http://localhost:7373/` serves the launcher). |
| `npm run hub` | Just the hub. `BCC_PORT` / `BCC_HUB_DIR` override port and store. |
| `npm run doctor` | Checks Node, deps, a Chromium for tests, the build, the unit suite, the hub. `-- --fix` installs and builds. |
| `npm test` | Unit suite + browser suite (real Chromium over CDP). `npm run test:unit` for logic only. |
| `npm run build:split` | Also one bundle per tool, each auto-starting (used by the tests). |

## Verification status

`npm test` runs both suites — **33 unit checks** and **110 browser checks** at the time
of writing. The browser suite drives the real `dist/bcc.js` in headless Chromium against
a fixture app served on two ports: the palette (hotkey, filter, launch), panels coexisting
and stopping independently, storage migration, every Context tool, checkpoint save /
restore / undo / scroll / redaction / cross-origin import with origin rewrite, storage
watch mode, env switching, hotkey changes, the recorder and all five export formats,
request replay, mock rules (glob match, XHR, fail-N, drop, latency, passthrough, boot
re-arm, dock switch), a journey recorded and replayed across two hard navigations with
the server asserting both submits, React-style controlled inputs, the component tree on
a fake fiber chain, error capture, page facts, the a11y outline, basket presets, the hub
mirror/pull, and the CSP report against a page served with a strict header.

**Inspect Figma, Figma stickies and Octane story are not covered** and have never been run
against the real products; their logic is a best guess anchored on the most stable hooks.
Run **Diagnose** once against each and adjust the selector files — that is the designed
workflow, not a failure.

## Security

- Everything runs client-side in your session. Nothing leaves the browser except into
  your clipboard, a file you download, or the loopback hub you started.
- Checkpoint exports withhold credential-looking keys unless you opt in, and say so.
  Recordings strip `authorization`/`cookie` by default.
- `probe` redacts password inputs; the journey recorder never stores password values.
- Captured content ends up in an LLM prompt. **Read what you are pasting.**

## Licence

MIT.
