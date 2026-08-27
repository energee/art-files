# Add-Layer UI, Code Layers & PSD Prerequisites Implementation Plan (Plan 4b of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Add text/image/barcode/QR layer" inline creation in Design mode, with every carried prerequisite paid down first: custom-image asset bytes actually render (canvas, PDF, PSD), PSD export covers customLayers and QrShapes.squares, QR layers default EC=M, barcode layers get human-readable digits with a show/hide knob, the portrait hit-box aspect is fixed, custom text layers get bold/tracking, and derived code payloads get the format-string chip builder.

**Architecture:** The prerequisites land bottom-up before any UI ships them: `CustomLayer` gains `barcode`/`qr` types and `CustomImageLayer` gains a stored `aspect` (model), `planLabel` emits the new items through the existing `Placed` kinds (display list), then each backend catches up (canvas, PDF, PSD), and only then does the Design-mode "Add layer" UI create layers. Custom image bytes travel in the `.label` ZIP under `custom/<assetId>/<name>` and reach backends the same way collab art does — bytes stay with the backend, the plan carries geometry only.

**Tech Stack:** TypeScript, vitest, existing React components, ag-psd (already a dependency). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-27-master-variation-design.md` (sections "Layer types" — Barcode, QR; "UI" — Inline creation, Per-layer properties; "Format strings")

**Prerequisite ledger honored here** (from `.superpowers/sdd/2026-08-27-master-variation-codes/progress.md` and `…-layers/progress.md`): P1 PSD ignores QrShapes.squares; P2 QR layer default EC=M (module default stays L); P3 barcode human-readables + show/hide digits for explicit patterns; P4 minimum-module-width scannability guard for Code 128 payloads; custom-image asset-bytes wiring (backends currently no-op); portrait image hit-box aspect; custom text bold/tracking stripped by customFallback; PSD ignores customLayers (must land before "Add layer" ships to users).

## Global Constraints

- No new npm dependencies. Branch `design/master-variation`. Requires Plan 4a completed first (uses `mode`, FieldList, v2 labels, `valuesFromConfig`).
- After each task: `npx vitest run` green, `npx tsc --noEmit` clean, then commit (sentence-style, no Co-Authored-By).
- Existing output unchanged when no custom layers exist: current regression locks stay green unmodified. `src/types.ts` additions must be optional.
- Module-level `qrShapes` default EC stays "L" (back-compat for the fixed template QR); only the QR *layer type* defaults to "M" (P2).
- Fonts through the existing `Face`/measure machinery — never a hardcoded font name.
- Before push: synchronized version bump to 0.1.32 + CHANGELOG entry (package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock label-lab entry, src-tauri/tauri.conf.json) — Task 7.
- Do NOT merge PR #41. Reviewer subagents are STRICTLY READ-ONLY — no stash, no checkout, no writes.

---

### Task 1: PSD renders QrShapes.squares (P1)

**Files:**
- Modify: `src/psd/build.ts` (the QR shape-layer builder — it re-derives its own `qrShapes`; find the dots/finders bezier emission)
- Test: `tests/psd-build.test.ts` (or wherever the PSD suite lives — follow the existing suite)

**Interfaces:**
- Consumes: `QrShapes.squares` + `style` (`src/qr.ts`), `qrPath`'s square/rounded math as the geometry reference.
- Produces: export the builder's shape→bezier converter as `qrBeziers(shapes: QrShapes, sizePx: number): BezierPath[]` (it is currently internal) so it is testable. Squares emit 4-knot closed rects; rounded squares emit rects whose corners are quarter-arcs approximated by cubics with the standard circle constant `k ≈ 0.5523` — reuse the builder's existing circle-to-bezier helper (the dots style already draws circles).

- [ ] **Step 1: Write the failing test**

```ts
import { qrBeziers } from "../src/psd/build";
import { qrShapes } from "../src/qr";

