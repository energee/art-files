// place.test.ts — placeLayers: every layer's box from its own x/anchor and a
// y that is either an edge or a `below` binding to another layer's resolved
// bottom. Sizes are faked; nothing here measures text.
import { describe, expect, it } from "vitest";
import { placeLayers } from "../src/model/place";
import type { Layer, TextLayer } from "../src/model/layers";

const STYLE = { fill: "#000000", layer: "metallic" } as const;
const text = (l: Partial<TextLayer> & Pick<Layer, "id" | "x" | "y">): TextLayer => ({
  kind: "text", name: l.id, enabled: true, anchor: "left", lines: [], size: 10,
  align: "left", style: STYLE, ...l,
});
const sizes: Record<string, { w: number; h: number }> = {
  a: { w: 100, h: 20 }, b: { w: 50, h: 30 }, c: { w: 10, h: 5 },
};
const sizeOf = (l: Layer) => sizes[l.id];

describe("placeLayers", () => {
  it("anchors x on the box's left, center or right edge", () => {
    const boxes = placeLayers([
      text({ id: "a", x: 40, y: 0, anchor: "left" }),
      text({ id: "b", x: 40, y: 0, anchor: "center" }),
      text({ id: "c", x: 40, y: 0, anchor: "right" }),
    ], sizeOf);
    expect(boxes.get("a")).toEqual({ x: 40, y: 0, w: 100, h: 20 });
    expect(boxes.get("b")).toEqual({ x: 15, y: 0, w: 50, h: 30 });
    expect(boxes.get("c")).toEqual({ x: 30, y: 0, w: 10, h: 5 });
  });

  it("a numeric y is the top edge, or the bottom edge when vAnchor is bottom", () => {
    const boxes = placeLayers([
      text({ id: "a", x: 0, y: 100 }),
      text({ id: "b", x: 0, y: 100, vAnchor: "bottom" }),
    ], sizeOf);
    expect(boxes.get("a")!.y).toBe(100);
    expect(boxes.get("b")!.y).toBe(70);
  });

  it("chains `below` bindings in dependency order, whatever the array order", () => {
    // c below b below a; declared back to front so a naive single pass
    // would read an unresolved neighbour.
    const boxes = placeLayers([
      text({ id: "c", x: 0, y: { below: "b", gap: 2 } }),
      text({ id: "b", x: 0, y: { below: "a", gap: 5 } }),
      text({ id: "a", x: 0, y: 10 }),
    ], sizeOf);
    expect(boxes.get("a")).toEqual({ x: 0, y: 10, w: 100, h: 20 });
    expect(boxes.get("b")).toEqual({ x: 0, y: 35, w: 50, h: 30 });
    expect(boxes.get("c")).toEqual({ x: 0, y: 67, w: 10, h: 5 });
  });

  it("a taller layer above pushes the whole chain down", () => {
    const layers = [
      text({ id: "a", x: 0, y: 10 }),
      text({ id: "b", x: 0, y: { below: "a", gap: 5 } }),
      text({ id: "c", x: 0, y: { below: "b", gap: 2 } }),
    ];
    const short = placeLayers(layers, sizeOf);
    const tall = placeLayers(layers, (l) => (l.id === "a" ? { w: 100, h: 50 } : sizes[l.id]));
    expect(tall.get("b")!.y - short.get("b")!.y).toBe(30);
    expect(tall.get("c")!.y - short.get("c")!.y).toBe(30);
  });

  it("a bound layer ignores vAnchor: its top follows the layer above", () => {
    const boxes = placeLayers([
      text({ id: "a", x: 0, y: 10 }),
      text({ id: "b", x: 0, y: { below: "a", gap: 0 }, vAnchor: "bottom" }),
    ], sizeOf);
    expect(boxes.get("b")!.y).toBe(30);
  });

  it("throws, naming both ids, when a binding references a layer not in the list", () => {
    expect(() => placeLayers([text({ id: "b", x: 0, y: { below: "a", gap: 0 } })], sizeOf))
      .toThrow(/"b".*"a"/);
  });

  it("guards against a cycle the parser should already have rejected", () => {
    expect(() => placeLayers([
      text({ id: "a", x: 0, y: { below: "b", gap: 0 } }),
      text({ id: "b", x: 0, y: { below: "a", gap: 0 } }),
    ], sizeOf)).toThrow(/cycl/i);
  });
});

