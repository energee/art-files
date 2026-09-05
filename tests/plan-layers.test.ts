// plan-layers.test.ts — planLayers, the generic display-list builder for
// v3 Layer[]: one branch per kind, boxes from placeLayers, items in array
// order. Deterministic fake metrics throughout (0.5pt per char per size
// unit; semibold 10% and bold 20% wider), so every expected number here is
// arithmetic, not a font fact.
import { describe, expect, it } from "vitest";
import {
  planLayers, layerBoxes, DEFAULT_FACES, type PlacedPage,
} from "../src/planLayers";
import {
  barcodeItem, customBarcodeItem, labelGuides, type MeasureFace, type PlacedBarcode,
  type PlacedImage, type PlacedPaths, type PlacedText,
} from "../src/plan";
import type {
  BarcodeLayer, ImageLayer, Layer, QrLayer, TextLayer, TextLine,
} from "../src/model/layers";
import { qrPath, qrShapes } from "../src/qr";
import { defaultConfig } from "../src/defaults";
import * as L from "../src/layout";

const m: MeasureFace = (text, size, face) =>
  text.length * size * (face === "regular" ? 0.5 : face === "semibold" ? 0.55 : 0.6);
const ASC = L.FONT_ASC;
const DESC = L.FONT_DESC;

const GOLD_METAL = { fill: "#F3CD80", layer: "metallic" } as const;
const line = (text: string, extra: Partial<TextLine> = {}): TextLine => ({ text, ...GOLD_METAL, ...extra });
const text = (l: Partial<TextLayer> & Pick<Layer, "id" | "x" | "y">): TextLayer => ({
  kind: "text", name: l.id, enabled: true, anchor: "left", lines: [line("X")], size: 10,
  align: "left", style: GOLD_METAL, ...l,
});
const image = (l: Partial<ImageLayer> & Pick<Layer, "id" | "x" | "y"> & Pick<ImageLayer, "asset" | "w">): ImageLayer => ({
  kind: "image", name: l.id, enabled: true, anchor: "left", style: GOLD_METAL, ...l,
});
// A tiny valid logo SVG: one triangle, the laurel's viewBox aspect.
const LOGO_SVG = '<svg viewBox="0 0 480 525"><path d="M0 0 L480 0 L240 525 Z"/></svg>';
const assets = { logoSvg: LOGO_SVG };
const texts = (items: readonly unknown[], id: string) =>
  (items as PlacedText[]).filter((r) => r.kind === "text" && r.id === id);

