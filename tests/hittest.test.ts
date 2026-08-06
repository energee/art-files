import { describe, expect, it } from "vitest";
import { boxesOf, boxOf, hitTest } from "../src/hittest";
import { wrapWarning, warningColumnLen } from "../src/warning";
import { defaultConfig } from "../src/defaults";
import * as L from "../src/layout";
import { measure, measureBW } from "./fixtures";

describe("preview hit-testing", () => {
  const cfg = defaultConfig();

  it("hits the beer name just above its baseline", () => {
    expect(hitTest(L.NAME.cx, L.NAME.baseline - 2, measure, cfg)).toBe("name");
  });

  it("hits the logo inside its box", () => {
    expect(hitTest(L.LOGO.cx, L.LOGO.cy, measure, cfg)).toBe("logo");
  });

  it("boxes a collab slot only when the switch is on AND its art is loaded", () => {
    const both = { left: true, center: true };
    const ids = (c: typeof cfg, slots = both) =>
      new Set(boxesOf(c, measure, slots).map((b) => b.id));
    const on = { ...cfg, collabEnabled: true };
    // Switch off, or slot empty: the renderers draw nothing there, so a box
    // would swallow clicks meant for whatever is behind it.
    expect(ids(cfg).has("collabLeft")).toBe(false);
    expect(ids(on, { left: false, center: false }).has("collabLeft")).toBe(false);
    // The lead-in only introduces the LEFT logo, and goes with it.
    expect(ids(on, { left: false, center: true }).has("collabLead")).toBe(false);
    for (const id of ["collabLead", "collabLeft", "collabCenter"] as const)
      expect(ids(on).has(id)).toBe(true);
  });

  it("hits the collab logo slots inside their fit envelopes", () => {
    const on = { ...cfg, collabEnabled: true };
    const both = { left: true, center: true };
    const left = boxOf("collabLeft", on, measure, both)!;
    expect(hitTest(left.x0 + 1, left.y0 + 1, measure, on, both)).toBe("collabLeft");
    // The centre slot hangs off the laurel, so nudging the laurel carries it.
    const nudged = { ...on, logo: { ...on.logo, offsetY: 10 } };
    const before = boxOf("collabCenter", on, measure, both)!;
    const after = boxOf("collabCenter", nudged, measure, both)!;
    expect(after.y0 - before.y0).toBeCloseTo(10);
  });

  it("hits the QR inside its box", () => {
    expect(hitTest(L.QR.x + 5, L.QR.yTop + 5, measure, cfg)).toBe("qr");
  });

  it("hits the barcode anywhere in its footprint, bars and digit column alike", () => {
    const B = L.BARCODE;
    // Near the bars end (x just inside the left edge) and near the digits end
    // (x just inside the right edge) — BARCODE.w spans the whole symbol depth.
    expect(hitTest(B.x + 1, B.yTop + B.h / 2, measure, cfg)).toBe("barcode");
    expect(hitTest(B.x + B.w - 1, B.yTop + B.h / 2, measure, cfg)).toBe("barcode");
    expect(hitTest(B.x + B.w / 2, B.yTop + 1, measure, cfg)).toBe("barcode");
  });

  it("misses just outside the barcode footprint", () => {
    const B = L.BARCODE;
    expect(hitTest(B.x - 2, B.yTop + B.h / 2, measure, cfg)).not.toBe("barcode");
    expect(hitTest(B.x + B.w + 2, B.yTop + B.h / 2, measure, cfg)).not.toBe("barcode");
    expect(hitTest(B.x + B.w / 2, B.yTop - 2, measure, cfg)).not.toBe("barcode");
    expect(hitTest(B.x + B.w / 2, B.yTop + B.h + 2, measure, cfg)).not.toBe("barcode");
  });

  it("exposes the barcode's footprint as its selection outline", () => {
    const B = L.BARCODE;
    const b = boxOf("barcode", cfg, measure)!;
    expect(b).toEqual({
      id: "barcode", x0: B.x, x1: B.x + B.w, y0: B.yTop, y1: B.yTop + B.h,
    });
  });

  it("hits rotated store-cold text", () => {
    expect(hitTest(L.STORE_COLD.x - 5, L.STORE_COLD.yStart - 20, measure, cfg)).toBe("storeCold");
  });

  it("returns null on empty background", () => {
    expect(hitTest(300, 250, measure, cfg)).toBeNull();
  });

  it("exposes the same box it hit, for drawing the selection", () => {
    const b = boxOf("logo", cfg, measure)!;
    expect(b.x0).toBeCloseTo(L.LOGO.cx - L.LOGO.w / 2, 5);
    expect(hitTest((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, measure, cfg)).toBe("logo");
  });

  // Regression: the logo box used LOGO.w for its height, but the renderers
  // scale logo2025.svg (viewBox 0 0 480 525) by width alone, so the drawn
  // artwork is ~3.1pt taller than that box — clicking the top or bottom of
  // the laurel cleared the selection instead of picking the logo.
  it("covers the logo's drawn height, not a square", () => {
    const b = boxOf("logo", cfg, measure)!;
    expect(b.y1 - b.y0).toBeCloseTo((L.LOGO.w * 525) / 480, 5);
    const nearTop = b.y0 + 0.5;
    expect(hitTest(L.LOGO.cx, nearTop, measure, cfg)).toBe("logo");
    // Just outside the real artwork still misses.
    expect(hitTest(L.LOGO.cx, b.y0 - 1, measure, cfg)).not.toBe("logo");
  });

  // Regression: the warning's hit boxes hardcoded 3 columns spanning the full
  // wrap budget, with nothing tying either number to what wrapWarning
  // actually produces.
  it("derives the warning's columns from the same wrapper the renderers use", () => {
    const cols = wrapWarning((t) => measure(t, L.WARNING.size), L.WARNING.maxLen);
    const boxes = boxesOf(cfg, measure).filter((b) => b.id === "warning");
    expect(boxes).toHaveLength(cols.length);
    boxes.forEach((b, i) => {
      expect(b.y1).toBeCloseTo(L.WARNING.yStart, 5);
      const expectedLen = warningColumnLen(cols[i], L.WARNING.maxLen, (t) => measure(t, L.WARNING.size));
      expect(b.y1 - b.y0).toBeCloseTo(expectedLen, 5);
      expect(b.y1 - b.y0).toBeLessThanOrEqual(L.WARNING.maxLen);
    });
  });

  // Every wrapped warning column is drawn justified — its inter-word spacing
  // stretched so the run reaches exactly maxLen — so a multi-word column's
  // hit box (and, by the same math in drawJustifiedRotated, its printed
  // extent) must measure exactly maxLen, not the ragged natural width.
  it("boxes multi-word warning columns at exactly maxLen (justified, no ragged final column)", () => {
    const cols = wrapWarning((t) => measure(t, L.WARNING.size), L.WARNING.maxLen);
    const boxes = boxesOf(cfg, measure).filter((b) => b.id === "warning");
    cols.forEach((line, i) => {
      const len = boxes[i].y1 - boxes[i].y0;
      if (line.includes(" ")) expect(len).toBeCloseTo(L.WARNING.maxLen, 5);
      else expect(len).toBeCloseTo(measure(line, L.WARNING.size), 5);
    });
  });

  it("measures storeCold at the bold width, matching drawRotated's hardcoded semibold face", () => {
    const b = boxOf("storeCold", cfg, measureBW)!;
    // Tracked: storeCold ships at 1.25pt, and the box has to follow the run
    // the renderer actually draws, not the font's bare measurement.
    const expected = L.trackedWidth(
      measureBW(cfg.storeCold.text, L.STORE_COLD.size, true),
      cfg.storeCold.text,
      cfg.storeCold.letterSpacing,
    );
    expect(b.y1 - b.y0).toBeCloseTo(expected, 5);
  });

  it("measures a bold description line (the default '# HOPS' header) at the bold width", () => {
    const headerBox = boxesOf(cfg, measureBW).find((b) => b.id === "description")!;
    const expected = measureBW("HOPS", L.DESC_HEADER.size, true);
    expect(headerBox.x1 - headerBox.x0).toBeCloseTo(expected, 5);
  });
});
