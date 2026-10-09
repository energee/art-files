// Historical pre-v3 geometry, retained only by the test oracle.
export * from "../../src/layout";
import { LEFT_X, CENTER_X, SAFE, TRIM, DEFAULT_MARGIN_PT, DEFAULT_STROKE_PX, PX } from "../../src/layout";

export const VOLUME = { x: LEFT_X, baseline: 35.49, size: 9 };
export const ABV = { x: LEFT_X, baseline: 46.29, size: 9 };
export const DESC_HEADER = { x: LEFT_X, baseline: 66.68, size: 9 };
export const DESC = { x: LEFT_X, firstBaseline: 77.48, leading: 10.8, size: 9 };

// Collab logos -----------------------------------------------------------
// The left slot flows below the description, so its y depends on how many
// description lines there are — see collabLeftFlow(). The center slot hangs a
// fixed gap under the laurel. Both fit their art inside maxW x maxH.
export const COLLAB_LEAD = {
  x: LEFT_X, size: 9, leading: 10.8, gapAbove: 21.6,
  lines: ["A collaborative", "project with"],
};
export const COLLAB_LEFT = { x: LEFT_X, gapAbove: 8, maxW: 70, maxH: 44 };
export const COLLAB_CENTER = { cx: CENTER_X, gapAbove: 14, maxW: 36, maxH: 36 };

/** Where the left collab block lands, given the description's line count.
 *  Returns top-left-origin points: a baseline per lead-in line, plus the top
 *  edge of the logo box below them. */
export function collabLeftFlow(descLineCount: number) {
  const descBottom = DESC.firstBaseline + Math.max(descLineCount - 1, 0) * DESC.leading;
  const leadBaselines = COLLAB_LEAD.lines.map(
    (_, i) => descBottom + COLLAB_LEAD.gapAbove + i * COLLAB_LEAD.leading,
  );
  return {
    leadBaselines,
    logoTop: leadBaselines[leadBaselines.length - 1] + COLLAB_LEFT.gapAbove,
  };
}

// Center column ----------------------------------------------------------
// baseline 44.96, not the reference's 38.23: the cap tops of "Lolev Beer" then
// sit on the 0.335in top margin instead of 6.73pt above it.
export const WORDMARK = { cx: CENTER_X, baseline: 44.96, size: 22, text: "Lolev Beer" };
export const LOGO = { cx: CENTER_X, cy: 183, w: 33.5 }; // h follows the SVG aspect
// baseline 317.16, not the reference's 323.28: carries the -6.12pt the
// bottom-anchored style line below moved up when the margin grew, keeping
// the name/style gap at the reference's 20.14pt instead of squeezing to 14.
export const NAME = { cx: CENTER_X, baseline: 317.16, size: 15.83 };
// baseline 337.30, not the reference's 344.6: the deepest descender then rests
// on the 0.335in bottom margin instead of 7.30pt below it.
export const STYLE_LINE = { cx: CENTER_X, baseline: 337.30, size: 12.18 };

// QR (bottom left; stroke width comes from cfg.qrStrokeWidth) ------------
/** Squared to the safe margins: x shares LEFT_X's left edge, and yTop is set
 *  so the plate's bottom (yTop + size) lands exactly on the bottom margin
 *  (ART.y + ART.h - 24.12 = 340.44). The reference had 23/289, which hung the
 *  plate past that margin. */
export const QR = { x: LEFT_X, yTop: SAFE.bottom - 59, size: 59 }; // yTop 281.44

