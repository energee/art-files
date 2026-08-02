# Beer Label PDF Generator — Design

Date: 2026-08-02. Status: approved (conversation with Ted).

## Purpose

A static Vite + TypeScript web app (pattern: the `barcode-qr` repo) that takes
beer label inputs and produces the two print-ready 600-DPI PDFs Lolev sends to
its label printer, replacing the manual Photoshop workflow that produced
`label-gen/Rocks/Labradorite.pdf` + `Labradorite-mask.pdf`.

## Inputs

Variable per label:

- beer name (e.g. "LABRADORITE"), style line ("Ultra Hopped Ale"), ABV
- description block: a markdown subset, one label line per line (`# text` =
  header, `**text**` = bold, `_text_` = white ink, combinable; plain =
  gold metallic)
- 12-digit UPC-A (rendered, validated with check digit; drawn as
  white-stroked black bars/digits directly on the texture — no background
  block — while the mask still white-inks the footprint)
- QR data (URL)
- background texture PNG/JPG (4800x3000, 8:5) + metallic mask PNG
  (same dimensions; exactly white `(255,255,255)` = metallic and blue
  `(0,156,215)` = white-ink, per the label-gen repo convention)

Static template (recreated from the Labradorite example, Poppins bundled
locally, real laurel logo from `Logos/Logo2025.svg`):

- "Lolev Beer" wordmark, laurel logo, "1 PINT",
  "@LOLEVBEER 5247 BUTLER ST, PITTSBURGH, PA", government warning, "STORE COLD"

Per-element controls: every text element — and each description line — has a
**fill** (gold / white / black) drawn in the art PDF and a **layer**
(`metallic` = knocked out of the white-ink layer so the silver stock shows;
`white` = white-ink underlay). Defaults mirror the Labradorite label.
A Save/Load button round-trips the whole form as JSON.

## Outputs

- `{Beer Name}.pdf` — label art. Page 585.12 x 369.12 pt (8x5 in art +
  0.0633 in bleed), texture scaled to fill the bleed box, all text/logo/
  barcode/QR drawn as vector with embedded fonts.
- `{Beer Name}-mask.pdf` — white-ink layer, same page size, binary blue/white:
  blue = white ink, white = knockout. Composition: page painted blue where the
  mask PNG is blue; metallic-assigned glyphs/QR knock out (white); the barcode
  block stays blue. Registration is guaranteed because both PDFs share one
  layout/geometry module.
- `tools/to-cmyk.sh` — Ghostscript post-step (brew install ghostscript) that
  converts both RGB PDFs to CMYK before sending to the printer (printer
  requires CMYK; in-browser output is RGB).

## Architecture

Pure TS core (no DOM) so the same code runs in the browser app and in a Node
iteration harness:

- `src/layout.ts` — all geometry in points; single source of truth
- `src/upc.ts` — UPC-A validation + module encoding (pure port of barcode-qr's
  validation; encoding table implemented directly to avoid DOM-bound JsBarcode)
- `src/qr.ts` — QR matrix via `qrcode-generator` (pure) + styled module geometry
- `src/pdf/art.ts`, `src/pdf/mask.ts` — pdf-lib builders (RGB; gs converts)
- `src/preview.ts` — same geometry rendered to on-screen SVG, art + mask side
  by side, live
- `src/main.ts`, `index.html` — form, drag-drop for texture/mask, downloads
- `scripts/generate.ts` — Node harness (tsx) used to regenerate the Labradorite
  label and visually iterate against the original PDFs

## Validation & errors

UPC-A check digit inline; mask must be same size as texture and contain only
the two allowed colors (small tolerance, reported clearly); beer name required
before download.

## Testing

Vitest on pure logic: layout math, UPC-A encoding/check digit, mask
polarity/compositing rules, config JSON round-trip. Visual QA: regenerate
Labradorite from the labradorite texture/mask and compare renders against the
original PDFs, iterating until they match.
