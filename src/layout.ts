// layout.ts — single source of truth for label geometry, in PDF points with a
// TOP-LEFT origin (y down). Draw helpers convert to PDF's bottom-left space.
// Page matches the Photoshop-era deliverables: an 8x5in die (TRIM) plus a
// per-side bleed that ships at the Photoshop value and is now a Settings knob
// (see BLEED / setBleed).
// It also states the PHYSICAL objects the label is made for — the label's own
// size in inches and the can it wraps (see CAN_DIAM_IN) — because those are
// facts about the product, not about any one renderer, and the inspector, the
// preset defaults and the 3D scene all have to agree on them.

/** The die cut — the label that comes off the press, fixed at 8 x 5in. The
 *  PAGE around it grows and shrinks with the bleed knob; this never does. */
export const TRIM = { w: 576, h: 360 };

/** Bleed the position constants in this file were measured at, in points
 *  (4.56pt = exactly 38px at DESIGN_DPI). Every position below is measured
 *  from the PAGE edge, bleed included, so a different bleed moves that edge
 *  out from under them and BLEED_SHIFT puts them back. Not a magic number to
 *  be "cleaned up" — it is the provenance of every measured value in this
 *  file, and re-deriving twenty of them by hand is where a misprinted label
 *  comes from. */
const MEASURED_BLEED = 4.56;

/** The bleed the Photoshop-era page was actually built at, in inches: 4.56/72,
 *  i.e. 0.063333...in. This is the provenance of every position constant below
 *  and the value BLEED_SHIFT is measured against — not necessarily the value
 *  the app ships with.
 *
 *  It is NOT 0.0635. That figure is (8.127 - 8) / 2, half the toolbar's ROUNDED
 *  readout; the page is 585.12pt = 8.126666...in. The preset does ship at the
 *  round 0.0635 by decision (see DEFAULT_RENDER.bleedIn), which grows the page
 *  0.024pt and leaves BLEED_SHIFT at 0.012 — harmless, because the shift keeps
 *  every element the same distance from the TRIM. Keep the two apart: this
 *  constant must track what the positions were MEASURED at, or the shift is
 *  computed from the wrong origin and the whole design slides. */
export const SHIPPED_BLEED_IN = MEASURED_BLEED / 72;

/** Bleed per side, in points — the Settings knob (render.bleedIn), via setBleed.
 *  Deliberately module-private: PAGE and ART already state it in the form every
 *  consumer wants, and BLEED_SHIFT is the only thing the output boundaries need.
 *  Exporting the raw bleed as well would invite a fourth boundary to re-derive
 *  its own shift from it, which is exactly the drift this design avoids. */
let BLEED = MEASURED_BLEED;

/** How far a measured position has to move to keep its distance from the TRIM
 *  once the page grows or shrinks around it. Zero at the shipped bleed, which
 *  is what makes this knob a no-op until someone turns it.
 *
 *  Applied ONCE per output boundary — pdf/build.ts, psd/build.ts and
 *  hittest.ts — and never folded back into the constants below. */
export let BLEED_SHIFT = 0;

/** Safe margin, in points (24.12 = 0.335in) — the guides the preview draws
 *  and the edges the margin-anchored constants below derive from. Lives here
 *  (not rulers.ts, which re-exports it) so one number moves the guides AND
 *  the elements squared to them. */
export const DEFAULT_MARGIN_PT = 24.12; // 0.335in

/** The safe-area edges at MEASURED_BLEED — the frame every margin-squared
 *  position below is an expression of. Frozen at the measured bleed like
 *  CENTER_X, deliberately not ART.x/y: positions are page-absolute at
 *  MEASURED_BLEED and BLEED_SHIFT re-bases them at the output boundaries. */
const SAFE = {
  left: MEASURED_BLEED + DEFAULT_MARGIN_PT,
  right: MEASURED_BLEED + TRIM.w - DEFAULT_MARGIN_PT,
  top: MEASURED_BLEED + DEFAULT_MARGIN_PT,
  bottom: MEASURED_BLEED + TRIM.h - DEFAULT_MARGIN_PT,
};

export const PAGE = { w: TRIM.w + 2 * BLEED, h: TRIM.h + 2 * BLEED };
/** Widest the 2D preview sheet is drawn on screen, in CSS px. It lives here
 *  rather than in PreviewCompare's class list because the 3D scene has to
 *  predict that sheet's on-screen height to frame its own label to match
 *  (see canScene's framingDistance) — two readers, one number. */
export const PREVIEW_MAX_W = 900;
/** How far past 1:1 the 2D preview rasterizes its PDFs — and therefore the
 *  zoom ceiling every view shares, because that is where the bitmap runs out
 *  of real pixels and a further zoom magnifies blur, not detail. It lives here
 *  because all three readers have to agree on it: PreviewCompare rasterizes at
 *  it, App clamps the 2D pane to it, and canScene clamps its dolly to it, so a
 *  zoom carried between the views is never silently clipped on the way in.
 *  ponytail: fixed oversample, CSS downscales; to zoom deeper, re-render the
 *  PDFs at this x zoom while zoomed rather than raising the number. */
