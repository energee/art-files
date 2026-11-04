# Illustrator (.ai) export: outlined vectors, embedded rasters, White Ink

Issue #597. Phase 1 plan plus the format proof (the issue's "First
implementation gate"). Branch `feat/ai-export-plan`, worktree
`.agents/worktrees/ai-export/`. No database changes, no schema migration.

## What the print PDF draws today (src/pdf/build.ts, recorded at e45372b1)

| Content | Art pass (process) | White Ink pass |
| --- | --- | --- |
| Text | Live font: pdf-lib `drawText` (BT/Tf/Tj) with a subset TrueType embed; tracking by `Tc`. | Already outlined: `outlineText` (fontkit glyph paths, same shaped glyphs and raw advances). |
| Text keyline | Live stroke: `Tr 2` at 2w with round join/cap, plus 8 to 57 filled "bridge" glyph copies (`bridgeOffsets`) for pdf.js. | Live `borderWidth` stroke on the outlined glyphs. |
| SVG logos, custom SVG | Filled `drawSvgPath` (nonzero), stroke via live `borderWidth` 2w, all strokes before fills. | Same paths, live stroke. |
| QR | Filled paths. The keyline is already a filled, grown path from `qrPaths(…, grow)`. | Same. |
| Barcode | Bars are `drawRectangle`. The halo is a live 2S rect border plus a `Tr 2` digit stroke. The digits are live type. | Bars are rects, digits outlined, halo a live stroke. |
| Rasters | `embedPng` (Flate + SMask alpha, lossless) or `embedJpg` (DCT passthrough, no re-encode). | The image's rect, flat 100% tint. |
| Uploaded mask | | A Separation image with an SMask (`embedWhiteInkMask`). |
| Spot | | `/Separation /White Ink /DeviceCMYK` (alternate 0 1 0 0), ExtGState `OP/op true, OPM 1`, OCG "White Ink". |

The page boxes are MediaBox = BleedBox = full page with bleed, and TrimBox = the 8x5in die.

So text, the text, logo and barcode keylines, and the barcode digits are the
only live type or live strokes. Rasters, the spot and the page boxes can go
through as they are.

## Format decision: PDF-compatible .ai built by the existing print builder

An Illustrator `.ai` since version 9 is a PDF file, plus optional private
Illustrator data that Adobe does not publish. When Illustrator opens a
PDF-structured `.ai` without that private data, its PDF import turns the
page into Illustrator objects. Paths become paths, images are embedded,
Separations become spot swatches and overprint becomes the Overprint Fill
attribute.

Options:

- **Chosen: PDF-compatible .ai.** The builder is
  `buildPrintPdf(outlineItems(plan))`. A display-list pass replaces every text
  item and every stroke with filled `paths` items. The unchanged print builder
  then writes them, together with the existing spot, overprint, raster and
  page-box code. There is no second renderer and no forked White Ink logic.
- **Rejected: native AI private data.** It is undocumented and proprietary,
  and no licensable spec or library exists.
- **Rejected: legacy PostScript AI (AI3 to AI8).** It is obsolete and has no
  embedded alpha or transparency model.
- **Out of scope per the issue:** EPS, SVG, and separate legacy/latest files.

This route is **not proven until Illustrator opens the proof** (Task 1). The issue is explicit: "A renamed PDF is not evidence of native AI support."

### Runtime and deployment contract

- Export runs entirely in Label Lab: TypeScript in the webview and in Node.
  It does not need Illustrator, Photoshop, a cloud service or a separately
  installed converter.
- The builder stays DOM-free, so tests and `scripts/` drive it the same way
  they drive the PDF builder.
- Licensing:
  - pdf-lib (MIT) and @pdf-lib/fontkit (MIT), both already shipped.
  - Poppins and Barlow Condensed are OFL 1.1. Converting glyphs to outlines
    in an artwork file is permitted; the outlines are not font software.
  - The stroke engine below is BSD-3.

### Stroke expansion (separate from text outlining)

The visible keyline is the outer half of a 2w centred stroke with round
joins and caps, with the fill drawn on top. Geometrically that is the shape
dilated by radius w: `stroke(2w, round) ∪ fill`. It is drawn in the stroke
colour, then the original fill goes on top.

- One dilated outline replaces the `Tr 2` stroke **and** the bridge copies, so
  no duplicate overprinting outlines are written.
