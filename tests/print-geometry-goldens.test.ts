// print-geometry-goldens.test.ts — characterization goldens for two
// print-geometry surfaces: an upright BARCODE layer's plotted geometry (box,
// bar rects, digit baselines, white-ink footprint) and a raster IMAGE
// layer's behaviour on the mask plate when its bytes never loaded.
//
// Deliberately CONCRETE NUMBERS rather than digests. The numbers were first
// pinned at the pre-fix behaviour of the old custom-layer plan, then flipped
// one finding at a time (#8 digit baseline, #11 double-outset footprint,
// #12 missing quiet zone, #13 phantom mask rect), each flip commented with
// its finding number; the master-as-layers switch (planLayers) reproduces
// them except the standard UPC/EAN guard elongation now shared by all barcodes. Any number that moves without such a comment is a
// regression.
//
// Fixture throughout: h = 30, moduleW = 1, anchored top-left at the label
// guides (x = 28.68, y = 28.68), halo strokeWidth 2px -> S = 0.24pt,
// textSize = 30 * 10/15 = 20pt, gap = 30 * 4/15 = 8pt, so the bars span
// y 28.68 -> 58.68 and the reserved digit band y 66.68 -> 86.68 (its bottom,
// 86.68, being the digits' baseline).
import { describe, expect, it } from "vitest";
import { readPsd } from "ag-psd";
import { layerBoxes, planLayers } from "../src/planLayers";
import type { MeasureFace, PlacedBarcode } from "../src/plan";
import type { BarcodeLayer, Layer, Symbology } from "../src/model/layers";
import { buildPsd } from "../src/psd/build";
import { flatLayers, lolevLayers, lolevPlan, logoSvg, psdAssets } from "./fixtures";

// Same deterministic fake metrics the other plan tests use: 0.5pt per char
// per size unit, bold 10% wider.
const m: MeasureFace = (text, size, face) =>
  text.length * size * 0.5 * (face === "regular" ? 1 : 1.1);
const assets = { logoSvg };

const layerFor = (symbology: Symbology, value: string): BarcodeLayer => ({
  id: "bc1", name: "BC", kind: "barcode", enabled: true, x: 28.68, y: 28.68, anchor: "left",
  symbology, value, h: 30, moduleW: 1,
  style: { fill: "#000000", layer: "white", stroke: "#FFFFFF", strokeWidth: 2 },
});

const S = 0.24; // 2px halo at 600dpi
const TEXT_SIZE = 20;
const X0 = 28.68; // guides' left edge — the box's own x
const BAR_TOP = 28.68;
const BAR_BOTTOM = 58.68;

/** Round to 2dp so float noise doesn't make these goldens unreadable; every
 *  fix below moves numbers by whole points, not by 1e-14. */
const r2 = (n: number) => Math.round(n * 100) / 100;
const rect = (b: { x: number; yTop: number; w: number; h: number }) =>
  [r2(b.x), r2(b.yTop), r2(b.w), r2(b.h)];
const box = (layer: BarcodeLayer) => {
  const b = layerBoxes([layer], m, assets).get(layer.id)!;
  return { w: r2(b.w), h: r2(b.h) };
};
const item = (layer: BarcodeLayer) => planLayers([layer], m, assets)[0] as PlacedBarcode | undefined;

