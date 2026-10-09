# tests/legacy — frozen pre-v3 layout oracle

Test-only. Nothing under `src/` may import from here (`eslint.config.js`
enforces it).

These files are the hardcoded Lolev layout engine as it stood before the
master-as-layers model (v3): `planLabel` over a `LabelConfig` and fixed
page-absolute constants. The app no longer runs any of it. It stays because
suites under `tests/` use it as an independent answer key for the live
`planLayers` path. `plan-layers-parity.test.ts` is the main one: it plans the
Lolev label both ways and asserts the geometry agrees within 0.25pt.

Not every suite that imports from here is a parity check.
`elements.test.ts`, `custom-layers.test.ts` (its `dragTarget2` and
`planLabel` cases) and `tracking.test.ts` (`isDefaultStyle`) test the legacy
code against itself. They keep `elements.ts` alive, and knip can't flag that.
They go when the directory does.

| File | Holds |
| --- | --- |
| `plan.ts` | `planLabel`, the old display-list planner |
| `planShared.ts` | text-run helpers and the fixed collab asset slots |
| `layout.ts` | the pre-v3 position constants (re-exports `src/layout`) |
| `elements.ts` | the old element registry and default-style check |
| `barcode.ts` | the fixed UPC slot (re-exports `src/barcode`) |

Rules:

- Do not edit these files to follow a `src/` change. A parity failure means
  the live renderer moved; fix `src/` or re-baseline the test on purpose.
- Do not add helpers here for new tests. New tests target `src/` directly.
- Keep only what a suite imports. Run `npx knip@6.38.0` after removing a
  suite and delete whatever it reports unused here.
- Do not add a suite that tests legacy code against itself. The three named
  above are the only ones, and they are not a reason to keep anything once
  the parity suites stop needing it.

This directory goes away once the parity suites assert against golden data
instead, which the ledger entry `legacy-oracle-deletion` parks until
master-as-layers replaces the display-list planner (issue #435).
