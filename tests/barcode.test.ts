// barcode.test.ts — drawBarcode geometry: the black bars it emits must tile
// the run area exactly as the encoded 95-module pattern, with nothing drawn
// outside the run (regression for the double height-subtraction that smeared
// runs below their slots).
import { describe, expect, it } from "vitest";
import type { PDFFont, PDFPage } from "pdf-lib";
import { drawBarcode } from "../src/pdf/build";
import { encodeUpc } from "../src/upc";
import { BARCODE as B, PAGE } from "../src/layout";

const UPC = "850051366224";

type Rect = { x: number; y: number; width: number; height: number; color: { red: number } };

function drawnBlackRects(): Rect[] {
  const rects: Rect[] = [];
  const page = {
    drawRectangle: (r: Rect) => rects.push(r),
    drawText: () => {},
  } as unknown as PDFPage;
  const font = { widthOfTextAtSize: () => 10 } as unknown as PDFFont;
  drawBarcode(page, { regular: font, semibold: font, bold: font }, UPC, "art");
  // Drop the white contrast underlays; bars are near-black (0.1).
  return rects.filter((r) => r.color.red < 0.5);
}

describe("drawBarcode", () => {
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
