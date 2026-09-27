// barcode.test.ts — drawBarcode: the black bars it emits must tile the run
// area exactly as the encoded 95-module pattern, with nothing drawn outside
// the run (regression for the double height-subtraction that smeared runs
// below their slots); and, since the barcode became a styled element, the
// art halo and the mask footprint must always resolve the SAME stroke width
// while a config saved before that change still prints what it always did.
import { describe, expect, it } from "vitest";
import type { PDFFont, PDFPage } from "pdf-lib";
import type { LabelConfig } from "../src/types";
import { drawBarcode } from "../src/pdf/build";
import { barcodeItem } from "./legacy/plan";
import { type MeasureFace } from "../src/plan";
import { barcodeDigitsFor, barcodeGeometry, barcodeStrokePt } from "./legacy/barcode";
import { encodeUpc, encodeEan13 } from "../src/upc";
import { encodeCode128 } from "../src/code128";
import { defaultConfig, parseConfigFile } from "../src/defaults";
import { BARCODE as B, COLORS, FONT_ASC, FONT_DESC, PAGE, PX, parseHexFill } from "./legacy/layout";

const UPC = "850051366224";

type Color = { red?: number; green?: number; blue?: number; gray?: number };
type Rect = {
  x: number; y: number; width: number; height: number; color: Color;
  // Set on the art pass's bar halos AND the mask's stroke footprint: both are
  // the base shape's OWN rect drawn with a centered border of 2S, so their
  // corners round at radius S the way Photoshop's outside stroke does. Read S
  // back as borderWidth / 2.
  borderWidth?: number;
};
type Text = { txt: string; x: number; y: number; color: Color };

function draw(cfg: LabelConfig, mode: "art" | "mask") {
  const rects: Rect[] = [];
  const texts: Text[] = [];
  const page = {
    drawRectangle: (r: Rect) => rects.push(r),
    drawText: (txt: string, o: Omit<Text, "txt">) => texts.push({ txt, ...o }),
    pushOperators: () => {}, // digit stroke pass sets text state (Tr/w/RG)
  } as unknown as PDFPage;
  const font = { widthOfTextAtSize: () => 10 } as unknown as PDFFont;
  const fonts = { regular: font, semibold: font, bold: font };
  const mf: MeasureFace = (t, size) => fonts.regular.widthOfTextAtSize(t, size);
  drawBarcode(page, fonts, barcodeItem(cfg, mf), mode);
  return { rects, texts };
}

const sameColor = (a: Color, b: { r: number; g: number; b: number }) =>
  (a.gray ?? a.red) === b.r && (a.gray ?? a.green) === b.g && (a.gray ?? a.blue) === b.b;

/** Split an art pass into its stroke-colored halo shapes and its fill ones. */
function split(cfg: LabelConfig) {
  const { rects, texts } = draw(cfg, "art");
  const ink = parseHexFill(cfg.barcodeFill);
  return {
    bars: rects.filter((r) => sameColor(r.color, ink)),
    halo: rects.filter((r) => !sameColor(r.color, ink)),
    digits: texts.filter((t) => sameColor(t.color, ink)),
    digitHalo: texts.filter((t) => !sameColor(t.color, ink)),
  };
}

function drawnBlackRects(): Rect[] {
  // Drop the white contrast underlays; bars are near-black.
  return draw(defaultConfig(), "art").rects.filter((r) => (r.color.gray ?? r.color.red!) < 0.5);
}

/** A config as saved before the barcode carried any style of its own. */
function preStyleConfig(): LabelConfig {
  const raw = ({ version: 1, ...defaultConfig() }) as unknown as Record<string, unknown>;
  delete raw.barcodeFill;
  delete raw.barcodeStroke;
  delete raw.barcodeLayer;
  delete raw.barcodeStrokeLayer;
  delete raw.barcodeStrokeWidth;
  return parseConfigFile(JSON.stringify(raw));
}