- The QR keyline needs no work; the planner already grows it.
- A rect union (barcode bars) dilates exactly to rounded rects. The engine
  handles it anyway, so there is one code path.

**Engine: Skia PathOps via `canvaskit-wasm` (Google, BSD-3), accepted (D1).**
Evaluated in a scratch install, 0.42.0:

- Barlow Condensed Bold "B8office" at 72 pt with a 3 pt keyline:
  `makeStroked({width: 6, join: Round, cap: Round})` then
  `Path.MakeFromOp(stroke, fill, Union)`.
- 14 input contours became 12 output contours, made of 166 quads, 42 lines
  and no flattening. The two lost contours are where adjacent glyphs merged.
- Bounds grew by exactly 3.00 pt per side. Counters stayed open: 31,654 of
  the sampled interior points were unpainted in both the fill and the
  dilation.
- Node start-up was about 0.75 s.
- Only the `canvaskit-wasm/full` build includes PathOps; the default build
  does not. The wasm is 7.9 MB.

Alternatives rejected:

- Clipper2 (Boost). It works on polygons only, so curves flatten to
  many-node polylines. The issue rules that out as destructive simplification.
- paper.js with paperjs-offset (MIT). Its offset robustness on
  self-overlapping glyph outlines is known to be weak.
- A hand-written per-point offset. The issue forbids it.

**Deployment consequence:** WebAssembly cannot compile under the Tauri CSP's
`script-src 'self'`. Task 9 added `'wasm-unsafe-eval'` (D1), which allows wasm
compilation only, not JavaScript eval.

## The format proof (done on this branch)

- `scripts/ai-format-proof.ts` writes `proof/ai-format-proof.ai`
  (about 95 KB, committed).
- Regenerate it with `npx tsx scripts/ai-format-proof.ts`.
- It plans real layers with the export measure (`pdfMeasureFace`) through
  `planLayers`, outlines them, and calls the unchanged `buildPrintPdf`.

Contents:

- Barlow Condensed Bold "office B8 AVATAR" at 44 pt, which exercises the
  `f_f_i` ligature and the B/8/O/A counters.
- A rotated Barlow run, "WAVE TOWER office".
- A White Ink run, "WHITE INK 0O8", overlapping the process run.
- The curved laurel SVG logo.
- A QR with a black keyline on White Ink. The keyline is a filled, expanded
  path.
- A UPC-A with outlined digits.
- A 256x256 transparent PNG: an 8 px checkerboard with an alpha-ramped edge,
  embedded losslessly with an SMask.
- An uploaded White Ink mask with 100/75/50/25/0% tint bands and a 50% alpha
  lower half.

`tests/ai-format-proof.test.ts` asserts:

- No text operators (BT/Tf/Tj/TJ/Tr) and no stroke-paint operators.
- No font in the page resources.
- The `White Ink` Separation with overprint on, and both its 1 and 0 tints
  painted.
- The art raster embedded at 256x256 with Flate.
- The uploaded mask embedded as a Separation image with an SMask.

Ghostscript `tiffsep` shows the expected Black, Cyan and White Ink plates.

**Proof limits, by design:**

- Text and logo keylines are off. Glyph and curve dilation is Task 2. The
  proof's outline pass throws on any live stroke rather than ship one.
- `newDoc` still embeds the faces it is given as unreferenced subset fonts
  (12 Font and 6 FontDescriptor objects in the proof). No page references
  them. Removing them is Task 4.

## Open decisions (user)

- **D1, stroke engine and CSP. Decided 2026-11-03: accepted.**
  `canvaskit-wasm/full` (7.9 MB wasm, lazy-loaded only by the AI export), and
  `'wasm-unsafe-eval'` in the Tauri `script-src`. Unblocked Tasks 2 and 9.
- **D2, layer separation.** Illustrator's PDF import is expected to put
  everything on one layer; PDF OCGs do not become AI layers. The issue asks
  only for "useful layer/group separation", so a top-level group per pass
  (process art, White Ink) may be enough. Task 1 records what Illustrator
  does, and this decision follows it.
- **D3, artboard and bleed.** Does Illustrator make the artboard from the
  TrimBox (8x5in) or the MediaBox? Does it set Document Setup bleed? If it
  uses the MediaBox, should the AI build set CropBox = TrimBox? That would
  differ from the print PDF.
