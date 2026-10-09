# Master / Variant restructure — design spec

Date: 2026-08-27
Status: approved design, pre-implementation
Amended: 2026-08-27 (after Plan 5a shipped) — a variant is presented as a named
group of fields and layers rather than as a diff; `collabEnabled` is deleted
from `LabelConfig` and Collab becomes an ordinary variant carrying three
fields. See "Variant (embedded in master)", "UI", and "Migration".
Amended: 2026-08-27 (final review, two ruled deviations from the section
above) — the shipped Collab variant carries **two** fields, not three:
`collabLead` was dropped because nothing reads `collabLead.text` (the
lead-in is fixed template art, drawn from `L.COLLAB_LEAD.lines`), and a real
text field there would need a variable line count that MOVES the partner
logo, since `collabLeftFlow()` derives the left logo's top edge from
`lines.length`. And the variant carries **no** `logo.offsetY` override
(`overrides: {}`), not "the logo nudge becomes an ordinary override on the
variant": the shipped nudge is 0, so an explicit override would preserve
nothing while shadowing a designer's master-level nudge on exactly the
labels the nudge serves — variant overrides merge on top of
`master.defaults`. See "Migration".
Amended: 2026-08-29 (plan pressure-test, REDUCTION mode) — v1 is re-scoped
around user-visible capability; the engineering endgame is deferred:

- **`.master` becomes a ZIP**, exactly the container `.label` already is:
  `master.json` (the shape `parseMaster` validates) plus assets under the same
  role/assetId directory scheme (`texture/<name>`, `mask/<name>`,
  `custom/<assetId>/<name>`), built with the existing labelfile ZIP code.
  Template art (texture, metallic mask) moves to the master; a label's own
  embedded assets, when present, win over the master's — forever — so old
  labels render unchanged. Legacy JSON-only `.master` files still open (`{`
  sniff → JSON reader, `PK` → ZIP); both share `parseMaster`. Corrupt-archive
  handling is one loud `fail()` — no validation layer beyond the parser.
- **Rotation ships minimal**: `rotation: 0 | 90` on barcode and text layers
  only (vertical codes and side text are the named needs). The property is an
  enum so 180/270 and image/qr extend for free later, but their goldens, hit
  boxes, and PSD geometry are NOT built until asked.
- **No `flow` constraint in the schema.** The generic
  "place after layer X with gap Y" idea is dropped: it would generalize
  exactly two hardcoded relationships (collab lead → logo, description
  stacking). If those migrations can express the relationship as resolver-
  computed offsets, the constraint never becomes a schema concept; revisit
  only at the moment the description/warning/collab elements migrate.
- **Built-in → generic migration is opportunistic, not a phase.** Built-in
  runtime branches (`plan.ts`, `elements.ts`, `hittest.ts`, `pdf/build.ts`,
  `psd/build.ts`, `ElementId`) are golden-locked and invisible to users; an
  element migrates only when keeping its branch blocks a user-facing change,
  each behind its existing byte-identity golden, branch deletion last. It is
  acceptable for some branches to never migrate. Tracked in
  `.agents/ledger-archive.md` (`builtin-to-generic-layer-migration`).
- **v1 order**: (1) parity locks, including a Collab PSD golden that carries
  REAL partner art (the current one is vacuous); (2) `.master` ZIP;
  (3) master-ordered draw order — renderers interleave `customLayers` at
  their `master.layers` position instead of appending on top, guarded by one
  golden with a custom layer behind a built-in, asserted in PDF only (the
  backends share `planLabel`'s ordering); (4) wire `master.guides` into the
  existing `position.ts` anchor/snap math for drag and render, deleting the
  hardcoded guide constants; (5) generic text multiline/wrap +
  minimal rotation; (6) opportunistic per-element migration.
- **Every text layer gets `align: "left" | "center" | "right" | "justify"`**
  in its style — one property, uniformly, including single-line layers
  (no-op until the box exceeds the line; `justify` on a last/only line
  degrades to left, standard behavior, no special case). Align is how lines
  sit INSIDE the layer's box; anchor stays what places the box on a guide —
  the two never conflate, so snapping never changes how text reads. A
  migrated built-in carries its current effective alignment explicitly, so
  goldens stay byte-identical.
- Field bindings stay path-based: for a materialized layer, styling lives at
  `config[layerId]`, so `"<layerId>.text"` already IS a layer-property
  binding. No new binding schema.
- **Consistency debt folded into the steps that touch its area** (each is a
  second way of doing something the plan has one way for):
  - Step 2 (master ZIP): normalize legacy raw `defaults.customLayers` entries
    into `kind`-bearing MasterLayers on master save, then delete resolve()'s
    reconciliation block; decide the unused `Variant.layers` appended path —
    use it from the starter master or delete it (YAGNI).
  - Step 3/4: move `ElementId` into a small pure module both the renderer
    registry and model import (the sync-by-comment in model/types.ts is a
    drift landmine); make lock universal — every layer honors `locked`,
    deleting resolve()'s hardcoded `LOCKABLE_IDS` set.
  - Step 5: rename `useDescriptionField` → `useTextField` in the same commit
    as its first non-description consumer; resolve the `model/doc.ts` vs
    `model/document.ts` naming split in whichever step first touches both.

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
- **Variant** — a named, toggleable override-diff on a master (today's collab
  becomes one). Variants stack; multiple can be enabled at once.

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
  "variants": [ /* Variant, embedded — never separate files */ ]
}
```

### Variant (embedded in master)

**A variant is a named group of fields and layers.** That is what the author
builds and what the filler switches on: give it a name, add the layers it
brings, declare which of them are fillable. `overrides` and `layerOverrides`
remain in the shape — a variant may also restyle a layer the master already
owns (the collab logo nudge is exactly this) — but they are the secondary
story, surfaced as per-property badges on the controls, never as a diff UI.

Still a pure diff on the master — never a copy. Editing the master propagates
to all variants.

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
  "enabledVariants": ["collab"],        // in enable order
  "values": { "<fieldId>": /* per-kind value */ }
}
```

