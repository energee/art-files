# Starter master: replace the built-in Lolev master

The app ships a neutral **Starter** master instead of the Lolev design. Lolev
becomes an ordinary `.master` file, opened once and kept in the library like any
other. The goal is no brewery-specific data, logo or URL in the binary, and no
special-case asset kind (`builtin:logo`).

Branch `feat/starter-master`, worktree `.agents/worktrees/starter-master/`,
stacked on #601. No database changes.

## Decisions (user, 2026-11-02)

- New tabs and fresh installs open on a generic built-in master.
- Lolev is exported once to a `.master` file the user keeps.

## Proposed defaults (confirm or change at approval)

- **Starter layers:** Background, Metallic mask, Name, Style, ABV, Volume,
  Description and Warning. The government warning text is the generic US
  statutory text. Positions match Lolev's, so muscle memory carries over.
  There is no logo, Brand, Info, Store cold, QR, barcode, or Collab variant.
- **Name:** "Starter", id `starter`. Same page size, guides and font (Poppins).
- **Lolev file:** committed at `masters/lolev.master`. It is not bundled with
  the app. Labels saved on `lolev` reach it through the existing missing-master
  prompt (**Locate .master…**), after which the library remembers it.
- **Old v1 `config.json` labels:** convert onto the current tab's master
  instead of Lolev. The layer ids they fill (name, style, abv…) exist in both.
- **CLI:** `npm run generate` with no `.master` uses Starter. The legacy
  texture/mask/config argv form needs `--master <file>`.

## Tasks

Each task starts by writing its named test, running it red, then implementing.

1. **Export Lolev to a file.** Create `scripts/export-lolev-master.ts`, which
   calls `packMaster` (src/model/files.ts:64) on `lolevMaster()` and turns
   `builtin:logo` into a real SVG image asset. Commit the output as
   `masters/lolev.master`.
   Test: `tests/lolev-master-file.test.ts`. The file unpacks, validates, and
   plans the same layers as `lolevMaster()` (image asset instead of builtin).
   Types: `Master`, `MasterAssets`. Depends on: none.
2. **Starter master.** Create `src/model/starterLayers.ts` exporting
   `starterMaster(): Master`.
   Test: `tests/starter-master.test.ts`. It validates, has no assets, and
   contains no "lolev" anywhere in its JSON. Depends on: none. Can run in
   parallel with 1.
3. **Lolev data becomes a test fixture.** Move `src/model/lolevLayers.ts` to
   `tests/fixtures/lolevMaster.ts` and repoint the 31 test imports. Tests keep
   their goldens.
   Test: the full suite stays green. Depends on: 1 (the script imports it from
   its new home).
4. **Ship Starter.** `SHIPPED_MASTER_ID`, `resolveDefaultMaster` and the
   `lastMasterId` fallback (src/masters.ts:26,169,383,404), the initial tab
   (App.tsx:384) and the picker's `builtIn` entry (App.tsx:1839) all use
   `starterMaster()`.
   Test: `tests/default-master-dom.test.tsx`. A fresh tab opens on Starter, and
   a remembered library master still wins. Depends on: 2, 3.
5. **Delete `builtin:logo`.** Remove the branches at planLayers.ts:232,
   App.tsx:2338, layers.ts:176/435-440, editLayers.ts:410-412,
   editSave.ts:69 and generate-lib.ts:506/552. Remove the `logoSvg` plan
   input (plan.ts:126) and the `logo2025.svg` import, and delete
   `src/dev/strokecap.ts` if nothing else uses it.
   Test: `tests/plan.test.ts`. An image layer whose asset is a `.master` SVG
   draws as paths. Depends on: 1, 4.
6. **Generic placeholders.** Replace the lolev.beer URLs and defaults:
   `src/qr.ts:13`, the App.tsx:2385/2416/2420 placeholders, and
   `src/defaults.ts`.
   Test: `tests/qr.test.ts`. Depends on: 4.
7. **v1 labels convert onto the open master.** Change convert.ts:318 and
   509-511 and App.tsx:2035.
   Test: `tests/convert-v1.test.ts`. A v1 config fills Starter's
   name/style/abv. Depends on: 4.
8. **CLI.** Default to Starter, and make the legacy argv form require
   `--master` (generate-lib.ts:636,699).
   Test: `tests/generate-cli.test.ts`. Depends on: 4, 5.
9. **Docs.** Update getting-started.mdx:40, variants.mdx:8,
   inspector.mdx:29,51, export.mdx:90, masters-and-labels.mdx:56 and
   generate.mdx: "Open lolev.master once". Add a CHANGELOG `[Unreleased]`
   entry. Depends on: 4-8.
10. **Verify.** Run tsc, lint, knip and the full vitest suite. Check in the dev
    server that a fresh profile opens on Starter, and that opening a `lolev`
    label goes through **Locate** → `masters/lolev.master` and renders the
    laurel. Depends on: all.

Tasks 1 and 2 can run in parallel. Tasks 6, 7 and 8 can run in parallel after
4. Everything else is sequential.

## Risk

Existing users' labels say `masterId: "lolev"`. After upgrading, each Lolev
label asks once to locate `lolev.master`; after that the library resolves it
silently. That prompt is the only behaviour change for them.
