# Custom Layers, Snap & Lock Implementation Plan (Plan 3 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Custom text and image layers that render everywhere the display list reaches (canvas preview, PDF art+mask, hit-testing), positioned by anchors, draggable on both axes with snap-to-guide, and a `locked` flag that makes any layer inert to dragging.

**Architecture:** `planLabel` (src/plan.ts) is the single display list all backends consume — custom layers become `Placed` items appended there, so preview/PDF/hittest can't drift. A pure anchor/snap module computes X/Y from `{anchor, vAnchor, offsetX, offsetY}` against the safe-area guides. Drag generalizes the existing vertical-only `dragTarget` to two axes for custom layers; snapping to a guide SETS the anchor.

**Tech Stack:** TypeScript, vitest, existing React preview components. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-27-master-variation-design.md` (sections "Lock, snap & guides", "Layer types")

**Plan resequencing:** Design/Fill modes + master library wiring move to Plan 4; compliance is Plan 5; migration + rename Plan 6.

## Global Constraints

- No new npm dependencies. Branch `design/master-variation`.
- After each task: `npx vitest run` green, `npx tsc --noEmit` clean, then commit (sentence-style, no Co-Authored-By).
- Existing output unchanged when `customLayers` is absent/empty: current tests must stay green unmodified.
- `src/types.ts` is the Save/Load schema — additions must be optional so version-1 files stay valid.
- Fonts for custom text go through the existing `Face`/measure machinery — never a hardcoded font name.
- PSD export of custom layers is OUT of this plan (deferred with the QrShapes.squares PSD prerequisite; both land when the PSD builder is touched). PDF art+mask ARE in scope.
- Guides in this plan come from `layout.ts`'s safe-area constants (left/center/right/top/bottom); master-supplied guides wire in Plan 4.

---

### Task 1: Anchor & snap math

**Files:**
- Create: `src/model/position.ts`
- Test: `tests/model-position.test.ts`

**Interfaces:**
- Consumes: nothing (pure; guide values injected).
- Produces:

```ts
export type Anchor = "left" | "center" | "right";
export type VAnchor = "top" | "bottom";
export interface LayerPosition {
  anchor: Anchor; vAnchor: VAnchor;
  offsetX: number; offsetY: number;   // points, from the anchored guide edge
}
export interface GuideLines {          // label-space points, top-left origin
  left: number; center: number; right: number; top: number; bottom: number;
}
export function anchoredX(p: LayerPosition, w: number, g: GuideLines): number;
export function anchoredY(p: LayerPosition, h: number, g: GuideLines): number;
export function positionFromDrag(
  x: number, y: number, w: number, h: number, g: GuideLines, threshold: number,
): { position: LayerPosition; snappedX: Anchor | null; snappedY: VAnchor | null };
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/model-position.test.ts
import { describe, expect, it } from "vitest";
import { anchoredX, anchoredY, positionFromDrag, type GuideLines } from "../src/model/position";

const g: GuideLines = { left: 30, center: 300, right: 570, top: 30, bottom: 330 };
const P = (over = {}) => ({ anchor: "left" as const, vAnchor: "top" as const, offsetX: 0, offsetY: 0, ...over });

describe("anchoredX/Y", () => {
  it("left anchor plants the left edge", () => {
    expect(anchoredX(P(), 100, g)).toBe(30);
    expect(anchoredX(P({ offsetX: 5 }), 100, g)).toBe(35);
  });
  it("center anchor stays centered as width changes", () => {
    expect(anchoredX(P({ anchor: "center" }), 100, g)).toBe(250);
    expect(anchoredX(P({ anchor: "center" }), 200, g)).toBe(200);
  });
  it("right anchor plants the right edge", () => {
    expect(anchoredX(P({ anchor: "right" }), 100, g)).toBe(470);
  });
  it("top and bottom anchors", () => {
    expect(anchoredY(P(), 50, g)).toBe(30);
    expect(anchoredY(P({ vAnchor: "bottom" }), 50, g)).toBe(280);
  });
});