Values for disabled variants stay in `values`, dormant, so re-enabling loses
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
- `image` — partner logo, badge art. The stored value is the **asset id** of
  the image inside the `.label` (the same per-id image store custom image
  layers already use), so a field value stays a plain string and the bytes
  stay where every other label image lives.
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
files resolve by ID. A label reads its trusted `masterHint` (the exact file it
was saved against) before the index's path for that id, since two files can
share an id (#405). The tab's Save Master and the hint it saves name that file;
the hint's file joins the index only when the index has no readable file for
the id, so a shared label never takes over the operator's library entry. Save
writes the hint relative to the label (`./x.master`, `../lib/x.master`), so a
shared label carries no absolute path or username (#428); when the two share
only the root or are on different drives, no hint is written. An absolute hint
from an older save is still read as written; a bare name (a browser file) is
not resolved beside the label. A library pick of a row whose file the OS
reports missing, with no remembered copy to stand in, drops the row; a label
open or the launch-time default keeps it, since an unmounted volume reads as
missing too. A
missing master falls back to a picker.

Stored as one localStorage key per master (`labellab.master:<id>`), not one
blob: every app window shares localStorage, and a whole-index
read-modify-write let one window's save drop another window's row (#408). An
index written before #408 (the single `labellab.masters` blob) is still read
and is split into per-master keys on the next write.

## Resolution

One pure function is the heart of the design:

```
resolve(master, enabledVariantIds, values) → EffectiveConfig  // LabelConfig shape
```

In order:

1. Start from master `physical` + `defaults` + `layers`.
2. For each enabled variant in enable order: deep-merge `overrides`, apply
   `layerOverrides`, append added `layers`. Last-enabled wins on conflicts
   (plain object-spread order).
3. Visible fields = master's + enabled variants'.
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
  and the field list (each field with its kind's widget) — no styling, variant
  controls, or layers panel. Design reveals layers, properties, guides, and
  field declarations.
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
- **Variant editing:** "Editing: Master ▾ / Collab / …" dropdown in Design
  mode. Edits record into the selected variant's diff automatically; touched
  properties show an "overridden" badge with per-property reset. No separate
  diff UI.
- **The Design sidebar is scoped by that selector**, top to bottom: master
  picker, the Editing selector (where variants live), the layers list, the
  fields of the *current target only*, then the inspector. Choose Master and
  you see the master's fields; choose Collab and you see its three. Adding a
  layer or making one fillable lands in whatever the selector points at —
  which is how a variant reads as a named group of fields rather than a diff.
  Deliberately not stacking every group's fields at once: it duplicates the
  selector and makes "where does this land?" ambiguous again.
- **Fill mode is unscoped:** every visible field is flat — the master's and
  every already-enabled variant's together. A filler does not care which
  group a field came from.
- **Per-layer properties:** 3–5 essential controls; the rest under one
  "Advanced" fold.
- **Starter master:** the app ships one built-in master with the sensible
  beverage set — Brand, name, description, ABV (`"{abv}% alc by vol"`),
  volume, government warning, barcode, QR — each layer disable-able. First
  launch opens it in Fill mode with a sample label: it works before any
  configuration; Design mode is where you make it yours. It is a well-made
  default file, not a special mechanism.

## Compliance: field-level validation via rule packs

Validation is declarative data, not engine code. A **rule pack** is a JSON
file of checks a master opts into (`rulePacks: ["ttb-malt-beverage"]`); the
engine knows only check *types*, so new jurisdictions/categories are data.
Packs declare their own `name`, `description`, `version`, citation base, and
the regulation revision date they were checked against — the UI is fully
data-driven and shows that date.

Check types:

- `exactText` — verbatim-mandated text (the government warning, with
  "GOVERNMENT WARNING" caps + bold); diffed against the statute string.
- `minTypeSize` — physical type minimums in mm, stepped by container volume.
  The resolver knows label dimensions + pt sizes, so true mm is computable —
  the thing generic label tools can't check.
- `maxCharsPerInch` — legibility density caps, from existing text metrics.
- `present` — required layers exist and are enabled (warning, class
  designation, net contents, name & address, ABV where required).
- `pattern` — statement formats (ABV "X% alc/vol" variants, net contents
  wording); the `format`-string mechanism makes these nearly self-enforcing.
- `vocabulary` — class/type designation must include a recognized class
  ("beer", "ale", "lager", "malt liquor", …) plus a rewrite dictionary for
  known traps: geographic style names ("Kölsch" → suggest "Kolsch-style ale"),
  abbreviation expansions ("IPA" → "India Pale Ale"). Suggestions cite their
  CFR section.

Execution: the validator runs on the **resolved** config (variants and
format strings included). Output is advisory, never blocking — COLA approval
is a human process; our job is "you'll bounce, here's why, here's the fix."
Each finding: severity, plain-English sentence, citation, and a one-click fix
where possible ("Insert exact warning text", "Set to 2.1mm").

Management UI (no pack manager to learn):

- Design mode has one **Compliance card**: a checklist of available packs,
  each one toggle + one-line description. All-or-nothing per pack — no
  per-rule cherry-picking (that is the footgun packs exist to prevent).
- Escape hatch: individual findings can be **dismissed with a reason**,
  per-label, recorded in the `.label`, visibly badged as dismissed.
- A status chip in both modes (green check / "3 issues"); clicking a finding
  selects the offending layer. Inline badges on offending layers.
- Export with open findings shows the list once with "Export anyway" — never
  blocks.
- Shipped packs are bundled files; "Import pack…" adds third-party or updated
  packs (file-open, appears in the checklist). No pack-authoring UI.

Shipped pack: a best-attempt **`ttb-malt-beverage`** pack, with all numbers
verified against the current eCFR text of 27 CFR Parts 7 and 16 during
implementation (never from memory), stamped with the revision date checked.
The compliance card carries a standing note that this is authoring
assistance, not legal advice or a substitute for COLA approval.

Consequences elsewhere in the design: the starter master's warning layer
ships `exactText`-bound and locked (correct by default), and `select` fields
are the natural home for class designation (the designer offers only
compliant choices).

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
- **Collab → shipped variant:** partner slots and the logo-nudge gate are
  re-expressed as a "Collab" variant on the migrated Lolev master, and
  `collabEnabled` is **deleted from `LabelConfig`** — there is no collab
  boolean left anywhere in the model or the UI. The variant carries **two**
  fields: `collabLeft` and `collabCenter` (image). `collabLead` is deliberately
  NOT a field: nothing reads `collabLead.text`, the lead-in is drawn from the
  fixed `L.COLLAB_LEAD.lines`, and a real text field there would need a
  variable line count that MOVES the partner logo, since `collabLeftFlow()`
  derives the left logo's top edge from `lines.length`. Its three layers are
  gated exactly like any other variant's, through the resolver's
  disabled-layer set that `planLabel`, the PDF builder and the hit-tester
  already consult. The variant carries **no** `logo.offsetY` override
  (`overrides: {}`) — NOT "the logo nudge becomes an ordinary override on the
  variant" as a first draft of this migration had it: the shipped nudge is 0,
  so an explicit override would preserve nothing while shadowing a designer's
  master-level nudge on exactly the labels the nudge serves, since variant
  overrides merge on top of `master.defaults`. The laurel's stack nudge
  (`logoNudge`) is unconditional now regardless of Collab.

  This is the one place the "renderers are untouched" rule is deliberately
  broken: `plan.ts`, `pdf/build.ts`, `hittest.ts` and `elements.ts` each lose
  their `cfg.collabEnabled` test. The byte-identity locks are the guard —
  goldens for collab **on** and collab **off** must both match before and
  after. Legacy `.label` files still map `collabEnabled: true` onto the
  variant, and zero `logo.offsetY` when the flag was false, so nothing that
  opens today renders differently.
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