describe("PSD QR squares", () => {
  it("square style emits one closed path per dark module", () => {
    const s = qrShapes("proof", { style: "square" });
    expect(qrBeziers(s, 100).length).toBe(s.squares!.length);
  });
  it("rounded style emits paths too", () => {
    expect(qrBeziers(qrShapes("proof", { style: "rounded" }), 100).length).toBeGreaterThan(0);
  });
  it("dots style output is unchanged in shape count", () => {
    const s = qrShapes("proof", { style: "dots" });
    // dots: one circle per data dot + 3 per finder (outer ring, hole, center)
    expect(qrBeziers(s, 100).length).toBe(s.dots.length + s.finders.length * 3);
  });
});
```

(Adjust the dots-count expectation to what the current builder actually emits — pin the CURRENT behavior before changing anything, then keep that assertion green.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/psd-build.test.ts` — FAIL (no `qrBeziers` export / empty squares output).

- [ ] **Step 3: Implement** — branch on `shapes.squares` exactly as `qrPath` does: plain rects, or `radius = 0.25 * msPx` rounded rects for `style === "rounded"`. Keep the dots/finders branch byte-identical.

- [ ] **Step 4: Gate** — `npx vitest run && npx tsc --noEmit` — green.

- [ ] **Step 5: Commit** — `git commit -m "PSD: square and rounded QR styles render as vector shapes instead of an empty layer."`

---

### Task 2: Custom-image asset bytes end to end (+ stored aspect, hit-box fix)

**Files:**
- Modify: `src/types.ts` (`CustomImageLayer` gains `aspect`)
- Modify: `src/plan.ts` (`PlacedImage` gains `asset`; custom branch uses stored aspect as fallback)
- Modify: `src/labelfile.ts` (ZIP carries custom images under `custom/<assetId>/<name>`)
- Modify: `src/App.tsx` (customImages state; feeds PlanAssets.custom, CanvasAssets, PDF Assets, save/open, resetDocument)
- Modify: `src/canvas/draw.ts`, `src/pdf/build.ts` (draw the bytes where they currently no-op)
- Modify: `src/hittest.ts`, `src/elements.ts` (use `layer.aspect` instead of the square fallback)
- Test: `tests/custom-layers.test.ts`, `tests/hittest.test.ts`, `tests/labelfile.test.ts` (extend)

**Interfaces:**

```ts
// src/types.ts — CustomImageLayer addition:
  /** Intrinsic aspect (w/h), captured at drop time so hit and drag boxes are
   *  exact before (and independent of) asset decode. Absent on older layers:
   *  square fallback, as before. */
  aspect?: number;

// src/plan.ts — PlacedImage addition:
  /** Custom-layer asset key (CustomImageLayer.asset); absent for collab
   *  slots. Backends look bytes up by it. */
  readonly asset?: string;

// src/labelfile.ts:
export type CustomImageAsset = { name: string; bytes: Uint8Array };
// LabelAssets gains: customImages?: Record<string, CustomImageAsset>; // key = CustomImageLayer.asset
// packLabelV2 writes each as `custom/<assetId>/<name>` (level 0);
// unpackLabel collects entries under `custom/` back into assets.customImages.

// src/pdf/build.ts — Assets gains: customImages?: Record<string, CollabImage>;
// src/canvas/draw.ts — CanvasAssets gains: customImages?: Record<string, ImageBitmap | null>;
```

