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

// Left column ------------------------------------------------------------
export const LEFT_X = 24.9;
export const VOLUME = { x: LEFT_X, baseline: 25, size: 8 };
export const ABV = { x: LEFT_X, baseline: 34, size: 8 };
export const DESC_HEADER = { x: LEFT_X, baseline: 58.5, size: 10 };
export const DESC = { x: LEFT_X, firstBaseline: 68.4, leading: 10, size: 10 };

// Center column ----------------------------------------------------------
export const WORDMARK = { cx: CENTER_X, baseline: 38.5, size: 22, text: "Lolev Beer" };
export const LOGO = { cx: CENTER_X, cy: 177, w: 40 }; // h follows the SVG aspect
export const NAME = { cx: CENTER_X, baseline: 318, size: 16 };
export const STYLE_LINE = { cx: CENTER_X, baseline: 338.5, size: 11 };

// QR (bottom left) -------------------------------------------------------
export const QR = { x: 23, yTop: 289, size: 59 };

// Right rotated column (text rotated 90deg CCW, reads bottom-to-top) -----
// x is the baseline's vertical line (glyphs extend to its RIGHT);
// yStart is where the text begins (toward the label bottom).
export const HANDLE_ADDR = { x: 502, yStart: 256, size: 10 };
export const WARNING = { x: 511.5, yStart: 256, size: 3.2, leading: 3.6 };
export const STORE_COLD = { x: 541, yStart: 152, size: 18 };

// Barcode (right edge, rotated 90deg CCW: bars run horizontally) ---------
// No background block: bars/digits are stroked white for contrast. The block
// footprint (x/yTop/w/h) still defines the white-ink area in the mask PDF.
// padRun insets the code along its run so the first/last digits fit inside.
export const BARCODE = {
  x: 526.7, yTop: 234, w: 36.5, h: 128,
  // stroke 0.55 >= half a module (1.07pt), so single-module gaps between
  // adjacent bars fill solid white instead of leaving a dark sliver.
  pad: 3, padRun: 13, textSize: 6, stroke: 0.55,
};
