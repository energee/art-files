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
`src/description.ts`). The barcode reproduces JsBarcode's UPC-A rendering,
so it matches the `barcode-qr` app at any scale: all of its geometry is
authored in modules (bars 15, digits 10, text gap 4, guards 24, quiet zone
8 — the module counts that app's options produce) and scaled by one
`UPC_MOD` in `src/layout.ts`. Digits are Poppins Regular in a column right
of the bars, with the number-system and check digits printed outside the
symbol in the quiet zones. Contrast comes from the
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
neutral dark theme). The sidebar splits fields by how often they change: **This beer** holds
what's edited every release (name, subtitle, ABV, UPC, QR, description);
**Brand template** collects the six set-once elements (volume, wordmark,
logo, handle/addr, warning, store cold) behind a collapsed disclosure
with a count badge, since their gold/metallic defaults are correct
almost every time. There are no more per-row swatch chips — a small dot
next to a row's label is the only per-row style signal, flagging a style
that deviates from the shipped gold/metallic default. Selecting an
element — by focusing or clicking its row in the form, or clicking it
directly in the preview, which doubles as a click target and draws a
selection outline around whatever's picked — opens one contextual style
panel below the form (Photoshop's model: only one element's panel is
ever open at a time). Its Fill (color picker/hex field/no-ink toggle),
Layer select, and outer-stroke toggle (its own color + width, px at the
600dpi deliverable, default 15px ≈ 1.8pt) are on every element's panel; a
Bold checkbox shows for the elements that have one, and a Reset button
(back to that element's shipped default) once a style deviates from it.
The description block's panel sets the base fill/layer for its plain
lines and the header plus an outer stroke for all its lines; the
`_white_` marker still overrides fill/layer per line; the logo's classic
dark keyline is just this stroke, on by default. Clicking empty
background in the preview clears the selection.

The description itself is a WYSIWYG multiline field now, not a
raw-markdown textarea: each line renders in its real appearance
(gold/white ink, bold, larger header) instead of `#`/`**`/`_`
punctuation, a toolbar toggles Header/Bold/White ink for whichever
line(s) the caret or selection touches, and "Edit as text" is an escape
hatch back to the raw markdown — storage is unchanged, still the same
markdown-subset string parsed by `src/description.ts`. The preview is a single frame: both PDFs
render to bitmaps via pdf.js and stack there, and a draggable divider
reveals the white-ink layer over the art in place — no embedded PDF
viewer, no tabs. Live previews build against a downscaled copy of the
texture/mask (print-size images made every keystroke-triggered rebuild
churn enough memory to crash the tab); downloads always rebuild at full
resolution when clicked. One **Export
PDFs** button downloads both files together, and **Export PSD** writes a
layered Photoshop file (see below); Save/Load config are small
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

### Layered PSD

`src/psd/build.ts` is a second renderer over the same `LabelConfig` and the
same `src/layout.ts` geometry, for handing artwork to a designer. Text
elements become editable Photoshop type layers; the logo, QR and barcode
become vector shape layers with real bezier knots; the texture is the one
raster layer. Layers are grouped as Texture / Left column / Center / Right
column / Codes. Photoshop prompts to update text layers on open because
ag-psd writes the text data without a rendered bitmap — choose **Update**.
The PDFs remain the printer deliverable; the PSD is the editable handoff.

Headless (same renderer, used for iteration/batches):

```bash
npm run generate -- <texture.png|none> <mask.png|none> <outDir> [config.json]
# writes {Name}.pdf, {Name}-mask.pdf and {Name}.psd
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