export const PREVIEW_OVERSAMPLE = 2.5;
/** Art box inside the bleed — the TRIM, offset by the bleed. Only x/y move
 *  with the knob; the die does not change size. */
export const ART = { x: BLEED, y: BLEED, w: TRIM.w, h: TRIM.h };
/** The page's horizontal centre AT MEASURED_BLEED — a position measured off
 *  the reference PDF like LEFT_X or BARCODE.x, and frozen like them. It is
 *  deliberately not PAGE.w / 2: BLEED_SHIFT is applied uniformly to every
 *  position at the output boundary, so this shifted centre IS the new page's
 *  centre by construction. Recomputing it live would move the centre column
 *  twice — once here and once at the boundary. */
export const CENTER_X = (TRIM.w + 2 * MEASURED_BLEED) / 2;
/** The label's own size in inches — the page (bleed included), which is what
 *  the renderer textures the can with and therefore what its percentage
 *  knobs are percentages of. */
export const LABEL_SHORT_IN = PAGE.h / 72;
export const LABEL_WIDE_IN = PAGE.w / 72;

/** The can the 3D views render: a 16 oz (473 ml) standard can, in inches.
 *  Nothing in Can.gltf carries real-world units (the model is normalized to
 *  scene height), so these two numbers are the one place the physical can is
 *  stated — transcribed from the model's bounding box, and the thing to
 *  change if the shop's can does. They exist so the Settings layer can read
 *  in inches rather than as a share of a can nobody measured; the stored
 *  values stay percentages, which is what canScene consumes. */
export const CAN_HEIGHT_IN = 6.19;
export const CAN_DIAM_IN = 2.6;
/** What the label actually wraps, so the basis for its width knob. The 8in
 *  art covers very nearly all of it. */
export const CAN_CIRCUM_IN = Math.PI * CAN_DIAM_IN;

/** How the trimmed label sits on the can, derived from the artboard rather
 *  than tuned by eye. These were knobs (labelSize / labelWidth, percentages
 *  of the can) that drifted from the label they were meant to depict: the
 *  shipped values drew it 5.076in tall and 7.964in around, against a real
 *  8 x 5in die. The label is a measured object and the can is a measured
 *  object, so their ratio is arithmetic, not a preference.
 *
 *  The wrap lands at 97.9%, comfortably short of meeting itself, so the
 *  cylinder needs no seam clamp — which is why MAX_WRAP_RATIO is gone. */
export const LABEL_WRAP_RATIO = ART.w / 72 / CAN_CIRCUM_IN;
export const LABEL_HEIGHT_RATIO = ART.h / 72 / CAN_HEIGHT_IN;

/** The trim's box inside the printed page, as 0..1 texture coordinates. The
 *  3D views crop every map to it so the can shows the label that comes off
 *  the die, not the bleed that gets cut away. Inset equally on all four
 *  sides, so it survives a flipped V without a separate top/bottom case.
 *
 *  Derived from both PAGE and ART, so setBleed has to recompute it; mutated in
 *  place, like PSD_DOC, so canScene's importers keep their reference. */
export const TRIM_UV = {
  x: ART.x / PAGE.w, y: ART.y / PAGE.h,
  w: ART.w / PAGE.w, h: ART.h / PAGE.h,
};

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
/** Text origin for every left-column element — volume, abv, the description
 *  and its header, and the collab lead-in and logo slot. Sits ON the 0.335in
 *  safe margin (ART.x + 24.12), so the column is square with the guide the
 *  preview draws. The reference PDF had it at 24.9 against the then-0.25in
 *  margin, which left the column 2.65pt inside it while the QR plate below
 *  sat 0.44pt inside — two different left edges in one column. Ink starts a
 *  hair right of this by each glyph's own side bearing; the origin is what's
 *  aligned, because the description is user text and its first glyph can be
 *  anything. */
export const LEFT_X = SAFE.left; // 28.68
// Baselines carry the +6.12pt the margin grew when it moved from 0.25in to
// 0.335in (2026-08), so the column hangs from the new top guide at the same
// distances the reference hung from the old one. The collab block flows from
// DESC (see collabLeftFlow) and follows automatically.
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
/** logo2025.svg's viewBox aspect (0 0 480 525) — height per unit width. The
 *  renderers derive this live via parseLogo; the hit-tester (no SVG in hand)
 *  reads it from here, so a new logo asset means updating this one ratio
 *  alongside the file. */