Behavior (binding):
- App keeps `const [customImages, setCustomImages] = useState<Record<string, CustomFile>>({})` with `CustomFile = { image: CollabImage; name: string; previewUrl: string; aspect: number }` — mirroring `CollabFile`, keyed by asset id minted at drop (`custom-asset-${crypto.randomUUID().slice(0, 8)}`). The assembly effect decodes them alongside collab art and fills `planAssets.custom = { [k]: { aspect } }` from real intrinsic sizes (SVG: parseLogo's ink box; raster: bitmap w/h).
- `resetDocument` clears them (revoking previewUrls); `saveProject` packs them; both open branches restore them (v1 zips simply have none).
- `src/canvas/draw.ts`: at the guard that currently no-ops on unresolvable custom ids, draw `customImages[item.asset]` into the placed rect in art mode; mask mode paints the rect per the raster collab-image mask rule. Missing bitmap stays a no-op (byte-identity lock).
- `src/pdf/build.ts`: embed via the same pipeline as collab art, keyed off `item.asset`; missing bytes stay a no-op.
- `src/hittest.ts` + `elements.ts` `dragTarget2` box(): `h = layer.aspect ? layer.w / layer.aspect : layer.w`; delete the deferred-square-fallback comment blocks (`elements.ts:360` area, `hittest.ts:184` area).
- `planLabel` custom-image branch: set `asset: layer.asset` on the item; when `A?.custom?.[layer.asset]` is absent but `layer.aspect` present, emit the rect from the stored aspect (selection/hit exists while bytes load); when both absent, keep today's skip.

- [ ] **Step 1: Failing tests** — `custom-layers.test.ts`: planLabel emits `asset` and `h = w / aspect` from stored aspect with no PlanAssets.custom; `hittest.test.ts`: portrait layer `aspect: 0.5` hits at `h = 2 * w`; `labelfile.test.ts`: `packLabelV2` with `customImages: { "custom-asset-x": { name: "mark.svg", bytes: new Uint8Array([60]) } }` round-trips through `unpackLabel`.

- [ ] **Step 2: Run to verify failures.**

- [ ] **Step 3: Implement per the interface block.**

- [ ] **Step 4: Gate** — `npx vitest run && npx tsc --noEmit` — green, including the existing no-op byte-identity locks (custom image layers with NO assets must still build a byte-identical PDF).

- [ ] **Step 5: Commit** — `git commit -m "Custom image layers: asset bytes travel in the label file and render in canvas and PDF, with exact aspect boxes."`

---

### Task 3: Barcode and QR custom layer types (P2, P3, P4)

**Files:**
- Modify: `src/types.ts` (CustomBarcodeLayer, CustomQrLayer)
- Modify: `src/barcode.ts` (`barcodeDigitsFor` — generic digit layout for explicit patterns)
- Modify: `src/model/fields.ts` (`minModuleWarning`)
- Modify: `src/plan.ts` (planLabel emits the new types; `PlacedBarcode.id` widens to `ElementId`)
- Modify: `src/canvas/draw.ts`, `src/pdf/build.ts` (verify no `id === "barcode"` switches break — paint reads item fields, which PlacedBarcode already carries)
- Modify: `src/hittest.ts`, `src/elements.ts` (boxes for the two new types)
- Test: `tests/barcode.test.ts`, `tests/custom-layers.test.ts` (extend)

**Interfaces:**

```ts
// src/types.ts
export interface CustomBarcodeLayer extends CustomLayerBase {
  type: "barcode";
  symbology: "upc-a" | "ean-13" | "code-128";
  /** Payload — RAW: may be a format string over field values ("{upc}").
   *  Expansion to the drawn value happens in expandCustomFormats (Task 5);
   *  until Task 5 lands, planLabel draws the raw string when it encodes. */
  value: string;
  /** Bar-area height in points. */
  h: number;
  /** Module width in points; run width follows the pattern length. */
  moduleW: number;
  /** Human-readable digits under the symbol (P3). Absent = true. */
  showDigits?: boolean;
  style: Style;   // fill/layer + stroke-as-halo, like the template barcode
}
export interface CustomQrLayer extends CustomLayerBase {
  type: "qr";
  value: string;                       // payload, RAW like the barcode's
  size: number;                        // side in points
  qrStyle: "square" | "rounded" | "dots";
  /** Error correction; ABSENT means "M" for layers (P2) — never L. */
  ecLevel?: "L" | "M" | "Q" | "H";
  style: Style;
}
export type CustomLayer =
  | CustomTextLayer | CustomImageLayer | CustomBarcodeLayer | CustomQrLayer;

// src/barcode.ts — P3. UPC-A keeps its historical 4-group layout; EAN-13:
// leading digit before the run + two 6-digit groups centered under their
// halves; Code 128: the whole value as one group centered under the symbol.
export function barcodeDigitsFor(
  symbology: Symbology, value: string, modulesLen: number, quiet: number,
  measure: (text: string) => number,
): BarcodeGeometry["digits"];

// src/model/fields.ts — P4: plain-English scannability warning, or null.
// Fires when moduleW < 0.72pt (0.01in) — below common scanner tolerance on
// curved metal; message names the symbology and the minimum.
export function minModuleWarning(
  symbology: "upc-a" | "ean-13" | "code-128", moduleW: number,
): string | null;
```

Behavior (binding):
- `barcodeGeometry` is UNCHANGED (explicit pattern → `digits: []`, the Plan-2 ruling stands). `planLabel`'s custom-barcode branch composes: encode via `encodeFor`, build its own scaled geometry (bars from the pattern at `layer.moduleW`/`layer.h`, positioned at `anchoredX/Y` — a small local helper mirroring `barcodeGeometry`'s bar-merging over the layer's metrics, or generalize `barcodeGeometry` to accept `{x, yTop, h, moduleW}` overrides — implementer's choice, with the template call's output pinned byte-identical either way), then `digits = (layer.showDigits ?? true) ? barcodeDigitsFor(...) : []`. An invalid payload (validator fails) emits nothing — never a garbage symbol.
- `PlacedBarcode.id` widens from `"barcode"` to `ElementId`. Audit consumers: `grep -n '"barcode"' src/canvas/draw.ts src/pdf/build.ts src/psd/build.ts src/hittest.ts` — paint must key off the ITEM's fields (fill/stroke/layers/geo), which it already carries; fix any `id === "barcode"` config lookups to use the item.
- QR: `planLabel` emits stroke-underlay + fill `paths` items exactly like the template QR, from `qrShapes(layer.value, { style: layer.qrStyle, ecLevel: layer.ecLevel ?? "M" })`, sized `layer.size`, at `anchoredX/Y`, styled from `layer.style`. No backend changes — `paths` is universal.
- Hit/drag boxes: barcode = pattern length × moduleW wide, `h` tall (+ digit band when shown); qr = `size × size`.

- [ ] **Step 1: Failing tests**

```ts
// tests/barcode.test.ts additions
it("ean-13 digits: leading digit + two centered sixes", () => {
  const d = barcodeDigitsFor("ean-13", "4006381333931", 95, 9, (t) => t.length * 4);
  expect(d.map((g) => g.text)).toEqual(["4", "006381", "333931"]);
});
it("code-128 digits: one group, centered", () => {
  const d = barcodeDigitsFor("code-128", "LOLEV-123", 68, 10, (t) => t.length * 4);
  expect(d).toHaveLength(1);
  expect(d[0].text).toBe("LOLEV-123");
});
// tests/custom-layers.test.ts additions
it("qr layer defaults to EC M", () => { /* plan a qr layer without ecLevel;
  assert its emitted path differs from an explicit ecLevel "L" plan of the
  same payload (M adds codewords), and equals an explicit "M" plan */ });
it("barcode layer digits obey showDigits", () => { /* default plans digits,
  showDigits: false plans none */ });
it("no custom layers -> byte-identical pre-feature plan", () => { /* existing
  lock stays green */ });
it("minModuleWarning fires under 0.72pt and stays quiet at 1pt", () => {
  expect(minModuleWarning("code-128", 0.5)).toMatch(/module/i);
  expect(minModuleWarning("code-128", 1)).toBeNull();
});
```

- [ ] **Step 2: Run to verify failures.**

- [ ] **Step 3: Implement** model + digits + warning + planLabel emission + boxes + consumer audit.

- [ ] **Step 4: Gate** — `npx vitest run && npx tsc --noEmit` — green.

- [ ] **Step 5: Commit** — `git commit -m "Custom barcode and QR layer types: EC defaults to M, per-symbology digits with a show/hide knob."`

---

### Task 4: "Add layer" UI in Design mode + custom rows + capability fix

**Files:**
- Modify: `src/elements.ts` (cfg-aware `customElement` replaces the blind capability fallback for callers that have cfg)
- Modify: `src/components/LayersPanel.tsx` (Custom group rows + "Add layer" menu, Design mode only)
- Modify: `src/components/layers.ts` (custom ids join the selection order)
- Modify: `src/components/StyleProperties.tsx` (per-type property rows)
- Modify: `src/App.tsx` (`addCustomLayer`, image add flow, delete-layer command)
- Test: `tests/custom-layers.test.ts` (capability), `tests/elements.test.ts` (extend)

**Interfaces:**

```ts
// src/elements.ts
/** Capability row for a custom layer, read from the actual layer (unlike
 *  elementById's blind fallback, which stays for cfg-less callers):
 *  text  -> { hasBold: true,  isText: true,  allowNone: true }
 *  image -> { hasBold: false, isText: false, allowNone: true }
 *  barcode/qr -> { hasBold: false, isText: false, allowNone: false }
 *  label = layer.name in every case. */
export function customElement(cfg: LabelConfig, id: `custom-${string}`): LabelElement;
// applyStyle: for custom ids, consult customElement(c, id) for the
// hasBold/isText strip guards, so bold/tracking reach custom TEXT lines.

// src/App.tsx
/** Inline creation (spec: placed immediately, configure after). Mints
 *  `custom-${crypto.randomUUID().slice(0, 8)}`, appends through update()
 *  (one undo step), selects the new layer. Defaults:
 *  text:    name "Text", size 12, line {text: "Text", ...nameStyle-derived fill/layer},
 *           position {anchor: "center", vAnchor: "top", offsetX: 0, offsetY: 24}
 *  image:   file-pick FIRST; on pick mint asset id, decode aspect, then add
 *           (w: 60, same default position)
 *  barcode: symbology "code-128", value "", h: 40, moduleW: 1, showDigits
 *           default, style from the template barcode's defaults
 *  qr:      value "", size: 40, qrStyle "square", style from the template
 *           QR's defaults (ecLevel absent = M) */
function addCustomLayer(type: "text" | "image" | "barcode" | "qr"): void;
```

Panel and inspector (binding):
- LayersPanel gets `mode` and `cfg.customLayers`: a "Custom" group listing each layer by `name` with the existing eye/select affordances (custom ids are already `ElementId`s and `HideableLayerId`s) and the lock badge; an "Add layer ▾" menu (Text / Image / Barcode / QR) renders only in Design mode.
- Selection ranges: `PANEL_ORDER` is static — where App resolves selection (`resolveSelect(s, id, mods, PANEL_ORDER)`), pass `[...PANEL_ORDER, ...(cfg.customLayers ?? []).map(l => l.id)]` instead; touch nothing else.
- StyleProperties per type, "3–5 essentials + Advanced" (spec): text = existing text controls plus size + name + lock (bold/tracking now functional via `customElement`); image = w, tint-style fill/layer, name, lock; barcode = value (Task 5 swaps in FormatBuilder), symbology, digits toggle, h; Advanced: moduleW with `minModuleWarning` rendered `text-destructive` under it, halo; qr = value, qrStyle, size; Advanced: ecLevel (shows "M (default)"), halo. Delete under Advanced ("Remove layer", undoable via update).

- [ ] **Step 1: Failing tests** — `elements.test.ts`: `applyStyle` with `{bold: true, letterSpacing: 1}` on a custom TEXT layer lands both on `layer.line`; on a custom IMAGE layer both stripped; `customElement` label = `layer.name`, barcode/qr `allowNone: false`.

- [ ] **Step 2: Run to verify failure** (today applyStyle strips bold/tracking for all custom ids).

- [ ] **Step 3: Implement** capability fix + panel + inspector rows + App commands.

- [ ] **Step 4: Gate** — `npx vitest run && npx tsc --noEmit` — green.

- [ ] **Step 5: Commit** — `git commit -m "Design mode: add text, image, barcode, and QR layers inline, with per-type properties and working bold and tracking on custom text."`

---

### Task 5: Format-string chip builder for derived code payloads

**Files:**
- Create: `src/components/FormatBuilder.tsx`
- Modify: `src/model/format.ts` (export `segments`)
- Modify: `src/model/document.ts` (`expandCustomFormats`)
- Modify: `src/components/StyleProperties.tsx` (custom code layers' value row uses FormatBuilder)
- Modify: `src/App.tsx` (displayCfg seam)
- Test: `tests/formatbuilder-dom.test.tsx`, `tests/model-format.test.ts`, `tests/model-document.test.ts` (extend)

**Interfaces:**

```ts
// src/model/format.ts
/** The format string split into literal and ref segments, using the same REF
 *  grammar expandFormat consumes — the builder renders these, never re-parsing. */
export function segments(fmt: string): ({ lit: string } | { id: string; tr?: string })[];

// src/model/document.ts
/** Display seam: clone cfg with each custom barcode/qr layer's raw `value`
 *  replaced by its expansion over the label's current field values. The raw
 *  cfg stays the edited/saved document; only planning/export consume this.
 *  Values with no refs pass through untouched (identity for plain payloads). */
export function expandCustomFormats(
  cfg: LabelConfig, values: Record<string, string>,
): LabelConfig;

// src/components/FormatBuilder.tsx
export function FormatBuilder(props: {
  value: string;                 // raw format string (storage form)
  fields: FieldDecl[];           // insertable refs (visibleFieldsOf output)
  preview: Record<string, string>; // current stringified values, for live preview
  onChange: (value: string) => void;
}): JSX.Element;
```

Behavior (spec: Format strings): literal segments render as inline editable text; each ref renders as a chip showing the field's `label` with a transform dropdown (none/slug/upper/lower/trim, each with the spec's plain-language description as its title); an "Insert field ▾" menu appends `{id}`; a "Raw" toggle swaps the whole row for a plain input over the raw string; a preview line shows `expandFormat(value, preview).text` live, with missing refs visible as literal braces (expandFormat's contract).

App wiring: memoize `const displayCfg = useMemo(() => expandCustomFormats(cfg, stringValues), [cfg, stringValues])` where `stringValues` stringifies `valuesFromConfig(master, enabledVariations, cfg)`; pass `displayCfg` everywhere `cfg` feeds rendering/export (PreviewCompare, CanView, buildFull, exportPsd) while the sidebar, history, and save keep raw `cfg`. With no custom code layers `expandCustomFormats` must return `cfg` by identity, so memo consumers don't re-render.

- [ ] **Step 1: Failing tests** — pure: `segments('beer {name|slug} end')` → `[{lit:"beer "},{id:"name",tr:"slug"},{lit:" end"}]`; `expandCustomFormats` expands `"{upc}"` in a barcode layer and returns cfg identity when no code layers exist. DOM: renders one chip labeled "Beer name" with slug selected; changing the transform calls `onChange` with `{name|upper}` in place; Raw toggle passes typed text through.

- [ ] **Step 2: Run to verify failures.**

- [ ] **Step 3: Implement** (helper exports + component + inspector swap + displayCfg seam).

- [ ] **Step 4: Gate** — `npx vitest run && npx tsc --noEmit` — green.

- [ ] **Step 5: Commit** — `git commit -m "Format builder: chip-based editor with live preview for derived barcode and QR payloads."`

---

### Task 6: PSD exports custom layers

**Files:**
- Modify: `src/psd/build.ts` (`PsdAssets` gains `customImages?: Record<string, {data: Uint8Array; width: number; height: number}>`; custom items emit layers)
- Modify: `src/App.tsx` (`exportPsd` rasterizes custom images like the texture, keyed by asset)
- Test: PSD suite (extend)

**Interfaces:**
- Consumes: the display list already carries every custom layer (Tasks 2–3); the work is removing the builder's custom-id early-outs and adding the raster path for `PlacedImage.asset`.
- Produces: one PSD layer per custom layer, named `layer.name`, on both art and mask plates (mask per the standard paint rules: metallic knocks out white, white paints mask blue; image rects per the raster collab rule).

- [ ] **Step 1: Failing test** — a config with one custom text layer builds a PSD containing a layer named after it with non-empty content; a custom image layer with supplied pixels produces a raster layer at the placed rect; a config with NO custom layers builds byte-identical output to a pre-change capture (pin the capture first).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** — text via the existing type-layer emitter over the placed runs; image via a raster layer scaled to the placed rect from `PsdAssets.customImages[asset]`; barcode via the merged-shape approach the template barcode uses; qr via Task 1's `qrBeziers`.

- [ ] **Step 4: Gate** — green.

- [ ] **Step 5: Commit** — `git commit -m "PSD: custom text, image, barcode, and QR layers export as real layers on both plates."`

---

### Task 7: Version bump + CHANGELOG + push gate

- [ ] **Step 1: Bump 0.1.31 → 0.1.32** in package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock (label-lab), src-tauri/tauri.conf.json.

- [ ] **Step 2: CHANGELOG entry**

```markdown
## [0.1.32] - 2026-08-27

- Design mode can now add layers: text, image, barcode (UPC-A, EAN-13,
  Code 128, with human-readable digits and a show/hide knob), and QR
  (square/rounded/dots; error correction defaults to M, with a warning when
  a Code 128 module is set too narrow to scan). Barcode and QR payloads can
  be built from label fields with a chip-based format editor and live
  preview. Custom image layers now actually render — their bytes travel
  inside the `.label` file — and the PSD exports carry every custom layer
  plus the square/rounded QR styles they previously dropped. Custom text
  layers support bold and letter-spacing; image hit areas now match portrait
  artwork exactly.
```

- [ ] **Step 3: Full gate** — `npx vitest run && npx tsc --noEmit` — green.

- [ ] **Step 4: Commit and push**

```bash
git add -A
git commit -m "Version 0.1.32: add-layer UI, code layer types, format builder, and full PSD coverage."
git push
```

Do NOT merge PR #41.

---

## Self-Review

- Prerequisite coverage: P1 ✓ (T1); P2 ✓ (T3 — layer-level M, module default untouched); P3 ✓ (T3 `barcodeDigitsFor` + `showDigits`); P4 ✓ (T3 `minModuleWarning`, surfaced in T4's panel); asset bytes ✓ (T2); portrait hit box ✓ (T2 stored aspect); custom text bold/tracking ✓ (T4 `customElement`); "PSD before Add-layer ships" ✓ — everything reaches users together at the 0.1.32 push, which contains T1 and T6.
- Spec coverage (4b slice): inline creation, no dialogs ✓ (T4); 3–5 essentials + Advanced fold ✓ (T4); chip builder with transforms, raw toggle, live preview ✓ (T5); barcode knobs height/module width/halo/digits ✓ (T3/T4); QR style dropdown with EC under Advanced ✓ (T4). NOT in this plan, flagged for the user before execution: the QR center-logo knockout with auto-H (spec "Layer types" — needs image-in-QR plumbing; propose deferring to a follow-up unless pulled in now); `code`-kind FieldDecls binding to custom layers via `layerId` (Plan 6 migration territory — the format-string `{upc}` path covers the derived case).
- Type consistency: raw `value` + `expandCustomFormats` display seam named identically in T3/T5; `PlacedImage.asset` (T2) is what T6's raster path reads; `qrBeziers` (T1) is what T6's QR path calls; `customElement` (T4) is the only new elements.ts surface.
- Known risk, stated: T3 widens `PlacedBarcode.id` — audit every consumer switch (`grep -n '"barcode"' src/canvas/draw.ts src/pdf/build.ts src/psd/build.ts src/hittest.ts`); the regression locks catch a miss.
