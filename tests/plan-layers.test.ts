// plan-layers.test.ts — planLayers, the generic display-list builder for
// v3 Layer[]: one branch per kind, boxes from placeLayers, items in array
// order. Deterministic fake metrics throughout (0.5pt per char per size
// unit; semibold 10% and bold 20% wider), so every expected number here is
// arithmetic, not a font fact.
import { describe, expect, it } from "vitest";
import {
  planLayers, planLayerScene, layerBoxes, facesOf, type PlacedPage,
} from "../src/planLayers";
import { barcodeItem, customBarcodeItem } from "./legacy/plan";
import { labelGuides, type MeasureFace, type PlacedBarcode, type PlacedImage, type PlacedPaths, type PlacedText,  } from "./legacy/planShared";
import type {
  BarcodeLayer, ImageLayer, Layer, QrLayer, TextLayer, TextLine,
} from "../src/model/layers";
import { qrPath, qrShapes } from "../src/qr";
import { defaultConfig } from "../src/defaults";
import { lolevMaster } from "../src/model/lolevLayers";
import { resolveLayers } from "../src/model/resolveLayers";
import * as L from "./legacy/layout";

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

  it("draws a tab as one space and drops other control characters, whatever stored them (#282)", () => {
    // pdf-lib would print a tab as four spaces (and break a line at \v/\f)
    // while the canvas preview shows one space, so the plan normalizes first.
    const plan = (t: string) => planLayers([text({ id: "s", x: 0, y: 0, lines: [line(t)] })], m, assets) as PlacedText[];
    expect(plan("\uFEFFHops\tCitra\u0001\u2028Mosaic\u200B\u009B\vX").map((r) => [r.text, r.w]))
      .toEqual(plan("Hops Citra Mosaic X").map((r) => [r.text, r.w]));
  });

  it("shows the placeholder when a line holds only control characters (#282)", () => {
    const [run] = planLayers([text({ id: "s", x: 0, y: 0, placeholder: "Name", lines: [line("\u0001\u007F")] })], m, assets) as PlacedText[];
    expect(run.text).toBe("Name");
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
    expect(facesOf(text({ id: "d", x: 0, y: 0 }))).toEqual({ base: "regular", bold: "semibold" });
    const bold = { ...text({ id: "n", x: 0, y: 0, lines: [line("HAZY")] }), faces: { base: "bold", bold: "bold" } as const };
    expect((planLayers([bold], m, assets)[0] as PlacedText).face).toBe("bold");
    const semi = { ...text({ id: "h", x: 0, y: 0, lines: [line("**@X** Y")] }), faces: { base: "semibold", bold: "bold" } as const };
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

// Issue #89: a marker pair spanning a space must survive the word split that
// wrap and justify do — each word keeps the span's style, and no literal
// `**` / `_` is ever drawn.
describe("planLayers text: multi-word markup across wrap/justify", () => {
  const WARN = "**GOVERNMENT WARNING:** (1) According to the Surgeon General";
  const styled = (runs: PlacedText[]) =>
    runs.filter((r) => r.text.trim()).map((r) => [r.text, r.face, r.layer]);
  const noMarkers = (runs: PlacedText[]) =>
    expect(runs.some((r) => r.text.includes("*") || r.text.includes("_"))).toBe(false);

  it("wrap: a bold span split across lines stays bold on both", () => {
    const runs = planLayers([text({ id: "w", x: 0, y: 0, width: 60, lines: [line(WARN)] })], m, assets) as PlacedText[];
    noMarkers(runs);
    expect(styled(runs).filter((r) => r[1] === "semibold"))
      .toEqual([["GOVERNMENT", "semibold", "metallic"], ["WARNING:", "semibold", "metallic"]]);
  });

  it("wrap: a _white ink_ span split across lines stays white on both", () => {
    const runs = planLayers([text({ id: "w", x: 0, y: 0, width: 40, lines: [line("A _very hoppy double_ IPA")] })], m, assets) as PlacedText[];
    noMarkers(runs);
    expect(styled(runs).filter((r) => r[2] === "white").map((r) => r[0])).toEqual(["very", "hoppy", "double"]);
  });

  it("justify: every word of a bold span is bold, markers stripped", () => {
    const runs = planLayers([text({ id: "w", x: 0, y: 0, width: 200, align: "justify",
      lines: [line("A **very hoppy double** IPA extraordinarilylongnextword")] })], m, assets) as PlacedText[];
    expect(styled(runs)).toEqual([
      ["A", "regular", "metallic"], ["very", "semibold", "metallic"], ["hoppy", "semibold", "metallic"],
      ["double", "semibold", "metallic"], ["IPA", "regular", "metallic"], ["extraordinarilylongnextword", "regular", "metallic"],
    ]);
    // Justified: the last word of the first line ends exactly at the width.
    const ipa = runs.find((r) => r.text === "IPA")!;
    expect(ipa.x + ipa.w).toBeCloseTo(200);
  });

  it("rotated justify (justifiedRotatedRuns): the warning heading is two bold words", () => {
    const layer = text({ id: "warn", x: 100, y: 300, vAnchor: "bottom", rotation: 90, width: 120, leading: 1,
      align: "justify", lines: [line(WARN)] });
    const runs = planLayers([layer], m, assets) as PlacedText[];
    noMarkers(runs);
    expect(styled(runs).filter((r) => r[1] === "semibold").map((r) => r[0])).toEqual(["GOVERNMENT", "WARNING:"]);
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

  it("carries the layer's fill as `tint` only when tintRaster is on (#414)", () => {
    const custom = { art1: { aspect: 2 } };
    const [plain] = planLayers([image({ id: "i", asset: "art1", w: 70, x: 0, y: 0 })], m, { ...assets, custom }) as PlacedImage[];
    expect(plain).not.toHaveProperty("tint");
    const [tinted] = planLayers([image({ id: "i", asset: "art1", w: 70, x: 0, y: 0, tintRaster: true })], m, { ...assets, custom }) as PlacedImage[];
    expect(tinted.tint).toBe(GOLD_METAL.fill);
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

  it("draws a UPC stored with its printed spaces exactly as its bare digits", () => {
    const bare = planLayers([upright], m, assets).find((p): p is PlacedBarcode => p.kind === "barcode")!;
    const spaced = planLayers([{ ...upright, value: "0 12345-67890 5" }], m, assets)
      .find((p): p is PlacedBarcode => p.kind === "barcode")!;
    expect(spaced.geo).toEqual(bare.geo);
    expect(spaced.digits).toEqual(bare.digits);
  });

  it("upright: matches plan.ts's custom barcode geometry (print-geometry goldens), guards run long into the digit band", () => {
    const item = planLayers([upright], m, assets).find((p): p is PlacedBarcode => p.kind === "barcode")!;
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

  // The layer box still reserves the quiet zone (edge digits, and Code 128's
  // clear margin) even though nothing paints a plate there. The stroke halo
  // is the barcode item's own S, not a second path.
  it.each([
    ["upc-a", "012345678905", 0], ["ean-13", "5901234123457", 0], ["code-128", "LOLEV-42", 0],
    ["upc-a", "012345678905", 90], ["code-128", "LOLEV-42", 90],
  ] as const)("%s %s at %s degrees: the box reserves the quiet zone and nothing else is painted", (symbology, value, rotation) => {
    const layer: BarcodeLayer = { ...upright, symbology, value, moduleW: 2.5, rotation };
    const items = planLayers([layer], m, assets);
    expect(items.map((p) => p.kind)).toEqual(["barcode"]);
    const box = layerBoxes([layer], m, assets).get("bc")!;
    const bars = (items[0] as PlacedBarcode).geo.bars;
    const lead = rotation ? box.y + box.h - Math.max(...bars.map((b) => b.yTop + b.h)) : Math.min(...bars.map((b) => b.x)) - box.x;
    expect(lead).toBeGreaterThanOrEqual(8 * 2.5 - 1e-9);
  });

  it.each([
    ["upc-a", "012345678905", 0], ["ean-13", "5901234123457", 0], ["code-128", "LOLEV-42", 0],
    ["upc-a", "012345678905", 90], ["code-128", "LOLEV-42", 90],
  ] as const)("%s %s at %s degrees: solid background fills exactly the layer box", (symbology, value, rotation) => {
    const layer: BarcodeLayer = { ...upright, symbology, value, moduleW: 2.5, rotation, solidBackground: true };
    const items = planLayers([layer], m, assets);
    expect(items.map((p) => p.kind)).toEqual(["paths", "barcode"]);
    const backing = items[0] as PlacedPaths;
    const box = layerBoxes([layer], m, assets).get("bc")!;
    const [, w, h] = backing.paths[0].match(/L([\d.]+) 0L[\d.]+ ([\d.]+)/)!.map(Number);
    expect(rotation ? [r2(backing.y), r2(h)] : [r2(backing.x), r2(w)])
      .toEqual(rotation ? [r2(box.y), r2(box.h)] : [r2(box.x), r2(box.w)]);
    expect(backing.fill).toBe(layer.style.stroke);
    expect(backing.layer).toBe("white");
  });

  it("a solid background with no stroke paints the barcode alone", () => {
    const layer: BarcodeLayer = {
      ...upright, solidBackground: true, style: { ...upright.style, stroke: "none" },
    };
    expect(planLayers([layer], m, assets).map((p) => p.kind)).toEqual(["barcode"]);
  });

  it("rotated: reproduces the template barcode item exactly", () => {
    const mod = 29.88 / 29;
    const rotated: BarcodeLayer = {
      ...upright, id: "barcode", x: L.BARCODE.x, y: L.BARCODE.yTop, rotation: 90, value: "850051366224",
      h: 15 * mod, moduleW: mod, style: { fill: "#1A1A1A", layer: "white", stroke: "#FFFFFF", strokeWidth: 20, strokeLayer: "white" },
    };
    const item = planLayers([rotated], m, assets).find((p): p is PlacedBarcode => p.kind === "barcode")!;
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

  it("an empty value emits nothing and has an empty box, like an invalid barcode (#72)", () => {
    expect(planLayers([{ ...qr, value: "" }], m, assets)).toEqual([]);
    expect(layerBoxes([{ ...qr, value: "" }], m, assets).get("qr")).toEqual({ x: 10, y: 20, w: 0, h: 0 });
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

it("uses authored guide positions in the shared plan and hit boxes", () => {
  const layer = text({ id: "anchored", x: 10, y: -3, guideY: "bottom", lines: [line("one"), line("two")] });
  const input = { ...assets, guides: { top: 30, bottom: 280 } };
  const box = layerBoxes([layer], m, input).get(layer.id)!;
  const runs = texts(planLayers([layer], m, input), layer.id);
  expect(box.y + box.h).toBeCloseTo(277);
  expect(runs.at(-1)!.y + DESC * layer.size).toBeCloseTo(277);
  const moved = { ...input, guides: { top: 40, bottom: 260 } };
  expect(layerBoxes([layer], m, moved).get(layer.id)!.y).toBeCloseTo(box.y - 20);
});

it("shares measured boxes with drawing, including skipped layers and binding chains", () => {
  const layers = [text({ id: "a", x: 10, y: 20, lines: [line("one"), line("two")] }),
    text({ id: "b", x: 10, y: { below: "a", gap: 5 } })];
  const scene = planLayerScene(layers, m, assets, { skip: new Set(["a"]) });
  expect(scene.boxes.get("a")!.h).toBeGreaterThan(0);
  expect(scene.boxes.get("b")!.y).toBeCloseTo(scene.boxes.get("a")!.y + scene.boxes.get("a")!.h + 5);
  expect(scene.items).toEqual(planLayers(layers, m, assets, { skip: new Set(["a"]) }));
  expect(scene.boxes).toEqual(layerBoxes(layers, m, assets));
});


it.each([0, 90] as const)("keeps each paragraph's last line naturally spaced at rotation %s (#293)", (rotation) => {
  const runs = planLayers([text({ id: "paragraphs", x: 0, y: 0, width: 30, rotation,
    align: "justify", lines: [line("aa bb"), line("aa bb cc")] })], m, assets) as PlacedText[];
  expect(runs.map((r) => r.text)).toEqual(["aa bb", "aa", "bb", "cc"]);
  expect(runs[0].w).toBe(25);
  expect(rotation ? runs[1].y - runs[2].y : runs[2].x - runs[1].x).toBe(20);
});

// The inspector's Fill and Metallic write the layer's block style, but every
// stored line carries its own copy of fill and plate (the editor writes them
// on each keystroke), and planning used to let that copy win — so on the
// shipped master's Name, Fill → #FF0000 left the text gold until the next
// keystroke. The block now drives every line; a line keeps only the white-ink
// underlay the toolbar gave it, and a `_white_` run keeps its own.
describe("planLayers text: the block's Fill and Metallic drive every line", () => {
  const pairs = (items: readonly unknown[], id: string) =>
    texts(items, id).map((r) => [r.text, r.fill, r.layer]);

  it("draws a label's stored gold/metallic Name in the inspector's red, off the metallic plate", () => {
    const { layers } = resolveLayers(lolevMaster(), [], { name: [line("Hello")] },
      { name: { style: { fill: "#FF0000", layer: "white" } } });
    expect(pairs(planLayers(layers, m, assets), "name")).toEqual([["HELLO", "#FF0000", "white"]]);
  });

  it("keeps a line's own white-ink underlay and a _white_ run under a metallic block", () => {
    const items = planLayers([text({ id: "t", x: 0, y: 0, style: { fill: "#FF0000", layer: "metallic" },
      lines: [line("A"), line("B", { layer: "white" }), line("C _D_")] })], m, assets);
    expect(pairs(items, "t")).toEqual([
      ["A", "#FF0000", "metallic"], ["B", "#FF0000", "white"],
      ["C ", "#FF0000", "metallic"], ["D", "#FF0000", "white"],
    ]);
  });

  it("puts every line of a block whose Metallic is off on the white plate", () => {
    const items = planLayers([text({ id: "t", x: 0, y: 0, style: { fill: "#123456", layer: "white" },
      lines: [line("A"), line("B", { layer: "white" })] })], m, assets);
    expect(pairs(items, "t")).toEqual([["A", "#123456", "white"], ["B", "#123456", "white"]]);
  });
});