describe("planLayers text", () => {
  it("places a plain left line: baseline one ascender below the box top", () => {
    const [run] = planLayers([text({ id: "volume", x: 40, y: 100, lines: [line("1 PINT", { bold: true })] })], m, assets) as PlacedText[];
    expect(run).toMatchObject({
      kind: "text", id: "volume", text: "1 PINT", x: 40, y: 100 + ASC * 10, size: 10,
      face: "semibold", tracking: 0, rotated: false, fill: GOLD_METAL.fill, layer: "metallic",
    });
    expect(run.w).toBeCloseTo(m("1 PINT", 10, "semibold"));
  });

  it("centers a center-anchored, center-aligned line on x", () => {
    const [run] = planLayers([text({ id: "s", x: 100, y: 0, anchor: "center", align: "center", size: 8, lines: [line("IPA")] })], m, assets) as PlacedText[];
    expect(run.x).toBeCloseTo(100 - m("IPA", 8, "regular") / 2);
  });

  it("right-aligns inside a right-anchored box", () => {
    const [run] = planLayers([text({ id: "s", x: 100, y: 0, anchor: "right", align: "right", lines: [line("AB")] })], m, assets) as PlacedText[];
    expect(run.x + run.w).toBeCloseTo(100);
  });

  it("splits inline **bold** into runs one weight up, advancing x", () => {
    const runs = planLayers([text({ id: "s", x: 10, y: 0, lines: [line("a **b** c")] })], m, assets) as PlacedText[];
    expect(runs.map((r) => [r.text, r.face])).toEqual([["a ", "regular"], ["b", "semibold"], [" c", "regular"]]);
    expect(runs[1].x).toBeCloseTo(runs[0].x + runs[0].w);
    expect(runs[2].x).toBeCloseTo(runs[1].x + runs[1].w);
  });

  it("a _white_ run moves to the white plate; stroke and tracking come from the layer style", () => {
    const style = { ...GOLD_METAL, stroke: "#000000", strokeWidth: 15, letterSpacing: 0.5 } as const;
    const runs = planLayers([text({ id: "s", x: 10, y: 0, style, lines: [line("a _b_")] })], m, assets) as PlacedText[];
    expect(runs.map((r) => r.layer)).toEqual(["metallic", "white"]);
    expect(runs[0].stroke).toEqual({ fill: "#000000", layer: "white", w: 15 * L.PX });
    expect(runs[0].tracking).toBe(0.5);
  });

  it("the faces hint sets the base weight; bold runs step up from it, capped at bold", () => {
    expect(DEFAULT_FACES).toEqual({ base: "regular", bold: "semibold" });
    const bold = { ...text({ id: "n", x: 0, y: 0, lines: [line("HAZY")] }), faces: { base: "bold", bold: "bold" } };
    expect((planLayers([bold], m, assets)[0] as PlacedText).face).toBe("bold");
    const semi = { ...text({ id: "h", x: 0, y: 0, lines: [line("**@X** Y")] }), faces: { base: "semibold", bold: "bold" } };
    expect((planLayers([semi], m, assets) as PlacedText[]).map((r) => r.face)).toEqual(["bold", "semibold"]);
  });

  it("header lines are bold at size * headerScale; every line advances by leading * size", () => {
    const lines = [line("HOPS", { header: true }), line("Citra")];
    const one = planLayers([text({ id: "d", x: 0, y: 57.23, size: 9, leading: 1.2, lines })], m, assets) as PlacedText[];
    expect(one.map((r) => [r.face, r.size])).toEqual([["semibold", 9], ["regular", 9]]);
    expect(one[0].y).toBeCloseTo(66.68);
    expect(one[1].y).toBeCloseTo(77.48);
    const two = planLayers([text({ id: "d", x: 0, y: 0, size: 9, headerScale: 2, lines })], m, assets) as PlacedText[];
    expect(two[0].size).toBe(18);
    expect(two[0].y).toBeCloseTo(ASC * 18);
    expect(two[1].y).toBeCloseTo(ASC * 18 + 1.2 * 9);
  });

  it("an empty layer draws its placeholder; a suffix follows the first line; uppercase applies to both", () => {
    const abv = text({ id: "abv", x: 0, y: 0, lines: [line("")], placeholder: "#", suffix: "% alc by vol", input: "number" });
    expect(texts(planLayers([abv], m, assets), "abv").map((r) => r.text).join("")).toBe("#% alc by vol");
    const filled = { ...abv, lines: [line("6.5")] };
    expect(texts(planLayers([filled], m, assets), "abv").map((r) => r.text).join("")).toBe("6.5% alc by vol");
    const name = text({ id: "name", x: 0, y: 0, lines: [line("")], placeholder: "Name", uppercase: true });
    expect(texts(planLayers([name], m, assets), "name")[0].text).toBe("NAME");
    expect(texts(planLayers([{ ...name, lines: [line("hazy")] }], m, assets), "name")[0].text).toBe("HAZY");
  });

  it("wraps a line longer than width at spaces, greedy like wrapWarning", () => {
    const runs = planLayers([text({ id: "w", x: 0, y: 0, width: 30, lines: [line("aa bb cc")] })], m, assets) as PlacedText[];
    expect(runs.map((r) => [r.text, r.y])).toEqual([["aa bb", ASC * 10], ["cc", ASC * 10 + 12]]);
  });

  it("justify stretches every line but the last to width; the last degrades to left", () => {
    const runs = planLayers([text({ id: "w", x: 5, y: 0, width: 30, align: "justify", lines: [line("aa bb cc")] })], m, assets) as PlacedText[];
    expect(runs.map((r) => [r.text, r.x])).toEqual([["aa", 5], ["bb", 25], ["cc", 5]]);
    expect(layerBoxes([text({ id: "w", x: 5, y: 0, width: 30, align: "justify", lines: [line("aa bb cc")] })], m, assets).get("w"))
      .toEqual({ x: 5, y: 0, w: 30, h: ASC * 10 + 12 + DESC * 10 });
  });

  it("rotation 90: one column reading bottom-to-top from a bottom-anchored y, baseline one ascender right of the box", () => {
    const [run] = planLayers([text({ id: "r", x: 100, y: 300, vAnchor: "bottom", rotation: 90, lines: [line("AB")] })], m, assets) as PlacedText[];
    expect(run).toMatchObject({ x: 100 + ASC * 10, y: 300, rotated: true, w: 10 });
    expect(layerBoxes([text({ id: "r", x: 100, y: 300, vAnchor: "bottom", rotation: 90, lines: [line("AB")] })], m, assets).get("r"))
      .toEqual({ x: 100, y: 290, w: (ASC + DESC) * 10, h: 10 });
  });

  it("rotation 90 + justify: columns step right by the leading, each justified except the last", () => {
    const layer = text({ id: "warn", x: 100, y: 300, vAnchor: "bottom", rotation: 90, width: 30, leading: 1, align: "justify", lines: [line("aa bb cc")] });
    const runs = planLayers([layer], m, assets) as PlacedText[];
    const x0 = 100 + ASC * 10;
    expect(runs.map((r) => [r.text, r.x, r.y])).toEqual([["aa", x0, 300], ["bb", x0, 280], ["cc", x0 + 10, 300]]);
    expect(layerBoxes([layer], m, assets).get("warn")).toEqual({ x: 100, y: 270, w: 10 + (ASC + DESC) * 10, h: 30 });
  });
});

