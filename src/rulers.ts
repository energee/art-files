// rulers.ts — pure screen/page conversion and tick/layout-guide geometry for
// the 2D preview rulers. PDF points remain the authoritative coordinate unit.
import { ART, OUTPUT_DPI } from "@/layout";

export type RulerUnit = "in" | "pt" | "px";
export type GuideAxis = "x" | "y";

export interface ManualGuide {
  id: number;
  axis: GuideAxis;
  point: number;
}

export interface RulerTick {
  /** Position in the ruler overlay's local CSS pixels. */
  screen: number;
  /** Trim-relative value in the selected display unit. */
  value: number;
  major: boolean;
  label?: string;
}

export interface LayoutGuides {
  verticalMargins: readonly [number, number];
  horizontalMargins: readonly [number, number];
  center: number;
  middle: number;
}

// The margin itself lives in layout.ts now (the safe-area edges derive from
// it there); re-exported here so ruler consumers keep their import.
export { DEFAULT_MARGIN_PT } from "@/layout";
const MIN_MAJOR_PX = 56;
const SUBDIVISIONS = 4;
// Pixels mean deliverable pixels at the document's OUTPUT resolution, not CSS
// screen pixels — so the ruler and the size readout count the same pixels the
// exported PSD has. A function rather than a table because OUTPUT_DPI is a
// Settings knob: a table built at import time would freeze it at 600 and the
// px readout would quietly disagree with the file on disk.
const unitPt = (unit: RulerUnit) => unit === "in" ? 72 : unit === "pt" ? 1 : 72 / OUTPUT_DPI;
const MAJOR_STEPS: Record<RulerUnit, readonly number[]> = {
  in: [0.125, 0.25, 0.5, 1, 2, 4, 8, 16],
  pt: [6, 12, 18, 36, 72, 144, 288, 576],
  px: [10, 25, 50, 100, 250, 500, 1000, 2000, 5000],
};

/** Map a PDF point on one page axis into the ruler overlay's CSS pixels. */
export function pointToScreen(
  point: number, frameStart: number, frameSize: number, pageSize: number,
): number {
  return frameStart + (point / pageSize) * frameSize;
}

/** Inverse of pointToScreen; values outside the visible page are intentional. */
export function screenToPoint(
  screen: number, frameStart: number, frameSize: number, pageSize: number,
): number {
  return ((screen - frameStart) / frameSize) * pageSize;
}

export function pointToUnit(point: number, origin: number, unit: RulerUnit): number {
  return (point - origin) / unitPt(unit);
}

export function unitToPoint(value: number, origin: number, unit: RulerUnit): number {
  return origin + value * unitPt(unit);
}

/**
 * A width x height in the chosen display unit, e.g. `8.127 × 5.127 in`.
 * Trailing zeros are dropped so the trim reads `8 × 5` rather than
 * `8.000 × 5.000`.
 *
 * Callers pass PAGE or ART deliberately, because the label has two honest
 * sizes: the PAGE is the artboard that goes to the press and the one the DPI
 * beside it describes (PSD_DOC is derived from it), while ART is the die cut,
 * the size the finished label is ordered and specified at. The toolbar shows
 * the page and names the trim in its tooltip.
 */
export function sizeLabel(widthPt: number, heightPt: number, unit: RulerUnit): string {
  const size = (points: number) => Number(pointToUnit(points, 0, unit).toFixed(3));
  return `${size(widthPt)} × ${size(heightPt)} ${unit}`;
}

/** A readable major interval for the current screen scale. */
export function majorStep(frameSize: number, pageSize: number, unit: RulerUnit): number {
  const pxPerUnit = (frameSize / pageSize) * unitPt(unit);
  return MAJOR_STEPS[unit].find((step) => step * pxPerUnit >= MIN_MAJOR_PX)
    ?? MAJOR_STEPS[unit][MAJOR_STEPS[unit].length - 1];
}

function labelOf(value: number, unit: RulerUnit): string {
  if (Math.abs(value) < 1e-9) return "0";
  if (unit !== "in") return String(Math.round(value));
  return String(Number(value.toFixed(3)));
}

/**
 * Generate major and minor ticks across a visible ruler span. The tick grid
 * is anchored on the trim origin, so zero never drifts when zoom changes.
 */
export function rulerTicks(args: {
  visibleStart: number;
  visibleEnd: number;
  frameStart: number;
  frameSize: number;
  pageSize: number;
  origin: number;
  unit: RulerUnit;
}): RulerTick[] {
  const { visibleStart, visibleEnd, frameStart, frameSize, pageSize, origin, unit } = args;
  if (!(frameSize > 0) || !(pageSize > 0) || visibleEnd <= visibleStart) return [];

  const major = majorStep(frameSize, pageSize, unit);
  const minor = major / SUBDIVISIONS;
  const firstPoint = screenToPoint(visibleStart, frameStart, frameSize, pageSize);
  const lastPoint = screenToPoint(visibleEnd, frameStart, frameSize, pageSize);
  const firstValue = pointToUnit(Math.min(firstPoint, lastPoint), origin, unit);
  const lastValue = pointToUnit(Math.max(firstPoint, lastPoint), origin, unit);
  const startIndex = Math.ceil(firstValue / minor - 1e-9);
  const endIndex = Math.floor(lastValue / minor + 1e-9);
  const ticks: RulerTick[] = [];

  for (let i = startIndex; i <= endIndex; i++) {
    const value = i * minor;
    const isMajor = ((i % SUBDIVISIONS) + SUBDIVISIONS) % SUBDIVISIONS === 0;
    ticks.push({
      screen: pointToScreen(unitToPoint(value, origin, unit), frameStart, frameSize, pageSize),
      value,
      major: isMajor,
      label: isMajor ? labelOf(value, unit) : undefined,
    });
  }
  return ticks;
}

/** Gap between a vertical tick and the end of its label, in CSS px. */
export const VERTICAL_LABEL_GAP = 2;
/** Upper bound on one 8px ruler glyph's advance. Digits measure about 5.3px
 *  in the UI font ("-" and "." less), so this over-reserves slightly rather
 *  than let a label clip the corner. */
const LABEL_CHAR_PX = 5.5;

/**
 * Drop the label (never the tick) of any vertical-ruler tick whose text would
 * reach into the corner. Vertical labels are rotated to read upward from
 * VERTICAL_LABEL_GAP above their tick, so a tick just below the corner ran its
 * label over the unit button. Horizontal labels run away from the corner and
 * need no check.
 */
export function withCornerClear(ticks: RulerTick[], cornerEnd: number): RulerTick[] {
  return ticks.map((tick) =>
    tick.label !== undefined
      && tick.screen - VERTICAL_LABEL_GAP - tick.label.length * LABEL_CHAR_PX < cornerEnd
      ? { ...tick, label: undefined }
      : tick);
}

/** Keep a safe-area inset inside the trimmed art without letting sides cross. */
export function clampMargin(marginPt: number): number {
  return Math.min(Math.min(ART.w, ART.h) / 2, Math.max(0, marginPt));
}

/** Locked margin, center, and middle positions in top-left-origin PDF points. */
export function layoutGuides(marginPt: number): LayoutGuides {
  const margin = clampMargin(marginPt);
  return {
    verticalMargins: [ART.x + margin, ART.x + ART.w - margin],
    horizontalMargins: [ART.y + margin, ART.y + ART.h - margin],
    center: ART.x + ART.w / 2,
    middle: ART.y + ART.h / 2,
  };
}
