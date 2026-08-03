# Spec: React + Tailwind + shadcn/ui rewrite of the label-generator UI

Date: 2026-08-02
Status: approved

## Goal

Replace the vanilla-TS frontend (`index.html` + `src/main.ts` + `src/style.css`)
with a React app styled with Tailwind CSS v4 and shadcn/ui, using a full
Linear-style neutral dark theme (no gold accent). Behavior is identical to the
current app except two functional changes: per-row fill colors become free hex
values chosen with a color picker (see "Hex fill colors"), and the QR payload
is derived from the beer name (see "Derived QR payload").

## Stack

- Vite + React 19 (`react`, `react-dom`, `@vitejs/plugin-react`)
- Tailwind CSS v4 (`tailwindcss`, `@tailwindcss/vite`)
- shadcn/ui, new-york style, neutral base color; components added via the CLI
  (`Button`, `Input`, `Select`, `Checkbox`, `Textarea`, `Label`)
- shadcn runtime deps: `class-variance-authority`, `clsx`, `tailwind-merge`,
  Radix primitives, `lucide-react`
- Preview rendering: `pdfjs-dist` (PDF → bitmap), `react-resizable-panels`
  (via shadcn Resizable) for the overlay-compare divider

## Hex fill colors

- `Fill` changes from `"gold" | "white" | "black"` to a hex string
  (`#rrggbb`) or the literal `"none"` meaning no ink (replaces the old magic
  meaning of `"white"`).
- UI per row: native `<input type="color">` swatch + hex text field, plus a
  "no ink" toggle. No color-picker library.
- `layout.ts` keeps `GOLD = #D0B070` (the exact hex of the current gold RGB
  0.815/0.69/0.44) as the default; `pdf/build.ts` `fillColor()` parses hex.
- Description markdown syntax is unchanged: plain text renders in default
  gold, `_underscored_` renders as no-ink/white layer.
- QR fill defaults to gold but is pickable (see "QR color and stroke").
- Config JSON stores hex strings; `parseConfigFile` migrates legacy values
  (`gold` → `#D0B070`, `black` → `#000000`, `white` → `none`) so old config
  files keep working.

## Derived QR payload

- The "QR data" form field is removed. The QR payload is always
  `https://lolev.beer/beer/<machine-name>`, where the machine name is the
  beer name lowercased, trimmed, with runs of non-alphanumeric characters
  collapsed to single dashes and leading/trailing dashes stripped
  (e.g. "Ultra Juice" → `ultra-juice`).
- `qrData` is removed from `LabelConfig`; `parseConfigFile` ignores it in
  legacy config files. `qrLayer` stays, with its form row.

## QR color and stroke

- The QR row gains a fill color picker (hex, same control as other rows,
  default `#D0B070`); the art PDF no longer hard-codes gold for the QR.
- Optional stroke: a toggle plus its own hex color picker (default
  `#FFFFFF`), off by default. When on, QR modules are stroked in that color —
  the same treatment as the white-stroked barcode — at a fixed width
  consistent with the barcode's stroke.
- New config fields: `qrFill` (hex), `qrStroke` (hex or `"none"`); legacy
  configs without them get the defaults (`#D0B070`, `none`).

## Per-element outer strokes (addendum, same day)

- Every element style (`Style`) gains optional `stroke` (hex or `"none"`)
  and `strokeWidth` (px at the 600dpi deliverable; default 15 ≈ 1.8pt),
  editable in each row's swatch popover next to the existing controls.
- Strokes are true OUTER strokes, art PDF only: QR/logo use grown/underlay
  passes; text uses a 16-direction offset ring under the fill (pdf-lib
  cannot stroke text — same technique as the barcode digits).
- The logo's previously hard-coded dark keyline becomes this stroke
  (`#1A1A1A`, on by default); pre-stroke configs migrate to keep it.
  `qrStrokeWidth` joins `qrStroke`. The barcode's fixed white stroke is
  unchanged (scannability, not styling).

## UI improvements (included in the rewrite)

1. **Generation status**: a small "building…" indicator on the preview while
   the debounced PDF build runs; previews visibly settle when current.
2. **Inline validation**: per-field errors (UPC under its input, mask error
   on the mask drop, name on the name input) instead of one error blob;
   disabled download buttons explain why via tooltip.
3. **Overlay compare preview (no embedded PDF viewer)**: the two generated
   PDFs are rendered to bitmaps with pdf.js (`pdfjs-dist`) — previews stay
   pixel-true to the print files but drop the browser PDF viewer chrome.
   Both bitmaps are stacked in a single frame; a shadcn Resizable
   (`react-resizable-panels`) divider overlays them — fully left shows pure
   art, dragging right reveals the white-ink layer in place, so the two
   registered layers are compared overlaid, not side by side. No tabs.
   ⌘K keeps "Preview: Art" / "Preview: White-ink" as divider snap actions.
