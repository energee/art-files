// model-group-drag.test.ts — dragging a MULTI-LAYER selection. Every selected
// layer must travel the same distance as the pointer: the group keeps its
// shape. The case that broke it is a layer bound below another layer in the
// same selection — it moves its own `gap` AND follows the layer it hangs from,
// so it travelled twice as far as the pointer.
import { describe, expect, it } from "vitest";
import { moveBy, snappedDx } from "../src/model/edit";
import { layerBoxes } from "../src/planLayers";
import type { Layer, TextLayer, TextLine } from "../src/model/layers";
import type { MeasureFace } from "../src/plan";
import { deepMerge } from "../src/model/merge";

const m: MeasureFace = (text, size) => text.length * size * 0.5;
const GOLD_METAL = { fill: "#F3CD80", layer: "metallic" } as const;
const line = (text: string): TextLine => ({ text, ...GOLD_METAL });
const text = (l: Partial<TextLayer> & Pick<Layer, "id" | "x" | "y">): TextLayer => ({
  kind: "text", name: l.id, enabled: true, anchor: "left", lines: [line("ABCD")], size: 10,
  align: "left", style: GOLD_METAL, ...l,
});
const assets = { logoSvg: "<svg viewBox='0 0 1 1'></svg>", custom: {} };
const guides = { left: 0, center: 100, right: 200, top: 0, bottom: 400 };

/** The whole selection dragged by (dx, dy), the way App's onDrag does it:
 *  every patch computed against the layers AS THEY WERE at the drag's start. */
const dragged = (layers: Layer[], ids: string[], dx: number, dy: number): Layer[] =>
  layers.map((l) => (ids.includes(l.id)
    ? deepMerge(l, moveBy(l, dx, dy, new Set(ids))) as Layer : l));

const tops = (layers: Layer[]) => {
  const boxes = layerBoxes(layers, m, assets);
  return Object.fromEntries(layers.map((l) => [l.id, boxes.get(l.id)!.y]));
};

describe("dragging a selection", () => {
  const layers: Layer[] = [
    text({ id: "a", x: 10, y: 20 }),
    text({ id: "b", x: 10, y: { below: "a", gap: 5 } }),
    text({ id: "free", x: 10, y: 200 }),
  ];

  it("moves a bound layer exactly as far as the layer it hangs from", () => {
    const before = tops(layers);
    const after = tops(dragged(layers, ["a", "b"], 0, 12));
    expect(after.a - before.a).toBe(12);
    expect(after.b - before.b).toBe(12);
  });

  it("moves two unrelated layers in step", () => {
    const before = tops(layers);
    const after = tops(dragged(layers, ["a", "free"], 0, 12));
    expect(after.a - before.a).toBe(12);
    expect(after.free - before.free).toBe(12);
  });

  it("still moves a bound layer dragged on its own", () => {
    const before = tops(layers);
    const after = tops(dragged(layers, ["b"], 0, 12));
    expect(after.b - before.b).toBe(12);
    expect(after.a).toBe(before.a);
  });
});

// The pointer snaps to the master's guides, and in a GROUP drag that snap has
// to move the whole selection or nothing: applying it to the grabbed layer
// alone re-spaces the group by up to `snap` every time it crosses a guide,
// which is what "the X axis is all over the place" looks like.
describe("snapping a group", () => {
  const grabbed = text({ id: "g", x: 60, y: 20 });      // 20 wide, left-anchored
  const follower = text({ id: "f", x: 150, y: 60 });
  const layers: Layer[] = [grabbed, follower];
  const lefts = (ls: Layer[]) => {
    const boxes = layerBoxes(ls, m, assets);
    return { g: boxes.get("g")!.x, f: boxes.get("f")!.x };
  };

  it("centres one dragged layer on the guide", () => {
    // A 26pt drag puts the box's centre at 96, 4 short of the centre guide at
    // 100 — inside the 6pt threshold, so the drag really travels 30.
    expect(snappedDx({ x: 60, w: 20 }, 26, guides, 6)).toBe(30);
  });

  it("centres the SELECTION's bounds, not the layer that happens to be grabbed", () => {
    // Grabbed 20 wide at 60, follower 20 wide at 150: the group spans 60..170,
    // centre 115. Bringing that centre to the guide at 100 is a 15pt drag left
    // — a snap the grabbed layer's own box (centre 70) would never ask for.
    const group = { x: 60, w: 110 };
    expect(snappedDx(group, -12, guides, 6)).toBe(-15);
    const after = lefts(layers.map((l) =>
      deepMerge(l, moveBy(l, -15, 0)) as Layer));
    expect(after.g).toBe(45);
    expect(after.f).toBe(135);
    expect((after.g + after.f + 20) / 2).toBe(guides.center); // group centred
  });

  it("is the raw delta when nothing is in range", () => {
    expect(snappedDx({ x: 60, w: 20 }, 40, guides, 6)).toBe(40);
  });
});
