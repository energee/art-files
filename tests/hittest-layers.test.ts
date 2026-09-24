// hittest-layers.test.ts — hit boxes and hit tests for v3 layers, from
// the same placement planLayers draws from.
import { describe, expect, it } from "vitest";
import { hitBoxesFromLayout, hitTestBoxes } from "../src/hittestLayers";
import { layerBoxes } from "../src/planLayers";
import { boxOfLayer } from "./fixtures";
import type { ImageLayer, Layer, TextLayer, TextLine } from "../src/model/layers";
import type { MeasureFace } from "../src/plan";
import * as L from "../src/layout";

const m: MeasureFace = (text, size, face) =>
  text.length * size * (face === "regular" ? 0.5 : face === "semibold" ? 0.55 : 0.6);
const GOLD_METAL = { fill: "#F3CD80", layer: "metallic" } as const;
const line = (text: string): TextLine => ({ text, ...GOLD_METAL });
const text = (l: Partial<TextLayer> & Pick<Layer, "id" | "x" | "y">): TextLayer => ({
  kind: "text", name: l.id, enabled: true, anchor: "left", lines: [line("ABCD")], size: 10,
  align: "left", style: GOLD_METAL, ...l,
});
const image = (l: Partial<ImageLayer> & Pick<Layer, "id" | "x" | "y"> & Pick<ImageLayer, "asset" | "w">): ImageLayer => ({
  kind: "image", name: l.id, enabled: true, anchor: "left", style: GOLD_METAL, ...l,
});
const LOGO_SVG = '<svg viewBox="0 0 480 525"><path d="M0 0 L480 0 L240 525 Z"/></svg>';
const assets = { logoSvg: LOGO_SVG, custom: { tex: { aspect: 2 } } };

const layers: Layer[] = [
  image({ id: "background", role: "background", asset: "tex", fit: "cover", w: L.PAGE.w, h: L.PAGE.h, x: 0, y: 0, locked: true }),
  text({ id: "a", x: 10, y: 20 }),
  text({ id: "b", x: 10, y: 20, locked: true }),
  text({ id: "r", x: 100, y: 300, vAnchor: "bottom", rotation: 90 }),
  text({ id: "c", x: 10, y: { below: "a", gap: 5 } }),
];

describe("hitBoxesFromLayout", () => {
  it("one box per drawing layer in draw order, page roles omitted, locked carried", () => {
    const boxes = hitBoxesFromLayout(layers, layerBoxes(layers, m, assets));
    expect(boxes.map((b) => [b.id, b.locked])).toEqual([["a", false], ["b", true], ["r", false], ["c", false]]);
    expect(boxes[0]).toEqual({ id: "a", x: 10, y: 20, w: 20, h: (L.FONT_ASC + L.FONT_DESC) * 10, locked: false });
  });

  it("a rotated column's box spans ascender to descender across, run length along", () => {
    const r = boxOfLayer("r", layers, m, assets)!;
    expect(r).toEqual({ id: "r", x: 100, y: 280, w: (L.FONT_ASC + L.FONT_DESC) * 10, h: 20, locked: false });
  });

  it("applies the bleed shift like hittest.ts, so boxes land on the shifted art", () => {
    L.setBleed(L.SHIPPED_BLEED_IN + 10 / 72);
    try {
      expect(boxOfLayer("a", layers, m, assets)).toMatchObject({ x: 20, y: 30 });
    } finally { L.setBleed(L.SHIPPED_BLEED_IN); }
    expect(boxOfLayer("a", layers, m, assets)).toMatchObject({ x: 10, y: 20 });
  });
});

describe("hitTestBoxes", () => {
  it("the topmost box under the point wins; stock is null", () => {
    const boxes = hitBoxesFromLayout(layers, layerBoxes(layers, m, assets));
    expect(hitTestBoxes(15, 25, boxes)).toBe("b");
    expect(hitTestBoxes(101, 290, boxes)).toBe("r");
    expect(hitTestBoxes(400, 200, boxes)).toBeNull();
  });
});

describe("empty text layers (#116)", () => {
  const empty = (id: string, extra: Partial<TextLayer> = {}) =>
    text({ id, x: 100, y: 50, lines: [line("")], ...extra });
  const H = (L.FONT_ASC + L.FONT_DESC) * 10;

  it("gets a square hit box grown from its anchor point the way its text grows (per align)", () => {
    // Anchor and align deliberately disagree: the box is zero-width at x
    // whatever the anchor, and the in-place editor finds x back from the box
    // through `align`, so the padding must follow align to keep it put.
    const ls = [empty("l", { anchor: "right" }), empty("c", { align: "center" }), empty("r", { align: "right" })];
    const boxes = hitBoxesFromLayout(ls, layerBoxes(ls, m, assets));
    expect(boxes).toEqual([
      { id: "l", x: 100, y: 50, w: H, h: H, locked: false },
      { id: "c", x: 100 - H / 2, y: 50, w: H, h: H, locked: false },
      { id: "r", x: 100 - H, y: 50, w: H, h: H, locked: false },
    ]);
    expect(hitTestBoxes(100 + H * 0.75, 50 + H / 2, boxes)).toBe("l"); // right of c's half
  });

  it("a rotated empty column pads up its run, keeping the bottom edge the editor starts from", () => {
    const ls = [empty("t", { rotation: 90 }), empty("b", { rotation: 90, vAnchor: "bottom" })];
    expect(hitBoxesFromLayout(ls, layerBoxes(ls, m, assets))).toEqual([
      { id: "t", x: 100, y: 50 - H, w: H, h: H, locked: false },
      { id: "b", x: 100, y: 50 - H, w: H, h: H, locked: false },
    ]);
  });

  it("the padding is hit-testing only: the layout box stays zero-width", () => {
    const ls = [empty("l")];
    expect(layerBoxes(ls, m, assets).get("l")).toMatchObject({ w: 0 });
  });
});
