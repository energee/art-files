// tests/canvas-draw.test.ts — the canvas backend against a recording fake
// ctx: Node has no 2D canvas, so what is pinned here is the PAINT PROTOCOL
// (order, colors, transforms), not rasterized pixels — the pixel side is
// covered by the print-geometry goldens. Plans come from planLayers over the Lolev
// master with deterministic fake metrics.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawPlate } from "../src/canvas/draw";
import { planLayers, type PlacedLayer } from "../src/planLayers";
import type { MeasureFace, PlacedBarcode } from "./legacy/planShared";
import type { BarcodeLayer } from "../src/model/layers";
import { MASK_BLUE_HEX, PAGE } from "./legacy/layout";
import { labelFontCss } from "../src/fonts";
import { logoSvg, lolevLayers, type LolevOpts } from "./fixtures";

// drawPlate requires the font family explicitly (no poppins default).
const FONT = labelFontCss("poppins");
const m: MeasureFace = (t, size) => t.length * size * 0.5;
const GOLD = "#F3CD80";

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

const plan = (opts: LolevOpts = {}): PlacedLayer[] =>
  planLayers(lolevLayers(opts), m, { logoSvg, custom: opts.custom });
/** Both page layers bound to assets "tex" / "msk". */
const withPages: LolevOpts = {
  overrides: { background: { asset: "tex" }, mask: { asset: "msk" } },
  custom: { tex: { aspect: 1 }, msk: { aspect: 1 } },
};
const bitmap = { width: 100, height: 100 } as unknown as CanvasImageSource;
/** Ops after drawPlate's one unconditional pre-loop translate (BLEED_SHIFT):
 *  the items' own paint, without the plate's background fills. */
const afterTranslate = (log: { op: string; args: unknown[] }[]) =>
  log.slice(log.findIndex((x) => x.op === "translate") + 1);

