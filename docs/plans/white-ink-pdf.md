# One print PDF with a "White Ink" spot layer

Status: planned (order 1 of 3: white-ink PDF → realistic can → CMYK export).

## Why

The printer (Blue Label Digital, "White File Creation" sheet) wants ONE PDF
with white ink as a spot colour, not our art PDF + blue/white mask PDF pair.
Their spec, verbatim in substance:

1. Spot swatch named exactly **`White Ink`**, alternate **100% magenta**.
2. A layer named **`White Ink`**, on top.
3. Every white element painted in that swatch (shows magenta, prints white).
4. Text converted to outlines.
5. **Overprint Fill** (and Stroke) on every white element.
6. The saved PDF should show the white as semi-transparent (overprint preview).

## Decided (with the user)

- `Export PDF` (⌘E) writes one `{name}.pdf`: the art plate as today, plus the
  `White Ink` layer.
- The old pair (`Export PDFs`, `Export Artwork PDF`, `Export Mask PDF`) stays,
  hidden behind a **Settings** toggle ("Two-file PDF export", default off).
  Those builds are unchanged.

## Builder's calls (made in brainstorming, change if wrong)

- PSD exports unchanged.
- Only the White Ink layer is outlined; art text stays live with embedded
  subset fonts.
- An uploaded mask PNG becomes a 1-channel image in the `White Ink` colour
  space, tint = `(255 - R) / 255` (blue `R=0` → 100%, white `R=255` → 0%), so
  anti-aliased edges keep partial tint instead of a hard threshold.
- `npm run generate` writes the single file by default; `--two-file` writes
  the old pair.

## Mapping: today's mask plate → White Ink

Today's mask plate is already the white layer, drawn in two RGB colours
(`maskColor` in `src/pdf/build.ts`). The combined file draws the SAME mask pass,
in the same order, with the colour swapped:

| Mask plate today | White Ink layer |
|---|---|
| `L.COLORS.maskBlue` fill/stroke | `/CSW cs 1 scn` (`CS`/`SCN` for strokes) |
| white `rgb(1,1,1)` (knockout) | `/CSW cs 0 scn` |
| no mask bytes → full-page blue flood | full-page rect at tint 1 |
| uploaded mask PNG | Separation image, tint per pixel |
| raster art footprint (blue rect) | rect at tint 1 |
| text / stroked text | glyph outlines (fill + `2w` stroke), tint by layer |
| barcode halo + digits | same shapes; digits outlined |

Why tint 0 works as a knockout: with overprint on, painting in a Separation
colour space only touches that one colorant. A tint-0 shape therefore erases
White Ink under it and leaves CMYK alone. That's exactly the mask's "white
wins on top" draw order. **Viewer caveat:** a viewer without overprint
preview (macOS Preview, Acrobat outside PDF/X) draws tint-0 shapes as opaque
white over the art and tint-1 shapes as magenta. That matches what the
printer's step 6 expects you to check in Acrobat with **Output Preview /
Overprint Preview** on. The CMYK plan's PDF/X output intent makes Acrobat
turn that preview on by default.

## Proven by spike (2026-10-28)

A hand-built page (pdf-lib low-level objects: Separation `White Ink` /
DeviceCMYK tint fn `C0 [0 0 0 0] C1 [0 1 0 0]`, ExtGState `OP/op true OPM 1`,
OCG `White Ink` + `/OCProperties`, content `/OC /OCW BDC … EMC`) went through
`tools/to-cmyk.sh` unchanged. `gs -sDEVICE=tiffsep` on the result emitted a
`White Ink` separation, and the magenta plate stayed uniform under the white
rect, so overprint holds. Fill overprint (`op`) survived the conversion; the
unused stroke flag (`OP`) was dropped. Re-check with real stroked white (task 8).

## Tasks

Each task starts by writing its named test and watching it fail. Validation
for every task: `npx tsc --noEmit && npx vitest run <test>`. Work in a worktree
under `.agents/worktrees/white-ink-pdf/`, branch `feat/white-ink-pdf`.

