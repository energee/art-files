# Lolev Label Generator

Local web app that turns a rock texture + optional metallic mask (from the `label-gen`
repo) plus beer info into the two print-ready 600-DPI PDFs sent to the label
printer:

- `{Beer Name}.pdf` — label art (8x5 in + 0.0633 in bleed, 585.12 x 369.12 pt)
- `{Beer Name}-mask.pdf` — white-ink layer: **blue = white ink, white =
  knockout** (silver stock shows through), same convention as the
  `label-gen/Rocks` mask PNGs (white `255,255,255` = metallic, blue
  `0,156,215` = everything else)

Every text element — and each description line individually — has a **fill**
(a hex color like `#D0B070`, or `none` for no ink, drawn in the art PDF) and
a **layer** (`metallic` knocks out of the white layer; `white` gets a
white-ink underlay). The description block is authored as a markdown
subset, one label line per line: `# text` = header, `**text**` = bold,
`_text_` = white ink, combinable; plain lines are gold metallic (parsed by
`src/description.ts`). The barcode follows JsBarcode's UPC-A rendering
(matching the `barcode-qr` app): plain black bars with the digits column to
their right, and the number-system/check digits printed outside the symbol
with their bars run tall alongside the guards. Contrast comes from the
white ink the mask lays under the whole footprint — per-bar white outlines
distorted the module widths enough to stop it decoding. The QR code's payload is
derived from the beer name (`https://lolev.beer/beer/<machine-name>`) with
a pickable fill color and optional stroke — there is no separate QR data
field. Design doc:
`docs/superpowers/specs/2026-08-02-label-pdf-generator-design.md`; the UI
rewrite to React + Tailwind + shadcn/ui is documented in
`docs/superpowers/specs/2026-08-02-shadcn-ui-rewrite-design.md`.

## Usage

The UI is built with React 19, Tailwind v4, and shadcn/ui (Linear-style
neutral dark theme). Each styled row shows a swatch chip; most rows also
show a text input next to it, but style-only rows (QR, Wordmark, Logo,
Warning) show just the chip. Click the chip to open a popover with the
color picker/hex field/no-ink toggle, layer select, bold toggle, and an
outer-stroke toggle with its own color + width (px at the 600dpi
deliverable, default 15px ≈ 1.8pt) — available on every element, the
description block included (its swatch sets the base fill/layer for plain
lines and the header plus an outer stroke for all its lines; the `_white_`
marker still overrides fill/layer per line); the logo's
classic dark keyline is just this stroke, on by default. All rows — the six
template ones (volume, wordmark, logo, handle/addr, warning, store cold)
included — sit in one flat list, no collapsed section. The preview is a single frame: both PDFs
render to bitmaps via pdf.js and stack there, and a draggable divider
reveals the white-ink layer over the art in place — no embedded PDF
viewer, no tabs. Live previews build against a downscaled copy of the
texture/mask (print-size images made every keystroke-triggered rebuild
churn enough memory to crash the tab); downloads always rebuild at full
resolution when clicked. One **Export
PDFs** button downloads both files together; Save/Load config are small
ghost buttons. Press <kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd> for a command
palette covering save config, load config, download art PDF, download mask
PDF, and preview snap actions ("Preview: Art" / "Preview: White-ink" jump
the divider to either end).

```bash
npm install
npm run dev        # open the app: the label previews immediately (text on bare
                   # stock), drop a texture + optional mask to fill it in,
                   # previews update live, download both PDFs
```

Headless (same renderer, used for iteration/batches):

```bash
npm run generate -- <texture.png|none> <mask.png|none> <outDir> [config.json]
```

The Save/Load config buttons round-trip the whole form as JSON (`{version: 1,
...LabelConfig}`, see `src/types.ts`). Config files saved by the pre-rewrite
vanilla-TS UI (named fills like `"gold"`/`"white"`/`"black"`, a `qrData`
field) are auto-migrated on load: `gold` → `#D0B070`, `black` → `#000000`,
`white` → `none`, and `qrData` is dropped in favor of the derived QR
payload. The app entry point is `src/main.tsx` (the old `src/main.ts` /
`src/style.css` vanilla-TS UI is gone).

## CMYK for the printer

The app outputs RGB. Before sending to the printer, convert:

```bash
brew install ghostscript   # once
tools/to-cmyk.sh LABRADORITE.pdf LABRADORITE-mask.pdf
```

## Layout

All geometry lives in `src/layout.ts` (points, top-left origin), tuned by
visual comparison against the Photoshop-era `Labradorite.pdf` /
`Labradorite-mask.pdf` reference pair. `src/pdf/build.ts` draws both PDFs from
that single geometry source, so art and mask stay registered. Static assets
(Poppins, the 2025 laurel logo) are bundled in `src/assets/`.

## Tests

```bash
npm test    # vitest: UPC-A encode/validate, QR geometry, mask polarity,
            # config round-trip
```
