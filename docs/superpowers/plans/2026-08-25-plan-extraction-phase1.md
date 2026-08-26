# Plan Extraction (Canvas Renderer Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract text placement out of `pdf/build.ts` into a pure, renderer-agnostic display list (`src/plan.ts`) that the PDF backend and `hittest.ts` both consume — behaviour-neutral, no user-visible change.

**Architecture:** `planLabel(cfg, measure, opts)` walks the label's text elements in draw order and emits `PlacedText[]` — one entry per inline run, in label-space points (top-left origin), carrying position, width, face, tracking, fill/layer, and resolved stroke. The PDF backend draws each entry (injecting PDFFont metrics as the measure, so built bytes place text exactly as today); hittest groups entries into boxes (injecting the canvas Measure, as today). Non-text elements (logo, QR, barcode, collab images) keep their current paths — their geometry already lives in shared modules (`logo.ts`, `qr.ts`, `barcode.ts`) and joins the plan in Phase 2 with the canvas backend.

**Tech Stack:** TypeScript, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-25-canvas-preview-renderer-design.md`

## Global Constraints

- Behaviour-neutral: every task ends with `npx tsc --noEmit` clean and `npx vitest run` fully green (228+ tests). Rendered output must be visually identical; PDF byte differences are acceptable only from operator reordering with identical drawn results.
- No new dependencies.
- Follow repo conventions (`.agents/conventions.md`): comment density matches existing files; comments state constraints, not narration.
- Coordinates in `plan.ts` are label-space points, top-left origin — backends convert (the PDF's `y()` flip stays in `pdf/build.ts`).
- All faces resolve through the existing convention: plain text `regular`, marker/flag bold `semibold`, with `bold` only where `pdf/build.ts` explicitly passes `fonts.bold` today.
- Never hardcode "Poppins" — font access goes through `src/fonts.ts` (see the dynamic-fonts constraint).
- Commit messages: conventional prefixes (`refactor:`, `test:`), no co-author lines.

---

### Task 1: `plan.ts` — types and flat/centred line placement

**Files:**
- Create: `src/plan.ts`
- Test: `tests/plan.test.ts`

**Interfaces:**
- Consumes: `L.runAdvances`, `L.DEFAULT_STROKE_PX`, `L.PX` from `src/layout.ts`; `parseRuns` from `src/description.ts`; `strokeLayerOf` from `src/strokes.ts`; types `Fill`, `Style`, `StyledLine` from `src/types.ts`; `ElementId` from `src/elements.ts`.
- Produces (later tasks rely on these exact names):
  - `type Face = "regular" | "semibold" | "bold"`
  - `type MeasureFace = (text: string, size: number, face: Face) => number`
  - `interface PlacedText { id: ElementId; text: string; x: number; y: number; w: number; size: number; face: Face; tracking: number; fill: Fill; layer: Style["layer"]; stroke: StrokeSpec | null; rotated: boolean }`
  - `type StrokeSpec = { fill: Fill; layer: Style["layer"]; w: number }`
  - `function strokeSpec(style: Style): StrokeSpec | null`
  - `function lineRuns(id: ElementId, line: StyledLine, m: MeasureFace, at: { x?: number; cx?: number; baseline: number; size: number; face?: Face }): PlacedText[]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/plan.test.ts
import { describe, expect, it } from "vitest";
import { lineRuns, type MeasureFace } from "../src/plan";

// Deterministic fake metrics: 0.5pt per char per size unit, bold faces 10% wider.
const m: MeasureFace = (text, size, face) =>
  text.length * size * 0.5 * (face === "regular" ? 1 : 1.1);

