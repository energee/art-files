# Conventions

recorded-at: d10cddf

<!-- Record only what you verified in >=2 places; cite an example file for each claim.

     Two rules keep this file from rotting into a confident lie:

     1. NOTHING DERIVABLE. If an agent can recompute it by reading the repo — module
        lists, directory trees, file counts, "there are three layers" — leave it out.
        Derivable facts are the ones guaranteed to go stale, and restating them is
        duplicated knowledge, which DRY predicts will diverge. Record what the code
        cannot say for itself: intent, rationale, which of two plausible patterns is
        the house style.
     2. NOTHING UNCITED. Every claim names a file, and a line where that helps. The
        citation is not decoration — it is what lets a later reader falsify the claim
        in one read. An uncited claim can never be proven wrong, so it never gets
        fixed. A claim whose citation no longer resolves, or whose cited code no
        longer supports it, is VOID — not "probably still true".

     recorded-at is the commit these observations were made against. It is what makes
     staleness cheap to check: `git diff <recorded-at>..HEAD -- <cited paths>`. If
     nothing under the citations moved, the claims are as good as when written. -->

## Layout

- Pure logic is kept DOM-free so it runs in both the browser app and the Node
  headless harness: `src/upc.ts:1` ("no DOM"), `src/maskimage.ts:1-3` ("shared by
  the browser app ... and the Node harness"). Keep new render/encode logic out of
  `src/main.ts` for the same reason.
- Label geometry has a single source of truth: every coordinate lives in
  `src/layout.ts` (points, top-left origin) and `src/pdf/build.ts` draws *both* PDFs
  from it so art and mask stay registered (`src/layout.ts:1-3`, `README.md` Layout).
  Never hardcode geometry in the builder.
- Design specs and implementation plans are committed under `docs/superpowers/`
  before implementation (`docs/superpowers/specs/2026-08-02-label-pdf-generator-design.md`,
  `docs/superpowers/plans/2026-08-02-shadcn-ui-rewrite.md`).

- Every file picker branches on `isTauri()` FIRST and uses the native
  dialog (`openNativeFile` / `saveNativeFile` in `src/files.ts`): WKWebView
  has no File System Access API, and the browser fallbacks lose the file's
  path, so desktop Save could not write back in place (`openMasterPicker`
  and `saveProject` in `src/App.tsx`, `openProjectPicker` in
  `src/TabsShell.tsx`).

## Naming

- Source files are single lowercase words named for their domain concept
  (`src/upc.ts`, `src/maskimage.ts`, `src/defaults.ts`); exported functions are
  camelCase verbs (`validateUpc` in `src/upc.ts:21`, `qrShapes` in `src/qr.ts:15`).
- Fixed geometry/color/template constants are UPPER_CASE module exports
  (`PAGE`, `ART`, `COLORS` in `src/layout.ts:5-17`; `WARNING_TEXT` in
  `src/defaults.ts:5`).
- Every source file opens with a `// filename — purpose` header comment
  (`src/qr.ts:1`, `src/layout.ts:1`, `src/defaults.ts:1`, `tests/core.test.ts:1`).

## Testing patterns

- Vitest, one suite (`tests/core.test.ts`) covering only the pure DOM-free logic —
  UPC encode/validate, QR geometry, mask polarity, config round-trip — with one
  `describe` block per source module (`tests/core.test.ts:10,32,49`). PDF drawing and
  DOM wiring are untested by design; verify those visually.
- Tests pin real production reference values rather than synthetic ones: the
  Labradorite UPC `850051366224` (`tests/core.test.ts:11-16`) and the live QR URL
  `https://lolev.beer` (`tests/core.test.ts:34`).

## Error handling

- NEVER use browser-native dialogs — `window.alert`, `window.confirm`,
  `window.prompt`. They block the main thread, escape the app's theme, and
  can't be driven by state. User-facing errors surface through app state
  rendered as the shadcn `Alert` (`src/components/ui/alert.tsx`): chrome-level
  failures go through `setLoadError`/`setBuildError` into the header's
  `HeaderAlert` (`src/App.tsx`). Anything needing confirmation gets a shadcn
  `Dialog`, not `confirm()`.
- Two-tier convention. User-input validation returns result objects
  `{ ok, error? }` instead of throwing (`validateUpc` in `src/upc.ts:21-27`,
  `validateMask` in `src/maskimage.ts:26-40`); `src/main.ts:201-208` collects these
  into the `#errors` element.
- Internal invariants and file parsing throw `Error` with a readable message
  (`parseConfigFile` in `src/defaults.ts:50,68`; logo SVG parsing in
  `src/pdf/build.ts:59,64,81`).

## Commit style

- Single capitalized summary line, often with a scope-word prefix ending in a colon;
  no conventional-commit types, no bodies, no Co-Authored-By. Examples: `Spec: QR
  fill color picker and optional stroke` (b9ce96a), `Barcode: white-stroked
  bars/digits on texture instead of white block` (0314f79).
- Spec/plan commits land as their own commits prefixed `Spec:` /
  `Implementation plan:` (637825a, d10cddf).