// Right rotated column (text rotated 90deg CCW, reads bottom-to-top) -----
// x is the baseline's vertical line (glyphs extend to its RIGHT);
// yStart is where the text begins (toward the label bottom).
// Size 12.91, down from the reference's 13.87, so the run spans the safe area
// exactly instead of overshooting it. Three things make its drawn length
// longer than the glyphs alone: the inline **handle** run sets in Bold,
// the element ships tracked at 0.38, and the outer stroke paints 1.8pt beyond
// the ink at each end. yStart (the run's bottom) is one stroke width inside the
// bottom margin for the same reason. Frozen: the live position is the
// master's handleAddress layer, not this constant. The ink-and-stroke solver
// that produced these numbers was removed in #435; to re-solve the master's
// layer, start from `git show 1a9b1a9^:tests/legacy/check-margins.mts`.
// x 487, in from the reference's 505: the warning grew to 4 columns of 8.2pt
// type (see WARNING below) and pushed the whole rotated block left so its
// last column clears the barcode halo. Info keeps its slot at the block's
// left edge, just clear of the warning's first column.
export const HANDLE_ADDR = { x: 474.58, yStart: 339.58, size: 12.91 };
// Size 8.2 with the element's -0.05 tracking (2026-08): the largest that
// keeps the sentence-case paragraph on 4 columns — and it clears the TTB's
// 2mm minimum character height (caps measure 2.02mm; the old all-caps 5.7pt
// setting was 1.40mm). Four columns no longer fit at the reference x, so the
// whole rotated info block moved left (see HANDLE_ADDR above): x is set so
// the 4th column's ink (descender + stroke) stops at the barcode halo's left
// edge (BARCODE.x - BARCODE.stroke = 535.28).
// yStart is the run's BOTTOM (the text reads bottom-to-top). justifiedRotatedRuns
// (plan.ts) stretches every column to exactly maxLen, so all three share a top and a
// bottom edge by construction rather than by measurement — the only question is
// where those edges land. maxLen is the safe span less the outer stroke at each
// end, and yStart is one stroke inside the bottom margin, which puts the drawn
// ink (stroke included) exactly on both guides. Aiming the GLYPHS at the guides
// instead leaves the stroke hanging 1.8pt over each one.
export const WARNING = {
  // leading 10 keeps the columns at the same spacing-to-size ratio the 5.7pt
  // setting had (7/5.7): stroke boxes kiss between columns, ink does not.
  x: 488.18, yStart: 338.64, size: 8.2, leading: 10,
  maxLen: TRIM.h - 2 * DEFAULT_MARGIN_PT - 2 * DEFAULT_STROKE_PX * PX,
};

// Measured off the reference PDF via `pdftotext -bbox`: the glyph band runs
// x 539.56-569.87 and pdftotext reports the full font box (ascender 1.05em +
// descender 0.35em = 1.40em), so size = 30.31/1.40 = 21.65 and the baseline
// sits 1.05em in from xMin. yStart matches the reference's 149.00 already.
// Size later reduced 1.5pt from the measured value by request (2026-08).
// x 556.30, not the measured 562.3: squared to the right margin like the rest
// of the layout. All caps, so the only ink past the rotated baseline is the
// 0.14pt by which O and C overshoot it — hence 0.14 short of the margin's
// 556.44, which lands that overshoot exactly on the guide.
// yStart 163.15, not the reference's 149: at the reference value the run's top
// sat past the top margin, because its 1.25 tracking adds 11.25pt of length
// that the size alone doesn't show. Moved down so its top lands on the
// guide, level with Info's and the warning's. Unstroked, unlike its neighbours,
// so nothing reaches past the ink here.
export const STORE_COLD = { x: SAFE.right - 0.14, yStart: 163.15, size: 20.15 }; // x 556.30

// Barcode (right edge, rotated 90deg CCW: bars run horizontally) ---------
// Proportions are JsBarcode's UPC-A rendering, so this matches the
// barcode-qr app exactly at any scale. That app passes width 1, height 15,
// textMargin 4 and fontSize 20 — which JsBarcode's UPC-A clamps to
// width * 10 — giving these module counts:
const UPC_UNITS = {
  /** The symbol itself. */
  modules: 95,
  /** Quiet zone each side; JsBarcode encodes it as "00000000" and prints
   *  the number-system / check digits inside it. */
  quiet: 8,
  /** Plain bar length. */
  barH: 15,
  /** Digit em size (JsBarcode: min(fontSize, width * 10)). */
  fontSize: 10,
  /** Gap between the bar ends and the digit baseline. */
  textMargin: 4,
};
/** Depth of the whole symbol (bars + gap + digits) in modules. */
const UPC_DEPTH_MODULES = UPC_UNITS.barH + UPC_UNITS.textMargin + UPC_UNITS.fontSize; // 29
/** Points per module, set so the symbol is exactly as deep as the reference
 *  label's barcode plate (measured 29.88pt at 600dpi = 29 modules). That
 *  also lands the run at 111 * mod = 114.4pt, matching its 114pt height. */
