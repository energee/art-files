// rulers.ts — pure screen/page conversion and tick/layout-guide geometry for
// the 2D preview rulers. PDF points remain the authoritative coordinate unit.
import { ART, PX } from "@/layout";

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

export const DEFAULT_MARGIN_PT = 18; // 0.25in
const MIN_MAJOR_PX = 56;
const SUBDIVISIONS = 4;
// Pixels mean deliverable pixels at the document's canonical 600 DPI, not CSS
// screen pixels. PX is 72/600pt and is already shared by the PSD renderer.
const UNIT_PT: Record<RulerUnit, number> = { in: 72, pt: 1, px: PX };
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
  return (point - origin) / UNIT_PT[unit];
}

export function unitToPoint(value: number, origin: number, unit: RulerUnit): number {
  return origin + value * UNIT_PT[unit];
}

/** A readable major interval for the current screen scale. */
export function majorStep(frameSize: number, pageSize: number, unit: RulerUnit): number {
  const pxPerUnit = (frameSize / pageSize) * UNIT_PT[unit];
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
