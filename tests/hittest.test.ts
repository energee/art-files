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

  it("boxes a collab slot only when its art is loaded", () => {
    const both = { left: true, center: true };
    const ids = (c: typeof cfg, slots = both) =>
      new Set(boxesOf(c, measure, slots).map((b) => b.id));
    const on = cfg;
    // Slot empty: the renderers draw nothing there, so a box would swallow
    // clicks meant for whatever is behind it. (On a non-collab label the app
    // hands over no collab art at all, so both slots read empty — see
    // App.tsx's collabFileOf.)
    expect(ids(on, { left: false, center: false }).has("collabLeft")).toBe(false);
    // The lead-in only introduces the LEFT logo, and goes with it.
    expect(ids(on, { left: false, center: true }).has("collabLead")).toBe(false);
    for (const id of ["collabLead", "collabLeft", "collabCenter"] as const)
      expect(ids(on).has(id)).toBe(true);
  });

  it("hits the collab logo slots inside their fit envelopes", () => {
    const on = cfg;
    const both = { left: true, center: true };
    const left = boxOf("collabLeft", on, measure, both)!;
    expect(hitTest(left.x0 + 1, left.y0 + 1, measure, on, both)).toBe("collabLeft");
    // The centre slot hangs off the laurel, so nudging the laurel carries it.
    const nudged = { ...on, logo: { ...on.logo, offsetY: 10 } };
    const before = boxOf("collabCenter", on, measure, both)!;
    const after = boxOf("collabCenter", nudged, measure, both)!;
    expect(after.y0 - before.y0).toBeCloseTo(10);
  });

  it("moves the laurel box by the stack nudge, unconditionally", () => {
    // The nudge exists to clear the centre collab mark, and it arrives with
    // the Collab variant now rather than being gated by a flag: whatever
    // offsetY the resolved config carries is what the box moves by, so the
    // box can never disagree with the drawn laurel (see logoNudge).
    const plain = boxOf("logo", cfg, measure)!;
    const nudged = { ...cfg, logo: { ...cfg.logo, offsetY: 40 } };
    expect(boxOf("logo", nudged, measure)!.y0 - plain.y0).toBeCloseTo(40);
    // The shipped master's own logo declares no offsetY, so a non-collab
    // label's laurel sits exactly where it is laid out.
    expect(cfg.logo.offsetY ?? 0).toBe(0);
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
  // hit box (and, by the same math in plan.ts's justifiedRotatedRuns, its printed
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

  it("measures storeCold at the bold width, matching rotatedRuns's hardcoded semibold face", () => {
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

  it("hits a custom text layer at its box center and misses just outside it", () => {
    const withCustom = {
      ...cfg,
      customLayers: [{
        id: "custom-a1b2c3" as const,
        name: "Extra line",
        type: "text" as const,
        position: { anchor: "left" as const, vAnchor: "top" as const, offsetX: 0, offsetY: 0 },
        line: { text: "Hello", fill: "#000000" as const, layer: "white" as const },
        size: 12,
      }],
    };
    const b = boxOf("custom-a1b2c3", withCustom, measure)!;
    expect(b).not.toBeNull();
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    expect(hitTest(cx, cy, measure, withCustom)).toBe("custom-a1b2c3");
    expect(hitTest(b.x0 - 5, cy, measure, withCustom)).not.toBe("custom-a1b2c3");
  });

  // Regression: before the layer carried its own stored aspect, this box
  // fell back to a square (h = w), which under-estimated a portrait asset's
  // real height and left its bottom half unclickable.
  it("boxes a custom image layer using its stored aspect, not a square fallback", () => {
    const withCustom = {
      ...cfg,
      customLayers: [{
        id: "custom-img1" as const,
        name: "Custom Image",
        type: "image" as const,
        asset: "art1",
        w: 40,
        aspect: 0.5, // portrait: h = w / aspect = 80, twice the width
        position: { anchor: "left" as const, vAnchor: "top" as const, offsetX: 0, offsetY: 0 },
        style: { fill: "none" as const, layer: "white" as const },
      }],
    };
    const b = boxOf("custom-img1", withCustom, measure)!;
    expect(b).not.toBeNull();
    expect(b.x1 - b.x0).toBeCloseTo(40);
    expect(b.y1 - b.y0).toBeCloseTo(80);
    const cy = (b.y0 + b.y1) / 2;
    expect(hitTest((b.x0 + b.x1) / 2, cy, measure, withCustom)).toBe("custom-img1");
    // Near the bottom of the tall box — a square fallback (h = w = 40) would
    // have missed this point entirely.
    expect(hitTest((b.x0 + b.x1) / 2, b.y1 - 1, measure, withCustom)).toBe("custom-img1");
  });
});