describe("positionFromDrag", () => {
  it("snaps the left edge to the left guide and sets the anchor", () => {
    const r = positionFromDrag(33, 100, 80, 20, g, 6);
    expect(r.snappedX).toBe("left");
    expect(r.position.anchor).toBe("left");
    expect(r.position.offsetX).toBe(0);
    expect(anchoredX(r.position, 80, g)).toBe(30);
  });
  it("snaps the box center to the center guide", () => {
    const r = positionFromDrag(262, 100, 80, 20, g, 6);   // center at 302
    expect(r.snappedX).toBe("center");
    expect(anchoredX(r.position, 80, g)).toBe(260);
  });
  it("snaps the right edge to the right guide", () => {
    const r = positionFromDrag(487, 100, 80, 20, g, 6);   // right edge 567
    expect(r.snappedX).toBe("right");
    expect(anchoredX(r.position, 80, g)).toBe(490);
  });
  it("no snap: keeps the nearest anchor with a real offset, round-trips", () => {
    const r = positionFromDrag(100, 100, 80, 20, g, 6);
    expect(r.snappedX).toBeNull();
    expect(anchoredX(r.position, 80, g)).toBe(100);
    expect(anchoredY(r.position, 20, g)).toBe(100);
  });
  it("vertical snap to bottom sets vAnchor", () => {
    const r = positionFromDrag(100, 308, 80, 20, g, 6);   // bottom edge 328
    expect(r.snappedY).toBe("bottom");
    expect(anchoredY(r.position, 20, g)).toBe(310);
  });
  it("nearest-guide tie-breaking prefers the closer snap", () => {
    const r = positionFromDrag(298 - 40, 100, 80, 20, g, 6); // center 298, 2pt off
    expect(r.snappedX).toBe("center");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/model-position.test.ts` FAILS.

- [ ] **Step 3: Implement**

```ts
// src/model/position.ts — pure anchor & snap math (spec: "Lock, snap &
// guides"). An anchor is the layer's reference edge: content-size changes
// re-align around it, which is what makes a snap survive edits. Snapping a
// drag to a guide SETS the anchor (offset 0); a free drop keeps the nearest
// anchor with the offset that reproduces the dropped spot exactly.
export type Anchor = "left" | "center" | "right";
export type VAnchor = "top" | "bottom";
export interface LayerPosition {
  anchor: Anchor; vAnchor: VAnchor; offsetX: number; offsetY: number;
}
export interface GuideLines {
  left: number; center: number; right: number; top: number; bottom: number;
}

export function anchoredX(p: LayerPosition, w: number, g: GuideLines): number {
  if (p.anchor === "left") return g.left + p.offsetX;
  if (p.anchor === "center") return g.center - w / 2 + p.offsetX;
  return g.right - w + p.offsetX;
}

export function anchoredY(p: LayerPosition, h: number, g: GuideLines): number {
  return p.vAnchor === "top" ? g.top + p.offsetY : g.bottom - h + p.offsetY;
}

export function positionFromDrag(
  x: number, y: number, w: number, h: number, g: GuideLines, threshold: number,
): { position: LayerPosition; snappedX: Anchor | null; snappedY: VAnchor | null } {
  const dx: [Anchor, number][] = [
    ["left", x - g.left], ["center", x + w / 2 - g.center], ["right", x + w - g.right],
  ];
  dx.sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]));
  const [ax, adx] = dx[0];
  const snappedX = Math.abs(adx) <= threshold ? ax : null;

  const dy: [VAnchor, number][] = [["top", y - g.top], ["bottom", y + h - g.bottom]];
  dy.sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]));
  const [ay, ady] = dy[0];
  const snappedY = Math.abs(ady) <= threshold ? ay : null;

  return {
    position: {
      anchor: ax, offsetX: snappedX ? 0 : adx,
      vAnchor: ay, offsetY: snappedY ? 0 : ady,
    },
    snappedX, snappedY,
  };
}
```

- [ ] **Step 4: Run** — file test, then full gate, all green.
- [ ] **Step 5: Commit** — `git add src/model/position.ts tests/model-position.test.ts && git commit -m "Layers: anchor and snap math with snap-sets-anchor semantics"`

---

### Task 2: Custom layer schema

**Files:**
- Modify: `src/types.ts`, `src/elements.ts`
- Test: new `tests/custom-layers.test.ts`

**Interfaces:**
- Consumes: `Style`, `StyledLine` (src/types.ts); `LayerPosition` (src/model/position.ts).
- Produces, in `src/types.ts`:

```ts
export interface CustomLayerBase {
  id: `custom-${string}`;          // unique per layer, e.g. custom-a1b2c3
  name: string;                    // shown in the layers panel
  position: import("./model/position").LayerPosition;
  locked?: boolean;
}
export interface CustomTextLayer extends CustomLayerBase {
  type: "text";
  line: StyledLine;                // one styled line
  size: number;                    // points
}
export interface CustomImageLayer extends CustomLayerBase {
  type: "image";
  /** Asset key into the plan's custom images (wired in Task 3). */
  asset: string;
  /** Box width in points; height follows the image's aspect. */
  w: number;
  style: Style;                    // fill/layer for SVG tint + white-ink behavior
}
export type CustomLayer = CustomTextLayer | CustomImageLayer;
// LabelConfig gains: customLayers?: CustomLayer[];   // absent = none (v1 files)
```

  and in `src/elements.ts`: `ElementId` widens to include `` `custom-${string}` ``. Check every exhaustive switch/record over ElementId still typechecks — add `export const isCustomId = (id: ElementId): id is \`custom-${string}\` => id.startsWith("custom-")` and guard lookups (e.g. `elementById`) with it, giving custom ids a generic descriptor (`hasBold: false`, label from the layer name where reachable). Never weaken ElementId to `string`.

