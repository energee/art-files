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
import { barcodeStrokePt } from "../src/barcode";
import { encodeUpc } from "../src/upc";
import { defaultConfig, parseConfigFile, toConfigFile } from "../src/defaults";
import { BARCODE as B, COLORS, PAGE, PX, parseHexFill } from "../src/layout";

const UPC = "850051366224";

type Color = { red: number; green: number; blue: number };
type Rect = { x: number; y: number; width: number; height: number; color: Color };
type Text = { txt: string; x: number; y: number; color: Color };

function draw(cfg: LabelConfig, mode: "art" | "mask") {
  const rects: Rect[] = [];
  const texts: Text[] = [];
  const page = {
    drawRectangle: (r: Rect) => rects.push(r),
    drawText: (txt: string, o: Omit<Text, "txt">) => texts.push({ txt, ...o }),
  } as unknown as PDFPage;
  const font = { widthOfTextAtSize: () => 10 } as unknown as PDFFont;
  drawBarcode(page, { regular: font, semibold: font, bold: font }, cfg, mode);
  return { rects, texts };
}

const sameColor = (a: Color, b: { r: number; g: number; b: number }) =>
  a.red === b.r && a.green === b.g && a.blue === b.b;

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
  return draw(defaultConfig(), "art").rects.filter((r) => r.color.red < 0.5);
}

/** A config as saved before the barcode carried any style of its own. */
function preStyleConfig(): LabelConfig {
  const raw = toConfigFile(defaultConfig()) as unknown as Record<string, unknown>;
  delete raw.barcodeFill;
  delete raw.barcodeStroke;
  delete raw.barcodeLayer;
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
    // Halo rects are emitted in bar order, each its bar outset by B.stroke.
    halo.forEach((h, i) => {
      expect(h.x).toBeCloseTo(bars[i].x - B.stroke, 10);
      expect(h.y).toBeCloseTo(bars[i].y - B.stroke, 10);
      expect(h.width).toBeCloseTo(bars[i].width + 2 * B.stroke, 10);
      expect(h.height).toBeCloseTo(bars[i].height + 2 * B.stroke, 10);
    });
  });

  it("keeps that config's white-ink footprint at the mask blue it always used", () => {
    const { rects } = draw(preStyleConfig(), "mask");
    expect(rects).toHaveLength(1);
    expect(sameColor(rects[0].color, COLORS.maskBlue)).toBe(true);
    expect(rects[0].x).toBeCloseTo(B.x - B.stroke, 10);
    expect(rects[0].width).toBeCloseTo(B.w + 2 * B.stroke, 10);
    expect(rects[0].height).toBeCloseTo(B.h + 2 * B.stroke, 10);
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
    const artS = halo.length ? bars[0].x - halo[0].x : 0;
    const maskRect = draw(cfg, "mask").rects[0];
    const maskS = (maskRect.width - B.w) / 2;
    expect(artS).toBeCloseTo(expected, 10);
    expect(maskS).toBeCloseTo(expected, 10);
    expect(maskRect.height).toBeCloseTo(B.h + 2 * expected, 10);
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

  it("knocks the footprint out of the white plate when the layer is metallic", () => {
    const { rects } = draw({ ...defaultConfig(), barcodeLayer: "metallic" }, "mask");
    expect(sameColor(rects[0].color, COLORS.white)).toBe(true);
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
    const { halo } = split(cfg);
    const expected = barcodeStrokePt(cfg);
    // Every halo rect is its bar expanded by S on each side.
    expect(halo[0].height).toBeGreaterThan(2 * expected);
    const maskRect = draw(cfg, "mask").rects[0];
    expect(maskRect.width).toBeCloseTo(B.w + 2 * expected, 10);
  });
});
