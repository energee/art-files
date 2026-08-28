// print-geometry-goldens.test.ts — characterization goldens for the two
// print-geometry surfaces that had no coverage at all: a CUSTOM barcode
// layer's plotted geometry (box, bar rects, digit baselines, white-ink
// footprint) and a CUSTOM raster image layer's behaviour on the mask plate
// when its bytes never loaded.
//
// Deliberately CONCRETE NUMBERS rather than digests. The numbers here were
// first pinned at the pre-fix behaviour, then flipped one finding at a time
// (#8 digit baseline, #11 double-outset footprint, #12 missing quiet zone,
// #13 phantom mask rect), each flip commented with its finding number. Any
// number that moves without such a comment is a regression.
//
// Fixture throughout: h = 30, moduleW = 1, anchored top-left at the label
// guides (x = 28.68, y = 28.68), halo strokeWidth 2px -> S = 0.24pt,
// textSize = 30 * 10/15 = 20pt, gap = 30 * 4/15 = 8pt, so the bars span
// y 28.68 -> 58.68 and the reserved digit band y 66.68 -> 86.68 (its bottom,
// 86.68, being the digits' baseline).
import { describe, expect, it } from "vitest";
import { readPsd } from "ag-psd";
import {
  customBarcodeBox, customBarcodeItem, labelGuides, type MeasureFace,
} from "../src/plan";
import { dragTarget2 } from "../src/elements";
import { buildPsd } from "../src/psd/build";
import { defaultConfig } from "../src/defaults";
import { psdAssets } from "./fixtures";
import type { CustomBarcodeLayer, CustomImageLayer } from "../src/types";
import type { Symbology } from "../src/barcode";

// Same deterministic fake metrics the other plan tests use: 0.5pt per char
// per size unit, bold 10% wider.
const m: MeasureFace = (text, size, face) =>
  text.length * size * 0.5 * (face === "regular" ? 1 : 1.1);

const position = { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 } as const;

