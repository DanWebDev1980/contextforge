## What and why

<!-- What chore does this remove, or what does it fix? Link the issue if there is one. -->

## Checklist

- [ ] `npm test` passes (33 unit checks + 110 browser checks)
- [ ] `npm run build` stays under the 250 KB budget
- [ ] A new tool is registered in `src/tools/index.js` and returns a `stop(reason)`
      that removes every listener and restores every patch
- [ ] No new dependency, or the PR explains why one is unavoidable
- [ ] Nothing captured leaves the browser except to the clipboard, a download,
      or the loopback hub
- [ ] `CHANGELOG.md` updated under `## [Unreleased]`

## Verification

<!-- What did you actually run it against? Paste the relevant test output. -->