describe("drawBarcode geometry", () => {
  const runLen = B.h - 2 * B.padRun;
  const mod = runLen / 95;
  const bottom = B.yTop + B.h - B.padRun; // top-origin coord of module 0

  it("draws every bar inside the run area", () => {
    for (const r of drawnBlackRects()) {
      const lowerEdge = PAGE.h - r.y; // back to top-origin
      expect(lowerEdge).toBeLessThanOrEqual(bottom + 1e-6);
      expect(lowerEdge - r.height).toBeGreaterThanOrEqual(bottom - runLen - 1e-6);
    }
  });

  it("bars reconstruct the encoded 95-module pattern", () => {
    const bits = Array(95).fill("0");
    for (const r of drawnBlackRects()) {
      const lowerEdge = PAGE.h - r.y;
      const i = Math.round((bottom - lowerEdge) / mod);
      const count = Math.round(r.height / mod);
      for (let k = i; k < i + count; k++) bits[k] = "1";
    }
    expect(bits.join("")).toBe(encodeUpc(UPC).modules);
  });
});

// The reason this file cares about colors at all: the barcode's white
// footprint is what lets the code scan over the printed texture, and a
// default that quietly changed it would ship unscannable labels with nothing
// else in the app or the suite to catch it.
describe("drawBarcode back-compat", () => {
  it("migrates a config saved before the barcode was stylable to the shipped look", () => {
    const cfg = preStyleConfig();
    expect(cfg.barcodeFill).toBe("#1A1A1A");
    expect(cfg.barcodeStroke).toBe("#FFFFFF");
    expect(cfg.barcodeLayer).toBe("white");
    expect(cfg.barcodeStrokeLayer).toBe("white");
    // Unset, NOT DEFAULT_STROKE_PX — this is what keeps the measured halo.
    expect(cfg.barcodeStrokeWidth).toBeUndefined();
  });

  it("draws that config's halo at exactly the measured L.BARCODE.stroke", () => {
    const { bars, halo, digits, digitHalo } = split(preStyleConfig());
    expect(bars.length).toBeGreaterThan(0);
    expect(halo).toHaveLength(bars.length);
    expect(digits.length).toBeGreaterThan(0);
    expect(digitHalo.length).toBeGreaterThan(0);
    for (const h of halo) expect(sameColor(h.color, COLORS.white)).toBe(true);
    // Halo rects are emitted in bar order, each its bar's own rect carrying a
    // centered 2*B.stroke border — S beyond the bar on every side, with the
    // corners rounded at radius S by the page's round line join.
    halo.forEach((h, i) => {
      expect(h.x).toBeCloseTo(bars[i].x, 10);
      expect(h.y).toBeCloseTo(bars[i].y, 10);
      expect(h.width).toBeCloseTo(bars[i].width, 10);
      expect(h.height).toBeCloseTo(bars[i].height, 10);
      expect(h.borderWidth).toBeCloseTo(2 * B.stroke, 10);
    });
  });

  it("keeps that config's white-ink footprint at the mask blue it always used, now shaped to the true bars+digits union rather than one bounding rect", () => {
    const cfg = preStyleConfig();
    const { bars, digits } = split(cfg);
    const { rects } = draw(cfg, "mask");
    expect(rects).toHaveLength(bars.length + digits.length);
    for (const r of rects) expect(sameColor(r.color, COLORS.maskBlue)).toBe(true);
    // First `bars.length` rects are the per-bar footprints, in bar order:
    // each the bar's own rect carrying a centered 2S border, exactly like the
    // art halo, so the mask's corners round at the same radius S.
    bars.forEach((bar, i) => {
      expect(rects[i].x).toBeCloseTo(bar.x, 10);
      expect(rects[i].y).toBeCloseTo(bar.y, 10);
      expect(rects[i].width).toBeCloseTo(bar.width, 10);
      expect(rects[i].height).toBeCloseTo(bar.height, 10);
      expect(rects[i].borderWidth).toBeCloseTo(2 * B.stroke, 10);
    });
  });
});

