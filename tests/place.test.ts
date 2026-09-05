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