const layerFor = (symbology: Symbology, value: string): CustomBarcodeLayer => ({
  id: "custom-bc1", name: "BC", type: "barcode", symbology, value,
  h: 30, moduleW: 1, position,
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
const dragBox = (layer: CustomBarcodeLayer) => {
  const cfg = defaultConfig();
  cfg.customLayers = [layer];
  const t = dragTarget2(cfg, { left: false, center: false }, layer.id, m)!;
  expect(t.kind).toBe("position");
  return (t as { box(): { w: number; h: number } | null }).box();
};

describe("custom barcode geometry goldens", () => {
  describe("upc-a 012345678905", () => {
    const layer = layerFor("upc-a", "012345678905");

    it("reports its box as the symbol plus both quiet zones", () => {
      const box = customBarcodeBox(layer)!;
      expect(box.pattern.modules.length).toBe(95);
      expect(box.w).toBe(111); // #12: was 95 — 8 quiet modules each side
      expect(box.h).toBe(58); // 30 bars + 8 gap + 20 text
    });

    it("gives elements.ts's drag box the same size", () => {
      expect(dragBox(layer)).toEqual({ w: 111, h: 58 }); // #12: was 95
    });

    it("plots bars, digits and footprint", () => {
      const item = customBarcodeItem(layer, m, labelGuides())!;
      expect(item.S).toBe(S);
      expect(item.textSize).toBe(TEXT_SIZE);
      expect(item.rotated).toBe(false);

      // 30 merged runs, each 30pt tall. #12 shifts module 0 one quiet zone
      // (8pt) in from the box's left edge.
      expect(item.geo.bars).toHaveLength(30);
      expect(rect(item.geo.bars[0])).toEqual([36.68, BAR_TOP, 1, 30]);
      expect(rect(item.geo.bars.at(-1)!)).toEqual([130.68, BAR_TOP, 1, 30]);

      // #8: baseline 86.68, was 66.68 (the band's TOP). #12: every x +8.
      expect(item.digits.map((d) => [d.text, r2(d.x), r2(d.y), r2(d.w)])).toEqual([
        ["0", 33.68, 86.68, 10],
        ["12345", 64.18, 86.68, 50],
        ["67890", 104.18, 86.68, 50],
        ["5", 134.68, 86.68, 10],
      ]);

      // #11: base ink, no pre-applied S — every consumer outsets by S itself.
      expect(item.footprint).toHaveLength(34); // 30 bars + 4 digit pills
      expect(rect(item.footprint[0])).toEqual([36.68, 28.68, 1, 30]);
      expect(rect(item.footprint[29])).toEqual([130.68, 28.68, 1, 30]);
      expect(item.footprint.slice(30).map(rect)).toEqual([
        [28.68, 65.68, 10, 28],
        [39.18, 65.68, 50, 28],
        [79.18, 65.68, 50, 28],
        [129.68, 65.68, 10, 28],
      ]);
    });

    it("keeps the digits' glyph box clear of the bars (#8)", () => {
      // Was 45.68 — 13pt of overprint on the bottom of the 30pt bars.
      const item = customBarcodeItem(layer, m, labelGuides())!;
      for (const d of item.digits)
        expect(r2(d.y - 1.05 * TEXT_SIZE)).toBeGreaterThanOrEqual(BAR_BOTTOM);
    });

    it("keeps the whole footprint inside the reported box (#11/#12)", () => {
      // Was [20.44, 131.92] against a box of [28.68, 123.68] — the footprint
      // was pre-outset by S and the box omitted the edge digits' quiet zones.
      const box = customBarcodeBox(layer)!;
      const item = customBarcodeItem(layer, m, labelGuides())!;
      const left = Math.min(...item.footprint.map((f) => r2(f.x)));
      const right = Math.max(...item.footprint.map((f) => r2(f.x + f.w)));
      expect([left, right]).toEqual([28.68, 139.68]);
      expect([X0, r2(X0 + box.w)]).toEqual([28.68, 139.68]);
    });
  });

  describe("ean-13 5901234123457", () => {
    const layer = layerFor("ean-13", "5901234123457");

    it("reports its box as the symbol plus both quiet zones", () => {
      const box = customBarcodeBox(layer)!;
      expect(box.pattern.modules.length).toBe(95);
      expect(box.w).toBe(111); // #12: was 95
      expect(box.h).toBe(58);
      expect(dragBox(layer)).toEqual({ w: 111, h: 58 }); // #12: was 95
    });

    it("plots bars, digits and footprint", () => {
      const item = customBarcodeItem(layer, m, labelGuides())!;
      expect(item.geo.bars).toHaveLength(30);
      expect(rect(item.geo.bars[0])).toEqual([36.68, BAR_TOP, 1, 30]); // #12
      expect(item.digits.map((d) => [d.text, r2(d.x), r2(d.y), r2(d.w)])).toEqual([
        ["5", 33.68, 86.68, 10], // #8 baseline, #12 x
        ["901234", 64.18, 86.68, 60],
        ["123457", 104.18, 86.68, 60],
      ]);
      expect(item.footprint).toHaveLength(33); // 30 bars + 3 pills
      expect(item.footprint.slice(30).map(rect)).toEqual([ // #11 base ink
        [28.68, 65.68, 10, 28],
        [34.18, 65.68, 60, 28],
        [74.18, 65.68, 60, 28],
      ]);
    });
  });

  describe("code-128 LOLEV-123", () => {
    const layer = layerFor("code-128", "LOLEV-123");

    it("reports its box as the bare symbol — #12 must not reach code-128", () => {
      const box = customBarcodeBox(layer)!;
      expect(box.pattern.modules.length).toBe(134);
      expect(box.w).toBe(134);
      expect(box.h).toBe(58);
      expect(dragBox(layer)).toEqual({ w: 134, h: 58 });
    });

    it("plots bars, digits and footprint", () => {
      const item = customBarcodeItem(layer, m, labelGuides())!;
      expect(item.geo.bars).toHaveLength(37);
      expect(rect(item.geo.bars[0])).toEqual([28.68, BAR_TOP, 2, 30]);
      expect(rect(item.geo.bars.at(-1)!)).toEqual([160.68, BAR_TOP, 2, 30]);
      expect(item.digits.map((d) => [d.text, r2(d.x), r2(d.y), r2(d.w)])).toEqual([
        ["LOLEV-123", 95.68, 86.68, 90], // #8 baseline only — x is unmoved
      ]);
      expect(item.footprint).toHaveLength(38);
      expect(rect(item.footprint[0])).toEqual([28.68, 28.68, 2, 30]); // #11
      expect(item.footprint.slice(37).map(rect)).toEqual([
        [50.68, 65.68, 90, 28],
      ]);
    });
  });

  it("drops the digit band, its pills and the baseline when showDigits is false", () => {
    const off = { ...layerFor("upc-a", "012345678905"), showDigits: false };
    expect(customBarcodeBox(off)!.h).toBe(30);
    const item = customBarcodeItem(off, m, labelGuides())!;
    expect(item.digits).toEqual([]);
    expect(item.footprint).toHaveLength(item.geo.bars.length);
  });

  it("emits nothing at all for a payload that fails its validator", () => {
    expect(customBarcodeBox(layerFor("upc-a", "nope"))).toBeNull();
    expect(customBarcodeItem(layerFor("upc-a", "nope"), m, labelGuides())).toBeNull();
    expect(dragBox(layerFor("upc-a", "nope"))).toBeNull();
  });
});

describe("custom raster image with unloaded bytes", () => {
  const imageLayer: CustomImageLayer = {
    id: "custom-i2", name: "Unloaded Image", type: "image",
    w: 100, aspect: 1, asset: "missing",
    position, style: { fill: "none", layer: "white" },
  };
  const build = async (mode?: "art" | "mask") => {
    const cfg = defaultConfig();
    cfg.customLayers = [imageLayer];
    const psd = readPsd(
      Buffer.from(await buildPsd(cfg, psdAssets, mode)).buffer as ArrayBuffer,
      { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true },
    );
    return flatNames(psd.children as any[]);
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

function flatNames(children: any[] = []): string[] {
  return children.flatMap((l) => [l.name ?? "", ...flatNames(l.children ?? [])]);
}