describe("planLayers image", () => {
  it("draws builtin:logo as the laurel paths sized by w, centered on a center anchor", () => {
    const [item] = planLayers([image({ id: "logo", asset: "builtin:logo", w: 33.5, x: 100, anchor: "center", y: 50, style: { ...GOLD_METAL, stroke: "#000000" } })], m, assets) as PlacedPaths[];
    expect(item).toMatchObject({ kind: "paths", id: "logo", x: 100 - 16.75, y: 50, fill: GOLD_METAL.fill });
    expect(item.stroke?.w).toBeCloseTo(15 * L.PX);
    expect(item.paths.length).toBeGreaterThan(0);
  });

  it("contain-fits a raster asset into w x h, scaled, carrying the asset key", () => {
    const custom = { art1: { aspect: 2 } };
    const [full] = planLayers([image({ id: "i", asset: "art1", w: 70, h: 44, x: 10, y: 20 })], m, { ...assets, custom }) as PlacedImage[];
    expect(full).toMatchObject({ kind: "image", id: "i", asset: "art1", x: 10, y: 20, w: 70, h: 35 });
    const [half] = planLayers([image({ id: "i", asset: "art1", w: 70, h: 44, scale: 0.5, x: 100, y: 20, anchor: "center" })], m, { ...assets, custom }) as PlacedImage[];
    expect(half).toMatchObject({ x: 100 - 17.5, w: 35, h: 17.5 });
    // No h: the box follows the asset's aspect at w.
    const [free] = planLayers([image({ id: "i", asset: "art1", w: 100, x: 0, y: 0 })], m, { ...assets, custom }) as PlacedImage[];
    expect(free).toMatchObject({ w: 100, h: 50 });
  });

  it("an SVG asset plans as ink-tight paths", () => {
    const custom = { art1: { aspect: 480 / 525, art: { kind: "svg" as const, svg: LOGO_SVG } } };
    const [item] = planLayers([image({ id: "i", asset: "art1", w: 36, h: 36, x: 0, y: 0 })], m, { ...assets, custom }) as PlacedPaths[];
    expect(item.kind).toBe("paths");
  });

  it("an empty or unknown asset draws nothing", () => {
    expect(planLayers([image({ id: "i", asset: "", w: 10, x: 0, y: 0 })], m, assets)).toEqual([]);
    expect(planLayers([image({ id: "i", asset: "nope", w: 10, x: 0, y: 0 })], m, { ...assets, custom: {} })).toEqual([]);
  });

  it("background/mask roles emit a page item cover-fit to the page", () => {
    const custom = { tex: { aspect: 2 } };
    const bg = image({ id: "background", role: "background", asset: "tex", fit: "cover", w: L.PAGE.w, h: L.PAGE.h, x: 0, y: 0 });
    const [item] = planLayers([bg], m, { ...assets, custom }) as PlacedPage[];
    expect(item).toEqual({ kind: "page", id: "background", role: "background", asset: "tex", ...L.coverFit(2, 1) });
    expect(planLayers([{ ...bg, asset: "" }], m, { ...assets, custom })).toEqual([]);
  });
});

