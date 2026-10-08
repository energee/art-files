// layout.ts — single source of truth for label geometry, in PDF points with a
// TOP-LEFT origin (y down). Draw helpers convert to PDF's bottom-left space.
// Page matches the Photoshop-era deliverables: an 8x5in die (TRIM) plus a
// per-side bleed that ships at the Photoshop value and is now a Settings knob
// (see BLEED / setBleed).
// It also states the PHYSICAL objects the label is made for — the label's own
// size in inches and the can it wraps (see CAN_DIAM_IN) — because those are
// facts about the product, not about any one renderer, and the inspector, the
// render-settings defaults and the 3D scene all have to agree on them.

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
 *  readout; the page is 585.12pt = 8.126666...in. The default does ship at the
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
export const SAFE = {
  left: MEASURED_BLEED + DEFAULT_MARGIN_PT,
  right: MEASURED_BLEED + TRIM.w - DEFAULT_MARGIN_PT,
  top: MEASURED_BLEED + DEFAULT_MARGIN_PT,
  bottom: MEASURED_BLEED + TRIM.h - DEFAULT_MARGIN_PT,
  center: MEASURED_BLEED + TRIM.w / 2,
};

export const PAGE = { w: TRIM.w + 2 * BLEED, h: TRIM.h + 2 * BLEED };
/** Cover-fit an image over the full bleed page, centered — shared by the PDF
 *  builders and the canvas backend. Centered, so the same rect serves both a
 *  top-left and a bottom-left origin: (PAGE.h - h) / 2 is the inset from
 *  either edge. */
export function coverFit(imgW: number, imgH: number) {
  const s = Math.max(PAGE.w / imgW, PAGE.h / imgH);
  const w = imgW * s;
  const h = imgH * s;
  return { x: (PAGE.w - w) / 2, y: (PAGE.h - h) / 2, w, h };
}

/** Widest the 2D preview sheet is drawn on screen, in CSS px. It lives here
 *  rather than in PreviewCompare's class list because the 3D scene has to
 *  predict that sheet's on-screen height to frame its own label to match
 *  (see canScene's framingDistance) — two readers, one number. */
export const PREVIEW_MAX_W = 900;
/** The zoom ceiling every view shares: App clamps the 2D zoom to it and
 *  canScene derives its closest orbit from it, so a view handoff is never
 *  silently clipped. (Raster density is previewRasterScale's job.) */
export const PREVIEW_OVERSAMPLE = 2.5;
/** Hard ceiling for the zoom-aware 2D raster. At the default page size this
 *  is 4876 x 3076 (about 60 MB of RGBA per canvas); PreviewCompare keeps the
 *  art and mask paints serial, so their temporary render surfaces do not peak
 *  together. This is the same 600-DPI density used for print output and keeps
 *  high-DPR zoom sharp without putting full-resolution uploaded textures back
 *  into the live rebuild loop. */
export const PREVIEW_RASTER_MAX_SCALE = 600 / 72;
/** Long-edge guard at the shipped page geometry. The scale cap above keeps
 *  ordinary pages at 600 DPI; this second bound keeps a user-expanded bleed
 *  from growing a preview canvas past the same memory budget. */
export const PREVIEW_RASTER_MAX_EDGE = Math.round(PAGE.w * PREVIEW_RASTER_MAX_SCALE);

/** Raster density for a 2D view. CSS zoom stays immediate; the preview
 *  debounces re-rasterization to this density after the gesture settles.
 *  Derived from the sheet's ON-SCREEN size, not from PREVIEW_OVERSAMPLE: the
 *  sheet is at most PREVIEW_MAX_W CSS px wide, so PREVIEW_MAX_W * zoom * dpr
 *  device pixels is exactly one raster pixel per device pixel. Oversampling
 *  past that bought no visible detail and cost backing store on every repaint
 *  (the paint runs per keystroke). */
export const previewRasterScale = (zoom: number, devicePixelRatio = 1) =>
  Math.min(
    PREVIEW_RASTER_MAX_SCALE,
    (PREVIEW_MAX_W / PAGE.w) * Math.max(1, zoom) * Math.max(1, devicePixelRatio),
  );
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
const CAN_HEIGHT_IN = 6.19;
const CAN_DIAM_IN = 2.6;
/** What the label actually wraps, so the basis for its width knob. The 8in
 *  art covers very nearly all of it. */
const CAN_CIRCUM_IN = Math.PI * CAN_DIAM_IN;

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
 *  hit-tester's glyph boxes, the barcode digits' pills that size the solid
 *  background (planLayers.ts) and their tests, so one measured value can't drift into three. */
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
export let OUTPUT_DPI = 0; // set by setOutputDpi(DESIGN_DPI) below
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
 *  NOTE for callers: this affects only the current process. `npm run
 *  generate`'s Node harness (scripts/generate.ts) imports this module in a
 *  separate process with its own state. It calls setBleed with the master’s
 *  physical.bleedIn and does not read the app’s local Settings. */
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

/** The warning's shipped tracking — named because it is geometry, not taste:
 *  defaultConfig ships it and parseConfigFile stamps it onto legacy configs,
 *  and without it the 8.2pt paragraph wraps into a 5th column under the
 *  barcode. One constant so a retune can't miss the migration. */
export const WARNING_TRACKING = -0.05;
