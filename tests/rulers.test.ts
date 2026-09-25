// rulers.test.ts — ruler conversion, tick-density, and locked-guide geometry.
import { describe, expect, it } from "vitest";
import {
  ART, BARCODE, DEFAULT_STROKE_PX, DESIGN_DPI, LEFT_X, PAGE, PSD_DOC, PX, QR,
  setOutputDpi, WARNING,
} from "../src/layout";
import {
  DEFAULT_MARGIN_PT, layoutGuides, majorStep, nextRulerUnit, pointToScreen,
  pointToUnit, rulerTicks, screenToPoint, sizeLabel, unitToPoint, withCornerClear,
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

  it("drops a vertical label that would run up into the unit corner, keeping its tick", () => {
    // Vertical labels are rotated to read upward from just above their tick,
    // so a tick a few px under the 20px corner painted "-0.5" over "in" (#134).
    const ticks = withCornerClear([
      { screen: 34, value: -0.5, major: true, label: "-0.5" },
      { screen: 34, value: -1, major: true, label: "-1" },
      { screen: 60, value: 0, major: true, label: "0" },
      { screen: 22, value: 0.125, major: false },
    ], 20);
    expect(ticks.map((tick) => tick.label)).toEqual([undefined, "-1", "0", undefined]);
    expect(ticks.map((tick) => tick.screen)).toEqual([34, 34, 60, 22]);
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

  it("derives 0.335in margins plus center and middle from the trim box", () => {
    const guides = layoutGuides(DEFAULT_MARGIN_PT);
    expect(guides.verticalMargins.map((p) => pointToUnit(p, ART.x, "in")))
      .toEqual([0.335, 7.665]);
    expect(guides.horizontalMargins.map((p) => pointToUnit(p, ART.y, "in")))
      .toEqual([0.335, 4.665]);
    expect(pointToUnit(guides.center, ART.x, "in")).toBe(4);
    expect(pointToUnit(guides.middle, ART.y, "in")).toBe(2.5);
    // 0.335in at the 600dpi output resolution. closeTo: 24.12pt is not exact
    // in binary, so the conversion carries ~1e-14 of float noise.
    expect(guides.verticalMargins.map((p) => pointToUnit(p, ART.x, "px")))
      .toEqual([expect.closeTo(201, 8), 4599]);
    expect(guides.horizontalMargins.map((p) => pointToUnit(p, ART.y, "px")))
      .toEqual([expect.closeTo(201, 8), 2799]);
  });

  it("states the artboard size in each unit without trailing zeros", () => {
    expect(sizeLabel(PAGE.w, PAGE.h, "in")).toBe("8.127 × 5.127 in");
    expect(sizeLabel(PAGE.w, PAGE.h, "pt")).toBe("585.12 × 369.12 pt");
    // The toolbar's px figure IS the exported PSD's pixel size, because
    // PSD_DOC is this same page measured at the same DPI.
    expect(sizeLabel(PAGE.w, PAGE.h, "px")).toBe(`${PSD_DOC.w} × ${PSD_DOC.h} px`);
  });

  it("states the trim as the round size the label is ordered at", () => {
    expect(sizeLabel(ART.w, ART.h, "in")).toBe("8 × 5 in");
    expect(sizeLabel(ART.w, ART.h, "px")).toBe("4800 × 3000 px");
  });

  it("follows the output DPI in px, and leaves saved ink weights alone", () => {
    try {
      setOutputDpi(300);
      // Half the pixels for the same physical label...
      expect(sizeLabel(PAGE.w, PAGE.h, "px")).toBe(`${PSD_DOC.w} × ${PSD_DOC.h} px`);
      expect(PSD_DOC.w).toBe(2438);
      // ...while inches and points, being physical, do not move.
      expect(sizeLabel(PAGE.w, PAGE.h, "in")).toBe("8.127 × 5.127 in");
      // The whole reason DESIGN_DPI is separate: a keyline saved as 15px is
      // 1.8pt of ink at any export resolution. If this ever tracks the knob,
      // every label ever saved silently changes stroke weight.
      expect(DEFAULT_STROKE_PX * PX).toBeCloseTo(1.8);
    } finally {
      setOutputDpi(DESIGN_DPI);
    }
    expect(PSD_DOC.w).toBe(4876);
  });

  it("cycles the toolbar's units back to where it started", () => {
    expect(nextRulerUnit("in")).toBe("pt");
    expect(nextRulerUnit("pt")).toBe("px");
    expect(nextRulerUnit("px")).toBe("in");
  });

  // The left column and the two code plates were squared to these guides (see
  // LEFT_X, QR and BARCODE in layout.ts). Only edges that are pure geometry are
  // asserted — a text element's ink edge needs real font metrics, so the
  // wordmark's and style line's baselines were set by measurement instead.
  // Deliberately NOT asserted: BARCODE.x, which stays 6.30pt past the right
  // margin because pulling its halo in would overlap the warning's third
  // column.
  it("squares the left column and the code plates to the margins", () => {
    const { verticalMargins: [left], horizontalMargins: [, bottom] } =
      layoutGuides(DEFAULT_MARGIN_PT);
    expect(LEFT_X).toBeCloseTo(left, 2);
    expect(QR.x).toBeCloseTo(left, 2);
    expect(QR.yTop + QR.size).toBeCloseTo(bottom, 2);
    expect(BARCODE.yTop + BARCODE.h).toBeCloseTo(bottom, 2);
  });

  // The warning's columns are justified to exactly maxLen, so their DRAWN
  // extent is maxLen plus the outer stroke, which pdf/build.ts paints beyond
  // the ink at both ends. Aiming maxLen at the full span therefore hangs the
  // stroke over both guides — the run has to be the span less one stroke width
  // at each end, starting one stroke inside the bottom margin. layout.ts
  // spells the margin as the literal 36 because importing DEFAULT_MARGIN_PT
  // would be circular; this is what stops the two spellings drifting.
  it("fits the warning's drawn ink, stroke included, between the margins", () => {
    const [top, bottom] = layoutGuides(DEFAULT_MARGIN_PT).horizontalMargins;
    const stroke = DEFAULT_STROKE_PX * PX;
    expect(WARNING.maxLen + 2 * stroke).toBeCloseTo(bottom - top, 6);
    expect(WARNING.yStart + stroke).toBeCloseTo(bottom, 6);
  });
});