it("guide anchors follow margins and keep the bottom fixed as a layer grows", () => {
  const layers = [text({ id: "a", x: 0, y: 3, guideY: "top" }), text({ id: "b", x: 0, y: -4, guideY: "bottom" })];
  const first = placeLayers(layers, sizeOf, { top: 20, bottom: 300 });
  expect(first.get("a")!.y).toBe(23);
  expect(first.get("b")!.y + first.get("b")!.h).toBe(296);
  const grown = placeLayers(layers, () => ({ w: 100, h: 60 }), { top: 30, bottom: 290 });
  expect(grown.get("a")!.y).toBe(33);
  expect(grown.get("b")!.y).toBe(226);
  expect(layers[1].y).toBe(-4);
});

it("middle anchors keep the layer centered between guides as height and margins change", () => {
  const layer = text({ id: "a", x: 0, y: 5, guideY: "middle" });
  const first = placeLayers([layer], sizeOf, { top: 20, bottom: 300 }).get("a")!;
  expect(first.y).toBe(155);
  const grown = placeLayers([layer], () => ({ w: 100, h: 60 }), { top: 40, bottom: 320 }).get("a")!;
  expect(grown.y).toBe(155);
  expect(grown.y + grown.h / 2).toBe(185);
});

it("anchors left/right edges independently of vertical anchors as size and guides change", () => {
  const layers = [
    text({ id: "a", x: 3, y: 2, guideX: "left", guideY: "top" }),
    text({ id: "b", x: -5, y: -4, guideX: "right", guideY: "bottom" }),
  ];
  const first = placeLayers(layers, sizeOf, { top: 20, bottom: 300, left: 30, right: 500 });
  expect(first.get("a")!.x).toBe(33);
  expect(first.get("b")!.x + first.get("b")!.w).toBe(495);
  const resized = placeLayers(layers, () => ({ w: 120, h: 60 }), { top: 20, bottom: 300, left: 40, right: 480 });
  expect(resized.get("a")!.x).toBe(43);
  expect(resized.get("b")).toMatchObject({ x: 355, y: 236, w: 120, h: 60 });
});

it("a center horizontal guide keeps the box centered as it grows", () => {
  const layers = [text({ id: "a", x: 4, y: 0, anchor: "center", guideX: "center", guideY: "top" })];
  const g = { top: 20, bottom: 300, left: 30, center: 265, right: 500 };
  const box = placeLayers(layers, () => ({ w: 100, h: 10 }), g).get("a")!;
  expect(box.x + box.w / 2).toBe(269);
  const grown = placeLayers(layers, () => ({ w: 200, h: 10 }), g).get("a")!;
  expect(grown.x + grown.w / 2).toBe(269);
});

it("binds facing edges on all four sides and follows growing neighbors through chains", () => {
  const a = text({ id: "a", x: 200, y: 200, anchor: "center", vAnchor: "bottom" });
  const sides = ["top", "left", "right", "bottom"] as const;
  const layers = [a, ...sides.map((side) => text({ id: side, x: 10, y: 15, binding: { to: "a", side, gap: 5 } }))];
  const measure = (l: Layer) => l.id === "a" ? { w: 100, h: 40 } : { w: 20, h: 10 };
  const first = placeLayers(layers, measure);
  expect(first.get("top")).toMatchObject({ x: 10, y: 145 });
  expect(first.get("bottom")).toMatchObject({ x: 10, y: 205 });
  expect(first.get("left")).toMatchObject({ x: 125, y: 15 });
  expect(first.get("right")).toMatchObject({ x: 255, y: 15 });
  const grown = placeLayers(layers, (l) => l.id === "a" ? { w: 140, h: 80 } : measure(l));
  expect(grown.get("top")!.y).toBe(105);
  expect(grown.get("left")!.x).toBe(105);
  expect(grown.get("right")!.x).toBe(275);
  expect(grown.get("bottom")!.y).toBe(205);
  const chain = text({ id: "chain", x: 0, y: 0, binding: { to: "right", side: "right", gap: 3 } });
  expect(placeLayers([chain, ...layers], measure).get("chain")!.x).toBe(278);
});
