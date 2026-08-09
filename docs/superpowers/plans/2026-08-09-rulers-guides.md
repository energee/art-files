# Rulers and guides implementation plan

Date: 2026-08-09
Spec: `docs/superpowers/specs/2026-08-09-rulers-guides-design.md`

1. Add DOM-free ruler geometry in `src/rulers.ts`: PDF-point/screen conversion,
   unit conversion, adaptive tick generation, margin clamping, and locked-guide
   positions. Cover it with `tests/rulers.test.ts`.
2. Extend `PreviewCompareHandle` with access to the exact transformed page
   element so rulers use the same bounding rectangle as preview hit-testing.
3. Add `src/components/Rulers.tsx` as a screen-space SVG overlay. Measure the
   pane/page with `ResizeObserver`, regenerate ticks on zoom/pan, and keep only
   ruler strips and narrow manual-guide handles pointer-active.
4. Add manual-guide pointer capture for create/move/remove, plus keyboard
   deletion on focused guides. Keep all guide positions in PDF points.
5. Own ruler visibility, units, safe-margin inset, guide visibility, and manual
   guides as session state in `App.tsx`. Expose actions through the existing
   command table and View menu.
6. Document the operator workflow in README, then run the complete tests,
   typecheck, production build, and visual interaction checks.