describe("upright barcode geometry goldens", () => {
  describe("upc-a 012345678905", () => {
    const layer = layerFor("upc-a", "012345678905");

    it("reports its box as the symbol plus both quiet zones", () => {
      expect(box(layer)).toEqual({ w: 111, h: 58 }); // #12: was 95 — 8 quiet modules each side; 30 bars + 8 gap + 20 text
    });

    it("plots bars, digits and footprint", () => {
      const it = item(layer)!;
      expect(it.S).toBe(S);
      expect(it.textSize).toBe(TEXT_SIZE);
      expect(it.rotated).toBe(false);

      // 30 merged runs. #12 shifts module 0 one quiet zone (8pt) in from the
      // box's left edge; the guards run long into the digit band (48).
      expect(it.geo.bars).toHaveLength(30);
      expect(rect(it.geo.bars[0])).toEqual([36.68, BAR_TOP, 1, 48]);
      expect(rect(it.geo.bars[4])).toEqual([48.68, BAR_TOP, 2, 30]);
      expect(rect(it.geo.bars.at(-1)!)).toEqual([130.68, BAR_TOP, 1, 48]);

      // #8: baseline 86.68, was 66.68 (the band's TOP). #12: every x +8.
      expect(it.digits.map((d) => [d.text, r2(d.x), r2(d.y), r2(d.w)])).toEqual([
        ["0", 33.68, 86.68, 10],
        ["12345", 64.18, 86.68, 50],
        ["67890", 104.18, 86.68, 50],
        ["5", 134.68, 86.68, 10],
      ]);

      // #11: base ink, no pre-applied S — every consumer outsets by S itself.
      expect(it.footprint).toHaveLength(34); // 30 bars + 4 digit pills
      expect(rect(it.footprint[0])).toEqual([36.68, 28.68, 1, 48]);
      expect(it.footprint.slice(30).map(rect)).toEqual([
        [28.68, 65.68, 10, 28],
        [39.18, 65.68, 50, 28],
        [79.18, 65.68, 50, 28],
        [129.68, 65.68, 10, 28],
      ]);
    });

    it("keeps the digits' glyph box clear of the bars (#8)", () => {
      // Was 45.68 — 13pt of overprint on the bottom of the 30pt bars.
      for (const d of item(layer)!.digits)
        expect(r2(d.y - 1.05 * TEXT_SIZE)).toBeGreaterThanOrEqual(BAR_BOTTOM);
    });

    it("keeps the whole footprint inside the reported box (#11/#12)", () => {
      // Was [20.44, 131.92] against a box of [28.68, 123.68] — the footprint
      // was pre-outset by S and the box omitted the edge digits' quiet zones.
      const it = item(layer)!;
      const left = Math.min(...it.footprint.map((f) => r2(f.x)));
      const right = Math.max(...it.footprint.map((f) => r2(f.x + f.w)));
      expect([left, right]).toEqual([28.68, 139.68]);
      expect([X0, r2(X0 + box(layer).w)]).toEqual([28.68, 139.68]);
    });
  });

  describe("ean-13 5901234123457", () => {
    const layer = layerFor("ean-13", "5901234123457");

    it("reports its box as the symbol plus both quiet zones", () => {
      expect(box(layer)).toEqual({ w: 111, h: 58 }); // #12: was 95
    });

    it("plots bars, digits and footprint", () => {
      const it = item(layer)!;
      expect(it.geo.bars).toHaveLength(30);
      expect(rect(it.geo.bars[0]).slice(0, 3)).toEqual([36.68, BAR_TOP, 1]); // #12
      expect(it.digits.map((d) => [d.text, r2(d.x), r2(d.y), r2(d.w)])).toEqual([
        ["5", 33.68, 86.68, 10], // #8 baseline, #12 x
        ["901234", 64.18, 86.68, 60],
        ["123457", 104.18, 86.68, 60],
      ]);
      expect(it.footprint).toHaveLength(33); // 30 bars + 3 pills
      expect(it.footprint.slice(30).map(rect)).toEqual([ // #11 base ink
        [28.68, 65.68, 10, 28],
        [34.18, 65.68, 60, 28],
        [74.18, 65.68, 60, 28],
      ]);
    });
  });

  describe("code-128 LOLEV-123", () => {
    const layer = layerFor("code-128", "LOLEV-123");

    it("reports its box as the bare symbol — #12 must not reach code-128", () => {
      expect(box(layer)).toEqual({ w: 134, h: 58 });
    });

    it("plots bars, digits and footprint", () => {
      const it = item(layer)!;
      expect(it.geo.bars).toHaveLength(37);
      expect(rect(it.geo.bars[0])).toEqual([28.68, BAR_TOP, 2, 30]);
      expect(rect(it.geo.bars.at(-1)!)).toEqual([160.68, BAR_TOP, 2, 30]);
      expect(it.digits.map((d) => [d.text, r2(d.x), r2(d.y), r2(d.w)])).toEqual([
        ["LOLEV-123", 95.68, 86.68, 90], // #8 baseline only — x is unmoved
      ]);
      expect(it.footprint).toHaveLength(38);
      expect(rect(it.footprint[0])).toEqual([28.68, 28.68, 2, 30]); // #11
      expect(it.footprint.slice(37).map(rect)).toEqual([[50.68, 65.68, 90, 28]]);
    });
  });

  it("drops the digit band, its pills and the baseline when showDigits is false", () => {
    const off = { ...layerFor("upc-a", "012345678905"), showDigits: false };
    expect(box(off).h).toBe(30);
    const it = item(off)!;
    expect(it.digits).toEqual([]);
    expect(it.footprint).toHaveLength(it.geo.bars.length);
  });

  it("emits nothing at all for a payload that fails its validator, and holds a zero box", () => {
    const bad = layerFor("upc-a", "nope");
    expect(item(bad)).toBeUndefined();
    expect(box(bad)).toEqual({ w: 0, h: 0 });
  });
});

describe("raster image with unloaded bytes", () => {
  const image: Layer = {
    id: "i2", name: "Unloaded Image", kind: "image", enabled: true, x: 28.68, y: 28.68, anchor: "left",
    w: 100, asset: "missing", style: { fill: "none", layer: "white" },
  };
  const opts = { extra: [image], custom: { missing: { aspect: 1 } } };
  const build = async (mode?: "art" | "mask") => {
    const psd = readPsd(
      Buffer.from(await buildPsd(await lolevPlan(opts), psdAssets, mode, { layers: lolevLayers(opts) })).buffer as ArrayBuffer,
      { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true },
    );
    return flatLayers(psd.children).map((l) => l.name ?? "");
  };

  it("emits no layer on the PSD art plate", async () => {
    expect(await build()).not.toContain("Unloaded Image");
  });

  it("emits no layer on the PSD mask plate either (#13)", async () => {
    // Mask mode used to push the blue footprint rect BEFORE checking the
    // bytes, laying solid white ink under art the art plate never prints. The
    // PDF and canvas backends always skipped the item on either plate.
    expect(await build("mask")).not.toContain("Unloaded Image");
  });
});
