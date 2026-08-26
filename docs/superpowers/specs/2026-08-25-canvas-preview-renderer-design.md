# Canvas preview renderer

**Date:** 2026-08-25
**Status:** Approved direction; implementation phased below.

## Problem

The 2D preview is built by generating two 600-DPI PDFs in a worker and
rasterizing them with pdf.js. Every keystroke pays a 150 ms debounce plus a
serialized build and raster — the latency that forced every in-place editing
design into workarounds (invisible carets, hide-element rebuilds). The
preview is also the wrong substrate for direct manipulation: you cannot put
a caret in, or drag, a baked bitmap.

## Decision

Render the preview **directly to 2D canvas** from the config, and build
PDFs **only on export**. The canvas renderer becomes the interactive truth
while editing; the PDF remains the deliverable, held equal by a parity
gate rather than by being the preview.

## Goals

- Per-keystroke preview updates with no worker round-trip or debounce.
- True in-place text editing (and, later, dragging) against a surface we
  control — the current hide-element-and-rebuild plumbing becomes a render
  flag with zero latency.
- Fonts flow through the `src/fonts.ts` gate, ready for a config-driven
  font choice (the font is Poppins today but intended to become dynamic).
  The gate landed in Phase 4c; font sourcing (choices) is Phase 5.
- Exports (PDF art + mask, PSD) unchanged in output.

## Non-goals

- No change to the stored label format, presets, or export file contents.
- No redesign of the 3D views in the first phases (they keep consuming
  rendered plates; switching their texture source is a later phase).
- No removal of the headless `npm run generate` harness.

## Architecture

### The drift problem is the design center

This adds a third renderer beside `pdf/build.ts` and `psd/build.ts`. Those
two already share `layout.ts` geometry, `description.ts` parsing,
`strokes.ts`, and the run/tracking math — but each still re-implements
*placement* (which runs draw where, in which face, on which plate). Three
copies of placement is where drift becomes likely.

So the core move is extracting placement into a renderer-agnostic module:

- **`src/plan.ts` — the display list.** A pure function
  `planLabel(cfg, opts): Placed[]` producing every drawable in label-space
  points: text runs (`{text, x, baseline, size, face, tracking, fill,
  layer, stroke...}`), vector shapes (logo paths), image placements
  (texture, collab art), and code geometry (barcode bars/digits, QR
  modules). `opts.skip: Set<ElementId>` replaces the current build-time
  `hidden` for both eyes and edit sessions.
- **Backends consume the plan.** The canvas renderer walks it with
  `CanvasRenderingContext2D`; `pdf/build.ts` and (incrementally)
  `psd/build.ts` walk the same list. Placement then exists once, and the
  parity question shrinks from "do three renderers agree?" to "does each
  backend faithfully draw a Placed item?" — a far smaller, testable surface.
- `hittest.ts` derives boxes from the same plan, ending the parallel
  box-vs-drawn bookkeeping it maintains today.

### Canvas renderer

`src/canvas/draw.ts`: `drawPlate(ctx, plan, assets, mode)` where `mode` is
the existing art/mask distinction. Text draws via `ctx.font` with
`LABEL_FONT_FAMILY` (the gate registers the same TTF bytes the PDF embeds;
canvas `measureText` through the shared `Measure` already matches the
hit-test metrics). Plate semantics mirror the PDF's: the mask plate's
blue/white ink polarity, stroke layers, and knockouts reproduce
`pdf/build.ts`'s Mode behaviour, using `globalCompositeOperation` for the
masking the PDF does with layered draws.

Rendering is synchronous and cheap (one plan walk); PreviewCompare calls it
on a `requestAnimationFrame` after config changes, at
`devicePixelRatio × zoom` resolution (reusing the existing raster-scale
ratchet). The pdf.js path, `pdf/client.ts`'s preview worker, and the
debounced build effect in App retire in Phase 3.

### Fidelity: parity gate

Two layers, cheapest first:

1. **Plan-level tests (CI):** the display list is pure data — snapshot and
   invariant tests (e.g. justified warning columns sum to `maxLen`,
   centred runs symmetric about their cx) run in vitest with no
   rasterization. Because all backends consume the plan, most historical
   drift classes die here by construction.
2. **Pixel parity (scripted, not CI-blocking):** a dev script renders the
   default config (and a marker-heavy fixture) through both the canvas
   renderer and the exported PDF (rasterized via pdf.js), and reports a
   pixel-diff percentage with an inspectable side-by-side. Run before
   releases and when touching a backend. Font rasterization differs
   between engines, so the threshold is tuned once and asserted loosely;
   the plan-level tests carry the strictness.

### Editing integration

- The in-place editor (already shipped) keeps its overlay, but
  `skip: {editingElement}` goes into `planLabel` — the element vanishes
  from the canvas the same frame the editor opens. The App-side
  hide-and-rebuild plumbing from v0.1.16 is deleted.
- Boxes come from the plan, so outlines, hit-testing, and the editor
  cannot disagree with the drawn frame even mid-keystroke.

### Error handling

- Renderer throws propagate to the existing `buildError` strip; a failed
  frame keeps the last painted canvas (same policy as today's aborted
  renders). (Applies to the 2D preview; a 3D texture-build failure keeps
  the last applied texture and warns to the console, matching the
  pre-canvas behavior — Phase 3 ruling.)
- Missing assets (no texture yet) render the plate without them, exactly
  as the PDF build does now.
- Font gate failure falls back as today: preview blocked with the error
  reported, never a silently wrong face.

## Phases

1. **Plan extraction + text/vector parity.** Create `plan.ts` from
   `pdf/build.ts`'s placement logic; make the PDF backend consume it;
   port `hittest.ts` to derive from it. Plan-level tests land here. No
   user-visible change.
2. **Canvas backend.** `canvas/draw.ts` walks the plan for both plates,
   including texture/mask compositing, collab images, barcode/QR. Pixel
   parity script lands here. Dev-only toggle to view it.
3. **The swap.** PreviewCompare renders from the canvas backend;
   per-keystroke updates; preview worker and debounce retire; in-place
   editing switches to `skip` (delete the v0.1.16 hide plumbing). Exports
   still build PDFs from the same plan.
4. **Follow-ons.** 3D views texture from the canvas plates; PSD backend
   moves onto the plan; drag-to-move editing; dynamic font config through
   `fonts.ts`.

Each phase ends green (`tsc`, `vitest run`) and is separately shippable;
binary-impacting phases carry their own version + changelog entry per the
release steward.

## Risks

- **Compositing mismatch** (metallic/white-ink layering) is the hardest
  parity surface; Phase 2's pixel script exists mainly for it.
- **Plan extraction touches every renderer.** Phase 1 is deliberately
  behaviour-neutral and lands with the existing suite green before any
  new backend appears.
- **Canvas text vs. embedded-font text** rasterize slightly differently
  across engines; geometry is shared, so differences are sub-pixel
  rendering only — accepted, and bounded by the parity threshold.
