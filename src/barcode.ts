// barcode.ts — barcode layout in label points (top-left origin, y down),
// shared by both deliverable builders: bar geometry is symbology-agnostic
// (any {modules, guards} pattern), while the human-readable digit layout
// below stays UPC-A-specific. Each renderer only paints; the geometry lives
// here, so the two can't silently disagree about the one element where drift
// means a code that no longer scans.
import type { Validation } from "./validation";
import type { LabelConfig } from "./types";
import * as L from "./layout";
import { encodeUpc, encodeEan13, validateUpc, validateEan13, type UpcModules } from "./upc";
import { encodeCode128, validateCode128 } from "./code128";

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

/** JsBarcode's UPC-A proportions (see layout.ts's UPC_UNITS), as ratios of a
 *  custom barcode layer's own bar height so its digit band scales with
 *  `layer.h` instead of the template's fixed BARCODE.textSize. The ONE place
 *  these two ratios are defined — plan.ts's customBarcodeBox/customBarcodeItem
 *  and elements.ts's customBarcodeDragBox both import them, so a custom
 *  layer's plotted digit band and its hit/drag box can never disagree (they
 *  used to be three independent hand copies of the same two numbers). */
export const CUSTOM_BARCODE_DIGIT_SIZE_RATIO = 10 / 15; // fontSize : barH
export const CUSTOM_BARCODE_DIGIT_GAP_RATIO = 4 / 15; // textMargin : barH

/** Quiet-zone width in modules, matching JsBarcode's UPC-A/EAN-13 default —
 *  where barcodeDigitsFor's leading/trailing digit sits, outside the guards. */
const BARCODE_QUIET_MODULES = 8;

/** The quiet zone `symbology` reserves on EACH side of its symbol, in modules.
 *  UPC-A and EAN-13 print their edge digits out there, so a custom layer's
 *  reported box must include both zones or those digits fall outside it (and
 *  a right-anchored symbol pushes its check digit past the trim). Code 128
 *  has no such digit, so its box is the bare symbol. The ONE place this rule
 *  lives: plan.ts's customBarcodeBox/customBarcodeItem and elements.ts's
 *  customBarcodeDragBox all call it, so the plotted geometry and the hit/drag
 *  box cannot disagree about where a custom barcode's edges are. */
export function quietModulesFor(symbology: Symbology): number {
  return symbology === "code-128" ? 0 : BARCODE_QUIET_MODULES;
}

/** Validate `value` under the named symbology — the gate a custom barcode
 *  layer's `value` must pass before `encodeFor` ever runs on it: an invalid
 *  payload (e.g. a still-unexpanded format string, see CustomBarcodeLayer)
 *  must never reach the encoders, which assume a validated string and would
 *  otherwise happily emit a garbage pattern instead of failing loudly. */
export function validateFor(
  symbology: Symbology, value: string,
): Validation {
  switch (symbology) {
    case "upc-a": return validateUpc(value);
    case "ean-13": return validateEan13(value);
    case "code-128": return validateCode128(value);
  }
}

/** Human-readable digit groups for an EXPLICIT pattern (a custom barcode
 *  layer's own geometry — never the template's, which stays governed by
 *  barcodeGeometry's own UPC-A-specific layout and its digits:[] rule for any
 *  supplied pattern). Per-symbology grouping (P3):
 *  - upc-a: the historical 4-group layout — number-system digit outside the
 *    left guard, two 5-digit groups centered under the left/right 35-module
 *    halves, check digit outside the right guard.
 *  - ean-13: the first digit (implied by parity, not drawn as bars) prints
 *    outside the left guard; the remaining twelve digits split into the two
 *    6-digit groups centered under the same two halves.
 *  - code-128: no guard structure to split around, so the whole value prints
 *    as one group centered under the symbol.
 *  `modulesLen`/`quiet` are in MODULE units (not points): `quiet` is the
 *  quiet-zone width a leading/trailing digit sits within, and `measure`'s
 *  return is read the same way (module units) since this function has no
 *  `mod` (points-per-module) to convert with — the caller, which does have
 *  one, positions each group's actual x/y from `center` itself; the `x` this
 *  function returns is a placeholder callers are expected to replace. The
 *  27.5/67.5 half-centers are the guard layout both encodeUpc/encodeEan13
 *  share (halves at modules [10,45) and [50,85) of a 95-module symbol), same
 *  as barcodeGeometry's own numbers — not derived from `modulesLen`, since
 *  UPC-A/EAN-13's guard positions are fixed regardless of the value encoded. */
export function barcodeDigitsFor(
  symbology: Symbology, value: string, modulesLen: number, quiet: number,
  measure: (text: string) => number,
): BarcodeGeometry["digits"] {
  const place = (text: string, anchor: number, dir: -1 | 0 | 1) => ({
    text, x: 0, center: anchor + (dir * measure(text)) / 2,
  });
  if (symbology === "code-128") return [place(value, modulesLen / 2, 0)];
  if (symbology === "ean-13") {
    return [
      place(value.slice(0, 1), -quiet, 1),
      place(value.slice(1, 7), 27.5, 0),
      place(value.slice(7, 13), 67.5, 0),
    ];
  }
  return [
    place(value.slice(0, 1), -quiet, 1),
    place(value.slice(1, 6), 27.5, 0),
    place(value.slice(6, 11), 67.5, 0),
    place(value.slice(11, 12), modulesLen + quiet, -1),
  ];
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