### 1. White Ink resources — `src/pdf/whiteInk.ts` (new)
Module comment: "the printer's White Ink spot layer: colour space, overprint
state, and optional-content layer for the combined print PDF."
- `export const WHITE_INK = "White Ink"`.
- `registerWhiteInk(doc: PDFDocument, page: PDFPage): { begin: PDFOperator[]; end: PDFOperator[] }`.
  It registers the Separation array (alternate DeviceCMYK, Type 2 function
  `C0 [0 0 0 0] C1 [0 1 0 0] N 1`), the ExtGState (`OP true op true OPM 1`) and
  the OCG (`Name (White Ink)`). It sets catalog `/OCProperties
  << /OCGs [ocg] /D << /Order [ocg] /ON [ocg] >> >>`, adds page resources
  `/ColorSpace /CSW`, `/ExtGState /GSW`, `/Properties /OCW`, and returns
  `begin = /OC /OCW BDC q /GSW gs` and `end = Q EMC`. Build the operators with
  pdf-lib's `PDFOperator.of`, never by string-concatenating bytes.
- `whiteFill(t: 0 | 1)` / `whiteStroke(t)`: the `cs`/`scn` and `CS`/`SCN`
  operator pairs.
- Test `tests/pdf-white-ink.test.ts`: save a doc with only the resources
  registered, reload it with `PDFDocument.load`, and assert the colourant name
  `White Ink`, alternate `DeviceCMYK`, `C1 [0 1 0 0]`, `OP`/`op` true, an OCG
  named `White Ink` listed in `/ON`.

### 2. Text → outlines — `src/pdf/outline.ts` (new) — depends on nothing
Turns a `PlacedText` into the SVG path strings `drawSvgPath` eats.
- **Reuse, don't rewrite:** `digitGroupPaths` in `src/psd/build.ts` already
  walks fontkit glyph commands (quadratic → cubic elevation, rotated runs).
  Move its glyph walk into this module and make the PSD import it from there.
  Keep `digitGroupPaths` itself in the PSD file as a thin wrapper.
- Advances must match what `page.drawText` prints. Per #86, pdf-lib places raw
  advances with no kerning, and `withTracking` adds `Tc` per glyph. So lay out
  with kerning/ligatures off (`font.layout(text, { kern: false, liga: false })`
  or `glyphsForString` + `advanceWidth`) and add `tracking` after each glyph.
- Faces come from `openFont` (`src/fontkit.ts`) on the same bytes in `Assets`.
- Test `tests/pdf-outline.test.ts`. Outline a known run, e.g. Poppins Bold
  "LUPULA" with tracking, and a rotated run. The outline bbox must match the
  drawn text's bbox from `pdftotext -bbox` / pdf-lib `widthOfTextAtSize`
  within 0.05pt.

### 3. White pass drawer — `src/pdf/build.ts` — depends on 1, 2
Add `drawWhiteInk(page, fonts, items, embedded, white)`. It walks the SAME
list in the SAME order as `drawItems(…, "mask")`:
- text → outline paths (task 2), then stroke-before-fill like the `paths`
  branch (`borderWidth: 2 * stroke.w`).
- paths / page flood / image footprint → as today.
- barcode → `drawBarcode` in mask mode, with the digits outlined.
  `digitGroupPaths` is already the outline, and the every-white-before-any-black
  ordering rule still applies.
Colour: get operators from pdf-lib's exported builders (`drawSvgPath`,
`drawRectangle`, `drawImage` from `"pdf-lib"`, which return `PDFOperator[]`).
Map each fill/stroke colour operator (`rg`/`g`/`RG`/`G`) to `whiteFill`/
`whiteStroke` of tint 1 (maskBlue) or 0 (white), then `page.pushOperators`.
Don't regex the serialized stream. Factor `maskColor`'s two cases into one
`maskTint(layer): 0 | 1` that both the RGB mask and the white pass read, so
the mapping can't drift.
- Test `tests/pdf-white-ink.test.ts` (extend): the content stream for a
  fixture plan contains no `rg`/`RG` between `BDC` and `EMC`, and has exactly
  as many `scn` paints as the mask build has blue+white paints.

### 4. Mask raster as a Separation image — `src/pdf/whiteInk.ts` — depends on 1
- `embedWhiteInkMask(doc, rgba: Uint8ClampedArray, w, h)` builds an image
  XObject with `/ColorSpace <the Separation>`, `/BitsPerComponent 8`, and
  `ctx.flateStream(tints)` where `tints[i] = 255 - R[i]`.
- Decoding stays OUTSIDE build.ts, the way `psdImages` takes
  `rasterPixelsNatural` (`src/assets/io.ts`). `Assets` gains optional
  `maskPixels?: { data; width; height }`: the app fills it via
  `rasterPixelsNatural`, the CLI via `pngjs` (already a devDependency; check
  the CLI path can use it, or decode with the same helper the CLI already
  uses for the mask).
