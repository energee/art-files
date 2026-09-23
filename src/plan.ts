// plan.ts — shared display-list types and generic text placement primitives.
import type { FontFamilyId } from "./fontCatalog";
import type { Fill, Style, StyledLine } from "./types";
import type { GuideLines } from "./model/position";
import type { BarcodeGeometry } from "./barcode";
import { markedWords, parseRuns } from "./description";
import { strokeLayerOf } from "./strokes";
import * as L from "./layout";

export type Face = "regular" | "semibold" | "bold";
export type MeasureFace = (text: string, size: number, face: Face, family?: FontFamilyId) => number;

export type StrokeSpec = { fill: Fill; layer: Style["layer"]; w: number };

/** The two plates every backend renders. */
export type Mode = "art" | "mask";

export interface PlacedText {
  readonly kind: "text";
  readonly id: string;
  readonly text: string;
  /** Unrotated: run's left edge / baseline. Rotated (reads bottom-to-top):
   *  x is the baseline's vertical line, y is where the run STARTS, and the
   *  run extends toward smaller y by `w`. */
  readonly x: number;
  readonly y: number;
  /** Drawn width of this run — tracked, without the trailing gap. */
  readonly w: number;
  readonly size: number;
  readonly face: Face;
  readonly fontFamily?: FontFamilyId;
  readonly tracking: number;
  readonly fill: Fill;
  readonly layer: Style["layer"];
  readonly stroke: StrokeSpec | null;
  readonly rotated: boolean;
}

/** Vector art placed on the label: pre-scaled absolute path data (see
 *  parseLogo) translated to (x, y), top-left origin. Backends fill with the
 *  nonzero rule (pdf-lib's drawSvgPath and Path2D's default agree); a stroke
 *  paints every path before any fill so overlapping laurel branches keep
 *  clean edges. */
export interface PlacedPaths {
  readonly kind: "paths";
  readonly id: string;
  readonly paths: readonly string[];
  readonly x: number;
  readonly y: number;
  readonly fill: Fill;
  readonly layer: Style["layer"];
  readonly stroke: StrokeSpec | null;
}

/** A raster collab logo's fitted rect. The bytes stay with the backend
 *  (keyed by id); art mode draws the image, mask mode paints the rect
 *  white-ink blue so a full-color logo prints on white ink. */
export interface PlacedImage {
  readonly kind: "image";
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Custom-layer asset key (CustomImageLayer.asset); absent for collab
   *  slots. Backends look bytes up by it. */
  readonly asset?: string;
}

/** The barcode as one item: shared geometry plus everything both plates
 *  paint from. Genuinely mode-asymmetric (art = stroked bars+digits, mask =
 *  the outset footprint), so it stays one item rather than mode-dependent
 *  primitives — the backends keep their paint logic, the geometry exists
 *  once. `digits` follow ONE of two conventions, gated by `rotated`: rotated
 *  (the template) reads bottom-to-top — x is the baseline's vertical line, y
 *  the run's start, extent -w; upright (every custom barcode layer) reads
 *  left-to-right like ordinary text — x is the run's CENTER (left edge is
 *  x - w/2), y is the baseline. Widened from the literal "barcode" to
 *  any layer id so every barcode uses the same placed item. */
export interface PlacedBarcode {
  readonly kind: "barcode";
  readonly id: string;
  readonly geo: BarcodeGeometry;
  /** Resolved halo width in points; 0 = no halo at all. */
  readonly S: number;
  readonly fill: Fill;
  readonly stroke: Fill;
  readonly fillLayer: Style["layer"];
  readonly strokeLayer: Style["layer"];
  readonly textSize: number;
  /** True for the template barcode, whose symbol lives pre-rotated into the
   *  page's vertical right column (modules run along Y) — its digits paint
   *  through a 90° glyph rotation. False for every custom barcode layer
   *  (Task 3), whose symbol is laid out upright (modules along X) — its
   *  digits paint as ordinary horizontal text. Backends (pdf/build.ts,
   *  canvas/draw.ts, psd/build.ts) branch their digit-drawing on this. */
  readonly rotated: boolean;
  readonly digits: readonly { text: string; x: number; y: number; w: number }[];
  /** The white-ink footprint at S = 0 (bars + digit pills); the mask pass
   *  outsets it by S as a border, matching barcodeFootprint's contract. */
  readonly footprint: readonly { x: number; yTop: number; w: number; h: number }[];
}

export type Placed = PlacedText | PlacedPaths | PlacedImage | PlacedBarcode;

/** Collab art as the plan needs it: SVG art plans as paths (the plan fits
 *  it itself, via parseLogo); raster art plans as a fitted rect, so only
 *  the intrinsic pixel size travels — bytes stay with the backend. */
export type PlanArt =
  | { kind: "svg"; svg: string }
  | { kind: "raster"; w: number; h: number };

export interface PlanAssets {
  guides?: Pick<GuideLines, "top" | "bottom"> & Partial<Pick<GuideLines, "left" | "right">>;
  /** Raw contents of logo2025.svg. */
  logoSvg: string;
  collabLeft?: PlanArt | null;
  collabCenter?: PlanArt | null;
  /** Custom image layers' loaded state, keyed by CustomImageLayer's `asset`.
   *  A layer whose key is absent here emits nothing (collab-art contract) —
   *  the asset hasn't loaded/isn't supplied. `aspect` is the intrinsic w/h,
   *  used by every custom image (raster or SVG-before-load) to size its box.
   *  `art` carries the loaded bytes' own shape: absent (not yet decoded) or
   *  `{kind:"raster"}` places the stored rect as before; `{kind:"svg"}`
   *  switches the item to an ink-tight `paths` fit. SVG art is planned as
   *  vectors instead of raster rectangles. */
  custom?: Record<string, { aspect: number; art?: PlanArt }>;
}

