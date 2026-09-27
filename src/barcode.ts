// barcode.ts — the symbology rules every barcode renderer shares: encoding
// and validation dispatch, the quiet zone each symbology reserves, and the
// human-readable digit groups (UPC-A, EAN-13, Code 128). planLayers turns
// these into placed geometry; each renderer only paints it, so none can
// silently disagree about the one element where drift means a code that no
// longer scans.
import { encodeUpc, encodeEan13, validateUpc, validateEan13, type UpcModules } from "./upc";
import { encodeCode128, validateCode128 } from "./code128";

/** The three symbologies the model's "code" field kind can dispatch to.
 *  Re-declared (not imported) on FieldDecl in src/model/types.ts to avoid a
 *  circular import; keep the two in sync. */
export type Symbology = "upc-a" | "ean-13" | "code-128";

/** Encode `value` under the named symbology into the shared {modules,
 *  guards} shape consumed by planLayers. */
export function encodeFor(symbology: Symbology, value: string): UpcModules {
  switch (symbology) {
    case "upc-a": return encodeUpc(value);
    case "ean-13": return encodeEan13(value);
    case "code-128": return encodeCode128(value);
  }
}

/** JsBarcode's UPC-A proportions, as ratios of a
 *  custom barcode layer's own bar height so its digit band scales with
 *  `layer.h`. The planner and hit-box measurement share these ratios. */
export const CUSTOM_BARCODE_DIGIT_SIZE_RATIO = 10 / 15; // fontSize : barH
export const CUSTOM_BARCODE_DIGIT_GAP_RATIO = 4 / 15; // textMargin : barH

/** Quiet-zone width in modules, matching JsBarcode's UPC-A/EAN-13 default —
 *  where barcodeDigitsFor's leading/trailing digit sits, outside the guards. */
const BARCODE_QUIET_MODULES = 8;

/** GS1's minimum Code 128 quiet zone, in modules. */
const CODE128_QUIET_MODULES = 10;

/** The quiet zone `symbology` reserves on EACH side of its symbol, in modules.
 *  UPC-A and EAN-13 print their edge digits out there, so a custom layer's
 *  reported box must include both zones or those digits fall outside it (and
 *  a right-anchored symbol pushes its check digit past the trim). Code 128
 *  has no edge digit but still needs its zone clear to scan. The ONE place
 *  this rule lives: the planner uses it for plotted geometry, hit boxes and
 *  the quiet-zone backing, so all three agree. */
export function quietModulesFor(symbology: Symbology): number {
  return symbology === "code-128" ? CODE128_QUIET_MODULES : BARCODE_QUIET_MODULES;
}

/** Validate `value` under the named symbology — the gate a custom barcode
 *  layer's `value` must pass before `encodeFor` ever runs on it: an invalid
 *  payload (e.g. a still-unexpanded format string, see CustomBarcodeLayer)
 *  must never reach the encoders, which assume a validated string and would
 *  otherwise happily emit a garbage pattern instead of failing loudly. */
export function validateFor(
  symbology: Symbology, value: string,
): { ok: boolean; error?: string } {
  switch (symbology) {
    case "upc-a": return validateUpc(value);
    case "ean-13": return validateEan13(value);
    case "code-128": return validateCode128(value);
  }
}

/** Human-readable digit groups for a layer's encoded pattern.
 *  Per-symbology grouping:
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
 *  share (halves at modules [10,45) and [50,85) of a 95-module symbol). They
 *  are not derived from `modulesLen`, since UPC-A/EAN-13's guard positions
 *  are fixed regardless of the value encoded. */
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