- Test (extend `pdf-white-ink.test.ts`): a 2×1 PNG [blue, white] → image
  stream decodes to `[255, 0]`.

### 5. `buildPrintPdf` — `src/pdf/build.ts` — depends on 3, 4
```ts
export async function buildPrintPdf(items, assets): Promise<Uint8Array>
```
`newDoc` → art pass exactly as `buildArtPdf` → `registerWhiteInk` → `begin`
→ the white pass, using the uploaded-mask Separation image or else the tint-1
flood, then `drawWhiteInk` → `end`. Title `{Name} label`. Keep the bleed
shift rules: the page flood and mask draw through `withoutBleedShift`.
- Test `tests/pdf-build.test.ts` (extend): byte-deterministic on repeat. The
  art-only content (before `BDC`) must equal `buildArtPdf`'s for the same
  input.

### 6. Separation goldens — `tests/print-pdf-separations.test.ts` — depends on 5
The acceptance test for the whole feature. For each existing golden fixture:
- `gs -sDEVICE=tiffsep -r150` on `buildPrintPdf`. The `White Ink` plate must
  equal "pixels that are maskBlue" in `pdftoppm -r150` of `buildMaskPdf`, with
  at most AA-edge pixels differing (pick the tolerance from the first run, and
  write it in the test with its reason).
- The C/M/Y/K plates must match `tiffsep` of `buildArtPdf`.
- CI: add `ghostscript` to the existing `apt-get install` line in
  `.github/workflows/ci.yml` (next to `poppler-utils`).

### 7. Export wiring — `src/useExport.ts`, `src/App.tsx`, `src/components/AppMenu.tsx`, `src/settings.ts`, `src/components/RenderSettings.tsx` — depends on 5
- `settings.ts`: persisted `twoFilePdfExport: boolean` (default `false`),
  stored the way the render settings are.
- `RenderSettings.tsx`: a "Two-file PDF export (art + mask)" switch with a
  one-line hint.
- `useExport.ts`: `buildFull("print")` saves one file via `saveVia`, with no
  mask-path derivation. Leave `exportPair` for the pair as is.
- `App.tsx:2088`: `export-pdf` "Export PDF" takes ⌘E. `export-both`/`export-art`/
  `export-mask` are listed only when the setting is on, with no shortcut;
  ⇧⌘E stays on PSDs. `AppMenu.tsx` export submenu likewise. Check the native
  Mac menu (`APP_MENUS`) and the command palette both read the same list.
- Tests: extend the existing AppMenu/App menu tests to cover the setting off
  (one PDF item, ⌘E) and on (all four PDF items).

### 8. CLI + CMYK script — `scripts/generate.ts`, `tools/to-cmyk.sh` — depends on 5
- generate writes `{name}.pdf` from `buildPrintPdf`; `--two-file` keeps the
  old pair. Test `tests/generate-cli.test.ts`.
- Run `tools/to-cmyk.sh` on a real exported label that has stroked white text.
  Confirm with `tiffsep` that `White Ink` survives, along with `OP`, now that
  strokes use it. If pdfwrite drops stroke overprint, add
  `-dPreserveOverprintSettings=true` (or whatever restores it) and say why in
  the script comment. Log the evidence in `.agents/ledger.md`.

### 9. Docs + release metadata — depends on 7, 8
- `docs-site/content/docs/(output)/export.mdx`: lead with the single PDF. Cover
  what `White Ink` is, how to check it (Acrobat → Output Preview →
  Separations / Overprint Preview), and the viewer caveat. Then the two-file
  setting. The CMYK section names the single file.
- `.agents/AGENTS.md` "About this repo" line on output files.
- `CHANGELOG.md` `## [Unreleased]`: an `### Added` bullet. This is
  binary-impacting, so queue the bullet and don't bump the version.

## Parallelism

1, 2 and the CI line of 6 in parallel → 3, 4 → 5 → 6, 7, 8 in parallel → 9.

## Done when

- `npx tsc --noEmit`, `npm run lint`, `npm test` and knip are green.
- Separation goldens pass in CI.
- A real export opens in Acrobat with a `White Ink` layer and separation, and
  overprint preview shows the white semi-transparent.
- The printer accepts a proof file. That's the last gate, and it's a human one.