const UPC_MOD = 29.88 / UPC_DEPTH_MODULES;
/** Bar-start to digit baseline — JsBarcode's text y for a bottom value row. */
const UPC_DEPTH = UPC_DEPTH_MODULES * UPC_MOD;
/** The white halo around the symbol, in points (~1.8 modules — see the note
 *  on BARCODE.stroke). Named so BARCODE.x's right-margin squaring and the
 *  stroke it clears derive from the same value: retune the halo and the
 *  plate moves with it. */
const UPC_STROKE = 1.8 * UPC_MOD;

// Colors and plates are cfg.barcodeFill / barcodeStroke / barcodeLayer /
// barcodeStrokeLayer now (shipping as near-black bars in a white halo over
// white ink); only the geometry lives here. Contrast comes from the white ink the mask PDF lays under the whole
// footprint (x/yTop/w/h) — per-bar outlines drawn interleaved with their bars
// distorted module widths badly enough to stop it scanning, which is why
// drawBarcode paints every stroke shape before any fill.
// x/yTop are the plate's top-left. They started as the reference's, measured
// at 600dpi, and were then nudged 3.25pt up and right by hand; x clears the
// warning's LAST column by construction now — WARNING.x is solved so that
// column's ink stops at this plate's halo edge (x - stroke = 535.28).
// yTop 226.07, not the reference's 237.23: the plate's bottom (yTop + h) then
// lands on the 0.335in bottom margin rather than past it. x IS squared to
// the right margin now — see the note on it.
export const BARCODE = {
  // Squared to the right margin (2026-08): the halo, not the plate, is the
  // ink edge, so x = margin (556.44) - depth (w) - halo stroke. Pulling the
  // barcode in meant moving the whole rotated info block left with it —
  // HANDLE_ADDR.x and WARNING.x carry the same 12.42pt shift, keeping the
  // warning's last column the same 0.75pt clear of the halo.
  x: SAFE.right - UPC_DEPTH - UPC_STROKE, // 524.71
  yTop: 226.07,
  h: (UPC_UNITS.modules + 2 * UPC_UNITS.quiet) * UPC_MOD,
  /** White-ink margin around the symbol; the reference plate is exactly the
   *  symbol's depth, so there is none. */
  pad: 0,
  /** Quiet zone along the run, in points. */
  padRun: UPC_UNITS.quiet * UPC_MOD,
  /** Plain bar length. */
  barLen: UPC_UNITS.barH * UPC_MOD,
  /** Guard runs: JsBarcode's guardHeight = barH + fontSize/2 + textMargin. */
  guardLen: (UPC_UNITS.barH + UPC_UNITS.fontSize / 2 + UPC_UNITS.textMargin) * UPC_MOD,
  /** Outer stroke around the artwork, in points, measured off the finished
   *  labels (~1.8 modules of white beyond the bars). Between the dense bars
   *  it closes up into a solid field, and around the digits it reads as a
   *  pill — which is exactly how the reference's white shape behaves.
   *  This is what an unset cfg.barcodeStrokeWidth resolves to; note it is
   *  wider than DEFAULT_STROKE_PX * PX (1.85pt vs 1.8pt). */
  stroke: UPC_STROKE,
  textSize: UPC_UNITS.fontSize * UPC_MOD,
  /** Bar start to the digit baseline (glyphs grow back toward the bars). */
  textOffset: UPC_DEPTH,
  w: UPC_DEPTH,
};
