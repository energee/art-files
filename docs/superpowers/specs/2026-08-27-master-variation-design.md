# Master / Variation restructure — design spec

Date: 2026-08-27
Status: approved design, pre-implementation
Approach: incremental re-layering (Approach 1) — the new model resolves down to
the existing `LabelConfig` shape; renderers, PDF/PSD builders, and the white-ink
pipeline are untouched at first and migrate piecemeal.

## Goal

Generalize the Lolev-specific label generator into a product other businesses
can use for beer, beverage, and any labelable round packaging. Replace three
hardcoded concepts — presets, the template, and collab — with two general ones:

- **Master** — the locked foundation shared by all `.label` files: physical
  dimensions, background/mask assets, layers, defaults, and the declaration of
  which parts are fillable per label.
- **Variation** — a named, toggleable override-diff on a master (today's collab
  becomes one). Variations stack; multiple can be enabled at once.

Plus: custom layers (text, image, barcode, QR), more barcode symbologies,
derived QR/barcode payloads, per-layer lock, and snap guides whose alignment
survives content changes.

## Data model

All artifacts are JSON.

### `.master` file

```jsonc
{
  "formatVersion": 1,
  "id": "<uuid>",
  "name": "Lolev",
  "physical": {
    "labelWidthIn": 0, "labelHeightIn": 0,   // from current TRIM
    "bleedIn": 0,                             // current bleed knob
    "canDiameterIn": 0                        // drives the 3D preview cylinder
  },
  "assets": { "background": "...", "metallicMask": "..." },
  "defaults": { /* LabelConfig-shaped styling defaults (today's preset payload) */ },
  "guides": {                                  // all removable/movable per master
    "left": 24.12, "center": "auto", "right": 24.12,   // pt from trim edges
    "top": 24.12, "bottom": 24.12                       // DEFAULT_MARGIN_PT today
  },
  "layers": [ /* Layer, see below */ ],
  "fields": [ /* FieldDecl, see below */ ],
  "variations": [ /* Variation, embedded — never separate files */ ]
}
```

### Variation (embedded in master)

Pure diff — never a copy. Editing the master propagates to all variations.

```jsonc
{
  "id": "collab",
  "name": "Collab",
  "overrides": { /* deep partial of defaults/physical */ },
  "layerOverrides": { "<layerId>": { /* partial Layer */ } },
  "layers": [ /* added layers */ ],
  "fields": [ /* added FieldDecls */ ]
}
```

### `.label` file

IDs and values only — no layout, no styling. This is what makes rebinding a
`.label` against a different master (cross-brewery collab) meaningful.

```jsonc
{
  "formatVersion": 2,
  "masterId": "<uuid>",
  "masterHint": "path/last/known.master",
  "enabledVariations": ["collab"],        // in enable order
  "values": { "<fieldId>": /* per-kind value */ }
}
```

Values for disabled variations stay in `values`, dormant, so re-enabling loses
nothing.

### Layer

One shape for built-in and custom layers. There are **no reserved IDs and no
sacred built-ins**: today's wordmark (renamed **Brand**), laurel (just an image
layer), storecold, info, government warning, name, description, volume, ABV,
barcode, and QR are all ordinary layers on the shipped master.

```jsonc
{
  "id": "brand",
  "type": "text" | "image" | "barcode" | "qr",
  "enabled": true,                 // master-level disable
  "locked": true,                  // fillers cannot select/move
  "position": {
    "anchor": "left" | "center" | "right",
    "vAnchor": "top" | "bottom" | null,   // null = stack-relative as today
    "offsetX": 0, "offsetY": 0
  },
  "style": { /* per-type, see Layer types */ },
  "content": { /* per-type; text/code content may be a format string */ }
}
```

### FieldDecl

A field is "what editor the filler gets and how the value is validated."

```jsonc
{ "id": "name", "layerId": "beer-name", "kind": "text", "label": "Beer name" }
```

Six kinds:

- `text` — rich styled lines, WYSIWYG (one text model; no separate plain/rich
  split). A master may constrain a field to a single line.
- `number` — min/max, unit, format (ABV, IBU, volume).
- `image` — partner logo, badge art.
- `code` — barcode/QR payload, validated per the target layer's symbology
  (existing UPC check-digit validation).
- `select` — one of a master-author-defined list (controlled choices without
  unlocking styling).
