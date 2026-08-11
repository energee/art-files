# Independent white/metallic layers for strokes

2026-08-11.

## Goal

Give every editable outer stroke its own white-ink plate assignment. A fill
and its stroke can then be assigned independently: either can print over white
ink (`white`) or knock through to metallic stock (`metallic`). All shipped and
migrated stroke assignments default to `white`, so enabling a stroke never
introduces metallic stock unless the operator explicitly asks for it.

## Data model and compatibility

- `Style` gains `strokeLayer?: Layer`. It remains optional in the TypeScript
  shape because existing saved version-1 projects do not contain it.
- The flat QR and barcode styles gain `qrStrokeLayer` and
  `barcodeStrokeLayer` fields.
- `defaultConfig()` writes `strokeLayer: "white"` for every nested style,
  including styles whose stroke is currently off, and writes both flat code
  stroke layers as `"white"`.
- `parseConfigFile()` keeps config version 1. It supplies `"white"` for every
  missing nested and flat stroke layer, so loading an older project produces
  a complete, deterministic in-memory config without a format-version break.
- Rendering and UI code also resolve a missing stroke layer as `"white"`.
  That defensive fallback covers direct test/config construction and avoids
  treating legacy absence as metallic.

The existing fill-layer fields retain their meanings. `white` means the mask
plate contains blue underprint ink; `metallic` means that footprint is knocked
out to white on the mask plate. Stroke color affects the art plate only.

## Inspector and layer summary

The Stroke group in the inspector keeps its on/off switch, color, and width.
While the stroke is enabled it also shows the existing metallic-horns toggle,
labelled **Stroke**, next to the color. Off is white/non-metallic, on is
metallic. Multi-selection uses the same mixed-state behavior as the fill
toggle, and changing it applies to all selected styles.

Reset restores the shipped stroke layer as well as stroke color and width.
The Layers panel digest includes the stroke plate after the stroke color and
width so the assignment is visible without opening the inspector.

## Rendering contract

Art output is unchanged: each stroke uses its configured color and width. On
the mask output, the renderer draws the stroke footprint first with the
stroke's layer color, then draws the fill footprint with the fill's layer
color. This ordering is essential when the assignments differ; it leaves the
outer part of the stroke visible rather than allowing the fill mask to erase
the complete element.

PDF and PSD exports follow the same rule for text, vector logos, QR modules,
barcode bars, and barcode digits. PSD strokes remain editable layer effects.
Raster collaboration art does not acquire a synthetic outline: its pixels and
alpha remain the footprint because the existing stroke controls apply only to
vector collaboration artwork.

Hidden elements continue to emit neither fill nor stroke on either plate.

## Tests and acceptance

- New projects explicitly contain only white/non-metallic stroke layers.
- Old version-1 project files load every absent stroke layer as white.
- Element adapters, multi-selection updates, reset comparisons, and summaries
  preserve the independent stroke layer.
- PDF and PSD mask tests cover a metallic fill with a white stroke and a white
  fill with a metallic stroke.
- Typecheck, production build, and the relevant renderer/config test suites
  pass in the isolated worktree.
- The inspector and layer digest are checked in the app when an in-app browser
  is available.