describe("drawPlate", () => {
  /** Every Path2D a draw filled or stroked, in order. */
  const pathObjects = (log: { op: string; args: unknown[] }[]) =>
    log.filter((x) => x.op === "fill" || x.op === "stroke").map((x) => x.args[0] as { d: string });

  it("reuses each Path2D across repaints and re-plans of the same logo and QR", () => {
    let parsed = 0;
    vi.stubGlobal("Path2D", class { constructor(public d?: string) { parsed++; } });
    const first = fakeCtx();
    drawPlate(first.ctx, plan().filter((p) => p.id === "logo" || p.id === "qr"), {}, "art", FONT);
    const afterFirst = parsed;
    // Every keystroke replans, so a FRESH plan must still hit the cache.
    const second = fakeCtx();
    drawPlate(second.ctx, plan().filter((p) => p.id === "logo" || p.id === "qr"), {}, "mask", FONT);
    expect(parsed).toBe(afterFirst);
    const a = pathObjects(first.log), b = pathObjects(second.log);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBe(a.length);
    b.forEach((p, i) => expect(p).toBe(a[i]));
  });

  it("a changed QR gets new Path2Ds while the unchanged logo keeps its own", () => {
    /** The path strings of a plan's paths items whose id passes `keep`. */
    const pathStrings = (p: PlacedLayer[], keep: (id: string) => boolean) =>
      new Set(p.flatMap((x) => (x.kind === "paths" && keep(x.id) ? x.paths : [])));
    const isQr = (id: string) => id === "qr";
    const before = plan();
    const first = fakeCtx();
    drawPlate(first.ctx, before, {}, "art", FONT);
    const old = new Set(pathObjects(first.log));
    for (const overrides of [{ qr: { qrStyle: "square" as const } }, { qr: { size: 70 } }]) {
      const after = plan({ overrides });
      const qr = pathStrings(after, isQr), logo = pathStrings(after, (id) => id === "logo");
      expect(qr).not.toEqual(pathStrings(before, isQr));
      const next = fakeCtx();
      drawPlate(next.ctx, after, {}, "art", FONT);
      const drawn = pathObjects(next.log);
      const qrDrawn = drawn.filter((p) => qr.has(p.d));
      const logoDrawn = drawn.filter((p) => logo.has(p.d));
      expect(qrDrawn.length).toBeGreaterThan(0);
      expect(logoDrawn.length).toBeGreaterThan(0);
      for (const p of qrDrawn) expect(old.has(p)).toBe(false);
      for (const p of logoDrawn) expect(old.has(p)).toBe(true);
    }
  });

  it("mask mode with no mask bitmap floods the plate white-ink blue first", () => {
    for (const p of [plan(), plan(withPages)]) {
      const { ctx, log } = fakeCtx();
      drawPlate(ctx, p, {}, "mask", FONT);
      const firstText = log.findIndex((c) => c.op === "fillText");
      const floodIdx = log.findIndex(
        (c, i) => c.op === "set:fillStyle" && c.args[0] === MASK_BLUE_HEX && i < firstText);
      expect(log.filter((c) => c.op === "fillRect").length).toBeGreaterThanOrEqual(2);
      expect(floodIdx).toBeGreaterThan(-1);
    }
  });

  it("mask mode draws the mask page item instead of flooding when its bitmap is loaded", () => {
    const { ctx, log } = fakeCtx();
    drawPlate(ctx, plan(withPages), { images: { msk: bitmap } }, "mask", FONT);
    const firstText = log.findIndex((c) => c.op === "fillText");
    expect(log.findIndex((c) => c.op === "drawImage")).toBeLessThan(firstText);
    expect(log.some((c, i) => c.op === "set:fillStyle" && c.args[0] === MASK_BLUE_HEX && i < log.findIndex((x) => x.op === "drawImage"))).toBe(false);
  });

  it("art mode draws the background page item before any element, and never the mask", () => {
    const { ctx, log } = fakeCtx();
    drawPlate(ctx, plan(withPages), { images: { tex: bitmap, msk: bitmap } }, "art", FONT);
    const imgs = log.filter((c) => c.op === "drawImage");
    expect(imgs).toHaveLength(1);
    expect(log.findIndex((c) => c.op === "drawImage")).toBeLessThan(log.findIndex((c) => c.op === "fillText"));
    // Cover-fit to the page width; a square bitmap overhangs top and bottom.
    const [, x, y, w] = imgs[0].args as number[];
    expect(x).toBe(0);
    expect(y).toBeLessThan(0);
    expect(w).toBeCloseTo(PAGE.w);
  });

  it("art mode with no background bitmap is bare stock: no drawImage", () => {
    const { ctx, log } = fakeCtx();
    drawPlate(ctx, plan(withPages), {}, "art", FONT);
    expect(log.some((c) => c.op === "drawImage")).toBe(false);
  });

  it("bridges the cavities, then strokes, then fills a stroked text run", () => {
    const { ctx, log } = fakeCtx();
    // Only the volume line, with a stroke forced on, so the rule is exercised
    // unambiguously.
    const stroked = plan({ overrides: { volume: { style: { stroke: "#112233" } } } })
      .filter((r) => r.id === "volume");
    drawPlate(ctx, stroked, {}, "art", FONT);
    const s = log.findIndex((c) => c.op === "strokeText");
    expect(s).toBeGreaterThan(-1);
    // The fillStyle in force at call `i` — scanned backwards rather than
    // sliced and reversed, so it reads as "the last one set before here".
    const inkAt = (i: number) => {
      for (let j = i - 1; j >= 0; j--) if (log[j].op === "set:fillStyle") return log[j].args[0];
    };
    // The cavity bridge fills glyph copies in the STROKE colour ahead of the
    // stroke (see bridgeOffsets); the element's own ink is the fill after it.
    const bridge = log.findIndex((c) => c.op === "fillText");
    expect(bridge).toBeGreaterThan(-1);
    expect(bridge).toBeLessThan(s);
    expect(inkAt(bridge)).toBe("#112233");
    const ink = log.findIndex((c, i) => c.op === "fillText" && i > s);
    expect(ink).toBeGreaterThan(-1);
    expect(inkAt(ink)).toBe(GOLD);
  });

  it("rotates rotated runs a quarter turn counter-clockwise", () => {
    const { ctx, log } = fakeCtx();
    drawPlate(ctx, plan(), {}, "art", FONT);
    const rot = log.find((c) => c.op === "rotate");
    expect(rot).toBeDefined();
    expect(rot!.args[0]).toBeCloseTo(-Math.PI / 2);
  });

  it("paints a raster image rect blue in mask mode, the bitmap in art mode", () => {
    const p = plan({
      variants: ["collab"], overrides: { collabCenter: { asset: "c" } }, custom: { c: { aspect: 1 } },
    }).filter((r) => r.id === "collabCenter");
    expect(p).toHaveLength(1);
    const art = fakeCtx();
    drawPlate(art.ctx, p, { images: { c: bitmap } }, "art", FONT);
    expect(art.log.filter((x) => x.op === "drawImage")).toHaveLength(1);
    const mask = fakeCtx();
    drawPlate(mask.ctx, p, { images: { c: bitmap } }, "mask", FONT);
    // Mask never draws the image itself: one blue footprint rect.
    expect(mask.log.some((x) => x.op === "drawImage")).toBe(false);
    const items = afterTranslate(mask.log);
    expect(items.filter((x) => x.op === "fillRect")).toHaveLength(1);
    expect(items.find((x) => x.op === "set:fillStyle")!.args[0]).toBe(MASK_BLUE_HEX);
  });

  it("a tinted image is recolored at draw time: source-in on a scratch canvas, then drawn (#414)", () => {
    const scratch = fakeCtx();
    const scratchCanvas = { width: 0, height: 0, getContext: () => scratch.ctx };
    vi.stubGlobal("document", { createElement: () => scratchCanvas });
    const item = { kind: "image" as const, id: "i1", asset: "c", x: 10, y: 10, w: 20, h: 10, tint: GOLD as `#${string}` };
    const art = fakeCtx();
    drawPlate(art.ctx, [item], { images: { c: bitmap } }, "art", FONT);
    // The scratch holds the bitmap at its own size, then the fill composited
    // source-in: the fill color wherever the art has alpha, like tintRgba.
    expect([scratchCanvas.width, scratchCanvas.height]).toEqual([100, 100]);
    const ops = scratch.log.map((x) => x.op);
    expect(ops.indexOf("drawImage")).toBeLessThan(ops.indexOf("set:globalCompositeOperation"));
    expect(scratch.log.find((x) => x.op === "set:globalCompositeOperation")!.args[0]).toBe("source-in");
    expect(scratch.log.find((x) => x.op === "set:fillStyle")!.args[0]).toBe(GOLD);
    expect(ops.indexOf("set:globalCompositeOperation")).toBeLessThan(ops.indexOf("fillRect"));
    // The plate draws the tinted scratch, never the raw bitmap.
    const drawn = art.log.filter((x) => x.op === "drawImage");
    expect(drawn).toHaveLength(1);
    expect(drawn[0].args).toEqual([scratchCanvas, 10, 10, 20, 10]);
    // Mask plate is unaffected: the same blue footprint as an untinted image.
    const mask = fakeCtx();
    drawPlate(mask.ctx, [item], { images: { c: bitmap } }, "mask", FONT);
    expect(mask.log.some((x) => x.op === "drawImage")).toBe(false);
    expect(afterTranslate(mask.log).find((x) => x.op === "set:fillStyle")!.args[0]).toBe(MASK_BLUE_HEX);
  });

  it("an image item whose bitmap never loaded is a quiet no-op on either plate", () => {
    const custom = { kind: "image" as const, id: "i1", asset: "missing", x: 10, y: 10, w: 20, h: 10 };
    const art = fakeCtx();
    expect(() => drawPlate(art.ctx, [custom], { images: { other: bitmap } }, "art", FONT)).not.toThrow();
    expect(art.log.some((x) => x.op === "drawImage")).toBe(false);
    const mask = fakeCtx();
    expect(() => drawPlate(mask.ctx, [custom], {}, "mask", FONT)).not.toThrow();
    // No blue footprint rect for the unloaded image (beyond the plate's own
    // background fills, which happen before the item loop).
    expect(afterTranslate(mask.log).some((x) => x.op === "fillRect")).toBe(false);
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
    // Only the logo's items (it ships keylined), so the op stream is unambiguous.
    const stroked = plan().filter((r) => r.id === "logo");
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
   *  CANVAS_LETTER_SPACING is a module-level const evaluated at IMPORT time,
   *  and in Node it short-circuits to "supported" before probing anything —
   *  so the only way to flip it is to re-import draw.ts with a `document`
   *  whose 2D context lacks the property. */
  it("without ctx.letterSpacing, a tracked run is placed glyph by glyph", async () => {
    vi.resetModules();
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({}) }) });
    const { drawPlate: drawUnsupported } = await import("../src/canvas/draw");
    const runs = planLayers([{
      id: "s", name: "S", kind: "text", enabled: true, x: 100, y: 200, anchor: "left", size: 10, align: "left",
      lines: [{ text: "IPA", fill: GOLD, layer: "metallic" }], style: { fill: GOLD, layer: "metallic", letterSpacing: 4 },
    }], m, { logoSvg });
    expect(runs[0].kind === "text" && runs[0].tracking).toBe(4); // the fallback only engages on tracked runs
    const { ctx, log } = fakeCtx();
    drawUnsupported(ctx, runs, {}, "art", FONT);
    const glyphs = log.filter((x) => x.op === "fillText");
    expect(glyphs.map((g) => g.args[0])).toEqual(["I", "P", "A"]);
    // Advance is the glyph's own measured width (3 per char here) + tracking,
    // in user-space px — the pt-scaled transform makes that scale-free.
    expect(glyphs.map((g) => g.args[1])).toEqual([0, 7, 14]);
  });

  it("paints every barcode halo shape before any ink shape", () => {
    const item = plan().find((r): r is PlacedBarcode => r.kind === "barcode")!;
    expect(item.S).toBeGreaterThan(0); // the shipped master carries the halo
    const { ctx, log } = fakeCtx();
    drawPlate(ctx, [item], {}, "art", FONT);
    const itemLog = afterTranslate(log);
    // Ink begins at the switch to the item's own fill colour: the digits'
    // cavity bridge paints fillText in the STROKE colour before that, and
    // those copies belong to the halo pass, not the ink one.
    const inkStart = itemLog.findIndex((x) => x.op === "set:fillStyle" && x.args[0] === item.fill);
    expect(inkStart).toBeGreaterThan(-1);
    const halo = itemLog.map((x, i) => (x.op === "strokeRect" || x.op === "strokeText" ? i : -1)).filter((i) => i >= 0);
    const ink = itemLog.map((x, i) => (i > inkStart && (x.op === "fillRect" || x.op === "fillText") ? i : -1)).filter((i) => i >= 0);
    expect(halo.length).toBeGreaterThan(0);
    expect(ink.length).toBeGreaterThan(0);
    expect(Math.max(...halo)).toBeLessThan(Math.min(...ink));
  });

  it("strokes the mask plate with the same bars and digit glyphs as the art", () => {
    const item = plan().find((r): r is PlacedBarcode => r.kind === "barcode")!;
    const paint = (mode: "art" | "mask") => {
      const { ctx, log } = fakeCtx();
      drawPlate(ctx, [item], {}, mode, FONT);
      return afterTranslate(log)
        .filter((x) => x.op === "strokeRect" || x.op === "fillRect" || x.op === "strokeText" || x.op === "fillText")
        .map((x) => x.op);
    };
    const ops = paint("mask");
    expect(ops).toEqual(paint("art"));
    expect(ops).toContain("strokeText");
    expect(ops.filter((op) => op === "fillRect")).toHaveLength(item.geo.bars.length);
  });

  it("draws an upright barcode layer's digits inside its own band, with no rotate call", () => {
    const layer: BarcodeLayer = {
      id: "bc1", name: "BC", kind: "barcode", enabled: true, x: 28.68, y: 28.68, anchor: "left",
      symbology: "code-128", value: "LOLEV-123", h: 30, moduleW: 1, style: { fill: "#000000", layer: "white" },
    };
    const [item] = planLayers([layer], m, { logoSvg }) as PlacedBarcode[];
    expect(item.rotated).toBe(false);
    expect(item.digits.length).toBeGreaterThan(0);
    const { ctx, log } = fakeCtx();
    drawPlate(ctx, [item], {}, "art", FONT);
    // No rotate() call at all: `rotated: false` means this backend skips the
    // quarter-turn it applies to the template.
    expect(log.some((x) => x.op === "rotate")).toBe(false);
    // Every digit's translate() lands inside that digit's own footprint pill
    // — the same band the white-ink plate reserves for it.
    const pills = item.footprint.slice(item.geo.bars.length);
    expect(pills.length).toBe(item.digits.length);
    const translates = log.filter((x) => x.op === "translate").map((x) => x.args as [number, number]);
    for (const pill of pills) {
      expect(translates.some(([tx, ty]) =>
        tx >= pill.x - 1e-6 && tx <= pill.x + pill.w + 1e-6 && ty >= pill.yTop - 1e-6 && ty <= pill.yTop + pill.h + 1e-6)).toBe(true);
    }
  });
});

