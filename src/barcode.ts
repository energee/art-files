// barcode.ts — barcode layout in label points (top-left origin, y down),
// shared by both deliverable builders: bar geometry is symbology-agnostic
// (any {modules, guards} pattern), while the human-readable digit layout
// below stays UPC-A-specific. Each renderer only paints; the geometry lives
// here, so the two can't silently disagree about the one element where drift
// means a code that no longer scans.
import type { LabelConfig } from "./types";
import * as L from "./layout";
import { encodeUpc, encodeEan13, type UpcModules } from "./upc";
import { encodeCode128 } from "./code128";

/** The three symbologies the model's "code" field kind can dispatch to.
 *  Re-declared (not imported) on FieldDecl in src/model/types.ts to avoid a
 *  circular import; keep the two in sync. */
export type Symbology = "upc-a" | "ean-13" | "code-128";

/** Encode `value` under the named symbology into the shared {modules,
 *  guards} shape consumed by barcodeGeometry. */
export function encodeFor(symbology: Symbology, value: string): UpcModules {
  switch (symbology) {
    case "upc-a": return encodeUpc(value);
    case "ean-13": return encodeEan13(value);
    case "code-128": return encodeCode128(value);
  }
}

/** The barcode's resolved outer-stroke ("halo") width, in points — the one
 *  place both deliverable builders get it from, so the art PDF's ink extent
 *  and the mask/PSD footprint cannot drift apart and fringe on press.
 *  - stroke "none" -> 0, which both builders read as "draw no halo at all".
 *  - an explicit barcodeStrokeWidth is px at the 600dpi deliverable.
 *  - UNSET keeps BARCODE.stroke, the ~1.8-module halo measured off the
 *    finished labels (NOT DEFAULT_STROKE_PX), so a config saved before the
 *    barcode was stylable still prints exactly as it always has. */
/** The barcode's true white-ink footprint: one rect per bar plus one pill per
 *  digit group, each outset by the halo `S`, in the same top-left coordinates
 *  as BarcodeGeometry. Both plates paint exactly these rects — the PDF's mask
 *  branch flipping them into PDF space, the PSD unioning them into a shape
 *  layer — so the white-ink plate cannot drift from the ink it underlies. A
 *  single bounding rect used to stand in for all of this; that under-covered
 *  the gaps between bars and the digit column, which can unprint the code on
 *  a textured stock. At S = 0 (stroke "none") it reduces to the bars' and
 *  digits' own ink, still needed under the ink for scan contrast.
 *
 *  The bar outsets are square while the art's halo rounds those corners at
 *  radius S, so this over-covers by a hair there — the safe direction:
 *  under-coverage fringes, over-coverage hides. */
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
 *  supplied by the caller so this stays free of any font machinery.
 *  `pattern`, when supplied, is drawn instead of encoding `upc` as UPC-A —
 *  the entry point for any non-UPC symbology (see `encodeFor`). The
 *  human-readable digit layout below is UPC-A-specific: it runs on the
 *  default (no `pattern`) path, and on any supplied pattern that still
 *  carries UPC/EAN-style guard groups (an explicit `encodeUpc`/`encodeEan13`
 *  pattern reproduces the same digits as the default path); a guardless
 *  pattern (Code 128) gets bars only, with an empty `digits` array —
 *  human-readable text for EAN-13/Code 128 arrives with the layer renderer
 *  in a later plan. */
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
    digits: guards.length === 0 ? [] : [
      place(upc[0], -quiet, 1), // number-system digit, before the symbol
      place(upc.slice(1, 6), 27.5, 0), // centered on modules 10-45
      place(upc.slice(6, 11), 67.5, 0), // centered on modules 50-85
      place(upc[11], modules.length + quiet, -1), // check digit, after it
    ],
  };
}
