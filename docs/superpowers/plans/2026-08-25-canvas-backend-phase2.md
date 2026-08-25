# Canvas Backend (Canvas Renderer Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `src/plan.ts` to a full display list (laurel, QR, collab images, barcode join the text runs), make the PDF backend a single plan walk, add the canvas renderer `src/canvas/draw.ts` that draws both plates from the same plan, and land the pixel-parity dev page plus a dev-only in-app toggle.

**Architecture:** `planLabel` gains a discriminated union — `Placed = PlacedText | PlacedPaths | PlacedImage | PlacedBarcode` — and an optional `opts.assets` (logo SVG + collab art descriptors). With `assets` the plan is the complete label in draw order, so `drawElements` collapses to one ordered walk with a per-kind dispatch (deleting the hand-maintained LEFT-set seam); without `assets` it stays text-only, which is exactly what `hittest.ts` consumes today. The canvas backend walks the same plan with `CanvasRenderingContext2D`; plate backgrounds (texture cover-fit, mask flood) mirror `buildArtPdf`/`buildMaskPdf` and stay outside the plan, sharing their geometry via a new `L.coverFit`.

**Tech Stack:** TypeScript, vitest, Canvas 2D. No new dependencies (the parity page runs in the real browser via a Vite dev-only page, not Node).

**Spec:** `docs/superpowers/specs/2026-08-25-canvas-preview-renderer-design.md`

## Global Constraints

