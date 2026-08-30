# contextforge

Browser-side capture tools that collect design, DOM, analytics and ticket
context into **one Copilot-ready prompt**.

Built for a workflow that lives across three tabs — ALM Octane for tickets,
Figma for designs and discoveries, a React codebase for the actual change — and
for a locked-down machine where installing anything is a negotiation. Every tool
is a single self-contained JS file you paste into the DevTools console. No
extension, no install, no permissions.

```
Octane story ─┐
Figma styles ─┼─► basket ─► one markdown prompt ─► Copilot ─► the repo
Figma notes  ─┤
page styles  ─┤
GA4 events   ─┘
```

## Install

```bash
git clone <your-fork> && cd contextforge
npm install
npm run build        # → dist/*.js and dist/index.html
```

Open `dist/index.html`. Each tool has a **Copy for console** button.

## Use

On the page you want to capture from:

1. DevTools → Console.
2. First time in a browser profile: type `allow pasting`, Enter.
3. Paste a tool, Enter. A panel appears. `Esc` closes it.

`dist/index.html` also offers each tool as a draggable bookmarklet. Those are
faster, but a strict `Content-Security-Policy` silently blocks `javascript:`
URLs — Figma is one such site. **If a bookmarklet does nothing, use the
console**; DevTools is exempt from CSP.

## The tools

| Tool | What it does |
| --- | --- |
| `basket` | The context builder. Everything captured, reorderable, exported as one prompt. |
| `inspect-web` | Hover an element, click it, capture the whole subtree's computed styles. |
| `inspect-figma` | Watch the Figma selection, capture the right-hand panel's styles. |
| `compare` | Diff a Figma capture against a web capture; list what does not match. |
| `octane-story` | Pull the open work item — fields, description, AC, comments. |
| `figma-stickies` | Harvest sticky-note / discovery text from a Figma or FigJam board. |
| `text-clip` | Select text anywhere, `Alt+C`, it lands in the basket with its URL. |
| `ga4` | Live view of the GA4 events the page fires, with their parameters. |
| `probe` | Dump a region's DOM structure so selectors can be written for it. |

### A typical run

```
Octane      → octane-story  → Add to basket
Figma       → figma-stickies → Harvest all → Add to basket
Figma       → inspect-figma  → click the component → Capture
your app    → inspect-web    → click the same component → Capture
your app    → compare        → Compare → Add to basket
your app    → basket         → write the task → Copy prompt
```

Paste into Copilot Chat with the repo open.

### Moving captures between tabs

The basket lives in `localStorage`, which is **per-origin** — a Figma capture and
an Octane story land in different baskets. Two ways across:

- **Copy JSON / Paste JSON** in the basket panel. Always works, no setup.
- **The hub**: `npm run hub` starts a loopback-only server on `:7373`. Every
  capture mirrors to it automatically, and **Pull hub** merges everything from
  every origin. It also serves the launcher at <http://localhost:7373/>.

## How each source is read, and what that costs

This matters more than usual here, because two of the three sources are hostile
to scraping in different ways.

### Your app — `inspect-web`

`getComputedStyle` on the clicked element and its descendants, normalized into a
shared schema (px numbers, `#rrggbb` colours, numeric font weights). Reliable;
this is just the DOM.

Depth defaults to 4 and caps at 400 nodes — "all child elements" on a page
section is otherwise ten thousand nodes and a prompt nobody can use. Adjust with
`[` / `]`. Invisible elements are skipped.

### Figma styles — `inspect-figma`

**The Figma canvas is WebGL. It has no DOM at all.** But the right-hand
properties panel is ordinary React-rendered DOM, so that is what gets read.

Because Figma's class names are hashed and change between releases, nothing here
keys off a class. It anchors on `aria-label`, `title` and section header text —
things Figma has to keep stable for its own accessibility. All of it lives in
[`src/adapters/figma/selectors.js`](src/adapters/figma/selectors.js), which is
the entire maintenance surface.

Known limits, stated plainly:

- The panel describes the **selected node only**. There is no child tree.
- Multi-select shows "Mixed"; that becomes `null` rather than a wrong value.
- Auto-layout **direction and alignment are icon toggles**, not text, so they
  are not read. Padding, gap, radius, typography, fills and strokes are.
- `Auto` and percentage line-heights cannot be resolved to px from the panel.

If it reads nothing, the panel probably moved. Run `probe` on it — see
[docs/calibration.md](docs/calibration.md).

### Figma discovery notes — `figma-stickies`

Different mechanism again. Since the canvas is WebGL, sticky text is unreachable
there — but **FigJam names each sticky layer after its own text**, and the
left-hand layers list is real DOM. So the tool scrolls that virtualized list end
to end and harvests the names.

Consequences: the layers panel must be open (`Alt+1`), text is truncated the way
the list truncates it, and structural layers come along too — hence the tick
boxes to drop them before adding to the basket.

### Octane — `octane-story`

Octane is an Angular SPA with generated class names, so this is label-anchored
too: it finds elements whose text is a known field name and reads the value
beside them. Rich-text fields are converted to markdown so acceptance-criteria
bullets survive into the prompt.

Field names live in
[`src/adapters/octane/scrape.js`](src/adapters/octane/scrape.js). Workspaces
rename and add fields, so expect to edit that list once — `probe` will tell you
what to put in it.

"Go to story" rewrites the `id` in the current URL and lets the SPA route there,
so you must already be on some story for the URL shape to be known.

### GA4 — `ga4`

This reads what the page **sends**: `dataLayer` pushes, and `/g/collect` hits via
`fetch`, `XHR` and `sendBeacon`, decoded from GA4's `en` / `ep.*` / `epn.*`
parameter encoding. Existing `dataLayer` entries are replayed, so you see events
that fired before you pasted the tool.

It does **not** read GA4 *reports* — that needs the Data API and OAuth, which is
a server-side tool, not a console snippet. For "does my change still fire the
right event with the right params", this is the half that matters.

It monkey-patches `fetch`, `XMLHttpRequest` and `sendBeacon` while open, and
restores all three when you close the panel.

## Verification status

`npm test` runs both suites.

- **Unit** (`test/smoke.mjs`) — unit normalizers, the comparison engine and the
  markdown export.
- **Browser** (`test/browser.mjs`) — drives real Chromium over CDP against a
  fixture page: mounts the overlay, hovers, clicks, and reads the captured
  styles back out of `localStorage`. Covers `inspect-web`, `probe` and `ga4`
  end to end.

**`inspect-figma`, `figma-stickies` and `octane-story` are not covered by tests**
and have never been run against the real products — no fixture for them exists
outside a live Figma file and a live Octane instance. Their DOM-reading logic is
a considered best guess anchored on the most stable hooks available. Expect to
run `probe` once against each and adjust the selector files; that is the
designed workflow, not a failure.

## Security

- Everything runs client-side, in your session. No credentials, no API tokens,
  no data leaves the browser except into your clipboard.
- The hub binds to `127.0.0.1` only, and is entirely optional.
- `probe` redacts password inputs.
- Captured content ends up in an LLM prompt. **Read what you are pasting.** If a
  ticket carries customer data, strip it in the basket first.

## Licence

MIT.
