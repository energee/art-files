// The collab slots' fit contract: an uploaded SVG's INK is scaled into
// maxW x maxH and translated to the box origin, whatever its viewBox says —
// a corner-of-a-huge-viewBox icon must not render tiny or off-center. The
// laurel path (no maxH) still sizes by viewBox, which LOGO_ASPECT depends on.
import { describe, expect, it } from "vitest";
import { parseLogo } from "../src/logo";

// A 20x20 square of ink parked at (40,40) inside a 1000x1000 viewBox.
const CORNER_SQUARE =
  '<svg viewBox="0 0 1000 1000"><path d="M 40 40 L 60 40 L 60 60 L 40 60 Z"/></svg>';

describe("parseLogo collab fit", () => {
  it("fits and origins the ink, ignoring viewBox padding", () => {
    const art = parseLogo(CORNER_SQUARE, 36, 36);
    // The 20x20 ink fills the 36x36 slot, not 20/1000ths of it.
    expect(art.w).toBeCloseTo(36, 6);
    expect(art.h).toBeCloseTo(36, 6);
    // Translated to the origin, so drawCollab's cx - w/2 centering is exact.
    expect(art.paths[0].startsWith("M 0 0")).toBe(true);
  });

  it("keeps the width cap dominant for wide art", () => {
    const wide = '<svg viewBox="0 0 10 10"><path d="M 0 0 L 8 0 L 8 2 L 0 2 Z"/></svg>';
    const art = parseLogo(wide, 36, 36);
    expect(art.w).toBeCloseTo(36, 6);
    expect(art.h).toBeCloseTo(9, 6); // 2/8 aspect preserved
  });

  it("honours ancestor <g> transforms — text outlines arrive y-up", () => {
    // An L-shape under the scale(1,-1) wrapper text exports carry. With the
    // group transform applied the foot points DOWN after normalization;
    // dropping it (the old bug) mirrored the glyphs.
    const flipped =
      '<svg viewBox="0 0 100 100"><g transform="scale(1,-1)">' +
      '<path d="M 0 0 L 20 0 L 20 10 L 0 10 Z"/></g></svg>';
    const art = parseLogo(flipped, 20, 10);
    // scale(1,-1) puts the ink at y -10..0; normalized to origin, unmirrored.
    expect(art.w).toBeCloseTo(20, 6);
    expect(art.h).toBeCloseTo(10, 6);
    expect(art.paths[0].startsWith("M 0 10")).toBe(true);
  });

  it("applies a group's non-uniform scale to the fitted aspect", () => {
    const wide =
      '<svg viewBox="0 0 100 100"><g transform="scale(2,1)">' +
      '<path d="M 0 0 L 10 0 L 10 10 L 0 10 Z"/></g></svg>';
    const art = parseLogo(wide, 36, 36);
    expect(art.h / art.w).toBeCloseTo(0.5, 6); // 20x10 ink, aspect honoured
  });

  it("still sizes the laurel path by viewBox", () => {
    const art = parseLogo(CORNER_SQUARE, 100); // no maxH = laurel behavior
    expect(art.w).toBeCloseTo(100, 6);
    expect(art.h).toBeCloseTo(100, 6);
  });
});
