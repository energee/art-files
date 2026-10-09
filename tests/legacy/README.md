# tests/legacy — frozen pre-v3 layout oracle

Test-only. Nothing under `src/` may import from here.

These files are the hardcoded Lolev layout engine as it stood before the
master-as-layers model (v3): `planLabel` over a `LabelConfig` and fixed
page-absolute constants. The app no longer runs any of it. It stays because
suites under `tests/` use it as an independent answer key for the live
`planLayers` path. `plan-layers-parity.test.ts` is the main one: it plans the
Lolev label both ways and asserts the geometry agrees within 0.25pt.

| File | Holds |
| --- | --- |
| `plan.ts` | `planLabel`, the old display-list planner |
| `planShared.ts` | text-run helpers and the fixed collab asset slots |
| `layout.ts` | the pre-v3 position constants (re-exports `src/layout`) |
| `elements.ts` | the old element registry and default-style check |
| `hittest.ts` | the old hit boxes, built from `planLabel` |
| `barcode.ts` | the fixed UPC slot (re-exports `src/barcode`) |

Rules:

- Do not edit these files to follow a `src/` change. A parity failure means
  the live renderer moved; fix `src/` or re-baseline the test on purpose.
- Do not add helpers here for new tests. New tests target `src/` directly.
- Keep only what a suite imports. Run `npx knip@6.38.0` after removing a
  suite and delete whatever it reports unused here.

This directory goes away once the parity suites assert against golden data
instead (ledger entry `legacy-oracle-deletion`, issue #435).
