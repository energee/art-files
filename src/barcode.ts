// barcode.ts — UPC-A layout in label points (top-left origin, y down), shared
// by both deliverable builders. Each renderer only paints; the geometry lives
// here, so the two can't silently disagree about the one element where drift
// means a code that no longer scans.
import * as L from "./layout";
import { encodeUpc } from "./upc";

export interface BarcodeGeometry {
  /** Points per module along the run. */
  mod: number;
  /** Top-origin y of module 0; the run advances upward (decreasing y). */
  bottom: number;
  /** Merged black runs, as rects in label points. */
  bars: { x: number; yTop: number; w: number; h: number }[];
  /** Digit groups. `x` is the baseline line (glyphs grow back toward the bars
   *  under the quarter turn); `center` is the group's centre in modules. */
  digits: { text: string; x: number; center: number }[];
}

/** `measure` returns a digit group's width at BARCODE.textSize, in points —
 *  supplied by the caller so this stays free of any font machinery. */
export function barcodeGeometry(
  upc: string,
  measure: (text: string) => number,
): BarcodeGeometry {
  const B = L.BARCODE;
  const { modules, guards } = encodeUpc(upc);
  const inGuard = (i: number) => guards.some(([a, b]) => i >= a && i < b);
  const mod = (B.h - 2 * B.padRun) / modules.length;
  const bottom = B.yTop + B.h - B.padRun;

  // Merge consecutive modules into one rect per run. Runs never merge across
  // a guard boundary, which keeps the tall guard groups square-ended.
  const bars: BarcodeGeometry["bars"] = [];
  for (let i = 0; i < modules.length; ) {
    if (modules[i] !== "1") { i++; continue; }
    let j = i;
    while (j < modules.length && modules[j] === "1" && inGuard(j) === inGuard(i)) j++;
    bars.push({
      x: B.x,
      yTop: bottom - j * mod,
      // Guard groups run long, into the digits column (JsBarcode guardHeight).
      w: inGuard(i) ? B.guardLen : B.barLen,
      h: (j - i) * mod,
    });
    i = j;
  }

  // The two five-digit groups centre under their 35-module halves. The outer
  // number-system and check digits align to the near/far edge of their quiet
  // zone, which is JsBarcode's textAlign left/right — expressed here as a
  // signed half-width shift.
  const quiet = B.padRun / mod;
  const place = (text: string, anchor: number, dir: -1 | 0 | 1) => ({
    text,
    x: B.x + B.textOffset,
    center: anchor + (dir * measure(text)) / 2 / mod,
  });
  return {
    mod,
    bottom,
    bars,
    digits: [
      place(upc[0], -quiet, 1), // number-system digit, before the symbol
      place(upc.slice(1, 6), 27.5, 0), // centered on modules 10-45
      place(upc.slice(6, 11), 67.5, 0), // centered on modules 50-85
      place(upc[11], modules.length + quiet, -1), // check digit, after it
    ],
  };
}
