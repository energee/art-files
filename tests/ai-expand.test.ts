// ai-expand.test.ts — the AI export's stroke expansion (src/ai/expand.ts):
// a keyline becomes the shape dilated by w (stroke 2w round ∪ fill), as one
// filled, cubic-only outline. Geometry is checked by re-reading the output
// with CanvasKit's nonzero fill, the rule the PDF builder draws paths with.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import CanvasKitInit, { type CanvasKit, type Path } from "canvaskit-wasm/full";
import { dilate } from "../src/ai/expand";
import { openFont } from "../src/fontkit";
import { outlineText } from "../src/pdf/outline";
import { DEFAULT_STROKE_PX, PX } from "../src/layout";

const SHIPPED_W = DEFAULT_STROKE_PX * PX;
const barlow = openFont(readFileSync(new URL("../src/assets/fonts/BarlowCondensed-Bold.ttf", import.meta.url)));
const glyph = (text: string) => outlineText(barlow, {
  kind: "text", id: "t", text, x: 0, y: 60, w: 0, size: 44, face: "bold",
  fontFamily: "barlow-condensed", tracking: 0, fill: "#000000", layer: "metallic", stroke: null, rotated: false,
});

let ck: CanvasKit;
beforeAll(async () => { ck = await CanvasKitInit(); });

/** Parse with the default (nonzero) fill rule; the caller deletes it. */
const parse = (d: string): Path => {
  const p = ck.Path.MakeFromSVGString(d);
  if (!p) throw new Error(`unparseable: ${d.slice(0, 60)}`);
  return p;
};

const bounds = (d: string) => {
  const p = parse(d);
  const [l, t, r, b] = p.computeTightBounds();
  p.delete();
  return { l, t, r, b };
};

/** Signed area of M/L/C/Z path data, by shoelace over finely sampled cubics. */
function area(d: string): number {
  const nums = (s: string) => s.trim().split(/[\s,]+/).filter(Boolean).map(Number);
  let sum = 0, x0 = 0, y0 = 0, x = 0, y = 0;
  const to = (nx: number, ny: number) => { sum += x * ny - nx * y; x = nx; y = ny; };
  for (const [, cmd, args] of d.matchAll(/([MLCZ])([^MLCZ]*)/g)) {
    const a = nums(args);
    if (cmd === "M") { [x, y] = a; x0 = x; y0 = y; }
    else if (cmd === "L") to(a[0], a[1]);
    else if (cmd === "C") {
      const [sx, sy] = [x, y];
      for (let i = 1; i <= 400; i++) {
        const t = i / 400, u = 1 - t;
        to(u * u * u * sx + 3 * u * u * t * a[0] + 3 * u * t * t * a[2] + t * t * t * a[4],
          u * u * u * sy + 3 * u * u * t * a[1] + 3 * u * t * t * a[3] + t * t * t * a[5]);
      }
    } else to(x0, y0);
  }
  return Math.abs(sum / 2);
}

describe("dilate", () => {
  it("dilates a rect to a rounded rect of exact area, as one outline", async () => {
    const w = 1.8;
    const out = await dilate(["M0 0L10 0L10 10L0 10Z"], w);
    expect(out).toHaveLength(1);
    expect(out[0].match(/M/g)).toHaveLength(1);
    expect(area(out[0])).toBeCloseTo(100 + 4 * 10 * w + Math.PI * w * w, 2);
    const b = bounds(out[0]);
    expect([b.l, b.t, b.r, b.b]).toEqual([-w, -w, 10 + w, 10 + w].map((v) => expect.closeTo(v, 2)));
  });

  it("grows Barlow glyph bounds by w on every side", async () => {
    const [d] = glyph("B8office");
    const [out] = await dilate([d], SHIPPED_W);
    const a = bounds(d), b = bounds(out);
    for (const grow of [a.l - b.l, a.t - b.t, b.r - a.r, b.b - a.b])
      expect(Math.abs(grow - SHIPPED_W)).toBeLessThanOrEqual(0.01);
  });

  // A counter is an unpainted point the glyph's fill encloses on all four
  // axis rays. B and 8 have one above and one below the middle, O one.
  it.each([["B", 2], ["8", 2], ["O", 1]] as const)("keeps %s's counters open at the shipped keyline", async (ch, holes) => {
    const [d] = glyph(ch);
    const [out] = await dilate([d], SHIPPED_W);
    const fill = parse(d), grown = parse(out);
    const { l, t, r, b } = bounds(d);
    const step = 0.2, nx = Math.ceil((r - l) / step), ny = Math.ceil((b - t) / step);
    const inFill = (i: number, j: number) => fill.contains(l + i * step, t + j * step);
    const grid = Array.from({ length: ny }, (_, j) => Array.from({ length: nx }, (_, i) => inFill(i, j)));
    const open = [0, 0]; // [upper half, lower half]
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (grid[j][i]) continue;
      const enclosed = grid[j].slice(0, i).includes(true) && grid[j].slice(i + 1).includes(true)
        && grid.slice(0, j).some((row) => row[i]) && grid.slice(j + 1).some((row) => row[i]);
      if (enclosed && !grown.contains(l + i * step, t + j * step)) open[j < ny / 2 ? 0 : 1]++;
    }
    fill.delete(); grown.delete();
    expect(open[0] + open[1]).toBeGreaterThan(0);
    if (holes === 2) expect(Math.min(...open)).toBeGreaterThan(0);
  });

  it("unions overlapping inputs into one outline", async () => {
    const out = await dilate(["M0 0L10 0L10 10L0 10Z", "M5 5L15 5L15 15L5 15Z"], 1);
    expect(out).toHaveLength(1);
    expect(out[0].match(/M/g)).toHaveLength(1);
  });

  // An open centre-line has no fill; the print PDF's live stroke still draws
  // it as a round-capped band, so its dilation is that band.
  it("dilates an open centre-line to its round-capped band", async () => {
    const [out] = await dilate(["M0 0L10 0"], 1);
    const b = bounds(out);
    expect([b.l, b.t, b.r, b.b]).toEqual([-1, -1, 11, 1].map((v) => expect.closeTo(v, 2)));
  });

  it("returns [] for no keyline width or no paths", async () => {
    for (const w of [0, -1, Number.NaN]) expect(await dilate(["M0 0L10 0L10 10Z"], w)).toEqual([]);
    expect(await dilate([], 1)).toEqual([]);
  });

  it("writes cubic-only path data", async () => {
    const out = (await dilate(glyph("B8office"), SHIPPED_W)).join(" ");
    expect(out).toMatch(/C/);
    expect(out).not.toMatch(/[^MLCZ\d\s.eE-]/);
  });
});