describe("planLayers barcode", () => {
  const upright: BarcodeLayer = {
    id: "bc", name: "BC", kind: "barcode", enabled: true, x: 28.68, y: 28.68, anchor: "left",
    symbology: "upc-a", value: "012345678905", h: 30, moduleW: 1,
    style: { fill: "#000000", layer: "white", stroke: "#FFFFFF", strokeWidth: 2 },
  };
  const r2 = (n: number) => Math.round(n * 100) / 100;

  it("upright: matches plan.ts's custom barcode geometry (print-geometry goldens), guards run long into the digit band", () => {
    const [item] = planLayers([upright], m, assets) as PlacedBarcode[];
    const ref = customBarcodeItem({
      id: "custom-bc", name: "BC", type: "barcode", symbology: "upc-a", value: "012345678905", h: 30, moduleW: 1,
      position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 }, style: upright.style,
    }, m, labelGuides())!;
    expect(item).toMatchObject({ kind: "barcode", id: "bc", S: 0.24, textSize: 20, rotated: false });
    expect(item.digits.map((d) => [d.text, r2(d.x), r2(d.y), r2(d.w)])).toEqual([
      ["0", 33.68, 86.68, 10], ["12345", 64.18, 86.68, 50], ["67890", 104.18, 86.68, 50], ["5", 134.68, 86.68, 10],
    ]);
    expect(item.geo.bars.map((b) => [b.x, b.yTop, b.w])).toEqual(ref.geo.bars.map((b) => [b.x, b.yTop, b.w]));
    // JsBarcode's UPC-A guard rule: start/center/end guards reach through the
    // digit band (h + textSize/2 + gap = 48); plain bars stay at h. The guard
    // region [0,10) takes in the number-system digit's bars, so the first
    // plain bar is the second digit's (bars[4]).
    expect(item.geo.bars[0].h).toBe(48);
    expect(item.geo.bars[3].h).toBe(48);
    expect(item.geo.bars[4].h).toBe(30);
    expect(item.footprint.slice(item.geo.bars.length)).toEqual(ref.footprint.slice(ref.geo.bars.length));
  });

  it("rotated: reproduces the template barcode item exactly", () => {
    const mod = 29.88 / 29;
    const rotated: BarcodeLayer = {
      ...upright, id: "barcode", x: L.BARCODE.x, y: L.BARCODE.yTop, rotation: 90, value: "850051366224",
      h: 15 * mod, moduleW: mod, style: { fill: "#1A1A1A", layer: "white", stroke: "#FFFFFF", strokeWidth: 20, strokeLayer: "white" },
    };
    const [item] = planLayers([rotated], m, assets) as PlacedBarcode[];
    const ref = barcodeItem(defaultConfig(), m);
    expect(item.rotated).toBe(true);
    expect(item.S).toBeCloseTo(ref.S);
    expect(item.textSize).toBeCloseTo(ref.textSize);
    expect(item.geo.mod).toBeCloseTo(ref.geo.mod);
    expect(item.geo.bottom).toBeCloseTo(ref.geo.bottom);
    expect(item.geo.bars).toHaveLength(ref.geo.bars.length);
    item.geo.bars.forEach((b, i) => {
      expect(b.x).toBeCloseTo(ref.geo.bars[i].x); expect(b.yTop).toBeCloseTo(ref.geo.bars[i].yTop);
      expect(b.w).toBeCloseTo(ref.geo.bars[i].w); expect(b.h).toBeCloseTo(ref.geo.bars[i].h);
    });
    item.digits.forEach((d, i) => {
      expect(d.text).toBe(ref.digits[i].text);
      expect(d.x).toBeCloseTo(ref.digits[i].x); expect(d.y).toBeCloseTo(ref.digits[i].y); expect(d.w).toBeCloseTo(ref.digits[i].w);
    });
    expect(item.footprint).toHaveLength(ref.footprint.length);
    item.footprint.forEach((f, i) => {
      expect(f.x).toBeCloseTo(ref.footprint[i].x); expect(f.yTop).toBeCloseTo(ref.footprint[i].yTop);
      expect(f.w).toBeCloseTo(ref.footprint[i].w); expect(f.h).toBeCloseTo(ref.footprint[i].h);
    });
    const box = layerBoxes([rotated], m, assets).get("barcode")!;
    expect(box.x).toBeCloseTo(L.BARCODE.x); expect(box.y).toBeCloseTo(L.BARCODE.yTop);
    expect(box.w).toBeCloseTo(L.BARCODE.w); expect(box.h).toBeCloseTo(L.BARCODE.h);
  });

  it("an invalid payload emits nothing and has an empty box", () => {
    expect(planLayers([{ ...upright, value: "nope" }], m, assets)).toEqual([]);
    expect(layerBoxes([{ ...upright, value: "nope" }], m, assets).get("bc")).toEqual({ x: 28.68, y: 28.68, w: 0, h: 0 });
  });
});