- **D4, a transparent raster's White Ink.** Today the print PDF floods a
  raster's whole rect with White Ink, ignoring alpha (seen in the proof's
  White Ink plate). The issue says "no unintended white rectangle". Should the
  footprint follow alpha in both the PDF and the AI? That changes the print
  PDF, so it is a separate decision and ticket.
- **D5, MIME type and save filter. Decided 2026-11-03: the default.**
  `application/illustrator` for the browser download, with a `.ai` filter in
  the native dialog.

## Tasks

Each task begins by writing its named test, running it red, then
implementing. UI rendering is TDD'd on logic and verified visually. Every
task's gate is `npx tsc --noEmit` plus `npx vitest run <its test>`.

1. **[USER] Illustrator format gate on the proof.** Open
   `proof/ai-format-proof.ai` directly in the latest stable Illustrator and the
   previous two majors. Record each major, build and OS. Check every item in
   *What to check in Illustrator* below. Save as .ai, close, reopen and check
   again. Export a PDF for comparison.
   Test: none (manual). Acceptance: a written pass/fail per item, per
   version. Depends on: none. **Blocks 5 to 18.** If it fails, stop and
   re-plan the format.
2. **Done. Stroke expansion engine.** Create `src/ai/expand.ts` with
   `dilate(paths: readonly string[], w: number): Promise<string[]>`. It
   lazy-loads `canvaskit-wasm/full`, computes `stroke(2w, round) ∪ fill`, and
   outputs cubic-only SVG path data.
   Test: `tests/ai-expand.test.ts`.
   - A rect dilates to a rounded rect with an exact area.
   - Barlow B/8/O counters stay open at the shipped keyline width.
   - Bounds grow by w ± 0.01 pt.
   - Open centre-lines, overlaps and w ≤ 0 return [].
   - The output has no `Q`.
   Types: none new. Depends on: D1. Parallel with 3.

   As built: all inputs union into one nonzero outline (`[]` or `[d]`), each
   input string filled on its own as `drawSvgPath` draws it. Deviation: an
   open centre-line returns its round-capped band, not `[]`, because the
   print PDF's live stroke draws that band; overlaps union into one contour.
   Only w ≤ 0 (or NaN) and no paths return `[]`. Skia's round joins come out
   as conics; each becomes one cubic (under 0.03% of the radius off).
3. **Outline pass.** Create `src/ai/outline.ts` with
   `outlineItems(items: readonly PlacedLayer[], font: FaceFont, dilate): Promise<PlacedLayer[]>`.
   It promotes the proof's pass. It is an exhaustive switch over
   `PlacedLayer["kind"]` that ends in `never`. It handles:
   - text with and without a keyline;
   - path keylines;
   - the barcode halo (bars and digits);
   - rasters and pages, passed through.

   The script then imports it instead of carrying its own copy.
   Test: `tests/ai-outline.test.ts`.
   - Every output item is `paths`, `image` or `page`.
   - Stroke items come before fill items.
   - The number of outlined glyphs equals `font.layout` glyphs. The ligature
     `office` gives 4.
   - Rotated and tracked runs match `glyphPaths` bounds within 0.05 pt.
   - Missing glyphs throw.
   Types: `PlacedLayer`, `PlacedPaths`, `FaceFont = (face: Face, family?: FontFamilyId) => Font`.
   Depends on: 2 (an injected `dilate` makes it testable with a stub first).
4. **AI builder, with no embedded fonts.** In `src/pdf/build.ts`, add
   `buildAiFile(items, assets): Promise<Uint8Array>`. It calls
   `outlineItems`, then the print path, with `newDoc` told not to embed faces.
   Use one parameter, not a new options type.
   Test: `tests/ai-build.test.ts`.
   - The whole file has no Font, FontDescriptor or FontFile objects.
   - No BT/Tf/stroke operators.
   - It has the Separation, OP/op and the OCG.
   - The page boxes equal `buildPrintPdf`'s.
   - `buildPrintPdf` and `buildArtPdf` bytes and the goldens are unchanged
     (`tests/pdf-print-build.test.ts`, `tests/print-geometry-goldens.test.ts`).
   Depends on: 3.
5. **Rendered parity with the print PDF.** At 600 DPI, render each plate of
   the AI and of the print PDF with pdftoppm and Ghostscript `tiffsep`, the
   same rasterizer for both. Compare the process plates and the White Ink
   plate separately. Any allowance is bounded to contour edges and stated per
   fixture; there is no blanket percentage. Include image-free and
   transparent-image controls.
   Test: `tests/ai-render-parity.test.ts`. Depends on: 4.
