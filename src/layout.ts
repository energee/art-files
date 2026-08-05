// layout.ts — single source of truth for label geometry, in PDF points with a
// TOP-LEFT origin (y down). Draw helpers convert to PDF's bottom-left space.
// Page matches the Photoshop-era deliverables: 8x5in art + 0.0633in bleed.

export const PAGE = { w: 585.12, h: 369.12 };
/** Art box inside the bleed. */
export const ART = { x: 4.56, y: 4.56, w: 576, h: 360 };
export const CENTER_X = PAGE.w / 2;

/** Default metallic gold, sampled from the Labradorite reference render.
 *  (Hex of the old rgb 0.815/0.69/0.44.) */
export const GOLD = "#D0B070" as const;

/** Fixed drawing colors (RGB 0-1). Every element fill is free hex now,
 *  including the barcode's — these remain for the mask's two paints
 *  (knockout white / white-ink blue) and for "none" handling. */
export const COLORS = {
  white: { r: 1, g: 1, b: 1 },
  maskBlue: { r: 0, g: 156 / 255, b: 215 / 255 },
};

/** Parse a Fill to rgb 0-1. "none" = no ink = white in the art PDF. */
export function parseHexFill(fill: `#${string}` | "none"): { r: number; g: number; b: number } {
  if (fill === "none") return COLORS.white;
  const n = parseInt(fill.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

// Left column (values measured from the Labradorite reference PDF) -------
export const LEFT_X = 24.9;
export const VOLUME = { x: LEFT_X, baseline: 29.37, size: 9 };
export const ABV = { x: LEFT_X, baseline: 40.17, size: 9 };
export const DESC_HEADER = { x: LEFT_X, baseline: 60.56, size: 9 };
export const DESC = { x: LEFT_X, firstBaseline: 71.36, leading: 10.8, size: 9 };

// Center column ----------------------------------------------------------
export const WORDMARK = { cx: CENTER_X, baseline: 38.23, size: 22, text: "Lolev Beer" };
export const LOGO = { cx: CENTER_X, cy: 183, w: 33.5 }; // h follows the SVG aspect
export const NAME = { cx: CENTER_X, baseline: 323.28, size: 15.83 };
export const STYLE_LINE = { cx: CENTER_X, baseline: 344.6, size: 12.18 };

/** One px at the 600dpi deliverable, in PDF points (72/600). */
export const PX = 72 / 600;
/** Default per-element outer-stroke width, in px at 600dpi (≈1.8pt). */
export const DEFAULT_STROKE_PX = 15;

// QR (bottom left; stroke width comes from cfg.qrStrokeWidth) ------------
export const QR = { x: 23, yTop: 289, size: 59 };

// Right rotated column (text rotated 90deg CCW, reads bottom-to-top) -----
// x is the baseline's vertical line (glyphs extend to its RIGHT);
// yStart is where the text begins (toward the label bottom).
export const HANDLE_ADDR = { x: 505, yStart: 346.28, size: 13.87 };
// maxLen 330 wraps the warning to the reference's exact 3 columns.
export const WARNING = { x: 516.62, yStart: 344.56, size: 6.06, leading: 7, maxLen: 330 };
// Measured off the reference PDF via `pdftotext -bbox`: the glyph band runs
// x 539.56-569.87 and pdftotext reports the full font box (ascender 1.05em +
// descender 0.35em = 1.40em), so size = 30.31/1.40 and the baseline sits
// 1.05em in from xMin. yStart matches the reference's 149.00 already.
export const STORE_COLD = { x: 562.3, yStart: 149, size: 21.65 };

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

// Colors are cfg.barcodeFill / barcodeStroke / barcodeLayer now (shipping as
// near-black bars in a white halo over white ink); only the geometry lives
// here. Contrast comes from the white ink the mask PDF lays under the whole
// footprint (x/yTop/w/h) — per-bar outlines drawn interleaved with their bars
// distorted module widths badly enough to stop it scanning, which is why
// drawBarcode paints every stroke shape before any fill.
// x/yTop are the plate's top-left. They started as the reference's, measured
// at 600dpi, and were then nudged 3.25pt up and right by hand; x still clears
// the warning's third column (glyphs end ~532.7) — with room to spare now,
// where at the reference position the halo just overlapped it.
export const BARCODE = {
  x: 537.13,
  yTop: 237.23,
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
  stroke: 1.8 * UPC_MOD,
  textSize: UPC_UNITS.fontSize * UPC_MOD,
  /** Bar start to the digit baseline (glyphs grow back toward the bars). */
  textOffset: UPC_DEPTH,
  w: UPC_DEPTH,
};