/** The guide lines a custom layer's anchor resolves against: the label's
 *  safe-area edges (L.SAFE), center = the midpoint of left/right. The ONE
 *  place this is computed — Task 4's drag-to-position math (model/position.ts)
 *  uses the same GuideLines shape, so a custom layer's plotted position and
 *  its drag guides can never disagree. */
export function labelGuides(): GuideLines {
  return {
    left: L.SAFE.left, right: L.SAFE.right,
    center: (L.SAFE.left + L.SAFE.right) / 2,
    top: L.SAFE.top, bottom: L.SAFE.bottom,
  };
}

/** The element's outer stroke as data (width in points). Null when off —
 *  same rules as pdf/build.ts's strokeOf: no stroke, "none", or width <= 0.
 *  Colors stay unresolved: art mode paints `fill`, mask mode paints by
 *  `layer` — that choice belongs to the backend, not the placement. */
export function strokeSpec(style: Style): StrokeSpec | null {
  if (!style.stroke || style.stroke === "none") return null;
  const px = style.strokeWidth ?? L.DEFAULT_STROKE_PX;
  if (px <= 0) return null;
  return { fill: style.stroke, layer: strokeLayerOf(style), w: px * L.PX };
}

/** One styled line as placed runs: walks the parsed runs left to right (or
 *  centered around `at.cx`), advancing x by each run's measured width plus
 *  tracking. `at.face` (the wordmark/name's forced Bold) wins over the bold
 *  flag on each run. This is the PDF backend's former drawLine, minus the
 *  drawing. */
export function lineRuns(
  id: string,
  line: StyledLine,
  m: MeasureFace,
  at: ({ x: number } | { cx: number }) & { baseline: number; size: number; face?: Face },
): PlacedText[] {
  const runs = parseRuns(line);
  const faceOf = (r: StyledLine): Face => at.face ?? (r.bold ? "semibold" : "regular");
  const tracking = line.letterSpacing ?? 0;
  const advances = L.runAdvances(runs, (r) => m(r.text, at.size, faceOf(r)), tracking);
  const total = advances.reduce((a, b) => a + b, 0) - tracking;
  let x = "cx" in at ? at.cx - total / 2 : at.x;
  const stroke = strokeSpec(line);
  return runs.map((run, i) => {
    const placed: PlacedText = {
      kind: "text", id, text: run.text, x, y: at.baseline,
      // The run's drawn width is its advance minus the gap to the next run.
      w: advances[i] - tracking,
      size: at.size, face: faceOf(run), tracking,
      fill: run.fill, layer: run.layer, stroke, rotated: false,
    };
    x += advances[i];
    return placed;
  });
}

/** Rotated 90° CCW text (reads bottom-to-top) as placed runs: walks the
 *  parsed runs bottom to top, advancing y by each run's measured width plus
 *  tracking (the rotation swaps the advance axis to y). `boldFace` omitted
 *  means inline `**bold**` runs keep `base` (storeCold's contract); given,
 *  they step up (info/warning). This is the PDF backend's former
 *  drawRotated, minus the drawing. */
export function rotatedRuns(
  id: string,
  style: Style,
  text: string,
  m: MeasureFace,
  at: { x: number; yStart: number; size: number; base: Face; boldFace?: Face },
): PlacedText[] {
  const runs = parseRuns({ ...style, text });
  const faceOf = (r: StyledLine): Face => (r.bold ? at.boldFace ?? at.base : at.base);
  const tracking = style.letterSpacing ?? 0;
  const advances = L.runAdvances(runs, (r) => m(r.text, at.size, faceOf(r)), tracking);
  const stroke = strokeSpec(style);
  let yPos = at.yStart;
  return runs.map((run, i) => {
    const placed: PlacedText = {
      kind: "text", id, text: run.text, x: at.x, y: yPos, w: advances[i] - tracking,
      size: at.size, face: faceOf(run), tracking,
      fill: run.fill, layer: run.layer, stroke, rotated: true,
    };
    yPos -= advances[i];
    return placed;
  });
}

/** A justified warning column: inter-word gaps stretched so the span lands
 *  exactly on maxLen (the PDF backend's former drawJustifiedRotated's math).
 *  Word widths measure the runs each word actually draws (markers stripped,
 *  own faces), or a bold-marked column would overshoot; words split via
 *  markedWords so a span crossing a space stays styled. A single word has no
 *  gap and stays at its natural length (see warningColumnLen). */
export function justifiedRotatedRuns(
  id: string,
  style: Style,
  text: string,
  m: MeasureFace,
  at: { x: number; yStart: number; size: number; maxLen: number; base: Face; boldFace?: Face },
): PlacedText[] {
  const words = markedWords(text);
  if (words.length < 2) return rotatedRuns(id, style, text, m, at);
  const faceOf = (r: StyledLine): Face => (r.bold ? at.boldFace ?? at.base : at.base);
  const widths = words.map((w) =>
    L.runsWidth(parseRuns({ ...style, text: w }),
      (r) => m(r.text, at.size, faceOf(r)), style.letterSpacing ?? 0));
  const totalWordWidth = widths.reduce((a, b) => a + b, 0);
  const gap = (at.maxLen - totalWordWidth) / (words.length - 1);
  let cursor = at.yStart;
  return words.flatMap((w, i) => {
    const placed = rotatedRuns(id, style, w, m, { ...at, yStart: cursor });
    cursor -= widths[i] + gap;
    return placed;
  });
}