- `toggle` — boolean show/hide of a layer.

Well-known field IDs (`name`, `style`, `abv`, `description`, `logo`, `upc`,
`volume`…) are documented so cross-master rebinding usually just works.

### Format strings (derived content)

Any text or code layer's content may be a format string over **field values**
(never other layers — cycles impossible by construction):

- ABV: `"{abv}% alc by vol"` — filler edits only the number.
- Derived QR: `"http://lolev.beer/beer/{name|slug}"` — filler never touches it.
- Field-bound barcode: `"{upc}"`.

Transforms: `slug`, `upper`, `lower`, `trim`. The UI is a builder (literal text
+ inserted field chips, each with a transform dropdown and plain-language
descriptions, live preview from the current label's real values); the raw
string is the storage format, visible under a "raw" toggle.

### Library index (app storage)

`{ [masterId]: { name, path, lastSeen } }` — a resolver cache only; files on
disk are the source of truth. The app remembers where masters live so `.label`
files resolve by ID; a missing master falls back to `masterHint`, then a picker.

## Resolution

One pure function is the heart of the design:

```
resolve(master, enabledVariationIds, values) → EffectiveConfig  // LabelConfig shape
```

In order:

1. Start from master `physical` + `defaults` + `layers`.
2. For each enabled variation in enable order: deep-merge `overrides`, apply
   `layerOverrides`, append added `layers`. Last-enabled wins on conflicts
   (plain object-spread order).
3. Visible fields = master's + enabled variations'.
4. Apply `values`, validating per kind. Invalid value → field-level error; the
   layer renders last-valid or placeholder — never crashes the preview.
5. Expand format strings.
6. Apply anchors/guides to compute final positions.

Synchronous, deterministic, memoized on inputs. Undo/redo operates on the
inputs (values, toggles, master edits), never on resolved output.

Rebinding: same `values`, different master. Matched field IDs carry over;
unmatched ones surface as a warning list ("this master has no `untappd-qr`
field — dropped"), never silently lost.

## Lock, snap & guides

- `locked` is set in Design mode. In Fill mode locked layers are inert;
  unlocked layers drag as today. In Design mode everything is selectable and
  lock is just a properties toggle (an authoring statement, not a wall).
- Position: anchor is the layer's reference edge. Center-anchored layers stay
  centered when content width changes; left-anchored keep the left edge
  planted. Generalizes today's vertical-only drag to both axes.
- Five built-in guides per master: left, center, right, top, bottom. Top and
  bottom seed from today's `DEFAULT_MARGIN_PT` (24.12pt = 0.335in). All guides
  are master properties: movable and removable.
- Dragging near a guide snaps the layer's anchor edge to it **and sets the
  anchor accordingly** (snapping to center = becoming center-anchored); a
  subtle highlight shows the engaged guide. Vertical snapping to top/bottom
  works the same way via `vAnchor`.
- No user-defined guides in v1.

## Layer types

One interface, four types. Every layer knows how to: measure its box (hit
testing, snapping), draw to the 2D canvas, contribute to the PDF art plate, and
contribute to the white-ink footprint. Existing elements already do all four —
they regroup under this interface.

- **Text** — rich styled lines; font/size/color/bold/tracking/stroke/plate as
  today; optional format binding; optional single-line constraint. Fonts come
  from the app catalog through the one font gate (dynamic-fonts plan) — never
  hardcoded.
- **Image** — PNG/SVG, scale, white-ink behavior (knockout/print, as current
  logo handling). Content baked into the master or bound to an `image` field.
- **Barcode** — symbology `upc-a | ean-13 | code-128`. Encoders stay hand-rolled
  and pure: `upc.ts` grows EAN-13 (UPC-A is EAN-13 with a leading 0 — the L/R
  module tables are shared, one extra parity table), new `code128.ts`. The
  existing geometry/halo/white-ink-footprint machinery generalizes to take a
  module pattern instead of calling `encodeUpc` directly. Knobs: height, module
  width, halo, show/hide digits. Payload via format string.
  Not shipping until asked: Code 39, ITF-14, DataMatrix, PDF417.
- **QR** — payload via format string; drawing is fully ours
  (`qrcode-generator` emits only the module matrix). Knobs:
  - Style: Square / Rounded / Dots — one dropdown with visual swatches.
  - Foreground color (background stays quiet-zone white for scannability).
  - Center logo: one toggle + image well; knocks out the middle and
    auto-raises error correction to H.
  - Size & halo/plate: same controls as barcode.
  - Error correction under "Advanced", default M (auto-H with logo).
  Not exposed (scan-reliability footguns on curved metal): per-eye colors,
  gradients, custom finder shapes.

## UI

Three principles, in tension-break order: **direct manipulation first**,
**progressive disclosure**, **click economy** (measure clicks-to-outcome;
simplify, then simplify again).

- **Two hats, one app.** A prominent segmented control: **Design**
  (master-edit) / **Fill** (label-edit, the default). Fill shows the label,
  the field list (each field with its kind's widget), and variation
  checkboxes — no styling, no layers panel. Design reveals layers, properties,
  guides, and field declarations.
- **The canvas is the field list.** Double-click any text layer to edit in
  place (extends the description editor's behavior to all text). Filling a
  typical label = click name, type, click description, type. The sidebar is a
  parallel path, not a required one.
- **Selection carries context.** Select a layer → properties are already
  visible. Make-fillable, lock, anchor: one click from selection.
  "Make fillable" infers the field kind from the layer type; naming after.
- **Inline creation.** Add text/image/barcode/QR places a sensibly-positioned
  layer immediately; configure after seeing it. No creation dialogs.
- **No confirmation dialogs for undoable acts.** Everything on canvas is
  undo-covered (the one-step drag undo generalizes).
- **Variation editing:** "Editing: Master ▾ / Collab / …" dropdown in Design
  mode. Edits record into the selected variation's diff automatically; touched
  properties show an "overridden" badge with per-property reset. No separate
  diff UI.
- **Per-layer properties:** 3–5 essential controls; the rest under one
  "Advanced" fold.
- **Starter master:** the app ships one built-in master with the sensible
  beverage set — Brand, name, description, ABV (`"{abv}% alc by vol"`),
  volume, government warning, barcode, QR — each layer disable-able. First
  launch opens it in Fill mode with a sample label: it works before any
  configuration; Design mode is where you make it yours. It is a well-made
  default file, not a special mechanism.

## Rename: Label Lab → Proof

The product is renamed **Proof** (print-proofing connotation; trademark/domain
check still owed). Scope: app display name, Tauri bundle identifier and window
title, `package.json`, README, and the release pipeline — tags move from
`label-lab-v*` to a new prefix, and the desktop updater feed renames with the
app, so the final Label Lab release must point existing installs at the new
feed or they stop receiving updates. Binary-impacting: ships as its own
coordinated, versioned release under the release-steward gate, separate from
the model restructure.

## Migration

- **Presets → masters:** on first launch each stored preset converts to a
  `.master` in the library. The preset bar becomes the master picker.
- **Collab → shipped variation:** partner slots and the logo-nudge gate are
  re-expressed as a "Collab" variation on the migrated Lolev master.
  `collabEnabled` maps to its toggle; slot images map to its fields.
- **Old `.label` files** open transparently: the loader detects the old
  format, maps known values (name, ABV, description, images, UPC) onto the
  migrated master's fields, and preserves nonstandard styling as label-level
  overrides so nothing visually changes on open. Saving writes the new format.
  One-line notice, no wizard.
- **Print-output invariant:** a migrated Lolev label must render
  byte-comparable PDF/PSD output before and after — the acceptance test for
  the whole restructure.

## Testing

- Resolver: pure-function unit tests — merge order, last-enabled-wins, format
  expansion, per-kind validation, rebinding warnings, dormant values.
- Encoders: spec-vector tests for EAN-13 and Code 128, like `upc.ts`'s.
- Snap/anchor math: unit tests in the `hittest` style.
- Migration: golden tests — legacy preset and legacy `.label` fixtures must
  produce identical PDF/PSD output through the new path.
- UI: existing DOM-test approach for the field editor and format builder.

## Out of scope (deliberately)

- User-defined guides; vertical guide sets beyond top/bottom.
- `date`, `color`, and computed field kinds (`code` covers the real derived
  case; `select` over designer swatches covers safe color choice).
- Rich per-eye QR styling; extra symbologies beyond the four.
- Clean-slate layer-list rewrite of the renderers (Approach 2) — the end state
  may converge there layer by layer, but never in one motion.