6. **Machine-readable codes.** Decode the AI's 600 DPI render with zxing-wasm
   (as `tests/qr-print-decode.test.ts` does) to the exact payload. Cover
   UPC-A, EAN-13, Code 128 and QR, upright and in all four quarter-turns,
   over light, dark and textured backgrounds.
   Test: `tests/ai-code-decode.test.ts`. Depends on: 4. Parallel with 5.
7. **Raster inventory and effective PPI.** Add
   `rasterInventory(items, assets): { asset: string; px: [w, h]; placedPt: [w, h]; ppi: [x, y]; embedded: true }[]`.
   PPI comes from the actual cover or contain placement, not metadata.
   Test: `tests/ai-raster-inventory.test.ts`. A 1200 px image over 4 in gives
   300 PPI, over 8 in gives 150 PPI, and a cover crop uses the real scale.
   Lossless: the decoded embed equals the source for the checkerboard and
   alpha-edge fixtures. Depends on: 4. Parallel with 5 and 6.
8. **Regression matrix fixtures.** Add the issue's matrix rows as synthetic
   fixtures:
   - Poppins and Barlow; AVATAR, WAVE TOWER, office; accents; tracking;
     alignment and justify; mixed weights; White Ink runs; rotated text.
   - Nested logo contours and the Q/T SVG cases (#67, #68).
   - Bleed 0.0633 in and 0.125 in, at PSD DPI 300, 600 and 1200.
   - Square, portrait and landscape textures.
   - Mask tints and alpha.
   - Collab OFF/ON on `masters/lolev.master`, and disabled layers.
   Test: `tests/ai-matrix.test.ts`. Depends on: 4. Feeds 5 and 6.
9. **Done. CSP and wasm loading in the desktop app.** Add `'wasm-unsafe-eval'` to
   `script-src`. Serve the wasm through Vite `?url` and load it lazily.
   Test: `tests/tauri-capabilities.test.ts`, which checks the CSP string and
   that it allows nothing broader. Depends on: D1. Parallel with 3 to 8.

   As built: `src/ai/expand.ts` imports the module and the `?url` wasm
   lazily; Node (tests, `scripts/`) lets CanvasKit read the wasm beside its
   module. Checked in headless Chrome under the shipped CSP with a probe
   build: the wasm compiles and `dilate` returns; without
   `'wasm-unsafe-eval'` it fails with a CSP CompileError. In that build the
   wasm (8.2 MB) and CanvasKit's JS (121 kB) are their own lazy files.
10. **Export lifecycle.** In `src/useExport.ts`:
    - widen `exportSingle`'s format to `"pdf" | "psd" | "ai"`;
    - add `printAi` to the destination memory, independent of PDF and PSD;
    - add `exportAi(request)` with a lazy `import("@/pdf/build")`.

    Test: `tests/use-export-dom.test.tsx`.
    - The suggested name is `<label stem>.ai`, or the export base.
    - As… asks again.
    - Cancel reports nothing.
    - A build failure writes nothing and names the file.
    - The busy state is released after success, failure and cancel.
    - Repeated clicks start one job.
    Depends on: 4.
11. **Destination memory across tabs and saves.** Save As, a first save,
    opening another label, or closing a tab must not leave an AI destination
    that overwrites another label's file.
    Test: `tests/save-races-dom.test.tsx`. Cover names with spaces and
    non-ASCII. Depends on: 10.
12. **Native save filter and fs scope.** Add `.ai` to the export dialog's
    filters (`src/files.ts`). Add `.ai` to the write scope only if re-saving
    to a remembered path needs it, and broaden nothing else.
    Test: `tests/files.test.ts`, `tests/tauri-capabilities.test.ts`.
    Depends on: 10.
13. **Commands, menu and palette.** Add **Export Illustrator (.ai)** and
    **Export Illustrator (.ai) As…** to the `App.tsx` command list, the
    `AppMenu.tsx` Export submenu and `CommandMenu.tsx`. Use no shortcut and
    the existing `guardExport` blocked-label gate.
    Test: `tests/appmenu.test.ts`, `tests/app-ux-commands-dom.test.tsx`.
    Depends on: 10.
14. **Locales.** Add both labels to all five `src/locales/*.ts` files, with no
    em dashes.
    Test: `tests/i18n.test.ts`. Depends on: 13.
15. **Blocked labels and stale jobs.** Missing glyphs and invalid codes reuse
    the blocked-label toast. One coherent snapshot is taken per job, and an
    edit during the build follows the stale-result path.
    Test: `tests/export-blocked-toast-dom.test.tsx`. Depends on: 10.
16. **Docs and changelog.** Update `docs-site/content/docs/(output)/export.mdx`
    with:
    - the AI export;
    - what stays raster;
    - the tested Illustrator versions, builds and OS, with dates;
    - the save-settings boundary.

    Add an `## [Unreleased]` → `### Added` bullet in `CHANGELOG.md`.
    Test: `npm run build --prefix docs-site`, and
    `node scripts/check-release.mjs origin/main`. Depends on: 10 to 14 and 17.
17. **[USER] Full Illustrator acceptance gate.** Export through the real app,
    browser and packaged desktop, on the matrix fixtures. In each of the three
    majors:
    - open on a clean machine without the fonts or the asset folder;
    - check Outline view, Document Info, Separations Preview, Overprint
      Preview and the Links panel;
    - save, reopen, and export a validation PDF for Task 5's comparison;
    - save in the latest Illustrator with compatible settings, then reopen in
      the oldest target.

    Keep the evidence packet. Test: none (manual). Depends on: 5 to 15.
18. **Repository delivery.** Run `npm test`, `npx tsc --noEmit`,
    `npm run lint`, `npm run build`, `npx knip@6.38.0`, and
    `node scripts/check-release.mjs origin/main`. Smoke-test the app's export.
    Depends on: all.

**Parallelism**

- 2 and 3 can run together, with a stub `dilate`.
- 5, 6, 7 and 8 can run together after 4. 9 can run any time after D1.
- 11, 12, 13 and 15 can run together after 10. 14 follows 13.
- 1 and 17 are user-owned and sit outside the agent queue. 1 gates
  everything after 4.

## What to check in Illustrator (Task 1)

Use File → Open on `proof/ai-format-proof.ai` itself, in each major. Do not
resave it in a newer Illustrator first. Record the Illustrator version, build
and OS for each check.

1. **Open warnings.** It opens with no repair, missing-font, missing-link,
   unsupported-content or colour-conversion warning. Note any import dialog.
2. **Document Info.** Window → Document Info lists Fonts: none and Embedded
   Images: 2 (the art raster and the mask). The Links panel shows both as
   embedded, with no linked files.
3. **Outline view.** In View → Outline (⌘Y), every glyph is a path. The
   counters of B, 8, O, A, e and o are holes. The `ffi` ligature is one glyph.
   Direct Select reaches individual glyph, laurel, QR-module and barcode-bar
   paths. The laurel's curves are smooth curves, not polylines.
4. **Text objects.** Select → Object → All Text Objects selects nothing.
5. **Strokes.** No object has a stroke. The QR's black keyline is a filled
   compound path behind the gold modules.
6. **Swatches and separations.**
   - The Swatches panel has exactly one spot swatch named `White Ink`.
   - The White Ink objects use it.
   - Window → Separations Preview lists White Ink as its own plate.
   - Toggling White Ink shows:
     - the five tint bands (100/75/50/25/0%), fainter in the lower half,
       where alpha is 50%;
     - knockouts where the gold metallic text, the laurel, the barcode and
       the QR modules sit;
     - the "WHITE INK 0O8" run as ink;
     - the transparent raster's full square footprint (D4).
7. **Overprint.** Overprint Preview on: the process artwork is not knocked out
   by White Ink. Attributes panel: White Ink objects have Overprint Fill
   checked.
8. **Raster.** The checkerboard disc's edge fades with no white or black
   fringe and no white box, over both the gold and the bare areas. Links info
   shows 256x256 px.
9. **Size and boxes.** Note the artboard size: 8.000 x 5.000 in (trim) or
   8.127 x 5.127 in (with bleed). Note the File → Document Setup bleed values
   (D3).
10. **Layers.** Note the layer and group structure Illustrator creates (D2).
11. **Round-trip.** Save as .ai with the default options, close, reopen, and
    repeat 2 to 8. Then File → Save a Copy as PDF and keep it for comparison.
12. **Codes.** Scan the QR (`https://example.com/proof`) and the UPC-A
    (`012345678905`) from the screen at 200% zoom.

If 3, 5, 6 or 7 fail in any target version, the PDF-compatible route is not
proven. Stop and bring the failing version and file back before any
integration work.
