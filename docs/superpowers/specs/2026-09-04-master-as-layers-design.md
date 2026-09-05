# Master as layers — design spec

Date: 2026-09-04
Status: approved design, pre-implementation
Supersedes: `2026-08-27-master-variation-design.md` (and its amendments). Where
this document is silent, the older spec's user-visible decisions stand (ZIP
container, rotation 0|90, align, guides); where they conflict, this one wins.

## Problem

One visible thing on a label — the beer name, say — is today split across
three records in three UI sections: a `MasterLayer` (policy only), a
`defaults[id]` entry (style and content), and a `FieldDecl` (label, editor
kind, and a path string back into `defaults`). The Layers panel shows the
first, the inspector the second, Fill mode's Fields list the third, and a
fourth "Document" group holds background, mask and physical settings.
Variants mirror the split with four lists of their own. Every shipped field
maps one-to-one onto a layer, so the split buys nothing.

Separately, the fourteen built-in elements are placed by a hardcoded Lolev
layout (`plan.ts` / `layout.ts`) and cannot move; only custom layers carry a
position. That blocks the one thing a variant most needs: moving a layer.

## Goal

- A layer is the only unit. Master = layers. Variant = a diff on layers.
- Every text is one kind of layer: multiline, rich (per-run fill / white ink
  / bold / header), edited by the existing WYSIWYG description editor.
- The word "built-in" leaves the codebase. The Lolev label is data in a
  `.master` file, including its positions.
- Layers can bind vertically to another layer and move when it grows.

Priority is intuitive use over preserving internal structure.

## Model

```ts
interface Master {
  formatVersion: 3;
  id: string;
  name: string;
  physical: { labelWidthIn; labelHeightIn; bleedIn; canDiameterIn };
  guides: Guides;                 // unchanged
  layers: Layer[];                // DRAW ORDER, back to front
  variants: Variant[];
}

type Layer = TextLayer | ImageLayer | BarcodeLayer | QrLayer;

interface LayerBase {
  id: string;
  name: string;
  kind: "text" | "image" | "barcode" | "qr";
  enabled: boolean;               // master-level off = never draws
  locked?: boolean;               // fillers cannot move it (universal — no LOCKABLE_IDS)
  fillable?: boolean;             // shows in Fill mode
  x: number;                      // PDF points, per anchor
  y: number | { below: string; gap: number };   // see Relative position
  anchor: Anchor;                 // existing custom-layer anchor
  rotation?: 0 | 90;
}

interface TextLayer extends LayerBase {
  kind: "text";
  lines: StyledLine[];            // the description's existing rich model
  size: number;                   // points
  align: "left" | "center" | "right" | "justify";
  input?: "number" | "code";      // Fill-mode widget hint; absent = text
  min?: number; max?: number;     // input: "number"
  symbology?: Symbology;          // input: "code"
  style: Style;                   // block style: stroke, tracking, base fill/layer
}
interface ImageLayer   extends LayerBase { kind: "image"; asset: string; width: number; style: Style }
interface BarcodeLayer extends LayerBase { kind: "barcode"; value: string; symbology: Symbology; height: number; style: Style }
interface QrLayer      extends LayerBase { kind: "qr"; value: string; size: number; style: Style }

interface Variant {
  id: string;
  name: string;
  layers: Record<string, Partial<Layer>>;   // keyed by layer id
}
```

Background texture and metallic mask are the two bottom `image` layers of
the master (`id: "background"`, `id: "mask"`), drawn by the existing
texture/mask code paths keyed off those ids. There is no separate assets
block and no Document group.

Rules:

- `Variant.layers[id]` with an id the master has: a deep-partial override
  of that layer. With an id the master lacks: a whole new layer that exists
  only while the variant is on (must be a complete `Layer`; validated at
  load). Variant-owned layers draw at the end of the master's draw order
  unless an `order?: number` is given — deferred until a master needs it.
- Resolution: start from `master.layers`, deep-merge each enabled variant's
  entries in the label's enable order, apply the label's `overrides`, drop
  `enabled: false`. Same `deepMerge` `resolve.ts` uses today.
- `fillable` is what Fill mode lists; the widget is derived from `kind` and
  `input`. There is no `FieldDecl` and no path string.

### `.label` file

