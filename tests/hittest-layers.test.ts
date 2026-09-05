// hittest-layers.test.ts — hit boxes and drag targets for v3 layers, from
// the same placement planLayers draws from.
import { describe, expect, it } from "vitest";
import {
  boxOfLayer, boxesForLayers, dragTargetLayers, hitBoxesLayers, hitTestLayers,
} from "../src/hittestLayers";
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

describe("hitBoxesLayers", () => {
  it("one box per drawing layer in draw order, page roles omitted, locked carried", () => {
    const boxes = hitBoxesLayers(layers, m, assets);
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

describe("hitTestLayers", () => {
  it("the topmost box under the point wins; stock is null", () => {
    expect(hitTestLayers(15, 25, layers, m, assets)).toBe("b");
    expect(hitTestLayers(101, 290, layers, m, assets)).toBe("r");
    expect(hitTestLayers(400, 200, layers, m, assets)).toBeNull();
  });
  it("boxesForLayers returns the asked ids in the asked order, dropping ones that draw nothing", () => {
    const empty = image({ id: "e", asset: "", w: 10, x: 0, y: 0 });
    expect(boxesForLayers(["c", "a", "e"], [...layers, empty], m, assets).map((b) => b.id)).toEqual(["c", "a"]);
  });
});

describe("dragTargetLayers", () => {
  it("is null for a locked or unknown layer", () => {
    expect(dragTargetLayers(layers, "b", m, assets)).toBeNull();
    expect(dragTargetLayers(layers, "nope", m, assets)).toBeNull();
  });
  it("moves a free layer's x/y by the delta, whichever edge y names", () => {
    expect(dragTargetLayers(layers, "a", m, assets)!.moved(3, 4)).toEqual({ x: 13, y: 24 });
    expect(dragTargetLayers(layers, "r", m, assets)!.moved(3, 4)).toEqual({ x: 103, y: 304 });
  });
  it("moves a bound layer by editing its gap, keeping the binding", () => {
    const t = dragTargetLayers(layers, "c", m, assets)!;
    expect(t.box.id).toBe("c");
    expect(t.moved(3, 4)).toEqual({ x: 13, y: { below: "a", gap: 9 } });
  });
});

it("hit boxes and drag gaps follow a right-bound neighbor", () => {
  const list = [text({ id: "a", x: 10, y: 20 }), text({ id: "b", x: 0, y: 50, binding: { to: "a", side: "right", gap: 5 } })];
  const target = dragTargetLayers(list, "b", m, assets)!;
  expect(target.box.x).toBe(35);
  expect(target.moved(4, 3)).toEqual({ y: 53, binding: { to: "a", side: "right", gap: 9 } });
});
