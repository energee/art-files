// layout.ts — single source of truth for label geometry, in PDF points with a
// TOP-LEFT origin (y down). Draw helpers convert to PDF's bottom-left space.
// Page matches the Photoshop-era deliverables: 8x5in art + 0.0633in bleed.

export const PAGE = { w: 585.12, h: 369.12 };
/** Art box inside the bleed. */
export const ART = { x: 4.56, y: 4.56, w: 576, h: 360 };
export const CENTER_X = PAGE.w / 2;

/** Height of the can the 3D views render, in inches — a 16 oz (473 ml)
 *  standard can, whose ~8.1in circumference is what the 8in-wide art wraps.
 *  Nothing in Can.gltf carries real-world units (the model is normalized to
 *  scene height), so this is the one place the physical can is stated. It
 *  exists so the Settings layer can show its label-height knob in inches
 *  rather than as a share of a can nobody measured; the stored value stays a
 *  percentage, which is what canScene consumes. Change this if the shop's
 *  can changes and every reading follows. */
export const CAN_HEIGHT_IN = 6.19;

/** That can's circumference, in inches (2.6in diameter) — what the label
 *  wraps, and so the basis for the Settings layer's label-width knob. The
 *  8in-wide art covers very nearly all of it, which is why a full-width
 *  label reads as ~8in here. */
export const CAN_CIRCUM_IN = Math.PI * 2.6;

/** Default metallic gold. Originally #D0B070 (sampled from the Labradorite
 *  reference render); brightened to #F3CD80 by request 2026-08. */
export const GOLD = "#F3CD80" as const;

/** Fixed drawing colors (RGB 0-1). Every element fill is free hex now,
 *  including the barcode's — these remain for the mask's two paints
 *  (knockout white / white-ink blue) and for "none" handling. */
/** The white-ink plate's ink colour. Hex is the form the PSD writes and the
 *  press specifies; the 0-1 triple below is derived so the two can't drift. */
export const MASK_BLUE_HEX = "#009CD7" as const;

export const COLORS = {
  white: { r: 1, g: 1, b: 1 },
  maskBlue: parseHexFill(MASK_BLUE_HEX),
};

/** Parse a Fill to rgb 0-1. "none" = no ink = white in the art PDF. */
export function parseHexFill(fill: `#${string}` | "none"): { r: number; g: number; b: number } {
  if (fill === "none") return COLORS.white;
  const n = parseInt(fill.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** Poppins' font box, measured with `pdftotext -bbox` off the reference PDF:
 *  ascender 1.05em above the baseline, descender 0.35em below. Shared by the
 *  hit-tester's glyph boxes, the barcode digits' mask pills (pdf/build.ts)
 *  and their tests, so one measured value can't drift into three. */
export const FONT_ASC = 1.05;
export const FONT_DESC = 0.35;

/** On-page length of a text run drawn with letter-spacing: the font's own
 *  measured width plus one gap per ADJACENT GLYPH PAIR. PDF's Tc operator
 *  also emits a gap after the final glyph, but that is advance, not ink —
 *  counting it would push every centred line half a gap left of centre and
 *  leave hit boxes overhanging their text. Shared by all three renderers and
 *  the hit-tester so they can't disagree about how wide a tracked line is. */
export function trackedWidth(base: number, text: string, tracking = 0): number {
  return base + tracking * Math.max(0, text.length - 1);
}

/** Tracked width of a line split into inline runs (see parseRuns), given a
 *  per-run measure. Each run pays one tracking unit for the gap to the next
 *  and the line drops the trailing one, so a single-run line reduces to
 *  trackedWidth of the whole string — which is why an unmarked line measures
 *  exactly as it did before inline runs existed.
 *
 *  Every consumer of a line's width goes through here — the PDF's centring
 *  and per-run advance, the PSD's centring, and the hit-tester's boxes — so
 *  none of them can disagree about how wide a marked-up line draws. The
 *  measure is injected because each speaks to different metrics: pdf-lib
 *  fonts, or hittest's Measure. */
export function runAdvances<T extends { text: string }>(
  runs: T[], measure: (run: T) => number, tracking = 0,
): number[] {
  return runs.map((r) => trackedWidth(measure(r), r.text, tracking) + tracking);
}

export function runsWidth<T extends { text: string }>(
  runs: T[], measure: (run: T) => number, tracking = 0,
): number {
  return runAdvances(runs, measure, tracking).reduce((a, b) => a + b, 0) - tracking;
}

// Left column (values measured from the Labradorite reference PDF) -------
export const LEFT_X = 24.9;
export const VOLUME = { x: LEFT_X, baseline: 29.37, size: 9 };
export const ABV = { x: LEFT_X, baseline: 40.17, size: 9 };
export const DESC_HEADER = { x: LEFT_X, baseline: 60.56, size: 9 };
export const DESC = { x: LEFT_X, firstBaseline: 71.36, leading: 10.8, size: 9 };

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
export const WORDMARK = { cx: CENTER_X, baseline: 38.23, size: 22, text: "Lolev Beer" };
export const LOGO = { cx: CENTER_X, cy: 183, w: 33.5 }; // h follows the SVG aspect
/** logo2025.svg's viewBox aspect (0 0 480 525) — height per unit width. The
 *  renderers derive this live via parseLogo; the hit-tester (no SVG in hand)
 *  reads it from here, so a new logo asset means updating this one ratio
 *  alongside the file. */
export const LOGO_ASPECT = 525 / 480;
export const NAME = { cx: CENTER_X, baseline: 323.28, size: 15.83 };
export const STYLE_LINE = { cx: CENTER_X, baseline: 344.6, size: 12.18 };

/** One px at the 600dpi deliverable, in PDF points (72/600). */
export const PX = 72 / 600;
/** Full 600-DPI document dimensions for PSD raster layers. */
export const PSD_DOC = { w: Math.round(PAGE.w / PX), h: Math.round(PAGE.h / PX) };
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
// descender 0.35em = 1.40em), so size = 30.31/1.40 = 21.65 and the baseline
// sits 1.05em in from xMin. yStart matches the reference's 149.00 already.
// Size later reduced 1.5pt from the measured value by request (2026-08).
export const STORE_COLD = { x: 562.3, yStart: 149, size: 20.15 };

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
