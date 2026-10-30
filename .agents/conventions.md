# Conventions

recorded-at: 4e0a146

These are observed patterns, not a directory inventory. Recheck the cited code
when changing it; historical plans describe their own implementation date.

## Rendering and model

- Keep planning and validation DOM-free so the app and headless generator share
  them (`src/planLayers.ts`, `src/model/fields.ts`, `scripts/generate-lib.ts`).
- The master owns layer positions and styles; resolved layers become one display
  list consumed by canvas, PDF and PSD (`src/model/layers.ts`, `src/planLayers.ts`,
  `src/pdf/build.ts`, `src/psd/build.ts`). Avoid renderer-specific layout rules.
- Use minimal layer patches through the model editing helpers, rather than
  mutating documents (`src/model/edit.ts`, `src/components/LayerInspector.tsx`).

## Files and errors

- Desktop file pickers use native dialogs before browser fallbacks so Save can
  retain a filesystem path (`src/files.ts`, `src/App.tsx`, `src/TabsShell.tsx`).
- Input validation returns readable results (`src/upc.ts`, `src/model/fields.ts`);
  invalid document structures throw at parsing boundaries (`src/model/labelfile.ts`,
  `src/model/layers.ts`). Preserve the previous document when opening fails.
- User-facing errors and confirmations use React state and themed alerts/dialogs,
  never browser alert/confirm/prompt (`src/App.tsx`, `src/components/MasterSaveReview.tsx`,
  `src/components/DesktopUpdater.tsx`).

## App copy

- No em dashes (—) in text the app shows: UI strings, toasts and their
  descriptions, and every language in `src/locales/*.ts` (keys and values). Split
  the sentence or use a colon or comma. A spaced en dash (–) is no substitute.

## Tests

- Vitest tests live beside related suites under `tests/`. Pure model tests use
  direct calls (`tests/model-edit.test.ts`, `tests/model-files.test.ts`).
- DOM suites opt into happy-dom and mount real React components with `createRoot`
  and `act` (`tests/layerlist-dom.test.tsx`, `tests/app-v3-dom.test.tsx`).
- Printing has explicit regression coverage: inspect PDF operations and PSD
  layers, and preserve raster goldens for intentional visual changes
  (`tests/pdf-build.test.ts`, `tests/psd-build.test.ts`, `docs/goldens.md`).

## Changes and delivery

- Use a capitalized summary such as `Fix: ...`; omit attribution trailers.
  Existing examples: `348ad5f`, `4e0a146`.
- Binary changes queue user-facing notes under Unreleased. Follow
  `release-steward.md`; publishing a version is a separate user decision.