export const LOGO_ASPECT = 525 / 480;
// baseline 317.16, not the reference's 323.28: carries the -6.12pt the
// bottom-anchored style line below moved up when the margin grew, keeping
// the name/style gap at the reference's 20.14pt instead of squeezing to 14.
export const NAME = { cx: CENTER_X, baseline: 317.16, size: 15.83 };
// baseline 337.30, not the reference's 344.6: the deepest descender then rests
// on the 0.335in bottom margin instead of 7.30pt below it.
export const STYLE_LINE = { cx: CENTER_X, baseline: 337.30, size: 12.18 };

/** The resolution the px-denominated DESIGN values were authored against.
 *  Pinned forever, and deliberately NOT the Settings knob below: a stroke
 *  saved as 15px is 1.8pt of ink on the press, and it has to stay 1.8pt
 *  whatever resolution the file is rastered at. Wire a variable DPI into this
 *  and every label ever saved silently changes stroke weight. */
export const DESIGN_DPI = 600;
/** One design px, in PDF points (72/600). Converts SAVED px values — stroke
 *  widths in the label config — into ink. Never varies. */
export const PX = 72 / DESIGN_DPI;

/** The resolution the deliverables are RASTERED at — the Settings knob. Only
 *  output size depends on it: the PSD's pixel grid and the ruler's px
 *  readout. Live-bound, so importers see the current value.
 *
 *  ponytail: one module-level output resolution, because the app edits one
 *  document at a time on the main thread. If a worker ever rasters, or two
 *  documents open at once, pass it as a parameter instead. */
export let OUTPUT_DPI = DESIGN_DPI;
/** Document dimensions for PSD raster layers, at OUTPUT_DPI. Mutated in place
 *  rather than replaced so the modules that read `PSD_DOC.w` keep working
 *  without re-importing. */
export const PSD_DOC = { w: 0, h: 0 };

/** PSD_DOC is just the PAGE measured at OUTPUT_DPI, so it goes stale when
 *  EITHER of them moves and both mutators below have to republish it. Order
 *  between them doesn't matter — this reads whatever the current page and DPI
 *  are — so a caller setting both simply pays one throwaway recompute. */
function publishPsdDoc() {
  PSD_DOC.w = Math.round((PAGE.w / 72) * OUTPUT_DPI);
  PSD_DOC.h = Math.round((PAGE.h / 72) * OUTPUT_DPI);
}

export function setOutputDpi(dpi: number) {
  OUTPUT_DPI = dpi;
  publishPsdDoc();
}
setOutputDpi(DESIGN_DPI);

/** Set the bleed, in inches per side, and republish every geometry that
 *  depends on it. Same shape as setOutputDpi: mutates the exported records in
 *  place so the fourteen modules holding a reference to PAGE/ART/TRIM_UV/
 *  PSD_DOC keep working without re-importing.
 *
 *  The position constants above are NOT rebased — they stay exactly as
 *  measured, and the three output boundaries add BLEED_SHIFT once each.
 *
 *  ponytail: one module-level document geometry, because the app edits exactly
 *  one label at a time. If it ever opens two, thread a Geometry through the
 *  renderers instead of reading module state.
 *
 *  NOTE for callers: the PDF preview worker runs its own copy of this module
 *  (separate registry), so calling this on the main thread alone leaves the
 *  worker building at the default. pdf/client.ts ships the value with every
 *  request for exactly that reason. */
export function setBleed(inches: number) {
  BLEED = inches * 72;
  BLEED_SHIFT = BLEED - MEASURED_BLEED;
  PAGE.w = TRIM.w + 2 * BLEED;
  PAGE.h = TRIM.h + 2 * BLEED;
  ART.x = BLEED;
  ART.y = BLEED;
  TRIM_UV.x = ART.x / PAGE.w;
  TRIM_UV.y = ART.y / PAGE.h;
  TRIM_UV.w = ART.w / PAGE.w;
  TRIM_UV.h = ART.h / PAGE.h;
  publishPsdDoc();
}

/** Default per-element outer-stroke width, in px at 600dpi (≈1.8pt). */
export const DEFAULT_STROKE_PX = 15;

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
// bottom margin for the same reason. Re-solve with scripts/check-margins.mts if
// the text, the tracking, the margin or the default stroke changes.
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
// yStart is the run's BOTTOM (the text reads bottom-to-top). drawJustifiedRotated
// stretches every column to exactly maxLen, so all three share a top and a
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

/** The warning's shipped tracking — named because it is geometry, not taste:
 *  defaultConfig ships it and parseConfigFile stamps it onto legacy configs,
 *  and without it the 8.2pt paragraph wraps into a 5th column under the
 *  barcode. One constant so a retune can't miss the migration. */
export const WARNING_TRACKING = -0.05;
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

// Colors are cfg.barcodeFill / barcodeStroke / barcodeLayer now (shipping as
// near-black bars in a white halo over white ink); only the geometry lives
// here. Contrast comes from the white ink the mask PDF lays under the whole
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