describe("drawBarcode styling", () => {
  // The one invariant worth a dedicated test: the mask plate sizes the white
  // ink from the same resolved S as the art plate. If they diverged, the
  // white-ink layer would no longer match the ink extent and the labels would
  // fringe on press — invisible on screen, expensive on paper.
  const cases: [string, Partial<LabelConfig>, number][] = [
    ["the shipped default is 20px @600dpi", {}, 20 * PX],
    // Explicit undefined (not just absent) — the shipped default sets 20, so
    // exercising the unset fallback needs the key knocked back out.
    ["unset width keeps the measured halo", { barcodeStrokeWidth: undefined }, B.stroke],
    ["an explicit width is px @600dpi", { barcodeStrokeWidth: 30 }, 30 * PX],
    ["stroke off means no halo at all", { barcodeStroke: "none" }, 0],
    // A width set while the stroke is off must still resolve to 0, or the
    // mask would reserve ink for a halo the art never draws.
    ["stroke off outranks a set width", { barcodeStroke: "none", barcodeStrokeWidth: 30 }, 0],
  ];

  it.each(cases)("art and mask resolve the same stroke: %s", (_name, patch, expected) => {
    const cfg = { ...defaultConfig(), ...patch };
    const { bars, halo } = split(cfg);
    // The art halo is the bar's own rect with a centered 2S border.
    const artS = halo.length ? halo[0].borderWidth! / 2 : 0;
    // Mask rects are pushed bar-first, so rects[0] is the first bar's
    // footprint — its centered border must track the same S as the art halo.
    const maskRect = draw(cfg, "mask").rects[0];
    const maskS = (maskRect.borderWidth ?? 0) / 2;
    expect(artS).toBeCloseTo(expected, 10);
    expect(maskS).toBeCloseTo(expected, 10);
    expect(maskRect.height).toBeCloseTo(bars[0].height, 10);
  });

  // Regression: the mask used to draw ONE bounding rect over the whole
  // symbol. That covers the ink but wildly over-covers the space between
  // bars and around the quiet zones — this asserts the new footprint is the
  // true union instead: every bar rect sized to its own bar, not the
  // symbol's full width/height.
  it.each(cases)("mask footprint shapes to each bar individually, not one bounding rect: %s", (_name, patch, expected) => {
    const cfg = { ...defaultConfig(), ...patch };
    const { bars, digits } = split(cfg);
    const { rects } = draw(cfg, "mask");
    expect(rects).toHaveLength(bars.length + digits.length);
    bars.forEach((bar, i) => {
      expect(rects[i].x).toBeCloseTo(bar.x, 10);
      expect(rects[i].y).toBeCloseTo(bar.y, 10);
      expect(rects[i].width).toBeCloseTo(bar.width, 10);
      expect(rects[i].height).toBeCloseTo(bar.height, 10);
      expect((rects[i].borderWidth ?? 0) / 2).toBeCloseTo(expected, 10);
    });
  });

  // Digit pills: a rect around each digit group's glyph box (measured font
  // width x the same ASC/DESC font-box ratio hittest.ts uses) expanded by S
  // — the shape the art's stroked digit halo traces around text.
  const DIGIT_ASC = FONT_ASC;
  const DIGIT_DESC = FONT_DESC;
  it.each(cases)("mask digit pills track the same S, sized to each digit's glyph box: %s", (_name, patch, expected) => {
    const cfg = { ...defaultConfig(), ...patch };
    const { bars, digits } = split(cfg);
    const { rects } = draw(cfg, "mask");
    const pills = rects.slice(bars.length); // digit pills follow the bar rects
    expect(pills).toHaveLength(digits.length);
    digits.forEach((d, i) => {
      // Mock font: widthOfTextAtSize always returns 10, so every digit
      // group's glyph run is 10pt regardless of text.
      const w = 10;
      const x0 = d.x - DIGIT_ASC * B.textSize;
      const x1 = d.x + DIGIT_DESC * B.textSize;
      expect(pills[i].x).toBeCloseTo(x0, 10);
      expect(pills[i].width).toBeCloseTo(x1 - x0, 10);
      expect(pills[i].height).toBeCloseTo(w, 10);
      expect((pills[i].borderWidth ?? 0) / 2).toBeCloseTo(expected, 10);
    });
  });

  it("emits no halo shapes at all when the stroke is off", () => {
    const { bars, halo, digits, digitHalo } = split({
      ...defaultConfig(), barcodeStroke: "none",
    });
    expect(halo).toHaveLength(0);
    expect(digitHalo).toHaveLength(0);
    // The artwork itself is untouched by the halo being off.
    expect(bars).toHaveLength(split(defaultConfig()).bars.length);
    expect(digits).toHaveLength(split(defaultConfig()).digits.length);
  });

  it("paints bars, digits and halo in the configured colors", () => {
    const cfg = { ...defaultConfig(), barcodeFill: "#112233" as const, barcodeStroke: "#445566" as const };
    const { bars, halo, digits, digitHalo } = split(cfg);
    for (const r of bars) expect(sameColor(r.color, parseHexFill("#112233"))).toBe(true);
    for (const t of digits) expect(sameColor(t.color, parseHexFill("#112233"))).toBe(true);
    for (const r of halo) expect(sameColor(r.color, parseHexFill("#445566"))).toBe(true);
    for (const t of digitHalo) expect(sameColor(t.color, parseHexFill("#445566"))).toBe(true);
  });

  it("paints a white stroke outside a metallic barcode fill", () => {
    const cfg = { ...defaultConfig(), barcodeLayer: "metallic" as const };
    const { bars, digits } = split(cfg);
    const { rects } = draw(cfg, "mask");
    const footprintCount = bars.length + digits.length;
    expect(rects).toHaveLength(2 * footprintCount);
    for (const r of rects.slice(0, footprintCount))
      expect(sameColor(r.color, COLORS.maskBlue)).toBe(true);
    for (const r of rects.slice(footprintCount))
      expect(sameColor(r.color, COLORS.white)).toBe(true);
  });

  it("paints a metallic stroke outside a white barcode fill", () => {
    const cfg = {
      ...defaultConfig(), barcodeLayer: "white" as const,
      barcodeStrokeLayer: "metallic" as const,
    };
    const { bars, digits } = split(cfg);
    const { rects } = draw(cfg, "mask");
    const footprintCount = bars.length + digits.length;
    for (const r of rects.slice(0, footprintCount))
      expect(sameColor(r.color, COLORS.white)).toBe(true);
    for (const r of rects.slice(footprintCount))
      expect(sameColor(r.color, COLORS.maskBlue)).toBe(true);
  });
});