describe("planLayers qr", () => {
  const qr: QrLayer = {
    id: "qr", name: "QR", kind: "qr", enabled: true, x: 10, y: 20, anchor: "left", size: 59,
    value: "https://lolev.beer/beer/x", qrStyle: "dots",
    style: { fill: "#F3CD80", layer: "metallic", stroke: "#000000", strokeWidth: 15, strokeLayer: "white" },
  };
  it("emits a stroke underlay then the fill, both at the box origin", () => {
    const items = planLayers([qr], m, assets) as PlacedPaths[];
    const shapes = qrShapes(qr.value, { style: "dots", ecLevel: "L" });
    expect(items).toEqual([
      { kind: "paths", id: "qr", x: 10, y: 20, stroke: null, paths: [qrPath(shapes, 59, 15 * L.PX)], fill: "#000000", layer: "white" },
      { kind: "paths", id: "qr", x: 10, y: 20, stroke: null, paths: [qrPath(shapes, 59)], fill: "#F3CD80", layer: "metallic" },
    ]);
    expect(planLayers([{ ...qr, style: { fill: "#F3CD80", layer: "metallic" } }], m, assets)).toHaveLength(1);
    expect(layerBoxes([qr], m, assets).get("qr")).toEqual({ x: 10, y: 20, w: 59, h: 59 });
  });
});

describe("planLayers order and binding", () => {
  it("emits items in array order and moves a bound layer when the layer above grows", () => {
    const desc = (n: number) => text({ id: "d", x: 0, y: 0, size: 9, lines: Array.from({ length: n }, (_, i) => line(`l${i}`)) });
    const lead = text({ id: "lead", x: 0, y: { below: "d", gap: 9 }, size: 9, lines: [line("A")] });
    const logo = image({ id: "logo", asset: "builtin:logo", w: 33.5, x: 100, y: 50 });
    const two = planLayers([logo, desc(2), lead], m, assets);
    expect(two.map((r) => r.id)).toEqual(["logo", "d", "d", "lead"]);
    const five = planLayers([logo, desc(5), lead], m, assets);
    const leadY = (items: readonly unknown[]) => texts(items, "lead")[0].y;
    expect(leadY(five) - leadY(two)).toBeCloseTo(3 * 1.2 * 9);
    // Bottom of a two-line block: last baseline + descender; gap 9 then the lead's ascender.
    expect(leadY(two)).toBeCloseTo(ASC * 9 + 1.2 * 9 + DESC * 9 + 9 + ASC * 9);
  });

  it("opts.skip omits a layer's items without moving its neighbours", () => {
    const layers = [text({ id: "a", x: 0, y: 0 }), text({ id: "b", x: 0, y: { below: "a", gap: 1 } })];
    const all = planLayers(layers, m, assets);
    const skipped = planLayers(layers, m, assets, { skip: new Set(["a"]) });
    expect(skipped).toEqual(all.filter((r) => (r.id as string) !== "a"));
  });
});