it("draws a text layer in its own font while other layers inherit the default", () => {
  const { ctx, log } = fakeCtx();
  drawPlate(ctx, plan({ overrides: { warning: { fontFamily: "barlow-condensed" } } }), {}, "art", FONT);
  const fonts = log.filter((op) => op.op === "set:font").map((op) => String(op.args[0]));
  expect(fonts.some((font) => font.endsWith("LabelFont-barlow-condensed"))).toBe(true);
  expect(fonts.some((font) => font.endsWith("LabelFont-poppins"))).toBe(true);
});

/** Issue #86: the PDF is drawn unkerned (pdf-lib emits no kerning), so the
 *  preview must be too — both what it measures and what it paints — or the
 *  screen shows Barlow Condensed ~8% tighter than the file prints. */
describe("canvas text is unkerned, like the PDF (#86)", () => {
  it("drawPlate turns kerning off before painting any text", () => {
    const { ctx, log } = fakeCtx();
    drawPlate(ctx, plan(), {}, "art", FONT);
    const kerning = log.findIndex((x) => x.op === "set:fontKerning" && x.args[0] === "none");
    expect(kerning).toBeGreaterThan(-1);
    expect(kerning).toBeLessThan(log.findIndex((x) => x.op === "fillText"));
  });

  it("the plan's canvas measure (loadLabelFaces) measures with kerning off", async () => {
    vi.resetModules();
    const seen: string[] = [];
    const measureCtx: Record<string, unknown> = {
      font: "", fontKerning: "auto",
      measureText: () => { seen.push(String(measureCtx.fontKerning)); return { width: 1 }; },
    };
    vi.stubGlobal("FontFace", class { load() { return Promise.resolve(this); } });
    vi.stubGlobal("document", { fonts: { add() {} }, createElement: () => ({ getContext: () => measureCtx }) });
    const { loadLabelFaces } = await import("../src/fonts");
    (await loadLabelFaces("barlow-condensed"))("AVATAR", 10, "regular");
    expect(seen).toEqual(["none"]);
  });
});