// The geometry entry point (barcodeGeometry) became symbology-agnostic: an
// optional trailing `pattern` lets a caller supply any {modules, guards}
// shape, while the default (no pattern) path must stay byte-identical to
// today's UPC-A-only behavior.
describe("barcodeGeometry pattern parameter", () => {
  const measure = () => 10;

  it("explicit UPC pattern matches the implicit default exactly", () => {
    const implicit = barcodeGeometry(UPC, measure);
    const explicit = barcodeGeometry(UPC, measure, encodeUpc(UPC));
    // Controller ruling (fix round 1): the digit-layout gate is on
    // `pattern === undefined`, uniformly — even an explicit `encodeUpc`
    // pattern that reproduces the default path's bars gets `digits: []`,
    // because gating on guard shape instead would silently apply UPC-A's
    // 12-digit slicing to an explicit EAN-13 pattern (which shares UPC-A's
    // guard shape). So this equality holds for everything EXCEPT `digits`;
    // that field is asserted separately, and always empty on the explicit
    // path.
    const { digits: _implicitDigits, ...implicitRest } = implicit;
    const { digits: _explicitDigits, ...explicitRest } = explicit;
    expect(explicitRest).toEqual(implicitRest);
    expect(implicit.digits.length).toBeGreaterThan(0);
    expect(explicit.digits).toEqual([]);
  });

  it("an explicit EAN-13 pattern also gets empty digits, not UPC-A digit slicing", () => {
    // EAN-13 shares UPC-A's guard shape ([0,10),[45,50),[85,95)), so a gate
    // on guard presence would misfire here and slice the 13-digit value
    // with UPC-A's 12-digit layout. The uniform "any explicit pattern gets
    // empty digits" rule is what prevents that.
    const geo = barcodeGeometry("4006381333931", measure, encodeEan13("4006381333931"));
    expect(geo.digits).toEqual([]);
    expect(geo.bars.length).toBeGreaterThan(0);
    expect(geo.bars.some((b) => b.w === B.guardLen)).toBe(true);
  });

  it("a Code 128 pattern yields bars, no digits, uniform heights", () => {
    const geo = barcodeGeometry("BEER-123", measure, encodeCode128("BEER-123"));
    expect(geo.digits).toEqual([]);
    expect(geo.bars.length).toBeGreaterThan(0);
    // No guards on a Code 128 pattern, so every bar uses the plain bar
    // length — none stretches to the tall guardLen used at UPC-A's guard
    // groups.
    const widths = new Set(geo.bars.map((b) => b.w));
    expect(widths.size).toBe(1);
  });
});

