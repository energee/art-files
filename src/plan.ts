// plan.ts — the label's display list: WHERE every text run draws, computed
// once, renderer-agnostically. pdf/build.ts and hittest.ts both consume it
// (the canvas backend joins in Phase 2 — see the 2026-08-25 canvas preview
// renderer spec), so placement cannot drift between what is drawn, hit-
// tested, and exported. Coordinates are label-space points with a TOP-LEFT
// origin; backends convert (the PDF's y-flip stays in pdf/build.ts).
// Measurement is injected: the PDF backend passes PDFFont metrics so built
// bytes place text exactly as before, the UI passes the fonts.ts canvas
// metrics — the same split hittest always had.
import type { Fill, Style, StyledLine } from "./types";
import type { ElementId } from "./elements";
import { parseRuns } from "./description";
import { strokeLayerOf } from "./strokes";
import * as L from "./layout";

export type Face = "regular" | "semibold" | "bold";
export type MeasureFace = (text: string, size: number, face: Face) => number;

export type StrokeSpec = { fill: Fill; layer: Style["layer"]; w: number };

export interface PlacedText {
  id: ElementId;
  text: string;
  /** Unrotated: run's left edge / baseline. Rotated (reads bottom-to-top):
   *  x is the baseline's vertical line, y is where the run STARTS, and the
   *  run extends toward smaller y by `w`. */
  x: number;
  y: number;
  /** Drawn width of this run — tracked, without the trailing gap. */
  w: number;
  size: number;
  face: Face;
  tracking: number;
  fill: Fill;
  layer: Style["layer"];
  stroke: StrokeSpec | null;
  rotated: boolean;
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

/** One styled line as placed runs — drawLine's math without the drawing.
 *  `at.face` (the wordmark/name's forced Bold) wins over the bold flag,
 *  exactly like drawLine's opts.font. */
export function lineRuns(
  id: ElementId,
  line: StyledLine,
  m: MeasureFace,
  at: { x?: number; cx?: number; baseline: number; size: number; face?: Face },
): PlacedText[] {
  const runs = parseRuns(line);
  const faceOf = (r: StyledLine): Face => at.face ?? (r.bold ? "semibold" : "regular");
  const tracking = line.letterSpacing ?? 0;
  const advances = L.runAdvances(runs, (r) => m(r.text, at.size, faceOf(r)), tracking);
  const total = advances.reduce((a, b) => a + b, 0) - tracking;
  let x = at.cx !== undefined ? at.cx - total / 2 : at.x!;
  const stroke = strokeSpec(line);
  return runs.map((run, i) => {
    const placed: PlacedText = {
      id, text: run.text, x, y: at.baseline,
      // The run's drawn width is its advance minus the gap to the next run.
      w: advances[i] - tracking,
      size: at.size, face: faceOf(run), tracking,
      fill: run.fill, layer: run.layer, stroke, rotated: false,
    };
    x += advances[i];
    return placed;
  });
}