describe("lineRuns", () => {
  it("places a plain flat line as one regular run at x", () => {
    const runs = lineRuns("volume", { text: "1 PINT", fill: "#C8A951", layer: "metallic" },
      m, { x: 40, baseline: 100, size: 10 });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: "volume", text: "1 PINT", x: 40, y: 100, size: 10,
      face: "regular", tracking: 0, rotated: false,
    });
    expect(runs[0].w).toBeCloseTo(m("1 PINT", 10, "regular"));
  });

  it("centres on cx using the tracked total width", () => {
    const tracking = 2;
    const runs = lineRuns("styleLine", { text: "IPA", fill: "#C8A951", layer: "metallic", letterSpacing: tracking },
      m, { cx: 100, baseline: 50, size: 8 });
    const total = m("IPA", 8, "regular") + tracking * 2; // trackedWidth: (len-1) gaps
    expect(runs[0].x).toBeCloseTo(100 - total / 2);
    expect(runs[0].tracking).toBe(tracking);
  });

  it("splits inline **bold** markers into runs with advancing x", () => {
    const runs = lineRuns("styleLine", { text: "a **b** c", fill: "#C8A951", layer: "metallic" },
      m, { x: 10, baseline: 50, size: 10 });
    expect(runs.map((r) => [r.text, r.face])).toEqual(
      [["a ", "regular"], ["b", "semibold"], [" c", "regular"]]);
    // Each run starts where the previous advance ended.
    expect(runs[1].x).toBeCloseTo(runs[0].x + runs[0].w);
    expect(runs[2].x).toBeCloseTo(runs[1].x + runs[1].w);
  });

  it("a forced face wins over the bold flag, matching drawLine's opts.font", () => {
    const runs = lineRuns("name", { text: "HAZY", fill: "#C8A951", layer: "metallic", bold: true },
      m, { cx: 100, baseline: 50, size: 20, face: "bold" });
    expect(runs[0].face).toBe("bold");
  });
});
```

Note: if `parseRuns`' actual marker split differs on the spaces around `**b**` (e.g. `"a "`/`"b"`/`" c"` vs trimmed variants), adjust the expected strings to what `parseRuns` really returns — the invariant under test is faces and advancing x, not the whitespace convention.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plan.test.ts`
Expected: FAIL — `src/plan.ts` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// plan.ts — the label's display list: WHERE every text run draws, computed
// once, renderer-agnostically. pdf/build.ts and hittest.ts both consume it
// (the canvas backend joins in Phase 2 — see the 2026-08-25 canvas preview
// renderer spec), so placement cannot drift between what is drawn, hit-
// tested, and exported. Coordinates are label-space points with a TOP-LEFT
// origin; backends convert (the PDF's y-flip stays in pdf/build.ts).
// Measurement is injected: the PDF backend passes PDFFont metrics so built
// bytes place text exactly as before, the UI passes the fonts.ts canvas
// metrics — the same split hittest always had.
import type { Fill, Style, StyledLine } from "./types";
import type { ElementId } from "./elements";
import { parseRuns } from "./description";
import { strokeLayerOf } from "./strokes";
import * as L from "./layout";

export type Face = "regular" | "semibold" | "bold";
export type MeasureFace = (text: string, size: number, face: Face) => number;

export type StrokeSpec = { fill: Fill; layer: Style["layer"]; w: number };

export interface PlacedText {
  id: ElementId;
  text: string;
  /** Unrotated: run's left edge / baseline. Rotated (reads bottom-to-top):
   *  x is the baseline's vertical line, y is where the run STARTS, and the
   *  run extends toward smaller y by `w`. */
  x: number;
  y: number;
  /** Drawn width of this run — tracked, without the trailing gap. */
  w: number;
  size: number;
  face: Face;
  tracking: number;
  fill: Fill;
  layer: Style["layer"];
  stroke: StrokeSpec | null;
  rotated: boolean;
}

/** The element's outer stroke as data (width in points). Null when off —
 *  same rules as pdf/build.ts's strokeOf: no stroke, "none", or width <= 0.
 *  Colors stay unresolved: art mode paints `fill`, mask mode paints by
 *  `layer` — that choice belongs to the backend, not the placement. */
export function strokeSpec(style: Style): StrokeSpec | null {
  if (!style.stroke || style.stroke === "none") return null;
  const px = style.strokeWidth ?? L.DEFAULT_STROKE_PX;
  if (px <= 0) return null;
  return { fill: style.stroke, layer: strokeLayerOf(style), w: px * L.PX };
}

/** One styled line as placed runs — drawLine's math without the drawing.
 *  `at.face` (the wordmark/name's forced Bold) wins over the bold flag,
 *  exactly like drawLine's opts.font. */
