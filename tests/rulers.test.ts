// rulers.test.ts — ruler conversion, tick-density, and locked-guide geometry.
import { describe, expect, it } from "vitest";
import { ART, PAGE } from "../src/layout";
import {
  DEFAULT_MARGIN_PT, layoutGuides, majorStep, pointToScreen, pointToUnit,
  rulerTicks, screenToPoint, unitToPoint,
} from "../src/rulers";

describe("preview rulers", () => {
  it("round-trips page points through a zoomed and panned frame", () => {
    const screen = pointToScreen(ART.x + 144, -83, 1462.8, PAGE.w);
    expect(screenToPoint(screen, -83, 1462.8, PAGE.w)).toBeCloseTo(ART.x + 144);
  });

  it("uses the trim edge as zero and reports bleed as negative", () => {
    expect(pointToUnit(ART.x, ART.x, "in")).toBe(0);
    expect(pointToUnit(0, ART.x, "in")).toBeCloseTo(-ART.x / 72);
    expect(unitToPoint(8, ART.x, "in")).toBeCloseTo(ART.x + ART.w);
  });

  it("uses 600-DPI deliverable pixels rather than CSS screen pixels", () => {
    expect(pointToUnit(ART.x + ART.w, ART.x, "px")).toBe(4800);
    expect(pointToUnit(ART.y + ART.h, ART.y, "px")).toBe(3000);
    expect(unitToPoint(150, ART.x, "px")).toBeCloseTo(ART.x + 18);
  });

  it("chooses denser major ticks as the page zooms", () => {
    expect(majorStep(585.12, PAGE.w, "in")).toBe(1);
    expect(majorStep(1462.8, PAGE.w, "in")).toBe(0.5);
    expect(majorStep(585.12, PAGE.w, "px")).toBe(500);
    expect(majorStep(1462.8, PAGE.w, "px")).toBe(250);
  });

  it("anchors tick zero to the trim edge through pan", () => {
    const frameStart = 25;
    const frameSize = PAGE.w * 2;
    const ticks = rulerTicks({
      visibleStart: 0, visibleEnd: 900, frameStart, frameSize,
      pageSize: PAGE.w, origin: ART.x, unit: "in",
    });
    const zero = ticks.find((tick) => tick.value === 0);
    expect(zero?.major).toBe(true);
    expect(zero?.screen).toBeCloseTo(frameStart + ART.x * 2);
    expect(zero?.label).toBe("0");
  });

  it("derives quarter-inch margins plus center and middle from the trim box", () => {
    const guides = layoutGuides(DEFAULT_MARGIN_PT);
    expect(guides.verticalMargins.map((p) => pointToUnit(p, ART.x, "in")))
      .toEqual([0.25, 7.75]);
    expect(guides.horizontalMargins.map((p) => pointToUnit(p, ART.y, "in")))
      .toEqual([0.25, 4.75]);
    expect(pointToUnit(guides.center, ART.x, "in")).toBe(4);
    expect(pointToUnit(guides.middle, ART.y, "in")).toBe(2.5);
    expect(guides.verticalMargins.map((p) => pointToUnit(p, ART.x, "px")))
      .toEqual([150, 4650]);
    expect(guides.horizontalMargins.map((p) => pointToUnit(p, ART.y, "px")))
      .toEqual([150, 2850]);
  });
});
