# Calibrating the Figma and Octane selectors

Figma and Octane both ship obfuscated, build-specific class names, so no
selector written without seeing your instance will hold for long. Rather than
guess harder, the repo has a `probe` tool and two small, editable selector files.

## The loop

1. Open the page: a Figma file with a layer selected, or an Octane story.
2. Paste `dist/probe.js` into the console.
3. Hover the region holding the data you want — Figma's right-hand properties
   panel, or the Octane story form. The highlight shows exactly what you have.
4. Click it. An annotated outline appears.
5. **Copy outline**, and hand it to whoever is writing the selectors (Copilot
   included — the outline is designed to be pasted into a prompt).

The outline records tag, id, classes, `data-*` / `aria-*` attributes, and each
element's own text and form value, indented by depth. Password inputs are
redacted.

## What to edit afterwards

### Figma — `src/adapters/figma/selectors.js`

- `FIELD_ALIASES` maps each property to the labels Figma might use for it. If
  the probe shows an input with `aria-label="Gap between objects"` and the gap
  is not being read, add that string to `FIELD_ALIASES.gap`. Matching is
  lowercase and exact against the resolved label.
- `SECTIONS` decides whether a colour swatch is a fill or a stroke, by finding
  the nearest section header above it.
- `findPropertiesPanel()` scores containers hugging the right edge of the
  viewport by how many recognisable inputs they hold. If it picks the wrong
  container, tighten the width bounds there.
- `labelOf()` resolves a control's label from `aria-label`, `title`,
  `aria-labelledby`, a sibling, or an SVG `<title>`. If your build labels
  controls some other way, add that path here.

Use the **Debug** button in `inspect-figma` to log the raw `{ label: value }`
bag it actually read — that shows immediately whether the problem is finding the
fields or mapping them.

### Octane — `src/adapters/octane/scrape.js`

- `FIELD_LABELS` is the list of short field names to harvest. Workspaces add
  custom fields; add their labels here, lowercased.
- `LONG_TEXT_LABELS` is for rich-text fields (description, acceptance criteria).
- `valueNear()` looks for the value in the next sibling, the same table row, or
  the shared wrapper. If your Octane nests values differently, add a candidate
  there.
- `readComments()` finds the largest region whose class or id contains
  "comment". If comments come out empty or duplicated, narrow that.

Use the **Debug** button in `octane-story` to log the parsed story object.

## When Figma ships a UI change

Symptoms: `inspect-figma` says "No recognised properties", or values go missing
after a Figma release. That is `FIELD_ALIASES` drifting, not a structural break.
Re-run the probe and add the new labels. It should be a few lines, which is the
whole point of keeping selectors out of the scraping logic.