- [ ] **Step 1: Failing test** — in `tests/custom-layers.test.ts`: a `LabelConfig` (from `defaultConfig()`) with one `customLayers` text entry typechecks and survives `JSON.parse(JSON.stringify(cfg))` deep-equal; `isCustomId("custom-x")` true, `isCustomId("logo")` false. Real code, using the shapes above.
- [ ] **Step 2: Run** — FAILS (types missing).
- [ ] **Step 3: Implement** per the interfaces above. Update `src/types.ts`'s header comment (schema now includes optional custom layers; still `{version: 1}` — additive).
- [ ] **Step 4: Full gate green** — watch exhaustive ElementId consumers (`elements.ts`, `hittest.ts`, `presets.ts`, `StyleProperties.tsx`); fix fallout with `isCustomId` guards.
- [ ] **Step 5: Commit** — `"Layers: custom text/image layer schema and widened element ids"`

---

### Task 3: Custom layers in the display list (preview + PDF)

**Files:**
- Modify: `src/plan.ts` (planLabel + PlanAssets); `src/pdf/build.ts` / `src/canvas/draw.ts` ONLY if a Placed kind isn't already handled generically (verify first — both consume `Placed[]`).
- Test: `tests/plan.test.ts` (append), `tests/pdf-build.test.ts` (append one assertion)

