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

/** Fixed drawing colors (RGB 0-1). Element fills are free hex now — these
 *  remain for the barcode, mask, and "none" handling. */
export const COLORS = {
  white: { r: 1, g: 1, b: 1 },
  black: { r: 0.1, g: 0.1, b: 0.1 },
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

/** Barcode contrast-stroke width: 0.55 >= half a module (1.07pt), so
 *  single-module gaps fill solid instead of leaving a dark sliver. */
export const INK_STROKE = 0.55;

// QR (bottom left; stroke width comes from cfg.qrStrokeWidth) ------------
export const QR = { x: 23, yTop: 289, size: 59 };

// Right rotated column (text rotated 90deg CCW, reads bottom-to-top) -----
// x is the baseline's vertical line (glyphs extend to its RIGHT);
// yStart is where the text begins (toward the label bottom).
export const HANDLE_ADDR = { x: 505, yStart: 346.28, size: 13.87 };
// maxLen 330 wraps the warning to the reference's exact 3 columns.
export const WARNING = { x: 516.62, yStart: 344.56, size: 6.06, leading: 7, maxLen: 330 };
export const STORE_COLD = { x: 559.2, yStart: 149, size: 17.83 };

// Barcode (right edge, rotated 90deg CCW: bars run horizontally) ---------
// No background block: bars/digits are stroked white for contrast. The block
// footprint (x/yTop/w/h) still defines the white-ink area in the mask PDF.
// padRun insets the code along its run so the first/last digits fit inside.
// x clears the warning's third column (glyphs end ~535.2): with no white
// block behind the bars, the digits column must not interleave with it.
export const BARCODE = {
  x: 536, yTop: 234, w: 36.5, h: 128,
  pad: 3, padRun: 13, textSize: 6, stroke: INK_STROKE,
};
