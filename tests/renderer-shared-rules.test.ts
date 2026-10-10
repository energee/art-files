// renderer-shared-rules.test.ts — the plate rules the three renderers
// (pdf/build.ts, canvas/draw.ts, psd/build.ts) share instead of each
// spelling them: which plate a page item paints on, and where a barcode
// digit run starts.
import { describe, expect, it } from "vitest";
import { pageDrawsOn, type PlacedPage } from "../src/planLayers";
import { digitStartX } from "../src/plan";

const page = (role: PlacedPage["role"]): PlacedPage =>
  ({ kind: "page", id: role, role, asset: "a", x: 0, y: 0, w: 1, h: 1 });

describe("pageDrawsOn", () => {
  it("draws the background on the art plate only and the mask on the mask plate only", () => {
    expect(pageDrawsOn(page("background"), "art")).toBe(true);
    expect(pageDrawsOn(page("background"), "mask")).toBe(false);
    expect(pageDrawsOn(page("mask"), "mask")).toBe(true);
    expect(pageDrawsOn(page("mask"), "art")).toBe(false);
  });
});

describe("digitStartX", () => {
  const d = { x: 100, w: 20 };
  it("is the baseline x for rotated (template) digits", () => {
    expect(digitStartX(d, true)).toBe(100);
  });
  it("is the run's left edge for upright digits, whose x is the centre", () => {
    expect(digitStartX(d, false)).toBe(90);
  });
});