**Interfaces:**
- Consumes: `CustomLayer` (types.ts), `anchoredX/anchoredY` (model/position.ts), `lineRuns`, `PlacedText`, `PlacedImage` (plan.ts), `L.SAFE`.
- Produces:
  - `export function labelGuides(): GuideLines` — ONE place (plan.ts or layout.ts, implementer's judgment): left/right/top/bottom from `L.SAFE`, center = `(SAFE.left + SAFE.right) / 2`. Task 4's drag uses the same function.
  - `planLabel` appends custom items AFTER existing ones (drawn on top), for each of `cfg.customLayers ?? []`:
    - text → measure the line's runs with the same advance math `lineRuns` uses to get total width `tw`; then `lineRuns(layer.id, layer.line, m, { x: anchoredX(layer.position, tw, guides), baseline: anchoredY(layer.position, layer.size, guides) + layer.size, size: layer.size })`.
    - image → `{ kind: "image", id: layer.id, x, y, w: layer.w, h: layer.w / aspect }` with aspect from a new optional `PlanAssets` entry `custom?: Record<string, { aspect: number }>`; a layer whose asset key is absent emits NOTHING (collab-art contract).
    - `PlanOpts.skip` applies to custom ids like any other id.
- Tests to append (concrete, matching each file's existing fixture style — read them first):
  - plan.test.ts: custom text layer yields PlacedText with id `custom-t1`, x = anchoredX for the measured width, baseline = top guide + size (vAnchor top, offsets 0); a center-anchored layer re-centers when the measure stub returns a wider width; image layer with aspect 2 gets `h = w / 2`; missing asset emits nothing; **absent/empty customLayers ⇒ plan deep-equals the no-layers plan** (the regression lock).
  - pdf-build.test.ts: a build with one custom text layer succeeds and differs from the no-layer build, asserted in the file's existing pattern (read it; e.g. byte-length inequality or its content checks).

- [ ] Steps: failing tests → FAIL → implement → full gate (regression lock must pass) → commit `"Layers: custom text/image layers render through the shared display list"`

---

### Task 4: Two-axis drag with guide snapping

**Files:**
- Modify: `src/elements.ts` (drag targets), `src/hittest.ts` (custom boxes), `src/components/PreviewCompare.tsx` (drag handler), `src/App.tsx` (drag commit callback — follow the existing offsetY drag wiring)
- Test: `tests/hittest.test.ts` (append), `tests/custom-layers.test.ts` (append)

**Interfaces:**
- Consumes: `positionFromDrag`, `labelGuides` (Tasks 1/3); the existing `dragTarget` contract (elements.ts:285) and PreviewCompare's drag ref (~line 540).
- Produces:
  - `elements.ts`: `export function dragTarget2(cfg, slots, id):`
    `{ kind: "position"; get(): LayerPosition; box(): {w:number,h:number} | null; set(c: LabelConfig, p: LayerPosition): void } |`
    `{ kind: "offsetY"; get(): number; set(c: LabelConfig, v: number): void } | null`
    — unlocked custom layers → `position` form (set writes `layer.position`); logo/collab keep the offsetY form via the existing logic; anything `locked` → null. End state has ONE implementation: either `dragTarget` becomes a thin wrapper over `dragTarget2` or its call sites migrate — no duplicated logic.
  - `hittest.ts`: custom layers get hit boxes (text: measured run box; image: x/y/w/h). If hittest already derives boxes from plan items generically they may Just Work — prove it with a test either way.
  - `PreviewCompare.tsx`: for a `position` target, track both axes; on move compute `positionFromDrag(x, y, w, h, labelGuides(), 6)` and write through the App callback with the SAME undo contract as the vertical drag (one undo step per drag; Escape restores); surface `snappedX/snappedY` to highlight the engaged guide via the existing guide overlay (a highlight prop/class — keep it minimal).
- Tests: dragTarget2 unit tests (locked → null; unlocked custom → position form; set() round-trips through anchoredX/Y); hittest test hitting a custom text layer at its box center and missing outside. NO DOM drag simulation — the pointer flow is exercised manually.

- [ ] Steps: failing tests → FAIL → implement → full gate → commit `"Layers: two-axis drag with snap-to-guide for custom layers"`

---

### Task 5: Lock flag on built-in draggables

**Files:**
- Modify: `src/types.ts` (`Positioned` gains `locked?: boolean`), `src/elements.ts` (drag targets respect it), `src/components/StyleProperties.tsx` (Lock toggle for elements with a drag target — follow the panel's existing switch pattern)
- Test: `tests/custom-layers.test.ts` (append)

**Interfaces:**
- Consumes: Task 4's `dragTarget2`.
- Produces: `logo`/`collabLeft` with `locked: true` → null drag target; properties panel shows Lock on draggable elements; absent = unlocked (v1 files unaffected).
- Tests: `dragTarget2` on a config with `logo.locked = true` (collab on) returns null; without the flag returns the offsetY form.

- [ ] Steps: failing test → FAIL → implement → full gate → commit `"Layers: lock flag makes any draggable layer inert"`

---

## Done means

A `.label` config can carry custom text and image layers that draw in the
2D preview and both PDF plates, hit-test, drag on both axes, snap to the
five safe-area guides (snap sets the anchor so alignment survives content
changes), and honor `locked` — including on the laurel and collab slots.
Absent `customLayers`, every existing output is provably unchanged. PSD
export of custom layers + the QrShapes.squares PSD gap remain the recorded
prerequisite for the plan that next touches psd/build.ts. Version bump at
push time.