```ts
interface LabelFileV3 {
  formatVersion: 3;
  masterId: string;
  masterHint?: string;
  enabledVariants: string[];
  values: Record<string, LayerValue>;   // keyed by layer id
  overrides?: Record<string, Partial<Layer>>;   // label-level deviations
  dormant?: { values: Record<string, LayerValue>; variants: string[] };
}
type LayerValue = StyledLine[] | string;   // text lines; image asset id; code/qr value
```

The ZIP container and asset directory scheme from the previous spec are
unchanged. A label's own embedded art still wins over the master's.

### Relative position

`y` may be `{ below: layerId, gap }`: this layer's top edge sits at the
referenced layer's resolved bottom edge plus `gap` (points, positive =
down). Positions resolve in dependency order after every layer's own height
is measured; chains work (A fixed → B below A → C below B). A cycle, or a
reference to a missing or disabled layer, is a load-time `fail()` on the
master. Design-mode drag of a bound layer edits `gap`; the inspector's
"Unbind" writes the computed `y` as a number. Not in v1: horizontal
binding, "above", baseline binding.

This is how `collabLeftFlow` / `collabCenterFrame` place the collab block
today; the Lolev master expresses it as data.

### Text

One text layer kind replaces `name`, `styleLine`, `abv`, `description`,
`volume`, `handleAddress`, `warning`, `storeCold`, `collabLead` and custom
text. `lines: StyledLine[]` is the description's existing per-line/per-run
model, so `parseDescription`/`serializeDescription` and the WYSIWYG editor
(`useDescriptionField`, renamed `useTextField`) apply to every text layer
unchanged. Single-line is one line. `justify` on a last/only line degrades
to left. ABV keeps `input: "number"` so Fill mode shows a number box and
writes `[{text: "6.5"}]`; the "%" suffix and any other fixed decoration is
authored as a run in the master's default lines that Fill mode does not
touch — the old `format` strings are not carried over.

## UI

- **One Layers list** (left sidebar), draw order reversed. Each row: icon,
  name, eye (session hide), power (enabled), lock, fillable toggle, and a
  variant badge when the row comes from a variant diff (dimmed while that
  variant is off). "Add layer" offers text / image / barcode / QR. The
  Document group is gone; background and mask are the two bottom rows and
  physical dimensions live in the master picker / Settings command.
- **Inspector** edits the selected layer: position (x, y or below+gap,
  anchor, rotation), kind-specific content, style. Editing target (master
  vs a variant) is unchanged: with a variant targeted, changes record into
  that variant's diff.
- **Fill mode** is the same list filtered to `fillable`, one widget per
  layer by `kind`/`input`; variant-owned rows sit under that variant's
  toggle. The canvas remains the primary editing surface.

## Renderer