4. **Asset thumbnails**: loaded texture/mask drops show a small image
   thumbnail (mask on a checkerboard) instead of filename only.
5. **Poppins headings**: the already-bundled Poppins is used for the app
   title and section headings; body stays neutral.
6. **Checkerboard "no ink" swatch**: `none` fill renders as a mini
   checkerboard chip in the color control, not a labeled checkbox.
7. **Command palette (⌘K)**: shadcn Command dialog with save config, load
   config, download art, download mask, export both, and preview snap
   actions.
8. **Progressive disclosure (swatch popovers)**: each styled row shows only
   its text input plus ONE swatch chip (current fill color; checkerboard for
   no-ink). Clicking the chip opens a popover holding the full style editor:
   ColorField (picker + hex + no-ink), layer select, bold toggle (StyledLine
   rows), and for the QR row the stroke toggle + stroke color. The separate
   "Name style" / "ABV style" / "QR stroke" rows are merged away.
9. **Collapsed template section**: the template-element rows (volume,
   wordmark, logo, handle/addr, warning, store cold) live in a shadcn
   Collapsible, closed by default — they rarely change.
10. **Quiet actions**: one primary **Export PDFs** button downloads art +
    mask together; Save/Load config become small ghost buttons; the
    description markdown legend moves to an info tooltip on the Description
    heading.

(Deferred: localStorage recent-configs list — fast follow, not in this
rewrite.)

## Untouched

Label logic not related to fill colors, and its tests: `src/upc.ts`,
`src/maskimage.ts`, `src/qr.ts`, `scripts/generate.ts`. `src/types.ts`,
`src/defaults.ts`, `src/layout.ts`, `src/description.ts`, `src/pdf/build.ts`,
and affected `tests/*` are touched only as far as the `Fill` change requires.

## Replaced

- `src/main.ts`, `src/style.css` — deleted
- `index.html` — slims to a `#root` mount + script tag
- New files:
  - `src/main.tsx` — React entry
  - `src/App.tsx` — owns all state (`LabelConfig`, texture, mask, errors,
    PDF blob URLs); 600 ms debounced regenerate; two-pane layout
    (fixed-width form sidebar left, previews filling the rest)
  - `src/components/LabelForm.tsx` — form rows built from shadcn primitives
  - `src/components/FileDrop.tsx` — drag-and-drop file targets
  - `src/components/ui/*` — shadcn-generated primitives
  - `src/index.css` — Tailwind entry + theme tokens

## Theme

Linear neutral dark: near-black background, zinc grays, muted indigo accent,
13 px base font, tight (~28 px) row heights, 1 px subtle borders, uppercase
micro-headings for form sections. No gold anywhere.

## Behavior parity (acceptance criteria)

1. Texture and mask file drops accept click or drag, show the file name, and
   show a drag-over highlight.
2. Mask files are validated (`validateMask`) and recolored
   (`recolorMaskForPdf`) exactly as today.
3. Every form row (beer fields, styled lines with bold checkbox + fill/layer
   selects, QR layer, description textarea with markdown legend, template
   elements) writes into the same `LabelConfig` shape.
4. Validation errors (UPC, mask, missing name/files) are listed; both download
   buttons are disabled until generation is unblocked.
5. Save config downloads `<name>-config.json` via `toConfigFile`; load config
   parses via `parseConfigFile`, re-renders the form, and regenerates.
6. Both PDFs live-update as pdf.js-rendered bitmaps in the overlay compare
   frame (no `<embed>`); download blob URLs are revoked when replaced.
7. Downloads are named `<beerName>.pdf` and `<beerName>-mask.pdf`.
8. Each styled row's color swatch, hex field, and no-ink toggle write the new
   `Fill` value into the config; loading a legacy config file with
   `gold`/`white`/`black` fills produces the migrated hex/`none` values.
9. The generated QR encodes `https://lolev.beer/beer/<machine-name>` derived
   live from the beer name; there is no QR data field in the form.
10. The QR row's fill picker changes the QR color in the art PDF; enabling
    the stroke toggle strokes the modules in the chosen stroke color.
11. Build indicator appears during generation; errors render inline at their
    fields; the overlay divider drags to compare art vs white-ink in place;
    loaded assets show thumbnails; ⌘K opens a command palette exposing
    save/load/download/export and preview snap actions.
12. Styled rows show only their input + one swatch chip; fill/hex/no-ink,
    layer, bold, and (QR) stroke all edit inside the chip's popover.
13. The Template section is collapsed by default and expands to reveal the
    six template rows; **Export PDFs** downloads both files in one click.

## Validation

`tsc --noEmit` clean, `vite build` succeeds, `vitest run` passes, and a
browser smoke test of the dev server exercising the parity checklist.