- Exports stay pixel-identical: every task ends with `npx tsc --noEmit` clean and `npx vitest run` fully green (242+ tests); Task 3 additionally verifies `npm run generate` output visually against pre-task PDFs at 100% and 400% zoom.
- No new dependencies.
- Coordinates in `plan.ts` are label-space points, top-left origin — backends convert (the PDF's `y()` flip stays in `pdf/build.ts`; canvas is natively top-left, no flip).
- Never hardcode "Poppins" — canvas text goes through `LABEL_FONT_FAMILY` and the loaders in `src/fonts.ts` (dynamic-fonts constraint).
- `BLEED_SHIFT` is applied once per output boundary: the canvas backend translates by it after painting backgrounds, exactly as `shiftForBleed` does in the PDF.
- Follow repo conventions (`.agents/conventions.md`): `// filename — purpose` headers on new files; comments state constraints, not narration.
- Commit messages: conventional prefixes (`refactor:`, `feat:`, `test:`, `chore:`), no co-author lines.
- Carried-forward Phase 1 minors land here: LEFT-set seam (Task 3), dead imports `WARNING_TEXT`/`displayAbv`/`displayStyle` and the `parseDescription` double-parse in `pdf/build.ts` (Task 3), `at.x!` → `{x}|{cx}` union and `Readonly` on `PlacedText` (Task 1).

---

### Task 1: `plan.ts` — the Placed union, laurel and QR items

**Files:**
- Modify: `src/plan.ts`
- Modify: `src/hittest.ts` (one narrowing guard), `src/pdf/build.ts` (one narrowing guard — keeps the tree compiling mid-phase)
- Test: `tests/plan.test.ts` (append)

**Interfaces:**
- Consumes: `parseLogo` from `src/logo.ts`; `qrPath`, `qrShapes`, `qrUrl` from `src/qr.ts`; `logoNudge` from `src/elements.ts`; existing plan exports.
- Produces (later tasks rely on these exact names):
  - `type Mode = "art" | "mask"` (exported; pdf/build.ts and canvas/draw.ts both alias it)
  - `interface PlacedText` — unchanged fields, all `readonly`, plus `readonly kind: "text"`
  - `interface PlacedPaths { readonly kind: "paths"; readonly id: ElementId; readonly paths: readonly string[]; readonly x: number; readonly y: number; readonly fill: Fill; readonly layer: Style["layer"]; readonly stroke: StrokeSpec | null }`
  - `type Placed = PlacedText | PlacedPaths | PlacedImage | PlacedBarcode` (the last two arrive in Task 2; in this task the union is `PlacedText | PlacedPaths`)
  - `type PlanArt = { kind: "svg"; svg: string } | { kind: "raster"; w: number; h: number }`
  - `interface PlanAssets { logoSvg: string; collabLeft?: PlanArt | null; collabCenter?: PlanArt | null }`
  - `PlanOpts` gains `assets?: PlanAssets`
  - `planLabel(cfg, m, opts): Placed[]` — with `opts.assets` the full display list in draw order; without it, text only (hittest's contract, unchanged numbers)
  - `lineRuns`'s `at` becomes `({ x: number } | { cx: number }) & { baseline: number; size: number; face?: Face }` (the `at.x!` cleanup)

- [ ] **Step 1: Write the failing tests**

```ts
// append to tests/plan.test.ts
// A tiny valid logo SVG: one triangle, laurel-shaped viewBox.
const LOGO_SVG =
  '<svg viewBox="0 0 480 525"><path d="M0 0 L480 0 L240 525 Z"/></svg>';

describe("planLabel with assets", () => {
  const cfg = defaultConfig();
  const assets = { logoSvg: LOGO_SVG };

  it("emits the laurel as a paths item centred on LOGO.cx", () => {
    const logo = planLabel(cfg, m, { assets }).find((r) => r.id === "logo");
    expect(logo).toBeDefined();
    expect(logo!.kind).toBe("paths");
    if (logo!.kind !== "paths") return;
    // parseLogo scales by width: drawn w is exactly LOGO.w, x centres it.
    expect(logo!.x).toBeCloseTo(L.LOGO.cx - L.LOGO.w / 2);
    expect(logo!.paths.length).toBeGreaterThan(0);
    expect(logo!.fill).toBe(cfg.logo.fill);
  });

  it("skip('logo') removes the laurel; without assets no laurel exists", () => {
    expect(planLabel(cfg, m, { assets, skip: new Set(["logo" as const]) })
      .some((r) => r.id === "logo")).toBe(false);
    expect(planLabel(cfg, m).some((r) => r.id === "logo")).toBe(false);
  });

  it("emits the QR as underlay+fill paths when stroked, fill alone when not", () => {
    const stroked = planLabel(cfg, m, { assets }).filter((r) => r.id === "qr");
    // defaultConfig ships a qrStroke; both items sit at the QR plate origin.
    expect(stroked).toHaveLength(2);
    expect(stroked.every((r) => r.kind === "paths"
      && r.x === L.QR.x && r.y === L.QR.yTop)).toBe(true);
    const bare = planLabel({ ...cfg, qrStroke: "none" }, m, { assets })
      .filter((r) => r.id === "qr");
    expect(bare).toHaveLength(1);
  });

  it("keeps text placement identical with and without assets", () => {
    const textOnly = planLabel(cfg, m);
    const full = planLabel(cfg, m, { assets }).filter((r) => r.kind === "text");
    expect(full).toEqual(textOnly);
  });

  it("orders the laurel between wordmark and name (the z-order pin)", () => {
    const ids = planLabel(cfg, m, { assets }).map((r) => r.id);
    expect(ids.indexOf("logo")).toBeGreaterThan(ids.lastIndexOf("wordmark"));
    expect(ids.indexOf("logo")).toBeLessThan(ids.indexOf("name"));
    // QR draws after storeCold — drawElements' actual order.
    expect(ids.indexOf("qr")).toBeGreaterThan(ids.lastIndexOf("storeCold"));
  });
});
```

Note: if `defaultConfig()` ships `qrStroke: "none"`, flip the two halves of the QR test (read `src/defaults.ts` to see which way it ships) — the invariant is stroked → 2 items, unstroked → 1.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/plan.test.ts`
Expected: FAIL — `planLabel` never emits `id: "logo"`, and `r.kind` doesn't exist.

- [ ] **Step 3: Write the implementation**

In `src/plan.ts`:

1. Add `kind` and `readonly` to `PlacedText` (every field `readonly`, plus `readonly kind: "text"`); update `lineRuns`/`rotatedRuns` construction sites to include `kind: "text"`.
2. Change `lineRuns`'s `at` to `({ x: number } | { cx: number }) & { baseline: number; size: number; face?: Face }` and replace the `at.x!` read with `"cx" in at ? at.cx - total / 2 : at.x`.
3. Add the new types and the asset-driven walk:

```ts
// plan.ts imports to add:
import { parseLogo } from "./logo";
import { qrPath, qrShapes, qrUrl } from "./qr";
import { logoNudge } from "./elements";

/** The two plates every backend renders. */
export type Mode = "art" | "mask";

/** Vector art placed on the label: pre-scaled absolute path data (see
 *  parseLogo) translated to (x, y), top-left origin. Backends fill with the
 *  nonzero rule (pdf-lib's drawSvgPath and Path2D's default agree); a stroke
 *  paints every path before any fill so overlapping laurel branches keep
 *  clean edges. */
export interface PlacedPaths {
  readonly kind: "paths";
  readonly id: ElementId;
  readonly paths: readonly string[];
  readonly x: number;
  readonly y: number;
  readonly fill: Fill;
  readonly layer: Style["layer"];
  readonly stroke: StrokeSpec | null;
}

export type Placed = PlacedText | PlacedPaths; // PlacedImage | PlacedBarcode join in Task 2

/** Collab art as the plan needs it: SVG art plans as paths (the plan fits
 *  it itself, via parseLogo); raster art plans as a fitted rect, so only
 *  the intrinsic pixel size travels — bytes stay with the backend. */
export type PlanArt =
  | { kind: "svg"; svg: string }
  | { kind: "raster"; w: number; h: number };

export interface PlanAssets {
  /** Raw contents of logo2025.svg. */
  logoSvg: string;
  collabLeft?: PlanArt | null;
  collabCenter?: PlanArt | null;
}
```

`PlanOpts` gains:

```ts
  /** With assets, planLabel emits the COMPLETE display list — text, laurel,
   *  QR, collab art, barcode — in drawElements' historical draw order, and
   *  the collab gates read the slots from here (opts.collab is ignored).
   *  Without assets: text only, gated by opts.collab — hittest's contract. */
  assets?: PlanAssets;
```

4. Restructure `planLabel`'s walk so non-text items land in draw order. The text calls are untouched; the additions interleave:

```ts
export function planLabel(cfg: LabelConfig, m: MeasureFace, opts: PlanOpts = {}): Placed[] {
  const skip = (id: ElementId) => !!opts.skip?.has(id);
  const A = opts.assets;
  // One source for the slot gates: the art itself when assets are in hand,
  // opts.collab (hittest's booleans) otherwise — never both.
  const slots = A
    ? { left: !!A.collabLeft, center: !!A.collabCenter }
    : opts.collab ?? { left: false, center: false };
  const out: Placed[] = [];
  // ... volume, abv, description, collabLead exactly as today, with the
  // collabLead gate reading `slots.left` instead of `opts.collab?.left` ...

  // Left collab art, flowed under the lead-in — drawCollab's placement.
  if (A && cfg.collabEnabled && A.collabLeft && !skip("collabLeft")) {
    const flow = L.collabLeftFlow(desc.lines.length);
    out.push(...collabItems("collabLeft", A.collabLeft, cfg.collabLeft, {
      x: L.COLLAB_LEFT.x, top: flow.logoTop,
      maxW: L.COLLAB_LEFT.maxW, maxH: L.COLLAB_LEFT.maxH,
    }));
  }

  // ... wordmark exactly as today ...

  // The laurel, and the centre collab mark hanging off its nudged bottom.
  // Geometry is computed even when the laurel is skipped: the centre mark
  // hangs off logoCy, and hiding the laurel must not move it.
  if (A) {
    const logo = parseLogo(A.logoSvg, L.LOGO.w);
    const logoCy = L.LOGO.cy + logoNudge(cfg);
    if (!skip("logo"))
      out.push({
        kind: "paths", id: "logo", paths: logo.paths,
        x: L.LOGO.cx - logo.w / 2, y: logoCy - logo.h / 2,
        fill: cfg.logo.fill, layer: cfg.logo.layer, stroke: strokeSpec(cfg.logo),
      });
    if (cfg.collabEnabled && A.collabCenter && !skip("collabCenter"))
      out.push(...collabItems("collabCenter", A.collabCenter, cfg.collabCenter, {
        cx: L.COLLAB_CENTER.cx,
        top: logoCy + logo.h / 2 + L.COLLAB_CENTER.gapAbove,
        maxW: L.COLLAB_CENTER.maxW, maxH: L.COLLAB_CENTER.maxH,
      }));
  }

  // ... name, styleLine, handleAddress, warning, storeCold exactly as today ...

  // QR — payload derived from the beer name; the stroked underlay is its own
  // paths item (the grow'd path IS the stroke, so the item itself is unstroked).
  if (A && !skip("qr")) {
    const shapes = qrShapes(qrUrl(displayName(cfg)));
    const at = { x: L.QR.x, y: L.QR.yTop };
    if (cfg.qrStroke !== "none")
      out.push({
        kind: "paths", id: "qr", ...at, stroke: null,
        paths: [qrPath(shapes, L.QR.size, (cfg.qrStrokeWidth ?? L.DEFAULT_STROKE_PX) * L.PX)],
        fill: cfg.qrStroke, layer: cfg.qrStrokeLayer,
      });
    out.push({
      kind: "paths", id: "qr", ...at, stroke: null,
      paths: [qrPath(shapes, L.QR.size)], fill: cfg.qrFill, layer: cfg.qrLayer,
    });
  }

  // Barcode joins in Task 2.
  return out;
}
```

5. The collab helper (its raster branch depends on Task 2's `PlacedImage`; if committing Task 1 separately, land the svg branch and `return []` for raster with a `// Task 2` note — this task's tests are svg/laurel-only):

```ts
/** A collab slot's art as placed items — drawCollab's placement without the
 *  drawing: the box scaled by the slot's scale knob, offsetY nudging the
 *  flowed position, SVG fitted ink-tight by parseLogo, raster fitted by its
 *  intrinsic aspect. */
function collabItems(
  id: ElementId,
  art: PlanArt,
  slot: CollabSlot,
  box: { x?: number; cx?: number; top: number; maxW: number; maxH: number },
): Placed[] {
  const maxW = box.maxW * slot.scale;
  const maxH = box.maxH * slot.scale;
  const top = box.top + (slot.offsetY ?? 0);
  const place = (w: number) => (box.cx !== undefined ? box.cx - w / 2 : box.x!);
  if (art.kind === "svg") {
    const a = parseLogo(art.svg, maxW, maxH);
    return [{
      kind: "paths", id, paths: a.paths, x: place(a.w), y: top,
      fill: slot.fill, layer: slot.layer, stroke: strokeSpec(slot),
    }];
  }
  const s = Math.min(maxW / art.w, maxH / art.h);
  const w = art.w * s;
  const h = art.h * s;
  return [{ kind: "image", id, x: place(w), y: top, w, h }];
}
```

(`CollabSlot` imports from `./types`.)

6. Keep the tree compiling: in `src/hittest.ts`'s grouping loop add `if (r.kind !== "text") continue;` as the first line of the `for (const r of plan)` body; in `src/pdf/build.ts` the plan variable is now `Placed[]`, so its two `plan.filter(...)` passes need the same narrowing — change both filters to `(r): r is PlacedText => r.kind === "text" && <existing condition>`. (Task 3 deletes these filters entirely.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green. The "identical with and without assets" test is the behaviour-neutrality gate for hittest and the PDF text pass.

- [ ] **Step 5: Commit**

```bash
git add src/plan.ts src/hittest.ts src/pdf/build.ts tests/plan.test.ts
git commit -m "refactor: plan.ts places the laurel and QR as display-list items"
```

---

### Task 2: `plan.ts` — collab images and the barcode item

**Files:**
- Modify: `src/plan.ts`
- Test: `tests/plan.test.ts` (append)

**Interfaces:**
- Consumes: `barcodeFootprint`, `barcodeGeometry`, `barcodeStrokePt`, type `BarcodeGeometry` from `src/barcode.ts`; Task 1's `PlanArt`, `collabItems`.
- Produces:
  - `interface PlacedImage { readonly kind: "image"; readonly id: ElementId; readonly x: number; readonly y: number; readonly w: number; readonly h: number }` — a raster collab logo's fitted rect; art mode draws the backend's image for `id`, mask mode paints the rect white-ink blue (raster prints on white ink, per drawCollab).
  - `interface PlacedBarcode { readonly kind: "barcode"; readonly id: "barcode"; readonly geo: BarcodeGeometry; readonly S: number; readonly fill: Fill; readonly stroke: Fill | "none"; readonly fillLayer: Style["layer"]; readonly strokeLayer: Style["layer"]; readonly textSize: number; readonly digits: readonly { text: string; x: number; y: number; w: number }[]; readonly footprint: readonly { x: number; yTop: number; w: number; h: number }[] }`
  - `function barcodeItem(cfg: LabelConfig, m: MeasureFace): PlacedBarcode` (exported — Task 3's refactored tests build items with it)
  - `Placed` becomes the full four-way union.

- [ ] **Step 1: Write the failing tests**

```ts
// append to tests/plan.test.ts
import { barcodeItem } from "../src/plan";

describe("planLabel collab images and barcode", () => {
  const cfg = defaultConfig();
  const assets = { logoSvg: LOGO_SVG };

  it("fits a raster centre logo into its envelope, centred on cx", () => {
    // 200x100 raster in a 36x36 envelope at scale 1: width-bound, s=0.18.
    const c = { ...cfg, collabEnabled: true };
    const item = planLabel(c, m, {
      assets: { ...assets, collabCenter: { kind: "raster", w: 200, h: 100 } },
    }).find((r) => r.id === "collabCenter");
    expect(item).toBeDefined();
    if (item!.kind !== "image") throw new Error("expected an image item");
    expect(item!.w).toBeCloseTo(L.COLLAB_CENTER.maxW * c.collabCenter.scale);
    expect(item!.h).toBeCloseTo(item!.w / 2);
    expect(item!.x).toBeCloseTo(L.COLLAB_CENTER.cx - item!.w / 2);
  });

  it("plans an svg left logo as paths at the flowed position", () => {
    const c = { ...cfg, collabEnabled: true };
    const item = planLabel(c, m, {
      assets: { ...assets, collabLeft: { kind: "svg", svg: LOGO_SVG } },
    }).find((r) => r.id === "collabLeft");
    expect(item?.kind).toBe("paths");
    if (item?.kind !== "paths") return;
    expect(item.x).toBeCloseTo(L.COLLAB_LEFT.x);
  });

  it("barcodeItem resolves the halo exactly like barcodeStrokePt", () => {
    expect(barcodeItem({ ...cfg, barcodeStroke: "none" }, m).S).toBe(0);
    expect(barcodeItem({ ...cfg, barcodeStrokeWidth: 10 }, m).S).toBeCloseTo(10 * L.PX);
    expect(barcodeItem(cfg, m).S).toBeCloseTo(L.BARCODE.stroke); // unset -> measured halo
  });

  it("places digit runs so each spans w toward the label top from y", () => {
    const item = barcodeItem(cfg, m);
    expect(item.digits).toHaveLength(4);
    for (const d of item.digits) {
      // Rotated-run convention: y is the run's start (bottom), extent is -w.
      const centerTop = (d.y + (d.y - d.w)) / 2;
      const g = item.geo.digits.find((x) => x.text === d.text)!;
      expect(centerTop).toBeCloseTo(item.geo.bottom - g.center * item.geo.mod, 5);
    }
  });

  it("the barcode is the plan's last item", () => {
    const list = planLabel(cfg, m, { assets });
    expect(list[list.length - 1].kind).toBe("barcode");
  });
});
```

Note: the raster test reads `c.collabCenter.scale` from the default config; if the default scale isn't 1, the `w` expectation above already accounts for it. If `defaultConfig()` ships `barcodeStrokeWidth` set, drop that line from the halo test and instead delete the width from the cfg literal.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/plan.test.ts`
Expected: FAIL — `barcodeItem` not exported; raster art finds no item.

- [ ] **Step 3: Write the implementation**

```ts
// plan.ts — add imports:
import { barcodeFootprint, barcodeGeometry, barcodeStrokePt, type BarcodeGeometry } from "./barcode";

/** A raster collab logo's fitted rect. The bytes stay with the backend
 *  (keyed by id); art mode draws the image, mask mode paints the rect
 *  white-ink blue so a full-color logo prints on white ink. */
export interface PlacedImage {
  readonly kind: "image";
  readonly id: ElementId;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The barcode as one item: shared geometry plus everything both plates
 *  paint from. Genuinely mode-asymmetric (art = stroked bars+digits, mask =
 *  the outset footprint), so it stays one item rather than mode-dependent
 *  primitives — the backends keep their paint logic, the geometry exists
 *  once. `digits` follow the rotated-run convention: x is the baseline's
 *  vertical line, y the run's start, extent -w. */
export interface PlacedBarcode {
  readonly kind: "barcode";
  readonly id: "barcode";
  readonly geo: BarcodeGeometry;
  /** Resolved halo width in points; 0 = no halo at all. */
  readonly S: number;
  readonly fill: Fill;
  readonly stroke: Fill | "none";
  readonly fillLayer: Style["layer"];
  readonly strokeLayer: Style["layer"];
  readonly textSize: number;
  readonly digits: readonly { text: string; x: number; y: number; w: number }[];
  /** The white-ink footprint at S = 0 (bars + digit pills); the mask pass
   *  outsets it by S as a border, matching barcodeFootprint's contract. */
  readonly footprint: readonly { x: number; yTop: number; w: number; h: number }[];
}

export type Placed = PlacedText | PlacedPaths | PlacedImage | PlacedBarcode;

/** The barcode's placed item. Exported for the barcode tests, which assert
 *  paint behaviour against a hand-built item. */
export function barcodeItem(cfg: LabelConfig, m: MeasureFace): PlacedBarcode {
  const B = L.BARCODE;
  const measure = (t: string) => m(t, B.textSize, "regular");
  const geo = barcodeGeometry(cfg.upc, measure);
  return {
    kind: "barcode", id: "barcode", geo,
    S: barcodeStrokePt(cfg),
    fill: cfg.barcodeFill, stroke: cfg.barcodeStroke,
    fillLayer: cfg.barcodeLayer, strokeLayer: cfg.barcodeStrokeLayer,
    textSize: B.textSize,
    digits: geo.digits.map((d) => {
      const w = measure(d.text);
      return { text: d.text, x: d.x, y: geo.bottom - d.center * geo.mod + w / 2, w };
    }),
    footprint: barcodeFootprint(geo, 0, measure),
  };
}
```

In `planLabel`, after the QR block:

```ts
  if (A && !skip("barcode")) out.push(barcodeItem(cfg, m));
```

And complete `collabItems`' raster branch (if Task 1 stubbed it):

```ts
  const s = Math.min(maxW / art.w, maxH / art.h);
  const w = art.w * s;
  const h = art.h * s;
  return [{ kind: "image", id, x: place(w), y: top, w, h }];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: green. The digit-placement equivalence to check against the source before trusting it: `pdf/build.ts` draws a digit at PDF-space `y(geo.bottom - d.center * geo.mod) - w/2`; converting to top-origin start-of-run gives `geo.bottom - d.center * geo.mod + w/2`, which is the item's `y`.

- [ ] **Step 5: Commit**

```bash
git add src/plan.ts tests/plan.test.ts
git commit -m "refactor: collab images and the barcode join the display list"
```

---

### Task 3: PDF backend walks the full plan

**Files:**
- Modify: `src/pdf/build.ts`
- Test: existing suite (`tests/pdf-build.test.ts`, `tests/barcode.test.ts`, `tests/tracking.test.ts`, `tests/bleed.test.ts`); update `drawBarcode` call sites in tests to build items via `barcodeItem`.

**Interfaces:**
- Consumes: `planLabel`, `Placed`, `PlacedText`, `PlacedBarcode`, `PlanArt`, `barcodeItem`, `Mode` from `src/plan.ts`.
- Produces: `drawBarcode(page: PDFPage, fonts: Fonts, item: PlacedBarcode, mode: Mode)` — signature change; `Fonts` becomes exported if the tests need it (check `tests/barcode.test.ts`'s imports first). `buildArtPdf`/`buildMaskPdf` unchanged.

- [ ] **Step 1: Rewrite `drawElements` as one plan walk**

```ts
async function drawElements(
  doc: PDFDocument,
  page: PDFPage,
  fonts: Fonts,
  cfg: LabelConfig,
  assets: Assets,
  mode: Mode,
) {
  const faceFont = (f: Face) =>
    f === "bold" ? fonts.bold : f === "semibold" ? fonts.semibold : fonts.regular;
  const pdfMeasure: MeasureFace = (t, size, f) => faceFont(f).widthOfTextAtSize(t, size);

  // Raster collab logos embed first: the plan places by intrinsic pixel
  // size, and the embedded image is what the art pass draws. Keyed by id so
  // the walk below can find its bytes again.
  const embedded = new Map<ElementId, Awaited<ReturnType<typeof doc.embedPng>>>();
  const planArt = async (id: ElementId, img: CollabImage | null | undefined): Promise<PlanArt | null> => {
    if (!img || !cfg.collabEnabled) return null;
    if (img.kind === "svg") return img;
    const emb = img.kind === "png" ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
    embedded.set(id, emb);
    return { kind: "raster", w: emb.width, h: emb.height };
  };

  // The complete label, placed once by plan.ts in draw order — the same
  // list hittest groups its text boxes from — measured with the actual
  // embedded PDFFont widths so the built bytes place text exactly as before.
  const plan = planLabel(cfg, pdfMeasure, {
    skip: assets.hidden,
    assets: {
      logoSvg: assets.logoSvg,
      collabLeft: await planArt("collabLeft", assets.collabLeft),
      collabCenter: await planArt("collabCenter", assets.collabCenter),
    },
  });

  const drawText = (r: PlacedText) => {
    const color = mode === "art" ? fillColor(r.fill) : maskColor(r.layer);
    const stroke = r.stroke
      ? { color: mode === "art" ? fillColor(r.stroke.fill) : maskColor(r.stroke.layer), w: r.stroke.w }
      : null;
    withTracking(page, r.tracking || undefined, () =>
      strokedText(page, stroke, r.text, {
        x: r.x, y: y(r.y), size: r.size, font: faceFont(r.face), color,
        ...(r.rotated ? { rotate: degrees(90) } : {}),
      }));
  };

  for (const r of plan) {
    if (r.kind === "text") drawText(r);
    else if (r.kind === "paths") {
      const color = mode === "art" ? fillColor(r.fill) : maskColor(r.layer);
      const at = { x: r.x, y: y(r.y) };
      // Every stroke path before any fill, so overlapping strokes can't
      // paint over a neighbour's fill (the laurel-branch rule).
      if (r.stroke) {
        const sc = mode === "art" ? fillColor(r.stroke.fill) : maskColor(r.stroke.layer);
        for (const d of r.paths)
          page.drawSvgPath(d, { ...at, color: sc, borderColor: sc, borderWidth: 2 * r.stroke.w });
      }
      for (const d of r.paths) page.drawSvgPath(d, { ...at, color });
    } else if (r.kind === "image") {
      const rect = { x: r.x, y: y(r.y + r.h), width: r.w, height: r.h };
      if (mode === "art") page.drawImage(embedded.get(r.id)!, rect);
      // Raster art prints on white ink: the mask paints its footprint blue.
      else page.drawRectangle({ ...rect, color: toRgb(L.COLORS.maskBlue) });
    } else drawBarcode(page, fonts, r, mode);
  }
}
```

- [ ] **Step 2: Refactor `drawBarcode` onto the item**

Signature: `export function drawBarcode(page: PDFPage, fonts: Fonts, item: PlacedBarcode, mode: Mode)`. Inside:
- `const S = item.S;` replaces `barcodeStrokePt(cfg)`; `const geo = item.geo;` replaces the `barcodeGeometry` call.
- The mask branch's `drawFootprint` iterates `item.footprint` instead of calling `barcodeFootprint(geo, 0, measure)`; layers read `item.fillLayer` / `item.strokeLayer`.
- The digits map becomes `item.digits.map((d) => ({ txt: d.text, x: d.x, y: y(d.y), w: d.w }))` — the plan already did the centring, and `y(d.y)` is exactly the old `y(geo.bottom - d.center * geo.mod) - w/2` (verify once against the pre-change expression).
- Art colors read `item.fill`; the stroke color reads `item.stroke` (only reached when `S > 0`; a `"none"` stroke always resolves S to 0 via `barcodeStrokePt`).
- `glyph.size` reads `item.textSize`.

- [ ] **Step 3: Delete everything the walk replaced**

- The `LEFT` set, both `plan.filter(...)` passes, and the wordmark special slot (order now lives in the plan).
- `drawCollab` entirely; `strokeOf` (its last consumers were `drawCollab` and the logo block); the logo/collabCenter/QR blocks.
- Imports that die with them: `parseLogo`, `logoNudge`, `parseDescription`, `strokeLayerOf`, `qrPath`/`qrShapes`/`qrUrl`, `barcodeFootprint`/`barcodeGeometry`/`barcodeStrokePt`, and the long-dead `WARNING_TEXT`, `displayAbv`, `displayStyle` (keep `displayName` — the doc titles use it). Import `Mode`, `Placed`, `PlacedBarcode`, `PlanArt` from `../plan`; delete the local `type Mode`.
- Update the file-header comment: the walk is now "draw the plan in order", not "one element walk with hand-kept passes".

Before deleting, run `grep -rn "drawCollab\|strokeOf\b" src tests` — anything a test imports keeps its export until that test is ported.

- [ ] **Step 4: Update the barcode tests' call sites**

`grep -n "drawBarcode" tests/*.ts` — each call `drawBarcode(page, fonts, cfg, mode)` becomes:

```ts
import { barcodeItem, type MeasureFace } from "../src/plan";
// with the test's existing fonts in scope:
const mf: MeasureFace = (t, size, f) =>
  (f === "bold" ? fonts.bold : f === "semibold" ? fonts.semibold : fonts.regular)
    .widthOfTextAtSize(t, size);
drawBarcode(page, fonts, barcodeItem(cfg, mf), mode);
```

Assertions stay untouched — a changed assertion means placement drifted; fix `plan.ts`, not the test.

- [ ] **Step 5: Full suite, typecheck, visual sanity**

Run: `npx tsc --noEmit && npx vitest run`
Expected: green.

Then the export-parity check: from a second clean worktree (or the pre-task commit), `npm run generate` into a scratch dir; `npm run generate` here; compare art and mask PDFs at 100% and 400% zoom — laurel edges/stroke, collab slots (if a fixture exercises them), QR rings, barcode halo and digit pills, and the mask plate's footprints must be indistinguishable. Do not use bare `git stash` (worktree rule); the second-worktree route is simpler.

- [ ] **Step 6: Commit**

```bash
git add src/pdf/build.ts tests/
git commit -m "refactor: pdf backend draws the whole label from one plan walk"
```

---

### Task 4: `coverFit`, `loadLabelFaces`, and the canvas backend

**Files:**
- Modify: `src/layout.ts` (add `coverFit`), `src/pdf/build.ts` (delegate `coverPage`), `src/fonts.ts` (add `loadLabelFaces`)
- Create: `src/canvas/draw.ts`
- Test: `tests/canvas-draw.test.ts` (new)

**Interfaces:**
- Consumes: `Placed`, `PlacedText`, `PlacedBarcode`, `Mode` from `src/plan.ts`; `LABEL_FONT_FAMILY` from `src/fonts.ts`; `L.PAGE`, `L.BLEED_SHIFT`, `L.MASK_BLUE_HEX`, `L.coverFit`.
- Produces:
  - `L.coverFit(imgW: number, imgH: number): { x: number; y: number; w: number; h: number }` — centered cover-fit rect over the full page; symmetric, so the same numbers serve both y conventions.
  - `loadLabelFaces(): Promise<MeasureFace>` in `src/fonts.ts` — same FontFace loads as `loadLabelFont`, measuring with the real per-face weights (400/600/700).
  - `interface CanvasAssets { texture?: (CanvasImageSource & { width: number; height: number }) | null; maskImage?: (CanvasImageSource & { width: number; height: number }) | null; collabLeft?: CanvasImageSource | null; collabCenter?: CanvasImageSource | null }`
  - `function drawPlate(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, plan: readonly Placed[], assets: CanvasAssets, mode: Mode): void`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/canvas-draw.test.ts — the canvas backend against a recording fake
// ctx: Node has no 2D canvas, and what parity needs pinned here is the PAINT
// PROTOCOL (order, colors, transforms), not rasterized pixels — the pixel
// side is the parity page's job.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { drawPlate, type CanvasAssets } from "../src/canvas/draw";
import { planLabel, type MeasureFace } from "../src/plan";
import { defaultConfig } from "../src/defaults";
import { MASK_BLUE_HEX, PAGE } from "../src/layout";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const logoSvg = readFileSync(join(__dirname, "..", "src", "assets", "logo2025.svg"), "utf8");
const m: MeasureFace = (t, size) => t.length * size * 0.5;

/** Records every call and property set, in order, so ordering rules
 *  (stroke-before-fill, background-before-elements) are assertable. */
function fakeCtx() {
  const log: { op: string; args: unknown[] }[] = [];
  const target: Record<string, unknown> = { canvas: { width: PAGE.w * 2, height: PAGE.h * 2 } };
  const ctx = new Proxy(target, {
    get(t, p: string) {
      if (p in t) return t[p];
      return (...args: unknown[]) => { log.push({ op: p, args }); };
    },
    set(t, p: string, v) {
      t[p] = v;
      log.push({ op: `set:${p}`, args: [v] });
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}

beforeEach(() => {
  vi.stubGlobal("Path2D", class { constructor(public d?: string) {} });
});

const cfg = defaultConfig();
const plan = () => planLabel(cfg, m, { assets: { logoSvg } });

describe("drawPlate", () => {
  it("mask mode with no mask image floods the plate white-ink blue first", () => {
    const { ctx, log } = fakeCtx();
    drawPlate(ctx, plan(), {}, "mask");
    const rects = log.filter((c) => c.op === "fillRect");
    // White base, then the blue flood, both before any element paints.
    const firstText = log.findIndex((c) => c.op === "fillText");
    const floodIdx = log.findIndex(
      (c, i) => c.op === "set:fillStyle" && c.args[0] === MASK_BLUE_HEX && i < firstText);
    expect(rects.length).toBeGreaterThanOrEqual(2);
    expect(floodIdx).toBeGreaterThan(-1);
  });

  it("art mode draws the texture cover-fit before any element", () => {
    const { ctx, log } = fakeCtx();
    const texture = { width: 100, height: 100 } as unknown as CanvasAssets["texture"];
    drawPlate(ctx, plan(), { texture }, "art");
    const img = log.findIndex((c) => c.op === "drawImage");
    const firstText = log.findIndex((c) => c.op === "fillText");
    expect(img).toBeGreaterThan(-1);
    expect(img).toBeLessThan(firstText);
  });

  it("strokes a stroked text run before filling it", () => {
    const { ctx, log } = fakeCtx();
    // Force a stroke on the volume line so the rule is exercised.
    const stroked = planLabel(
      { ...cfg, volume: { ...cfg.volume, stroke: "#112233" } }, m, { assets: { logoSvg } });
    drawPlate(ctx, stroked, {}, "art");
    const s = log.findIndex((c) => c.op === "strokeText");
    const f = log.findIndex((c) => c.op === "fillText");
    expect(s).toBeGreaterThan(-1);
    expect(s).toBeLessThan(f);
  });

  it("rotates rotated runs a quarter turn counter-clockwise", () => {
    const { ctx, log } = fakeCtx();
    drawPlate(ctx, plan(), {}, "art");
    const rot = log.find((c) => c.op === "rotate");
    expect(rot).toBeDefined();
    expect(rot!.args[0]).toBeCloseTo(-Math.PI / 2);
  });

  it("paints a raster collab rect blue in mask mode, image in art mode", () => {
    const c = { ...cfg, collabEnabled: true };
    const p = planLabel(c, m, {
      assets: { logoSvg, collabCenter: { kind: "raster", w: 10, h: 10 } },
    });
    const art = fakeCtx();
    drawPlate(art.ctx, p, { collabCenter: {} as CanvasImageSource }, "art");
    expect(art.log.filter((x) => x.op === "drawImage").length).toBeGreaterThan(0);
    const mask = fakeCtx();
    drawPlate(mask.ctx, p, {}, "mask");
    // Mask never draws the image itself.
    expect(mask.log.some((x) => x.op === "drawImage")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/canvas-draw.test.ts`
Expected: FAIL — `src/canvas/draw.ts` does not exist.

- [ ] **Step 3: Implement `coverFit`, `loadLabelFaces`, then `draw.ts`**

`src/layout.ts` (near `PAGE`):

```ts
/** Cover-fit an image over the full bleed page, centered — shared by the PDF
 *  builders and the canvas backend. Centered, so the same rect serves both a
 *  top-left and a bottom-left origin: (PAGE.h - h) / 2 is the inset from
 *  either edge. */
export function coverFit(imgW: number, imgH: number) {
  const s = Math.max(PAGE.w / imgW, PAGE.h / imgH);
  const w = imgW * s;
  const h = imgH * s;
  return { x: (PAGE.w - w) / 2, y: (PAGE.h - h) / 2, w, h };
}
```

`src/pdf/build.ts`'s `coverPage` body becomes a delegation (or delete it and inline `const r = L.coverFit(img.width, img.height)` at its two call sites, mapping `{x, y, width: r.w, height: r.h}`).

`src/fonts.ts`:

```ts
/** Face-aware canvas measure for the plan: the same loaded faces, measured
 *  at their true weights (unlike Measure's bold-boolean approximation, which
 *  hit boxes keep for compatibility). The canvas renderer places with THIS,
 *  so what it measures is what it draws. */
export function loadLabelFaces(): Promise<import("./plan").MeasureFace> {
  return loadLabelFont().then(() => {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("Could not create the font measurement canvas.");
    const weight = { regular: 400, semibold: 600, bold: 700 } as const;
    return (text, size, face) => {
      ctx.font = `${weight[face]} ${size}px ${LABEL_FONT_FAMILY}`;
      return ctx.measureText(text).width;
    };
  });
}
```

`src/canvas/draw.ts`:

```ts
// draw.ts — the canvas backend: walks the display list (plan.ts) and paints
// one plate into a 2D context. Same Mode semantics as pdf/build.ts — art
// paints fills over the texture, mask paints knockout white / white-ink blue
// — but no y-flip (canvas and the plan are both top-left origin) and no
// stroke-cavity bridge (real canvas strokes are solid; the bridge exists
// only for pdf.js's path-font renderer). Fonts arrive through the fonts.ts
// gate: callers must have awaited loadLabelFont()/loadLabelFaces() so
// LABEL_FONT_FAMILY resolves — a missing face would silently measure wrong,
// which is exactly what the gate exists to prevent.
import type { Mode, Placed, PlacedBarcode, PlacedText } from "../plan";
import type { Fill, Style } from "../types";
import { LABEL_FONT_FAMILY } from "../fonts";
import * as L from "../layout";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface CanvasAssets {
  /** Art plate background, cover-fitted; absent = bare stock (white). */
  texture?: (CanvasImageSource & { width: number; height: number }) | null;
  /** Uploaded mask, drawn as-authored; absent = flood white-ink blue. */
  maskImage?: (CanvasImageSource & { width: number; height: number }) | null;
  /** Raster collab logos, keyed to the PlacedImage ids. */
  collabLeft?: CanvasImageSource | null;
  collabCenter?: CanvasImageSource | null;
}

const WEIGHT = { regular: 400, semibold: 600, bold: 700 } as const;

/** Art-mode CSS color for a Fill — "none" is no ink, i.e. white, the same
 *  rule as pdf/build.ts's fillColor via parseHexFill. */
const cssFill = (fill: Fill) => (fill === "none" ? "#FFFFFF" : fill);
/** Mask-mode paint: knockout (white) or white-ink (blue). */
const cssMask = (layer: Style["layer"]) =>
  layer === "metallic" ? "#FFFFFF" : L.MASK_BLUE_HEX;

/** Paint one plate from the plan. The canvas's pixel size sets the scale
 *  (width / PAGE.w); the caller sizes it. Backgrounds paint before the
 *  BLEED_SHIFT translate, exactly like shiftForBleed in the PDF: they cover
 *  the page and must not move with the design. */
export function drawPlate(
  ctx: Ctx, plan: readonly Placed[], assets: CanvasAssets, mode: Mode,
): void {
  const scale = ctx.canvas.width / L.PAGE.w;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // Plate background — mirrors buildArtPdf / buildMaskPdf.
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, L.PAGE.w, L.PAGE.h);
  const cover = (img: CanvasImageSource & { width: number; height: number }) => {
    const r = L.coverFit(img.width, img.height);
    ctx.drawImage(img, r.x, r.y, r.w, r.h);
  };
  if (mode === "art") {
    if (assets.texture) cover(assets.texture);
  } else if (assets.maskImage) cover(assets.maskImage);
  else {
    // No mask uploaded: flood white ink ("print as a white label"); metallic
    // elements knock back out on top.
    ctx.fillStyle = L.MASK_BLUE_HEX;
    ctx.fillRect(0, 0, L.PAGE.w, L.PAGE.h);
  }

  ctx.translate(L.BLEED_SHIFT, L.BLEED_SHIFT);

  for (const r of plan) {
    if (r.kind === "text") drawText(ctx, r, mode);
    else if (r.kind === "paths") {
      ctx.save();
      ctx.translate(r.x, r.y);
      const paths = r.paths.map((d) => new Path2D(d));
      // Every stroke path before any fill — the laurel-branch rule.
      if (r.stroke) {
        ctx.strokeStyle = mode === "art" ? cssFill(r.stroke.fill) : cssMask(r.stroke.layer);
        ctx.lineWidth = 2 * r.stroke.w;
        for (const p of paths) { ctx.stroke(p); ctx.fill(p); }
      }
      ctx.fillStyle = mode === "art" ? cssFill(r.fill) : cssMask(r.layer);
      for (const p of paths) ctx.fill(p);
      ctx.restore();
    } else if (r.kind === "image") {
      if (mode === "art") {
        const img = r.id === "collabLeft" ? assets.collabLeft : assets.collabCenter;
        if (img) ctx.drawImage(img, r.x, r.y, r.w, r.h);
      } else {
        // Raster art prints on white ink: the mask paints its footprint blue.
        ctx.fillStyle = L.MASK_BLUE_HEX;
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
    } else drawBarcode(ctx, r, mode);
  }
}
```

Note the stroke pass above: pdf-lib's stroked `drawSvgPath` fills AND strokes each path in one op (`color` + `borderColor`), so the canvas stroke pass does `stroke(p)` then `fill(p)` per path in stroke color, then the fill pass repaints all fills — same layering result.

```ts
function drawText(ctx: Ctx, r: PlacedText, mode: Mode) {
  ctx.font = `${WEIGHT[r.face]} ${r.size}px ${LABEL_FONT_FAMILY}`;
  // Tracking in points: under the pt-scaled transform, user-space px ARE
  // points. Canvas letterSpacing also gaps after the final glyph, but that
  // is advance, not ink — run positions come from the plan, so it cannot
  // shift anything.
  ctx.letterSpacing = `${r.tracking}px`;
  ctx.save();
  ctx.translate(r.x, r.y);
  if (r.rotated) ctx.rotate(-Math.PI / 2); // y-down CCW = PDF's degrees(90)
  if (r.stroke) {
    ctx.strokeStyle = mode === "art" ? cssFill(r.stroke.fill) : cssMask(r.stroke.layer);
    ctx.lineWidth = 2 * r.stroke.w; // outer half is the w-wide stroke; fill covers the inner
    ctx.strokeText(r.text, 0, 0);
  }
  ctx.fillStyle = mode === "art" ? cssFill(r.fill) : cssMask(r.layer);
  ctx.fillText(r.text, 0, 0);
  ctx.restore();
  ctx.letterSpacing = "0px";
}

/** Both plates of the barcode — the same paint logic as pdf/build.ts's
 *  drawBarcode, from the same item. */
function drawBarcode(ctx: Ctx, item: PlacedBarcode, mode: Mode) {
  const digit = (d: { text: string; x: number; y: number }, paint: "fill" | "stroke") => {
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(-Math.PI / 2);
    if (paint === "fill") ctx.fillText(d.text, 0, 0);
    else { ctx.strokeText(d.text, 0, 0); ctx.fillText(d.text, 0, 0); }
    ctx.restore();
  };
  ctx.font = `${WEIGHT.regular} ${item.textSize}px ${LABEL_FONT_FAMILY}`;
  ctx.letterSpacing = "0px";

  if (mode === "mask") {
    // Expanded stroke footprint first, exact fill footprint on top — same
    // plate-independence rule as the PDF's mask branch.
    const paintFootprint = (outset: number, color: string) => {
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * outset;
      for (const f of item.footprint) {
        ctx.fillRect(f.x, f.yTop, f.w, f.h);
        if (outset > 0) ctx.strokeRect(f.x, f.yTop, f.w, f.h);
      }
    };
    if (item.S > 0) paintFootprint(item.S, cssMask(item.strokeLayer));
    if (item.S === 0 || item.strokeLayer !== item.fillLayer)
      paintFootprint(0, cssMask(item.fillLayer));
    return;
  }

  const bars = item.geo.bars;
  if (item.S > 0) {
    const sc = cssFill(item.stroke === "none" ? "none" : item.stroke);
    ctx.fillStyle = sc;
    ctx.strokeStyle = sc;
    ctx.lineWidth = 2 * item.S;
    // EVERY stroke shape before ANY fill — interleaving distorts module
    // widths until the code stops decoding (see pdf/build.ts).
    for (const b of bars) { ctx.fillRect(b.x, b.yTop, b.w, b.h); ctx.strokeRect(b.x, b.yTop, b.w, b.h); }
    for (const d of item.digits) digit(d, "stroke");
  }
  const ink = cssFill(item.fill);
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  for (const b of bars) ctx.fillRect(b.x, b.yTop, b.w, b.h);
  for (const d of item.digits) digit(d, "fill");
}
```

TypeScript note: if the installed `lib.dom` lacks `letterSpacing` on the context type, add it once via a local declaration in draw.ts (`interface Ctx2DLetterSpacing { letterSpacing: string }` and intersect `Ctx`) rather than `as any` per site.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: green, existing suites untouched.

- [ ] **Step 5: Commit**

```bash
git add src/layout.ts src/pdf/build.ts src/fonts.ts src/canvas/draw.ts tests/canvas-draw.test.ts
git commit -m "feat: canvas backend draws both plates from the display list"
```

---

### Task 5: Pixel-parity dev page

**Files:**
- Create: `parity.html` (repo root — Vite serves it in dev; `vite build` only bundles `index.html`, so it never ships)
- Create: `src/dev/parity.ts`
- Modify: `package.json` (add the `parity` script)

**Interfaces:**
- Consumes: `buildArtPdf`, `buildMaskPdf`, `Assets` from `src/pdf/build.ts`; `loadFonts` from `src/pdf/fonts.ts`; `renderPdfPage` from `src/pdf/render.ts`; `planLabel` from `src/plan.ts`; `drawPlate`, `CanvasAssets` from `src/canvas/draw.ts`; `loadLabelFont`, `loadLabelFaces` from `src/fonts.ts`; `defaultConfig` from `src/defaults.ts`; `logo2025.svg?raw`.
- Produces: `npm run parity` opens a page reporting, per config × plate, a pixel-diff percentage with PASS/FAIL and a canvas/PDF/diff side-by-side.

- [ ] **Step 1: The page shell**

```html
<!-- parity.html — DEV-ONLY canvas-vs-PDF pixel parity harness (never built;
     vite build bundles only index.html). Run: npm run parity -->
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Canvas / PDF parity</title></head>
  <body style="font-family: ui-monospace, monospace; background: #1c1c1c; color: #eee; padding: 16px">
    <h1 style="font-size: 16px">Canvas vs PDF parity</h1>
    <div id="report"></div>
    <script type="module" src="/src/dev/parity.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: The harness**

```ts
// parity.ts — DEV-ONLY: renders each fixture config through the canvas
// backend and through the real PDF pipeline (build + pdf.js raster), then
// reports the per-plate pixel difference. Font rasterization differs between
// the two engines, so the threshold is loose by design — the plan-level
// vitest suites carry the strictness; this page exists for compositing and
// geometry drift, which shows up as whole-percent jumps, not fractions.
import { buildArtPdf, buildMaskPdf, type Assets } from "../pdf/build";
import { loadFonts } from "../pdf/fonts";
import { renderPdfPage } from "../pdf/render";
import { planLabel } from "../plan";
import { drawPlate, type CanvasAssets } from "../canvas/draw";
import { loadLabelFont, loadLabelFaces } from "../fonts";
import { defaultConfig } from "../defaults";
import { PAGE } from "../layout";
import type { LabelConfig } from "../types";
import logoSvg from "../assets/logo2025.svg?raw";

const SCALE = 2; // raster px per pt — plenty to see geometry drift
/** Channel delta below which a pixel counts as equal (antialias noise). */
const CHANNEL_TOLERANCE = 24;
/** Max fraction of differing pixels per plate. Tune ONCE after the first
 *  run: set it to ~2x the observed default-config number, then leave it. */
const MAX_DIFF_PCT = 1.5;

/** A deterministic synthetic texture, so the cover-fit and draw-over-art
 *  paths are exercised without a bundled photo. */
function syntheticTexture(): Promise<{ bytes: Uint8Array; bitmap: ImageBitmap }> {
  const c = new OffscreenCanvas(800, 500);
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 800, 500);
  g.addColorStop(0, "#3a3a44");
  g.addColorStop(1, "#14141a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 800, 500);
  return c.convertToBlob({ type: "image/png" }).then(async (blob) => ({
    bytes: new Uint8Array(await blob.arrayBuffer()),
    bitmap: await createImageBitmap(blob),
  }));
}

/** Marker-heavy fixture: inline bold, strokes and tracking on one label. */
function markerConfig(): LabelConfig {
  const cfg = defaultConfig();
  return {
    ...cfg,
    beerName: "Parity Test",
    description: "### HEADER\nA **bold** run and a plain one\nSecond **line** here",
    volume: { ...cfg.volume, stroke: "#112233", strokeWidth: 20 },
    nameStyle: { ...cfg.nameStyle, letterSpacing: 1.2 },
  };
}

function diffPct(a: ImageData, b: ImageData): { pct: number; heat: ImageData } {
  const heat = new ImageData(a.width, a.height);
  let differing = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(
      Math.abs(a.data[i] - b.data[i]),
      Math.abs(a.data[i + 1] - b.data[i + 1]),
      Math.abs(a.data[i + 2] - b.data[i + 2]),
    );
    if (d > CHANNEL_TOLERANCE) {
      differing++;
      heat.data[i] = 255;
      heat.data[i + 3] = 255;
    }
  }
  return { pct: (differing / (a.data.length / 4)) * 100, heat };
}

async function run() {
  const report = document.getElementById("report")!;
  const [fonts, mf, texture] = await Promise.all([
    loadFonts(), loadLabelFaces(), syntheticTexture(),
  ]);
  await loadLabelFont();
  const w = Math.round(PAGE.w * SCALE);
  const h = Math.round(PAGE.h * SCALE);

  for (const [name, cfg] of [["default", defaultConfig()], ["markers", markerConfig()]] as const) {
    const pdfAssets: Assets = { fonts, logoSvg, texture: { bytes: texture.bytes, kind: "png" } };
    const canvasAssets: CanvasAssets = { texture: texture.bitmap };
    const plan = planLabel(cfg, mf, { assets: { logoSvg } });
    for (const mode of ["art", "mask"] as const) {
      const pdfBytes = mode === "art"
        ? await buildArtPdf(cfg, pdfAssets) : await buildMaskPdf(cfg, pdfAssets);
      const pdfCanvas = document.createElement("canvas");
      await renderPdfPage(pdfBytes, { canvas: pdfCanvas, size: { width: w, height: h } });
      const ours = document.createElement("canvas");
      ours.width = w;
      ours.height = h;
      drawPlate(ours.getContext("2d")!, plan, canvasAssets, mode);

      const A = ours.getContext("2d")!.getImageData(0, 0, w, h);
      const B = pdfCanvas.getContext("2d")!.getImageData(0, 0, w, h);
      const { pct, heat } = diffPct(A, B);
      const heatCanvas = document.createElement("canvas");
      heatCanvas.width = w;
      heatCanvas.height = h;
      heatCanvas.getContext("2d")!.putImageData(heat, 0, 0);

      const row = document.createElement("div");
      const ok = pct <= MAX_DIFF_PCT;
      row.innerHTML = `<h2 style="font-size:13px;color:${ok ? "#7c7" : "#f66"}">
        ${name} / ${mode}: ${pct.toFixed(3)}% differing — ${ok ? "PASS" : "FAIL"} (max ${MAX_DIFF_PCT}%)</h2>`;
      for (const [label, c] of [["canvas", ours], ["pdf", pdfCanvas], ["diff", heatCanvas]] as const) {
        c.style.width = "420px";
        c.title = label;
        c.style.marginRight = "8px";
        c.style.background = "#fff";
        row.appendChild(c);
      }
      report.appendChild(row);
    }
  }
}

run().catch((e) => {
  document.getElementById("report")!.textContent = String(e);
});
```

`package.json` scripts: `"parity": "vite --open /parity.html"`.

- [ ] **Step 3: Run it and tune the threshold**

Run: `npm run parity`. Inspect all four rows. Expect sub-percent differences from font rasterization only; geometry or compositing drift reads as clustered red regions in the diff heatmap — fix `draw.ts` (or `plan.ts`) until only glyph-edge speckle remains. Then set `MAX_DIFF_PCT` to roughly 2× the worst observed PASS value and note the observed numbers in the commit message.

Sanity checks worth a deliberate look: the mask plate's flood blue + knockouts, the barcode halo pills, QR finder rings (the ccw hole must punch through), laurel stroke, and the texture cover-fit crop.

- [ ] **Step 4: Full suite still green, then commit**

Run: `npx tsc --noEmit && npx vitest run`

```bash
git add parity.html src/dev/parity.ts package.json
git commit -m "feat: canvas-vs-pdf pixel parity dev page (npm run parity)"
```

---

### Task 6: Dev-only in-app toggle

**Files:**
- Modify: `src/components/PreviewCompare.tsx`, `src/App.tsx`

**Interfaces:**
- Consumes: `drawPlate`, `CanvasAssets` from `src/canvas/draw.ts`; `planLabel`, `PlanAssets`, `MeasureFace` from `src/plan.ts`; `loadLabelFaces` from `src/fonts.ts`.
- Produces: with `localStorage.canvasPreview = "1"` in a dev build, the 2D preview's two canvases paint via `drawPlate` per config change instead of the PDF raster path. Production builds compile the flag away (`import.meta.env.DEV` guard).

- [ ] **Step 1: PreviewCompare gains an optional canvas source**

New prop:

```ts
    /** DEV-ONLY (Phase 2): when set, the preview paints its two canvases
     *  from the canvas backend instead of the PDF raster path — the Phase 3
     *  swap, behind a flag. Everything else (hit-testing, editing, divider)
     *  is source-agnostic and stays as-is. */
    canvasRender?: {
      m: MeasureFace;
      planAssets: PlanAssets;
      drawAssets: CanvasAssets;
      skip: { has(id: ElementId): boolean };
    } | null;
```

In the component, gate the PDF path and add the canvas effect:

```ts
  useRenderPdfs(
    canvasRender ? null : artBytes, canvasRender ? null : maskBytes,
    artCanvas, maskCanvas, rasterScale, onRenderError,
  );

  // DEV canvas path: repaint both plates on every config/asset change, on a
  // rAF so a burst of keystrokes coalesces into one paint per frame.
  useEffect(() => {
    if (!canvasRender) return;
    const raf = requestAnimationFrame(() => {
      const plan = planLabel(cfg, canvasRender.m,
        { skip: canvasRender.skip, assets: canvasRender.planAssets });
      for (const [canvas, mode] of
          [[artCanvas.current, "art"], [maskCanvas.current, "mask"]] as const) {
        if (!canvas) continue;
        const w = Math.round(PAGE.w * rasterScale);
        if (canvas.width !== w) {
          canvas.width = w;
          canvas.height = Math.round(PAGE.h * rasterScale);
        }
        drawPlate(canvas.getContext("2d")!, plan, canvasRender.drawAssets, mode);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [canvasRender, cfg, rasterScale]);
```

- [ ] **Step 2: App builds the dev assets**

In `App.tsx`, module scope:

```ts
/** DEV-ONLY (Phase 2): paint the 2D preview with the canvas backend instead
 *  of the PDF raster path. Set localStorage.canvasPreview = "1" and reload.
 *  Compiled out of production builds; deleted when Phase 3 makes the canvas
 *  path the only path. */
const CANVAS_PREVIEW =
  import.meta.env.DEV && localStorage.getItem("canvasPreview") === "1";
```

Then a dev-only effect that assembles the `canvasRender` prop into state (all `null` when the flag is off, so production pays nothing):

```ts
  const [canvasRender, setCanvasRender] =
    useState<ComponentProps<typeof PreviewCompare>["canvasRender"]>(null);
  useEffect(() => {
    if (!CANVAS_PREVIEW) return;
    let cancelled = false;
    (async () => {
      const m = await loadLabelFaces();
      const bitmap = async (bytes: Uint8Array | undefined) =>
        bytes ? await createImageBitmap(new Blob([bytes as BlobPart])) : null;
      // Reuse the same resolution collabAssets() does, then split each slot
      // into its plan half (svg string / intrinsic size) and draw half (bitmap).
      const { collabLeft: cl, collabCenter: cc } = await collabAssets();
      const slot = async (img: CollabImage | null | undefined) => {
        if (!img) return { art: null, image: null };
        if (img.kind === "svg") return { art: img, image: null };
        const bmp = await createImageBitmap(new Blob([img.bytes as BlobPart]));
        return { art: { kind: "raster" as const, w: bmp.width, h: bmp.height }, image: bmp };
      };
      const [left, center] = await Promise.all([slot(cl), slot(cc)]);
      const eyed = eyedAssets(true);
      const next = {
        m,
        planAssets: { logoSvg, collabLeft: left.art, collabCenter: center.art },
        drawAssets: {
          texture: await bitmap(eyed.texture?.bytes),
          maskImage: await bitmap(eyed.maskPng),
          collabLeft: left.image, collabCenter: center.image,
        },
        skip: /* the same hidden-or-editSession structural set the preview
                 build passes today (see the debounced build effect) */,
      };
      if (!cancelled) setCanvasRender(next);
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [/* the same deps as the debounced preview build effect */]);
```

Executor judgment: read App's existing debounced preview-build effect (`src/App.tsx` around line 960) and reuse its exact `hidden` construction and dependency list — the flag path must skip precisely what the build path skips. Pass `canvasRender={canvasRender}` to `<PreviewCompare>`. Do NOT disable the PDF preview builds when the flag is on — exports and the 3D views still consume them, and the double work is dev-only.

- [ ] **Step 3: Verify by hand**

Run: `npm run dev`, set `localStorage.canvasPreview = "1"`, reload. Check: both plates paint, the divider wipes between them, texture/mask uploads appear, hiding a layer removes it, typing updates the canvas, and clearing the flag restores the PDF raster path. (DOM wiring is untested by design — repo convention.)

- [ ] **Step 4: Suite green, then commit**

Run: `npx tsc --noEmit && npx vitest run`

```bash
git add src/components/PreviewCompare.tsx src/App.tsx
git commit -m "feat: dev-only toggle paints the 2D preview from the canvas backend"
```

---

### Task 7: Version + changelog (release steward)

**Files:**
- Modify: `package.json`, `package-lock.json` (two version fields), `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (the `label-lab` entry), `src-tauri/tauri.conf.json`, `CHANGELOG.md`

- [ ] **Step 1: Bump the synchronized version**

`npm version 0.1.18 --no-git-tag-version` handles the npm pair; edit `Cargo.toml`, the `Cargo.lock` `label-lab` entry, and `tauri.conf.json` by hand to `0.1.18`.

- [ ] **Step 2: Changelog entry**

```markdown
## [0.1.18] - 2026-08-25

- Internal: the shared display list now covers the whole label (laurel, QR,
  collab logos, barcode), and a new canvas renderer draws both plates from
  it — groundwork for the direct-canvas preview, behind a dev-only flag.
  Exports are unchanged; a parity harness (npm run parity) checks the two
  renderers against each other.
```

- [ ] **Step 3: Release check, final validation, commit**

Run: `node scripts/check-release.mjs origin/main` (the lockfile-drift gate — see learnings.md), then `npx tsc --noEmit && npx vitest run` — green.

```bash
git add -A
git commit -m "chore: bump version to 0.1.18 and record the changelog"
```

---

## Self-review notes

- Spec coverage (Phase 2): non-text elements join the plan (Tasks 1–2: logo paths, QR modules, collab image placements, barcode geometry), canvas backend walking the plan for both plates with the PDF's Mode semantics incl. texture/mask compositing (Task 4), pixel-parity script — scripted, not CI-blocking (Task 5), dev-only toggle (Task 6), release steward (Task 7). Texture/mask plate backgrounds deliberately stay outside the plan (they are page paints, pre-BLEED_SHIFT, mirroring buildArt/MaskPdf) — geometry shared via `coverFit`.
- Compositing note: the PDF achieves masking with plain opaque layered draws (knockout = white over blue), so the canvas needs no `globalCompositeOperation` — the spec's mention of it is satisfied by source-over layering that reproduces the identical result; the parity page is the proof.
- Carried-forward Phase 1 items: LEFT seam + wordmark slot deleted (Task 3), dead imports + parseDescription double-parse deleted (Task 3), `at.x!` union + Readonly (Task 1).
- Type consistency: `Placed`/`PlacedPaths` (Task 1) match Task 3/4's consumption; `PlacedImage`/`PlacedBarcode`/`barcodeItem` (Task 2) match Tasks 3–5; `Mode` exported once from plan.ts; `CanvasAssets`/`drawPlate` (Task 4) match Tasks 5–6; `loadLabelFaces` (Task 4) matches Tasks 5–6.
- Executor judgment calls flagged in-line: default config's `qrStroke`/`barcodeStrokeWidth` shipping values (Task 1/2 tests), which test files import `drawBarcode`/`drawCollab` (Task 3), `lib.dom`'s `letterSpacing` typing (Task 4), the parity threshold tuning (Task 5), and App's exact hidden-set/dependency reuse (Task 6).