`elements.ts`, `plan.ts`, `hittest.ts`, `pdf/build.ts`, `psd/build.ts` keep
exactly one path per `kind`. `planLabel` becomes: resolve layers → measure
each → resolve relative positions → emit placed items in draw order. The
hardcoded Lolev layout (`layout.ts` constants, `collabItems`,
`barcodeItem`'s fixed placement, the `ElementId` union) is deleted once the
Lolev master reproduces it. `LOCKABLE_IDS` is deleted; lock is universal.

## Lolev master

`model/lolev.ts` is rewritten as data: every current element as a layer
with explicit `x`/`y`/`anchor` taken from the current layout's computed
coordinates, the collab block as a `collab` variant whose diff adds
`collabLead` (text, bound below `description`), `collabLeft` (image, bound
below `collabLead`) and `collabCenter` (image, bound below `logo`), and the
logo's existing `offsetY` nudge expressed as its `y`.

## Migration

- `.master` v1/v2 → v3: `layers[i]` + `defaults[id]` + matching `fields[]`
  entry fold into one `Layer`; `variant.fields`/`layerOverrides`/`layers`
  fold into `variant.layers`. Built-in ids get positions from the same
  table the Lolev rewrite uses. One converter in `model/masterfile.ts`,
  run on open; saves are always v3.
- `.label` v1/v2 → v3: `values[fieldId]` re-keys to the layer id; a v1
  `LabelConfig` goes through the existing v1→v2 path first. Text values
  that were markdown strings parse to `StyledLine[]`.
- Legacy JSON-only `.master` and the `{`/`PK` sniff stay.

## Goldens

Byte identity across the migration is not a target: text draws through one
generic path afterwards. Each PDF/PSD golden is re-baselined after a 600 DPI
raster diff against the old output, reviewed per layer; the diff PNG is
committed with the new golden. After re-baseline, goldens are byte-locked
again as today. New regression tests: relative-position chain (a two-line
vs three-line description moves the collab block), variant override of a
position, variant-added layer, converter round-trips for master and label.

## Removed (approved 2026-09-04 UX pass)

Deleted, functionality covered elsewhere in this spec:

- **Presets** (`presets.ts`, `presets.json`, PresetBar, PresetsDialog, the
  three preset commands). A master is the saved style; a barcode value is a
  fillable layer. If value history is wanted later it is a recent-values
  dropdown on the code widget, not a library.
- **Editing target selector** (EditingTarget.tsx, TargetFields). Where an
  edit lands follows the layer: a layer present in a variant diff edits that
  variant; a master layer edits the master. No global mode.
- **Session unlock on shipped fields** and the locked-row rename/remove
  mechanism. `fillable` is a toggle on the layer row; `locked` only
  governs moving.
- **"Make fillable" inspector button.** Same control as the row toggle.
- **Stack nudge and collab slot nudges** (StackNudge, CollabSlotContent).
  Every layer has a position; `below` binding covers the flow.
- **"Edit as Markdown" escape hatch.** Markdown is the serialization, not a
  user surface.

Merged:

- **Preview views: five → three.** Label (2D, with the existing art/mask
  divider), Mask (divider at 100%), Can (with a 1 / 4 count for the pack
  render). Commands `view-rendered` and `view-pack` go; shortcuts 1–3.
- **Guide toggles: seven → two.** Rulers, Guides. Guides shows bleed,
  margin, center and manual guides together; a manual guide deletes from an
  × on hover. `clear-guides` and the per-kind toggles go.
- **Design / Fill modes → one mode** with a "Fillable only" filter on the
  Layers list. Fill-mode drag lock becomes `locked` on the layer.
- **Eye and power → enabled only.** The session-only hidden set
  (`hiddenLayers`) is deleted; hiding is `enabled: false`, recorded in the
  master or variant being edited, undoable.

Kept: workspace tabs, undo/redo, canvas in-place edit and drag, metallic
toggle, 3D can, desktop updater, master picker.

Deferred: inline inspector — a selected Layers row expands to show position,
content and style, and the right-hand inspector goes away. Revisit after the
cuts, only if the expanded row stays under one screen tall.

## Out of scope (v1)

Horizontal/above/baseline binding; variant draw-order control; per-layer
fonts (see dynamic-fonts memory: route text through the one font gate);
180/270 rotation; multi-master labels.

## Order

1. Model + converter + parser (`model/types.ts`, `masterfile.ts`,
   `labelfile.ts`), with the Lolev master rewritten as data. Tests only.
2. Renderer: generic text layer with `lines`, relative `y`, one path per
   kind in plan/hittest/pdf/psd. Re-baseline goldens layer by layer, then
   delete the built-in branches.
3. UI: single Layers list with the fillable filter, inspector position
   section with bind/unbind, and every deletion/merge in "Removed".
4. Ledger: close `builtin-to-generic-layer-migration`; add relative-position
   deferrals.

## Top and bottom guide anchors (2026-09-04 follow-up)

Layers may set `guideY: "top" | "bottom"` with numeric `y` as a signed
offset in points. Top anchors the top edge; bottom anchors the bottom edge,
so multiline text grows upward. `guideY: "none"` uses absolute placement.
Guide anchors and below-layer bindings are mutually exclusive. The inspector
can detach without moving the layer; dragging adjusts the offset. Margin
changes persist in the master and move anchored layers in preview and exports.

Middle guide anchor follow-up: `guideY: "middle"` anchors the layer's vertical
center to the midpoint of the top/bottom margin guides, plus numeric `y` offset.

Four margin-guide edges (2026-09-05): `guideX: "left" | "right"` uses numeric
`x` as signed offset, independent of `guideY`; `none` restores absolute x.
The inspector exposes horizontal bindings and detaches without moving the layer.


### Follow-up: four-side layer bindings (2026-09-05)

Supersedes the deferred horizontal/above layer-binding scope. A layer may set
`binding: { to: layerId, side: "top" | "left" | "right" | "bottom", gap: number }`.
The facing edges are separated by the gap; positive gaps move outward. The other
axis retains its position or guide anchor. Measured size changes propagate through
binding chains in the shared preview/export planner. Legacy `y: { below, gap }`
continues to mean a bottom binding. Missing/disabled targets and cycles are rejected.
Dragging changes the signed gap on the bound axis. Switching axes or unbinding
freezes the resolved coordinate of the newly free axis.
