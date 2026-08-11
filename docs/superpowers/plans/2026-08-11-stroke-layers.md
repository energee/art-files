# Independent stroke layers implementation plan

2026-08-11. Implements
`docs/superpowers/specs/2026-08-11-stroke-layers-design.md`.

## 1. Schema and migration

- Add the nested and flat stroke-layer fields to `src/types.ts`.
- Put an explicit white stroke layer on every style in `defaultConfig()`.
- Migrate missing version-1 fields to white in `parseConfigFile()`.
- Add focused default and legacy-project tests.

## 2. Element adapters and inspector

- Extend the QR/barcode flat-style map and default-style comparison.
- Add the stroke metallic toggle to the Stroke group, including mixed
  selections and reset behavior.
- Include the resolved stroke layer in the Layers panel digest.
- Add adapter tests for reading and applying the field.

## 3. PDF plates

- Resolve mask stroke color independently from fill color.
- Draw text/vector/QR strokes on the mask before their fills.
- Split barcode stroke and fill footprints so each uses its own layer.
- Add mask-color and draw-order regression tests.

## 4. PSD plates

- Preserve stroke effects in mask mode and paint them from the independent
  stroke layer.
- Apply the same behavior to text, vector logos, QR, and barcode layers.
- Update PSD structure/effect tests for white and metallic stroke layers.

## 5. Verification

- Run focused config, element, PDF, barcode, and PSD tests.
- Run the full test suite, TypeScript typecheck, and production build.
- Start the worktree app and visually verify the inspector and layer summary
  using the in-app browser if one is available.
