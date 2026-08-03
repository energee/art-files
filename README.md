# Lolev Label Generator

Local web app that turns a rock texture + metallic mask (from the `label-gen`
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
`src/description.ts`). The barcode draws directly on the texture as
white-stroked black bars and digits (no background block); its footprint is
still white-inked in the mask for scan contrast. The QR code's payload is
derived from the beer name (`https://lolev.beer/beer/<machine-name>`) with
a pickable fill color and optional stroke — there is no separate QR data
field. Design doc:
`docs/superpowers/specs/2026-08-02-label-pdf-generator-design.md`; the UI
rewrite to React + Tailwind + shadcn/ui is documented in
`docs/superpowers/specs/2026-08-02-shadcn-ui-rewrite-design.md`.

## Usage

The UI is built with React 19, Tailwind v4, and shadcn/ui (Linear-style
neutral dark theme). Press <kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd> to open a
command palette for save/load config, downloads, and preview-mode
switching.

```bash
npm install
npm run dev        # open the app: drop texture + mask, fill the form,
                   # previews update live, download both PDFs
```

Headless (same renderer, used for iteration/batches):

```bash
npm run generate -- <texture.png> <mask.png> <outDir> [config.json]
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