// The halo width is resolved once, in src/barcode.ts, and read by BOTH
// deliverable builders (pdf/build.ts drawBarcode, psd/build.ts) — the
// expression used to be duplicated verbatim in the two, where any drift
// would put the white-ink plate out of register with the printed artwork.
describe("shared barcode stroke resolver", () => {
  it("resolves none / explicit px / unset the way both builders need", () => {
    expect(barcodeStrokePt({ barcodeStroke: "none", barcodeStrokeWidth: 20 })).toBe(0);
    expect(barcodeStrokePt({ barcodeStroke: "#FFFFFF", barcodeStrokeWidth: 20 })).toBeCloseTo(20 * PX, 10);
    // Unset keeps the halo measured off the finished labels, not DEFAULT_STROKE_PX.
    expect(barcodeStrokePt({ barcodeStroke: "#FFFFFF", barcodeStrokeWidth: undefined })).toBe(B.stroke);
  });

  it("is the width the PDF actually draws", () => {
    const cfg = { ...defaultConfig(), barcodeStrokeWidth: 31 };
    const { bars, halo } = split(cfg);
    const expected = barcodeStrokePt(cfg);
    // Every halo rect is its bar carrying a centered 2S border, which reaches
    // S past the bar on each side.
    expect(halo[0].borderWidth).toBeCloseTo(2 * expected, 10);
    const maskRect = draw(cfg, "mask").rects[0]; // first bar's footprint rect
    expect(maskRect.width).toBeCloseTo(bars[0].width, 10);
    expect(maskRect.borderWidth).toBeCloseTo(2 * expected, 10);
  });
});

// barcodeDigitsFor (P3) — generic per-symbology digit grouping for a custom
// barcode layer's own EXPLICIT pattern; barcodeGeometry itself is untouched
// (see its own comment) and keeps returning digits:[] for any pattern.
describe("barcodeDigitsFor", () => {
  it("upc-a: historical 4-group layout", () => {
    const d = barcodeDigitsFor("upc-a", "850051366224", 95, 9, (t) => t.length * 4);
    expect(d.map((g) => g.text)).toEqual(["8", "50051", "36622", "4"]);
  });

  it("ean-13 digits: leading digit + two centered sixes", () => {
    const d = barcodeDigitsFor("ean-13", "4006381333931", 95, 9, (t) => t.length * 4);
    expect(d.map((g) => g.text)).toEqual(["4", "006381", "333931"]);
  });

  it("code-128 digits: one group, centered", () => {
    const d = barcodeDigitsFor("code-128", "LOLEV-123", 68, 10, (t) => t.length * 4);
    expect(d).toHaveLength(1);
    expect(d[0].text).toBe("LOLEV-123");
  });
});
