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

// #68: only rendered geometry is ink — see renderedOnly in src/logo.ts.
describe("parseLogo non-rendered geometry", () => {
  const TRIANGLE = '<path d="M 40 60 L 60 60 L 50 40 Z"/>';
  const SQUARE = '<path d="M -500 -500 L 500 -500 L 500 500 L -500 500 Z"/>';
  const hidden = (tag: string) => `<${tag} id="x">${SQUARE}</${tag}>${TRIANGLE}`;

  it.each([
    ["a clipPath square around the triangle", `<clipPath id="c">${SQUARE}</clipPath><g clip-path="url(#c)">${TRIANGLE}</g>`],
    ["<defs>", hidden("defs")],
    ["<mask>", hidden("mask")],
    ["<symbol>", hidden("symbol")],
    ["<pattern>", hidden("pattern")],
    ["HTML-commented paths", `<!-- ${SQUARE} -->${TRIANGLE}`],
    // Without the `/>` guard, <defs/> would swallow the triangle up to </defs>.
    ["a self-closing <defs/> without swallowing the art", `<defs/>${TRIANGLE}<defs>${SQUARE}</defs>`],
  ])("ignores %s", (_name, body) => {
    const art = parseLogo(`<svg viewBox="0 0 100 100">${body}</svg>`, 36, 36);
    expect(art.paths).toHaveLength(1);
    // The 20x20 triangle fills the slot rather than shrinking to ~0.7pt.
    expect(art.w).toBeCloseTo(36, 6);
    expect(art.h).toBeCloseTo(36, 6);
  });
});

// #69: basic shapes are ink too — converted to path data in src/logo.ts.
// Elements it can't draw (<use>, <text>, <image>) are rejected by name
// rather than silently dropped.
describe("parseLogo basic shapes", () => {
  const TRIANGLE = '<path d="M 40 60 L 60 60 L 50 40 Z"/>';
  const fit = (body: string) => parseLogo(`<svg viewBox="0 0 100 100">${body}</svg>`, 36, 36);

  it("keeps a <rect> next to a path, fitting both", () => {
    // Rect spans 0..100; triangle 40..60 — the old parser returned only the
    // triangle, blown up to fill the slot.
    const art = fit(`<rect x="0" y="0" width="100" height="100"/>${TRIANGLE}`);
    expect(art.paths).toHaveLength(2);
    expect(art.paths[0]).toBe("M 0 0 L 36 0 L 36 36 L 0 36 Z");
    // The triangle keeps its place inside the rect: 40..60 of 100 → 14.4..21.6.
    expect(art.paths[1].startsWith("M 14.4 21.6")).toBe(true);
  });

  it.each([
    ["rect", '<rect x="10" y="20" width="80" height="40"/>', 80, 40],
    ["rounded rect", '<rect x="10" y="20" width="80" height="40" rx="5"/>', 80, 40],
    ["circle", '<circle cx="50" cy="50" r="25"/>', 50, 50],
    ["ellipse", '<ellipse cx="50" cy="50" rx="40" ry="10"/>', 80, 20],
    ["polygon", '<polygon points="10,10 90,10 50,50"/>', 80, 40],
    ["polyline", '<polyline points="10 10, 90 10 50 30"/>', 80, 20],
    ["line", '<line x1="10" y1="10" x2="90" y2="30"/>', 80, 20],
  ])("converts a lone <%s> to ink", (_name, shape, w, h) => {
    const art = fit(shape);
    expect(art.paths).toHaveLength(1);
    // Aspect of the ink box survives (curves' control points may widen the
    // box by a hair, so compare the ratio loosely).
    expect(art.w / art.h).toBeCloseTo(w / h, 1);
  });

  it("applies a shape's own and its group's transforms", () => {
    const art = fit('<g transform="scale(2,1)"><rect width="10" height="10" transform="translate(5,0)"/></g>');
    expect(art.h / art.w).toBeCloseTo(0.5, 6);
  });

  it.each(["use", "text", "image"])("rejects <%s> by name instead of dropping it", (tag) => {
    expect(() => fit(`${TRIANGLE}<${tag} href="#x"/>`)).toThrow(new RegExp(`<${tag}>`));
  });
});

// #70: any valid XML attribute syntax — either quote, any whitespace before
// the name and around "=" — reads the same (attr in src/logo.ts).
describe("parseLogo attribute syntax", () => {
  const fit = (body: string) => parseLogo(`<svg viewBox="0 0 100 100">${body}</svg>`, 36, 36);
  const SQUARE = "M 40 40 L 60 40 L 60 60 L 40 60 Z";

  it.each([
    ["single quotes", `<path d='${SQUARE}'/>`],
    ["a newline before d", `<path\nd="${SQUARE}"/>`],
    ["a tab before d", `<path\td="${SQUARE}"/>`],
    ["spaces around =", `<path d = "${SQUARE}"/>`],
    ["a double quote inside single quotes", `<path id='a"b' d='${SQUARE}'/>`],
  ])("reads d with %s", (_name, body) => {
    const art = fit(body);
    expect(art.w).toBeCloseTo(36, 6);
    expect(art.paths[0].startsWith("M 0 0")).toBe(true);
  });

  it("applies a single-quoted <g> transform", () => {
    // translate(0,-1000) moves the square far above; the fit then normalizes
    // it back, so compare the unfitted laurel path (viewBox-scaled) instead.
    const art = parseLogo(
      `<svg viewBox="0 0 100 100"><g\ttransform='translate(10,0)'><path d="${SQUARE}"/></g></svg>`, 100);
    expect(art.paths[0].startsWith("M 50 40")).toBe(true);
  });

  it("reads single-quoted shape attributes", () => {
    const art = fit(`<rect x='0' y='0' width='100' height='50'/>`);
    expect(art.h / art.w).toBeCloseTo(0.5, 6);
  });

  it("doesn't read a longer name ending in the attribute's", () => {
    // stroke-width must not be taken for width.
    expect(() => fit(`<rect stroke-width="5" height="10"/>`)).toThrow();
  });
});