export function lineRuns(
  id: ElementId,
  line: StyledLine,
  m: MeasureFace,
  at: { x?: number; cx?: number; baseline: number; size: number; face?: Face },
): PlacedText[] {
  const runs = parseRuns(line);
  const faceOf = (r: StyledLine): Face => at.face ?? (r.bold ? "semibold" : "regular");
  const tracking = line.letterSpacing ?? 0;
  const advances = L.runAdvances(runs, (r) => m(r.text, at.size, faceOf(r)), tracking);
  const total = advances.reduce((a, b) => a + b, 0) - tracking;
  let x = at.cx !== undefined ? at.cx - total / 2 : at.x!;
  const stroke = strokeSpec(line);
  return runs.map((run, i) => {
    const placed: PlacedText = {
      id, text: run.text, x, y: at.baseline,
      // The run's drawn width is its advance minus the gap to the next run.
      w: advances[i] - tracking,
      size: at.size, face: faceOf(run), tracking,
      fill: run.fill, layer: run.layer, stroke, rotated: false,
    };
    x += advances[i];
    return placed;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/plan.test.ts` then `npx tsc --noEmit`
Expected: PASS, clean. The `w` computation assumes `runAdvances` gives each run `trackedWidth + tracking` (layout.ts:199-208) so subtracting `tracking` restores the drawn width, and `total` mirrors `runsWidth`'s trailing-gap subtraction (layout.ts:210-213) — verify both against the source before trusting a green run.

- [ ] **Step 5: Commit**

```bash
git add src/plan.ts tests/plan.test.ts
git commit -m "refactor: add plan.ts display-list types and flat line placement"
```

---

### Task 2: Rotated and justified-rotated placement

**Files:**
- Modify: `src/plan.ts` (append)
- Test: `tests/plan.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's `PlacedText`, `MeasureFace`, `strokeSpec`; `L.runAdvances`, `L.runsWidth` from layout; `parseRuns`.
- Produces:
  - `function rotatedRuns(id: ElementId, style: Style, text: string, m: MeasureFace, at: { x: number; yStart: number; size: number; base: Face; boldFace?: Face }): PlacedText[]`
  - `function justifiedRotatedRuns(id: ElementId, style: Style, text: string, m: MeasureFace, at: { x: number; yStart: number; size: number; maxLen: number; base: Face; boldFace?: Face }): PlacedText[]`

- [ ] **Step 1: Write the failing tests**

```ts
// append to tests/plan.test.ts
import { justifiedRotatedRuns, rotatedRuns } from "../src/plan";

describe("rotatedRuns", () => {
  it("advances along -y from yStart, reading bottom-to-top", () => {
    const runs = rotatedRuns("storeCold", { fill: "#C8A951", layer: "metallic" },
      "STORE **COLD**", m, { x: 500, yStart: 300, size: 6, base: "semibold" });
    // No boldFace: **bold** runs keep the base face (drawRotated's contract
    // when its boldFont parameter is omitted, as storeCold's call does).
    expect(runs.map((r) => r.face)).toEqual(["semibold", "semibold"]);
    expect(runs[0]).toMatchObject({ x: 500, y: 300, rotated: true });
    // The second run starts one full advance closer to the label top.
    expect(runs[1].y).toBeCloseTo(300 - runs[0].w);
  });

  it("steps **bold** runs up to boldFace when given", () => {
    const runs = rotatedRuns("handleAddress", { fill: "#C8A951", layer: "metallic" },
      "@LOLEV **BEER**", m, { x: 500, yStart: 300, size: 6, base: "semibold", boldFace: "bold" });
    expect(runs.map((r) => r.face)).toEqual(["semibold", "bold"]);
  });
});

describe("justifiedRotatedRuns", () => {
  it("stretches inter-word gaps so the span is exactly maxLen", () => {
    const runs = justifiedRotatedRuns("warning", { fill: "none", layer: "metallic" },
      "AB CD EF", m, { x: 520, yStart: 300, size: 5, maxLen: 100, base: "regular" });
    expect(runs).toHaveLength(3);
    // First word starts at yStart; the far end of the last word lands at
    // yStart - maxLen exactly.
    expect(runs[0].y).toBe(300);
    const last = runs[runs.length - 1];
    expect(last.y - last.w).toBeCloseTo(300 - 100);
  });

  it("a single word keeps its natural length (no gap to stretch)", () => {
    const runs = justifiedRotatedRuns("warning", { fill: "none", layer: "metallic" },
      "ALCOHOL", m, { x: 520, yStart: 300, size: 5, maxLen: 100, base: "regular" });
    expect(runs).toHaveLength(1);
    expect(runs[0].w).toBeCloseTo(m("ALCOHOL", 5, "regular"));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/plan.test.ts`
Expected: FAIL — `rotatedRuns` not exported.

- [ ] **Step 3: Write the implementation**

```ts
// append to src/plan.ts

/** Rotated 90° CCW text (reads bottom-to-top) as placed runs — drawRotated's
 *  math without the drawing. `boldFace` omitted means inline `**bold**` runs
 *  keep `base` (storeCold's contract); given, they step up (info/warning). */
export function rotatedRuns(
  id: ElementId,
  style: Style,
  text: string,
  m: MeasureFace,
  at: { x: number; yStart: number; size: number; base: Face; boldFace?: Face },
): PlacedText[] {
  const runs = parseRuns({ ...style, text });
  const faceOf = (r: StyledLine): Face => (r.bold ? at.boldFace ?? at.base : at.base);
  const tracking = style.letterSpacing ?? 0;
  const advances = L.runAdvances(runs, (r) => m(r.text, at.size, faceOf(r)), tracking);
  const stroke = strokeSpec(style);
  let yPos = at.yStart;
  return runs.map((run, i) => {
    const placed: PlacedText = {
      id, text: run.text, x: at.x, y: yPos, w: advances[i] - tracking,
      size: at.size, face: faceOf(run), tracking,
      fill: run.fill, layer: run.layer, stroke, rotated: true,
    };
    yPos -= advances[i];
    return placed;
  });
}

/** A justified warning column: inter-word gaps stretched so the span lands
 *  exactly on maxLen — drawJustifiedRotated's math. Word widths measure the
 *  runs each word actually draws (markers stripped, own faces), or a bold-
 *  marked column would overshoot. A single word has no gap and stays at its
 *  natural length (see warningColumnLen). */
export function justifiedRotatedRuns(
  id: ElementId,
  style: Style,
  text: string,
  m: MeasureFace,
  at: { x: number; yStart: number; size: number; maxLen: number; base: Face; boldFace?: Face },
): PlacedText[] {
  const words = text.split(" ");
  if (words.length < 2) return rotatedRuns(id, style, text, m, at);
  const faceOf = (r: StyledLine): Face => (r.bold ? at.boldFace ?? at.base : at.base);
  const widths = words.map((w) =>
    L.runsWidth(parseRuns({ ...style, text: w }),
      (r) => m(r.text, at.size, faceOf(r)), style.letterSpacing ?? 0));
  const totalWordWidth = widths.reduce((a, b) => a + b, 0);
  const gap = (at.maxLen - totalWordWidth) / (words.length - 1);
  let cursor = at.yStart;
  return words.flatMap((w, i) => {
    const placed = rotatedRuns(id, style, w, m, { ...at, yStart: cursor });
    cursor -= widths[i] + gap;
    return placed;
  });
}
```

Note the first rotated test's advance check: `runs[1].y` sits at `300 - advances[0]`, and with zero tracking `advances[0] === runs[0].w` — if the test fails by exactly a tracking-sized gap, the `w`/advance relationship from Task 1 was misread; fix there, not here.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/plan.test.ts && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/plan.ts tests/plan.test.ts
git commit -m "refactor: rotated and justified-rotated placement in plan.ts"
```

---

### Task 3: `planLabel` — the full text walk

**Files:**
- Modify: `src/plan.ts` (append; move new imports into the top import block)
- Test: `tests/plan.test.ts` (append)

**Interfaces:**
- Consumes: Tasks 1–2; `displayAbv`, `displayName`, `displayStyle` from `src/defaults.ts`; `parseDescription`, `parseInfoLine` from `src/description.ts`; `wrapWarning`, `warningMeasure` from `src/warning.ts`; `L.VOLUME/ABV/DESC/DESC_HEADER/COLLAB_LEAD/WORDMARK/NAME/STYLE_LINE/HANDLE_ADDR/WARNING/STORE_COLD/collabLeftFlow` from layout.
- Produces:
  - `interface CollabSlots { left: boolean; center: boolean }` (plan.ts owns it now; Task 5 re-exports from hittest for compatibility)
  - `interface PlanOpts { skip?: { has(id: ElementId): boolean }; collab?: CollabSlots }`
  - `function planLabel(cfg: LabelConfig, m: MeasureFace, opts?: PlanOpts): PlacedText[]`

- [ ] **Step 1: Write the failing tests**

```ts
// append to tests/plan.test.ts
import * as L from "../src/layout";
import { planLabel } from "../src/plan";
import { defaultConfig } from "../src/defaults";

describe("planLabel", () => {
  const cfg = defaultConfig();

  it("emits every text element of a default config, in draw order", () => {
    const ids = [...new Set(planLabel(cfg, m).map((r) => r.id))];
    expect(ids).toEqual([
      "volume", "abv", "description", "wordmark", "name", "styleLine",
      "handleAddress", "warning", "storeCold",
    ]);
  });

  it("skip removes an element without moving its neighbours", () => {
    const all = planLabel(cfg, m);
    const skipped = planLabel(cfg, m, { skip: new Set(["abv" as const]) });
    expect(skipped.some((r) => r.id === "abv")).toBe(false);
    const others = (rs: typeof all) => rs.filter((r) => r.id !== "abv");
    expect(others(skipped)).toEqual(others(all));
  });

  it("the ABV line is the display string, not the raw config field", () => {
    const abv = planLabel(cfg, m).filter((r) => r.id === "abv");
    expect(abv.map((r) => r.text).join("")).toContain("% alc by vol");
  });

  it("name and wordmark are forced to the Bold face and the name is uppercased", () => {
    const c = { ...defaultConfig(), beerName: "hazy" };
    const name = planLabel(c, m).filter((r) => r.id === "name");
    expect(name.every((r) => r.face === "bold")).toBe(true);
    expect(name.map((r) => r.text).join("")).toBe("HAZY");
  });

  it("collabLead appears only with the switch on AND a left slot filled", () => {
    const on = { ...defaultConfig(), collabEnabled: true };
    expect(planLabel(on, m).some((r) => r.id === "collabLead")).toBe(false);
    expect(planLabel(on, m, { collab: { left: true, center: false } })
      .some((r) => r.id === "collabLead")).toBe(true);
  });

  it("every warning column with 2+ words justifies to exactly maxLen", () => {
    const byColumn = new Map<number, { start: number; end: number; words: number }>();
    for (const r of planLabel(cfg, m).filter((r) => r.id === "warning")) {
      const col = byColumn.get(r.x) ?? { start: -Infinity, end: Infinity, words: 0 };
      byColumn.set(r.x, {
        start: Math.max(col.start, r.y), end: Math.min(col.end, r.y - r.w),
        words: col.words + 1,
      });
    }
    expect(byColumn.size).toBeGreaterThan(1);
    for (const col of byColumn.values())
      if (col.words >= 2)
        expect(col.start - col.end).toBeCloseTo(L.WARNING.maxLen, 5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/plan.test.ts`
Expected: FAIL — `planLabel` not exported.

- [ ] **Step 3: Write the implementation**

Mirror `drawElements` (src/pdf/build.ts:452-602) exactly, text elements only. The face choices are copied from its call sites — do not re-derive them:

```ts
// append to src/plan.ts (imports go in the top block)
import type { LabelConfig } from "./types";
import { displayAbv, displayName, displayStyle } from "./defaults";
import { parseDescription, parseInfoLine } from "./description";
import { warningMeasure, wrapWarning } from "./warning";

/** Which collab logo slots hold art — the same fact hittest tracks: the
 *  renderers skip an empty slot, so its text must not be planned either. */
export interface CollabSlots { left: boolean; center: boolean }

export interface PlanOpts {
  /** Elements to omit entirely (the layers-panel eyes, and the in-place
   *  editor's session element from Phase 3 on). Layout is untouched:
   *  skipping never reflows neighbours. */
  skip?: { has(id: ElementId): boolean };
  collab?: CollabSlots;
}

/** Every text run of the label, in drawElements' order. Non-text elements
 *  (logo, QR, barcode, collab images) are not planned yet — Phase 2. */
export function planLabel(cfg: LabelConfig, m: MeasureFace, opts: PlanOpts = {}): PlacedText[] {
  const skip = (id: ElementId) => !!opts.skip?.has(id);
  const out: PlacedText[] = [];

  if (!skip("volume"))
    out.push(...lineRuns("volume", cfg.volume, m,
      { x: L.VOLUME.x, baseline: L.VOLUME.baseline, size: L.VOLUME.size }));
  if (!skip("abv"))
    out.push(...lineRuns("abv", { text: `${displayAbv(cfg)}% alc by vol`, ...cfg.abvStyle }, m,
      { x: L.ABV.x, baseline: L.ABV.baseline, size: L.ABV.size }));

  const desc = parseDescription(cfg.description, cfg.descStyle);
  if (!skip("description")) {
    if (desc.header)
      out.push(...lineRuns("description", desc.header, m,
        { x: L.DESC_HEADER.x, baseline: L.DESC_HEADER.baseline, size: L.DESC_HEADER.size }));
    desc.lines.forEach((line, i) =>
      out.push(...lineRuns("description", line, m,
        { x: L.DESC.x, baseline: L.DESC.firstBaseline + i * L.DESC.leading, size: L.DESC.size })));
  }

  // Lead-in only when there is a left logo for it to introduce — the same
  // gate drawElements applies with assets.collabLeft.
  if (cfg.collabEnabled && opts.collab?.left && !skip("collabLead")) {
    const flow = L.collabLeftFlow(desc.lines.length);
    L.COLLAB_LEAD.lines.forEach((text, i) =>
      out.push(...lineRuns("collabLead", { text, ...cfg.collabLead, bold: true }, m,
        { x: L.COLLAB_LEAD.x, baseline: flow.leadBaselines[i], size: L.COLLAB_LEAD.size })));
  }

  if (!skip("wordmark"))
    out.push(...lineRuns("wordmark", { text: L.WORDMARK.text, ...cfg.wordmark, bold: true }, m,
      { cx: L.WORDMARK.cx, baseline: L.WORDMARK.baseline, size: L.WORDMARK.size, face: "bold" }));
  if (!skip("name"))
    out.push(...lineRuns("name", { text: displayName(cfg).toUpperCase(), ...cfg.nameStyle, bold: true }, m,
      { cx: L.NAME.cx, baseline: L.NAME.baseline, size: L.NAME.size, face: "bold" }));
  if (!skip("styleLine"))
    out.push(...lineRuns("styleLine", { ...cfg.styleLine, text: displayStyle(cfg) }, m,
      { cx: L.STYLE_LINE.cx, baseline: L.STYLE_LINE.baseline, size: L.STYLE_LINE.size }));

  const info = parseInfoLine(cfg.handleAddress.text, cfg.handleAddress);
  if (!skip("handleAddress"))
    out.push(...rotatedRuns("handleAddress", info, info.text, m, {
      x: L.HANDLE_ADDR.x, yStart: L.HANDLE_ADDR.yStart, size: L.HANDLE_ADDR.size,
      base: info.bold ? "bold" : "semibold", boldFace: "bold",
    }));

  // Wrapping measures with the warning's own tracking and inline runs — the
  // exact measure both renderers and hittest wrap with today.
  if (!skip("warning")) {
    const warnLines = wrapWarning(
      warningMeasure((t, bold) => m(t, L.WARNING.size, bold ? "bold" : "regular"),
        cfg.warning.letterSpacing),
      L.WARNING.maxLen,
    );
    warnLines.forEach((line, i) =>
      out.push(...justifiedRotatedRuns("warning", cfg.warning, line, m, {
        x: L.WARNING.x + i * L.WARNING.leading, yStart: L.WARNING.yStart,
        size: L.WARNING.size, maxLen: L.WARNING.maxLen, base: "regular", boldFace: "bold",
      })));
  }

  if (!skip("storeCold"))
    // No boldFace: drawElements passes no boldFont here, so markers keep the
    // line's own face.
    out.push(...rotatedRuns("storeCold", cfg.storeCold, cfg.storeCold.text, m, {
      x: L.STORE_COLD.x, yStart: L.STORE_COLD.yStart, size: L.STORE_COLD.size,
      base: cfg.storeCold.bold ? "bold" : "semibold",
    }));

  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/plan.test.ts && npx tsc --noEmit`
Expected: PASS, clean. If `parseInfoLine`'s return shape has no `bold` field or is not itself a `Style`, mirror exactly how `pdf/build.ts:571-575` reads it. If `warningMeasure`'s callback signature differs from `(text, bold)`, mirror `pdf/build.ts:579-585`.

- [ ] **Step 5: Commit**

```bash
git add src/plan.ts tests/plan.test.ts
git commit -m "refactor: planLabel walks every text element into the display list"
```

---

### Task 4: PDF backend consumes the plan for text

**Files:**
- Modify: `src/pdf/build.ts` (`drawElements`, src/pdf/build.ts:452-602)
- Test: existing suite (`tests/pdf-build.test.ts`, `tests/tracking.test.ts`, `tests/bleed.test.ts`)

**Interfaces:**
- Consumes: `planLabel`, `PlacedText`, `MeasureFace`, `Face` from `src/plan.ts`.
- Produces: no new exports. Before deleting `drawLine`/`drawRotated`/`drawJustifiedRotated`, run `grep -rn "drawJustifiedRotated\|drawRotated\|drawLine" src tests` — any helper a test imports directly keeps its export; port that test's coverage to the plan functions first, then delete the helper.

- [ ] **Step 1: Add the plan-driven text pass**

Inside `drawElements`, build the plan with PDFFont metrics and draw it, deleting the per-element text calls it replaces (volume, abv, description, collabLead, wordmark, name, styleLine, handleAddress, warning, storeCold):

```ts
const faceFont = (f: Face) =>
  f === "bold" ? fonts.bold : f === "semibold" ? fonts.semibold : fonts.regular;
const pdfMeasure: MeasureFace = (t, size, f) => faceFont(f).widthOfTextAtSize(t, size);
const plan = planLabel(cfg, pdfMeasure, {
  skip: assets.hidden,
  collab: { left: !!assets.collabLeft, center: !!assets.collabCenter },
});
const drawPlaced = (r: PlacedText) => {
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
const LEFT: ReadonlySet<ElementId> = new Set(["volume", "abv", "description", "collabLead"]);
plan.filter((r) => LEFT.has(r.id)).forEach(drawPlaced);
```

`drawElements`' final order becomes: plan-left text (the filter above) → collabLeft image block → laurel block (with its stroke pass) → collabCenter block → `plan.filter((r) => !LEFT.has(r.id)).forEach(drawPlaced)` → QR block → barcode block.

Two deliberate paint-order moves versus today, both between non-overlapping elements: the wordmark now draws after the collab-center image instead of before the laurel (they share no pixels — the wordmark sits above the laurel with clear air), and the QR now draws after storeCold instead of before handleAddress (the QR touches nothing in the rotated column). Confirm both non-overlaps visually in Step 3; if anything overlaps, split the plan walk further to restore the exact original order instead.

- [ ] **Step 2: Type-check and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: green. A failure in `tests/pdf-build.test.ts` or `tests/tracking.test.ts` means placement drifted — fix `plan.ts`, never the test, unless the assertion is about operator-stream internals (e.g. one Tc per line instead of per run) rather than placement; those may be updated only with a same-geometry justification in the commit message.

- [ ] **Step 3: Visual sanity check**

Run: `npm run generate` and compare the emitted PDFs against ones generated from the pre-task commit (`git stash push -u -m "plan-task4" && npm run generate` into a scratch dir, then `git stash apply <sha>` — capture the SHA per the worktree stash rules, or simpler: generate from a second clean worktree). Text placement, tracking, strokes, and the mask plate must be indistinguishable at 100% and 400% zoom.

- [ ] **Step 4: Commit**

```bash
git add src/pdf/build.ts src/plan.ts tests/
git commit -m "refactor: pdf backend draws text from planLabel"
```

---

### Task 5: hittest derives text boxes from the plan

**Files:**
- Modify: `src/hittest.ts` (the `flat`/`centred`/`rotated` text-box construction inside `boxesOf`, src/hittest.ts:83-160; logo/QR/barcode/collab-image boxes stay)
- Test: existing `tests/hittest.test.ts`, `tests/selection.test.ts`, `tests/tracking.test.ts`

**Interfaces:**
- Consumes: `planLabel`, `PlacedText`, `MeasureFace`, `CollabSlots` from `src/plan.ts`.
- Produces: `boxesOf`/`boxesFor`/`hitTest` signatures unchanged. `CollabSlots` becomes `export type { CollabSlots } from "./plan"` (delete the local declaration; keep `NO_SLOTS`).

- [ ] **Step 1: Replace the text-box math with plan grouping**

```ts
// in boxesOf — text boxes from the plan, one box per drawn line/column.
// The measure adapter maps faces onto the existing bold-boolean Measure so
// every number matches today's boxes exactly: semibold AND bold both
// measure as the "bold" metrics, the same approximation these boxes
// always made (see the boxesOf doc comment).
const mf: MeasureFace = (t, s, face) => m(t, s, face !== "regular");
const plan = planLabel(cfg, mf, { collab: slots });
const textBoxes: Box[] = [];
const groups = new Map<string, PlacedText[]>();
for (const r of plan) {
  // Unrotated runs of one drawn line share a baseline; rotated runs of one
  // column share their x. Group on that, per element.
  const key = `${r.id}:${r.rotated ? `r${r.x}` : `f${r.y}`}`;
  const g = groups.get(key);
  if (g) g.push(r); else groups.set(key, [r]);
}
for (const runs of groups.values()) {
  const { id, rotated, size } = runs[0];
  textBoxes.push(rotated
    ? {
        id, x0: runs[0].x - ASC * size, x1: runs[0].x + DESC * size,
        y0: Math.min(...runs.map((r) => r.y - r.w)), y1: Math.max(...runs.map((r) => r.y)),
      }
    : {
        id, x0: Math.min(...runs.map((r) => r.x)), x1: Math.max(...runs.map((r) => r.x + r.w)),
        y0: runs[0].y - ASC * size, y1: runs[0].y + DESC * size,
      });
}
```

Then assemble the returned `boxes` array in the same order as today, splicing `textBoxes.filter((b) => b.id === <id>)` where each old `flat`/`centred`/`rotated` call sat, and keeping the logo/QR/barcode/collab-image boxes untouched. Grouping preserves plan order, so a per-id filter keeps line order too. Delete `flat`/`centred`/`rotated`/`width` and the `wrapWarning`/`warningColumnLen`/`warningMeasure` imports if (and only if) nothing else in the file still uses them.

Two equivalences to trust-but-verify via the suite: (a) the plan-derived warning box spans first-word-start to last-word-end — exactly `warningColumnLen`'s value by construction (justified → `maxLen`, single word → natural width); (b) handleAddress/storeCold previously measured with `bold=true` — the adapter maps their semibold/bold faces to `bold=true` identically.

- [ ] **Step 2: Run the suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: green. A hittest failure means the grouping produced different geometry — fix the grouping or the face adapter, not the test.

- [ ] **Step 3: Commit**

```bash
git add src/hittest.ts
git commit -m "refactor: hittest derives text boxes from planLabel"
```

---

### Task 6: Version + changelog (release steward)

**Files:**
- Modify: `package.json`, `package-lock.json` (two version fields), `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (the `label-lab` entry), `src-tauri/tauri.conf.json`, `CHANGELOG.md`

- [ ] **Step 1: Bump the synchronized version**

All six locations move to the next patch (0.1.16 → 0.1.17, or one past whatever is current), exactly like commit `4496b4f`.

- [ ] **Step 2: Changelog entry**

```markdown
## [0.1.17] - 2026-08-25

- Internal: text placement is now computed once (a shared display list)
  and consumed by both the PDF renderer and click-target hit-testing,
  groundwork for the direct-canvas preview. No visual or output changes
  intended.
```

- [ ] **Step 3: Final validation and commit**

Run: `npx tsc --noEmit && npx vitest run` — green.

```bash
git add -A
git commit -m "chore: bump version to 0.1.17 and record the changelog"
```

---

## Self-review notes

- Spec coverage (Phase 1): plan.ts creation (Tasks 1–3), PDF backend consumption (Task 4), hittest derivation (Task 5), plan-level invariant tests (inside Tasks 1–3: centred symmetry, justification-to-maxLen, skip-no-reflow). Shapes/images/codes deliberately deferred to Phase 2 (their geometry already lives in shared modules; the canvas backend that needs them planned arrives then).
- Type consistency: `MeasureFace`, `PlacedText`, `StrokeSpec`, `PlanOpts`, `CollabSlots`, `planLabel`, `lineRuns`, `rotatedRuns`, `justifiedRotatedRuns` carry identical signatures across Tasks 1–5.
- Executor judgment calls flagged in-line, never assumed: `runAdvances`' trailing-gap convention (Task 1 Step 4), `parseRuns`' whitespace split (Task 1 Step 1), `parseInfoLine`/`warningMeasure` shapes (Task 3 Step 4), which build helpers tests import (Task 4 interfaces), and the two paint-order moves (Task 4 Step 1).
