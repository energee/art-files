// tests/canvas-draw.test.ts — the canvas backend against a recording fake
// ctx: Node has no 2D canvas, and what parity needs pinned here is the PAINT
// PROTOCOL (order, colors, transforms), not rasterized pixels — the pixel
// side is the parity page's job.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { drawPlate, type CanvasAssets } from "../src/canvas/draw";
import { barcodeItem, planLabel, type MeasureFace } from "../src/plan";
import { defaultConfig } from "../src/defaults";
import { MASK_BLUE_HEX, PAGE } from "../src/layout";
import { labelFontCss } from "../src/fonts";
import { assets as fixtureAssets } from "./fixtures";

// drawPlate requires the font family explicitly (no poppins default).
const FONT = labelFontCss("poppins");

// The shared fixture logo — fixtures.ts exists so every suite reads ONE copy.
const logoSvg = fixtureAssets.logoSvg;
const m: MeasureFace = (t, size) => t.length * size * 0.5;

/** Records every call and property set, in order, so ordering rules
 *  (stroke-before-fill, background-before-elements) are assertable. */
function fakeCtx() {
  const log: { op: string; args: unknown[] }[] = [];
  const target: Record<string, unknown> = { canvas: { width: PAGE.w * 2, height: PAGE.h * 2 } };
  const ctx = new Proxy(target, {
    get(t, p: string) {
      if (p in t) return t[p];
      return (...args: unknown[]) => { log.push({ op: p, args }); };
    },
    set(t, p: string, v) {
      t[p] = v;
      log.push({ op: `set:${p}`, args: [v] });
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}

beforeEach(() => {
  vi.stubGlobal("Path2D", class { constructor(public d?: string) {} });
});

const cfg = defaultConfig();
const plan = () => planLabel(cfg, m, { assets: { logoSvg } });

describe("drawPlate", () => {
  it("mask mode with no mask image floods the plate white-ink blue first", () => {
    const { ctx, log } = fakeCtx();
    drawPlate(ctx, plan(), {}, "mask", FONT);
    const rects = log.filter((c) => c.op === "fillRect");
    // White base, then the blue flood, both before any element paints.
    const firstText = log.findIndex((c) => c.op === "fillText");
    const floodIdx = log.findIndex(
      (c, i) => c.op === "set:fillStyle" && c.args[0] === MASK_BLUE_HEX && i < firstText);
    expect(rects.length).toBeGreaterThanOrEqual(2);
    expect(floodIdx).toBeGreaterThan(-1);
  });

  it("art mode draws the texture cover-fit before any element", () => {
    const { ctx, log } = fakeCtx();
    const texture = { width: 100, height: 100 } as unknown as CanvasAssets["texture"];
    drawPlate(ctx, plan(), { texture }, "art", FONT);
    const img = log.findIndex((c) => c.op === "drawImage");
    const firstText = log.findIndex((c) => c.op === "fillText");
    expect(img).toBeGreaterThan(-1);
    expect(img).toBeLessThan(firstText);
  });

  it("strokes a stroked text run before filling it", () => {
    const { ctx, log } = fakeCtx();
    // Force a stroke on the volume line so the rule is exercised.
    const stroked = planLabel(
      { ...cfg, volume: { ...cfg.volume, stroke: "#112233" } }, m, { assets: { logoSvg } });
    drawPlate(ctx, stroked, {}, "art", FONT);
    const s = log.findIndex((c) => c.op === "strokeText");
    const f = log.findIndex((c) => c.op === "fillText");
    expect(s).toBeGreaterThan(-1);
    expect(s).toBeLessThan(f);
  });

  it("rotates rotated runs a quarter turn counter-clockwise", () => {
    const { ctx, log } = fakeCtx();
    drawPlate(ctx, plan(), {}, "art", FONT);
    const rot = log.find((c) => c.op === "rotate");
    expect(rot).toBeDefined();
    expect(rot!.args[0]).toBeCloseTo(-Math.PI / 2);
  });

  it("paints a raster collab rect blue in mask mode, image in art mode", () => {
    const c = { ...cfg, collabEnabled: true };
    const p = planLabel(c, m, {
      assets: { logoSvg, collabCenter: { kind: "raster", w: 10, h: 10 } },
    });
    const art = fakeCtx();
    drawPlate(art.ctx, p, { collabCenter: {} as CanvasImageSource }, "art", FONT);
    expect(art.log.filter((x) => x.op === "drawImage").length).toBeGreaterThan(0);
    const mask = fakeCtx();
    drawPlate(mask.ctx, p, {}, "mask", FONT);
    // Mask never draws the image itself.
    expect(mask.log.some((x) => x.op === "drawImage")).toBe(false);
  });

  it("throws when an art-mode image item has no bitmap (assembly bug, not a blank)", () => {
    const c = { ...cfg, collabEnabled: true };
    const p = planLabel(c, m, {
      assets: { logoSvg, collabCenter: { kind: "raster", w: 10, h: 10 } },
    });
    const { ctx } = fakeCtx();
    expect(() => drawPlate(ctx, p, {}, "art", FONT)).toThrow(/collabCenter/);
  });

  it("owns textAlign/textBaseline: pins both before any text paints", () => {
    const { ctx, log } = fakeCtx();
    drawPlate(ctx, plan(), {}, "art", FONT);
    const firstText = log.findIndex((x) => x.op === "fillText");
    const align = log.findIndex((x) => x.op === "set:textAlign" && x.args[0] === "left");
    const base = log.findIndex((x) => x.op === "set:textBaseline" && x.args[0] === "alphabetic");
    expect(align).toBeGreaterThan(-1);
    expect(base).toBeGreaterThan(-1);
    expect(align).toBeLessThan(firstText);
    expect(base).toBeLessThan(firstText);
  });

  it("strokes every laurel path before filling any (the laurel-branch rule)", () => {
    // Force a stroke on the logo, then draw ONLY its items so the op stream
    // is unambiguous.
    const stroked = planLabel(
      { ...cfg, logo: { ...cfg.logo, stroke: "#112233" } }, m, { assets: { logoSvg } },
    ).filter((r) => r.id === "logo");
    const { ctx, log } = fakeCtx();
    drawPlate(ctx, stroked, {}, "art", FONT);
    const strokes = log.map((x, i) => (x.op === "stroke" ? i : -1)).filter((i) => i >= 0);
    const fills = log.map((x, i) => (x.op === "fill" ? i : -1)).filter((i) => i >= 0);
    expect(strokes.length).toBeGreaterThan(0);
    expect(fills.length).toBeGreaterThan(0);
    expect(Math.max(...strokes)).toBeLessThan(Math.min(...fills));
  });

  it("paints every barcode halo shape before any ink shape", () => {
    const item = barcodeItem(cfg, m);
    expect(item.S).toBeGreaterThan(0); // default config ships the measured halo
    const { ctx, log } = fakeCtx();
    drawPlate(ctx, [item], {}, "art", FONT);
    // The plate's white background flood is also a fillRect, before the item
    // loop even starts — scope to ops after drawPlate's one unconditional
    // pre-loop translate (BLEED_SHIFT) so the background isn't mistaken for
    // barcode ink.
    const itemLog = log.slice(log.findIndex((x) => x.op === "translate") + 1);
    const halo = itemLog
      .map((x, i) => (x.op === "strokeRect" || x.op === "strokeText" ? i : -1))
      .filter((i) => i >= 0);
    const ink = itemLog
      .map((x, i) => (x.op === "fillRect" || x.op === "fillText" ? i : -1))
      .filter((i) => i >= 0);
    expect(halo.length).toBeGreaterThan(0);
    expect(Math.max(...halo)).toBeLessThan(Math.min(...ink));
  });
});
