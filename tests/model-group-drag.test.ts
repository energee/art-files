// model-group-drag.test.ts — dragging a MULTI-LAYER selection. Every selected
// layer must travel the same distance as the pointer: the group keeps its
// shape. The case that broke it is a layer bound below another layer in the
// same selection — it moves its own `gap` AND follows the layer it hangs from,
// so it travelled twice as far as the pointer.
import { describe, expect, it } from "vitest";
import { moveBy } from "../src/model/edit";
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
    ? deepMerge(l, moveBy(l, dx, dy, guides, 0, 0, new Set(ids))) as Layer : l));

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
