// tests/canvas-draw.test.ts — the canvas backend against a recording fake
// ctx: Node has no 2D canvas, and what parity needs pinned here is the PAINT
// PROTOCOL (order, colors, transforms), not rasterized pixels — the pixel
// side is the parity page's job.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawPlate, type CanvasAssets } from "../src/canvas/draw";
import {
  barcodeItem, customBarcodeItem, labelGuides, lineRuns, planLabel, type MeasureFace,
} from "../src/plan";
import type { CustomBarcodeLayer } from "../src/types";
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
  const target: Record<string, unknown> = {
    canvas: { width: PAGE.w * 2, height: PAGE.h * 2 },
    // Real metrics, not a logging stub: the no-letterSpacing fallback advances
    // by measureText(glyph).width, so it needs a number back. 3 per char.
    measureText: (t: string) => {
      log.push({ op: "measureText", args: [t] });
      return { width: t.length * 3 };
    },
  };
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
// Teardown, not inline: a test that stubs `document` (the letterSpacing
// fallback one) must not leak it to its siblings even when an assertion
// throws mid-test. beforeEach re-stubs Path2D for the next one.
afterEach(() => vi.unstubAllGlobals());

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

  it("bridges the cavities, then strokes, then fills a stroked text run", () => {
    const { ctx, log } = fakeCtx();
    // Force a stroke on the volume line so the rule is exercised.
    const stroked = planLabel(
      { ...cfg, volume: { ...cfg.volume, stroke: "#112233" } }, m, { assets: { logoSvg } });
    drawPlate(ctx, stroked, {}, "art", FONT);
    const s = log.findIndex((c) => c.op === "strokeText");
    expect(s).toBeGreaterThan(-1);
    // The fillStyle in force at call `i` — scanned backwards rather than
    // sliced and reversed, so it reads as "the last one set before here".
    const inkAt = (i: number) => {
      for (let j = i - 1; j >= 0; j--) {
        if (log[j].op === "set:fillStyle") return log[j].args[0];
      }
    };
    // The cavity bridge fills glyph copies in the STROKE colour ahead of the
    // stroke (see bridgeOffsets); the element's own ink is the fill after it.
    const bridge = log.findIndex((c) => c.op === "fillText");
    expect(bridge).toBeGreaterThan(-1);
    expect(bridge).toBeLessThan(s);
    expect(inkAt(bridge)).toBe("#112233");
    const ink = log.findIndex((c, i) => c.op === "fillText" && i > s);
    expect(ink).toBeGreaterThan(-1);
    expect(inkAt(ink)).toBe(cfg.volume.fill);
  });

  it("rotates rotated runs a quarter turn counter-clockwise", () => {
    const { ctx, log } = fakeCtx();
    drawPlate(ctx, plan(), {}, "art", FONT);
    const rot = log.find((c) => c.op === "rotate");
    expect(rot).toBeDefined();
    expect(rot!.args[0]).toBeCloseTo(-Math.PI / 2);
  });

  it("paints a raster collab rect blue in mask mode, image in art mode", () => {
    const p = planLabel(cfg, m, {
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

  it("skips an unresolvable custom image id instead of misreading collabCenter's bitmap", () => {
    // A hand-placed item with an id neither slot name recognizes — the shape
    // a custom-layer image takes before asset-bytes wiring exists (deferred
    // to the plan that adds image assets to the UI).
    const custom = { kind: "image" as const, id: "custom-i1" as const, x: 10, y: 10, w: 20, h: 10 };
    const art = fakeCtx();
    expect(() => drawPlate(art.ctx, [custom], { collabCenter: {} as CanvasImageSource }, "art", FONT))
      .not.toThrow();
    expect(art.log.filter((x) => x.op === "drawImage").length).toBe(0);
    const mask = fakeCtx();
    expect(() => drawPlate(mask.ctx, [custom], {}, "mask", FONT)).not.toThrow();
    // No blue footprint rect drawn for the unresolved custom image (beyond
    // the plate's own background fills, which happen before the item loop).
    const itemLog = mask.log.slice(mask.log.findIndex((x) => x.op === "translate") + 1);
    expect(itemLog.some((x) => x.op === "fillRect")).toBe(false);
  });

  it("throws when an art-mode image item has no bitmap (assembly bug, not a blank)", () => {
    const p = planLabel(cfg, m, {
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

  /** The pre-17.4 WKWebView path: those engines silently IGNORE
   *  ctx.letterSpacing, so drawText lays tracked runs out per glyph instead.
   *  No developer ever executes this branch (every dev browser supports the
   *  property), which is exactly why it needs pinning here.
   *
   *  CANVAS_LETTER_SPACING is a module-level const evaluated at IMPORT time,
   *  and in Node it short-circuits to "supported" before probing anything —
   *  so the only way to flip it is to re-import draw.ts with a `document`
   *  whose 2D context lacks the property. */
  it("without ctx.letterSpacing, a tracked run is placed glyph by glyph", async () => {
    vi.resetModules();
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({}) }) });
    const { drawPlate: drawUnsupported } = await import("../src/canvas/draw");
    const runs = lineRuns(
      "styleLine", { text: "IPA", fill: "#C8A951", layer: "metallic", letterSpacing: 4 },
      m, { x: 100, baseline: 200, size: 10 },
    );
    expect(runs[0].tracking).toBe(4); // the fallback only engages on tracked runs
    const { ctx, log } = fakeCtx();
    drawUnsupported(ctx, runs, {}, "art", FONT);
    const glyphs = log.filter((x) => x.op === "fillText");
    expect(glyphs.map((g) => g.args[0])).toEqual(["I", "P", "A"]);
    // Advance is the glyph's own measured width (3 per char here) + tracking,
    // in user-space px — the pt-scaled transform makes that scale-free.
    expect(glyphs.map((g) => g.args[1])).toEqual([0, 7, 14]);
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
    // Ink begins at the switch to the item's own fill colour: the digits'
    // cavity bridge paints fillText in the STROKE colour before that, and
    // those copies belong to the halo pass, not the ink one.
    const inkStart = itemLog.findIndex(
      (x) => x.op === "set:fillStyle" && x.args[0] === item.fill);
    expect(inkStart).toBeGreaterThan(-1);
    const halo = itemLog
      .map((x, i) => (x.op === "strokeRect" || x.op === "strokeText" ? i : -1))
      .filter((i) => i >= 0);
    const ink = itemLog
      .map((x, i) => (i > inkStart && (x.op === "fillRect" || x.op === "fillText") ? i : -1))
      .filter((i) => i >= 0);
    expect(halo.length).toBeGreaterThan(0);
    expect(ink.length).toBeGreaterThan(0);
    expect(Math.max(...halo)).toBeLessThan(Math.min(...ink));
  });

  // Final fix wave (C1): a custom barcode layer's digits must draw UPRIGHT —
  // no quarter-turn — with ink landing inside customBarcodeBox's own band,
  // not rotated off into the bars.
  it("draws a custom barcode layer's digits upright, inside its own band, with no rotate call", () => {
    const layer: CustomBarcodeLayer = {
      id: "custom-bc1", name: "Custom Barcode", type: "barcode",
      symbology: "code-128", value: "LOLEV-123",
      h: 30, moduleW: 1,
      position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 },
      style: { fill: "#000000", layer: "white" },
    };
    const item = customBarcodeItem(layer, m, labelGuides())!;
    expect(item).toBeDefined();
    expect(item.rotated).toBe(false);
    expect(item.digits.length).toBeGreaterThan(0);

    const { ctx, log } = fakeCtx();
    drawPlate(ctx, [item], {}, "art", FONT);

    // No rotate() call at all: the whole point of `rotated: false` is that
    // this backend skips the quarter-turn it applies to the template.
    expect(log.some((x) => x.op === "rotate")).toBe(false);

    // Every digit's translate() (the point fillText/strokeText paint at 0,0
    // relative to) lands inside that digit's own footprint pill — the same
    // band the white-ink plate reserves for it (I1) — proving the ink is not
    // off in the bars' column.
    const pills = item.footprint.slice(item.geo.bars.length);
    expect(pills.length).toBe(item.digits.length);
    const translates = log
      .filter((x) => x.op === "translate")
      .map((x) => x.args as [number, number]);
    for (let i = 0; i < item.digits.length; i++) {
      const pill = pills[i];
      const hit = translates.some(
        ([tx, ty]) => tx >= pill.x - 1e-6 && tx <= pill.x + pill.w + 1e-6
          && ty >= pill.yTop - 1e-6 && ty <= pill.yTop + pill.h + 1e-6,
      );
      expect(hit).toBe(true);
    }
  });
});
