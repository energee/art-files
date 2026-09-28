// Historical fixed UPC layout used only by the pre-v3 test oracle.
export * from "../../src/barcode";
import type { LabelConfig } from "../../src/types";
import type { BarcodeGeometry } from "../../src/barcode";
import { encodeUpc, type UpcModules } from "../../src/upc";
import * as L from "./layout";

/** The barcode's resolved outer-stroke ("halo") width, in points — the one
 *  place both deliverable builders get it from, so the art PDF's ink extent
 *  and the mask/PSD footprint cannot drift apart and fringe on press.
 *  - stroke "none" -> 0, which both builders read as "draw no halo at all".
 *  - an explicit barcodeStrokeWidth is px at the 600dpi deliverable.
 *  - UNSET keeps BARCODE.stroke, the ~1.8-module halo measured off the
 *    finished labels (NOT DEFAULT_STROKE_PX), so a config saved before the
 *    barcode was stylable still prints exactly as it always has. */
/** Bars plus one em-box per digit group, each outset by `S`, in the same
 *  top-left coordinates as BarcodeGeometry. The legacy plan stores this on
 *  the item's footprint (pass S = 0). The plates paint the bar rects and the
 *  digit glyphs, not these boxes. */
export function barcodeFootprint(
  geo: BarcodeGeometry, S: number, measure: (text: string) => number,
): { x: number; yTop: number; w: number; h: number }[] {
  const B = L.BARCODE;
  return [
    ...geo.bars.map((b) => ({
      x: b.x - S, yTop: b.yTop - S, w: b.w + 2 * S, h: b.h + 2 * S,
    })),
    ...geo.digits.map((d) => {
      // The glyph run is rotated, so its measured width is the pill's HEIGHT,
      // centred on the group's centre module; the font box spans it crosswise.
      const len = measure(d.text);
      const x0 = d.x - L.FONT_ASC * B.textSize - S;
      const x1 = d.x + L.FONT_DESC * B.textSize + S;
      const yc = geo.bottom - d.center * geo.mod;
      return { x: x0, yTop: yc - len / 2 - S, w: x1 - x0, h: len + 2 * S };
    }),
  ];
}

export function barcodeStrokePt(
  cfg: Pick<LabelConfig, "barcodeStroke" | "barcodeStrokeWidth">,
): number {
  if (cfg.barcodeStroke === "none") return 0;
  if (cfg.barcodeStrokeWidth !== undefined) return cfg.barcodeStrokeWidth * L.PX;
  return L.BARCODE.stroke;
}

/** `measure` returns a digit group's width at BARCODE.textSize, in points —
 *  supplied by the caller so this stays free of any font machinery.
 *  `pattern`, when supplied, is drawn instead of encoding `upc` as UPC-A —
 *  the entry point for any non-UPC symbology (see `encodeFor`). The
 *  human-readable digit layout below is UPC-A-specific and runs ONLY on the
 *  default (no `pattern`) path, where `upc` is known to be a valid UPC-A
 *  string; ANY explicitly supplied pattern — even an explicit
 *  `encodeUpc(upc)` that reproduces the default path's bars exactly — gets
 *  an empty `digits` array. This is a uniform rule, not symbology sniffing:
 *  encodeEan13 shares UPC-A's guard shape, so gating on guard presence would
 *  silently slice a 13-digit EAN value with UPC-A's 12-digit layout. Human-
 *  readable text for EAN-13/Code 128 arrives with the layer renderer in a
 *  later plan. */
export function barcodeGeometry(
  upc: string,
  measure: (text: string) => number,
  pattern?: UpcModules,
): BarcodeGeometry {
  const B = L.BARCODE;
  const { modules, guards } = pattern ?? encodeUpc(upc);
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
    digits: pattern !== undefined ? [] : [
      place(upc[0], -quiet, 1), // number-system digit, before the symbol
      place(upc.slice(1, 6), 27.5, 0), // centered on modules 10-45
      place(upc.slice(6, 11), 67.5, 0), // centered on modules 50-85
      place(upc[11], modules.length + quiet, -1), // check digit, after it
    ],
  };
}
