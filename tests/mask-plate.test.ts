// mask-plate.test.ts — the white-ink plate (buildMaskPdf) pinned at the
// operator level, so a polarity or colour regression fails here by name
// instead of surfacing only as a raster-golden diff. Three contracts:
//   - polarity: "metallic" knocks out (white), "white" paints white ink
//     (mask blue), for every element kind the plate draws;
//   - the flood: exactly #009CD7, page-covering, over a white base, and
//     before any element so knockouts still win;
//   - the barcode backing: the solid background takes the halo's plate and
//     paints before the bars.
// Reads fill-colour operators from the real content stream pdf-lib emits.
import { describe, expect, it } from "vitest";
import { buildArtPdf, buildMaskPdf } from "../src/pdf/build";
import * as L from "../src/layout";
import type { PlacedImage } from "../src/plan";
import { assets, contentStreamText, fillOps, lolevPlan, onePxPng, pageRectPath } from "./fixtures";

const BLUE = [0, 156 / 255, 215 / 255] as const;
const WHITE = [1, 1, 1] as const;
/** Test-title names for the two paints. */
const INK = { ink: BLUE, knockout: WHITE } as const;
type Rgb = readonly [number, number, number];

const same = (a: Rgb, b: Rgb) => a.every((c, i) => Math.abs(c - b[i]) < 1e-9);

/** The mask plate's fill ops for one layer alone. A loaded mask page item
 *  stands in for the flood (so it adds no rg of its own), and the first op —
 *  the unconditional white page base — is dropped, leaving only the layer's
 *  own paints. */
async function maskOpsFor(id: string, overrides: Record<string, object> = {}): Promise<Rgb[]> {
  const items = (await lolevPlan({
    overrides: { ...overrides, mask: { asset: "msk" } },
    custom: { msk: { aspect: 1 } },
  })).filter((r) => r.id === id || r.kind === "page");
  expect(items.some((r) => r.id === id)).toBe(true);
  const bytes = await buildMaskPdf(items, { ...assets, images: { msk: { kind: "png", bytes: onePxPng } } });
  const ops = fillOps(await contentStreamText(bytes));
  expect(ops[0]).toEqual(WHITE);
  return ops.slice(1);
}

describe("mask plate polarity", () => {
  it("derives the plate's blue from the press hex, #009CD7", () => {
    expect(L.MASK_BLUE_HEX).toBe("#009CD7");
    expect(same([L.COLORS.maskBlue.r, L.COLORS.maskBlue.g, L.COLORS.maskBlue.b], BLUE)).toBe(true);
  });

  it.each([
    ["metallic", "knockout"],
    ["white", "ink"],
  ] as const)("text on the %s layer paints %s", async (layer, paint) => {
    const want = INK[paint];
    const style = { fill: "#000000", layer, stroke: "none" } as const;
    const ops = await maskOpsFor("storeCold", { storeCold: { lines: [{ text: "INK", ...style }], style } });
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) expect(op).toEqual(want);
  });

  it.each([
    ["metallic", "knockout"],
    ["white", "ink"],
  ] as const)("QR modules (vector paths) on the %s layer paint %s", async (layer, paint) => {
    const want = INK[paint];
    const ops = await maskOpsFor("qr", { qr: { style: { layer, stroke: "none" } } });
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) expect(op).toEqual(want);
  });

  // A text stroke taking its own plate is pinned in pdf-build.test.ts ("the
  // rotated column's stroke pass"), in both polarities and in draw order.

  it("raster art never knocks out: its footprint paints white ink", async () => {
    const image: PlacedImage = { kind: "image", id: "art", asset: "art", x: 10, y: 10, w: 20, h: 20 };
    const bytes = await buildMaskPdf([image], { ...assets, images: { art: { kind: "png", bytes: onePxPng } } });
    const ops = fillOps(await contentStreamText(bytes));
    // White base, the no-mask flood, then the image's blue footprint.
    expect(ops).toEqual([WHITE, BLUE, BLUE]);
  });
});

describe("the no-mask white-ink flood", () => {
  it("covers the page in mask blue over a white base, before any element", async () => {
    const stream = await contentStreamText(await buildMaskPdf(await lolevPlan(), assets));
    const ops = fillOps(stream);
    expect(ops[0]).toEqual(WHITE);
    expect(ops[1]).toEqual(BLUE);
    // The flood is the second page-covering rect (the white base is first).
    const pageRect = pageRectPath();
    const flood = stream.indexOf(pageRect, stream.indexOf(pageRect) + 1);
    expect(flood).toBeGreaterThan(0);
    // Only the base and the flood's own colour precede the flood rect, so no
    // element paints under it; the shipped label's metallic knockouts land
    // after it, where they still win.
    expect(fillOps(stream.slice(0, flood))).toEqual([WHITE, BLUE]);
    expect(fillOps(stream.slice(flood)).some((op) => same(op, WHITE))).toBe(true);
  });

  it("never reaches the art plate", async () => {
    const ops = fillOps(await contentStreamText(await buildArtPdf(await lolevPlan(), assets)));
    expect(ops.some((op) => same(op, BLUE))).toBe(false);
  });
});

describe("the barcode on the mask plate", () => {
  it("ships bars and halo on white ink (all blue)", async () => {
    const ops = await maskOpsFor("barcode");
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) expect(op).toEqual(BLUE);
  });

  it("metallic bars knock out of the white-ink halo, halo first", async () => {
    const ops = await maskOpsFor("barcode", { barcode: { style: { layer: "metallic", strokeLayer: "white" } } });
    const firstWhite = ops.findIndex((op) => same(op, WHITE));
    expect(firstWhite).toBeGreaterThan(0);
    for (const op of ops.slice(0, firstWhite)) expect(op).toEqual(BLUE);
    for (const op of ops.slice(firstWhite)) expect(op).toEqual(WHITE);
  });

  it.each([
    ["white", "ink"],
    ["metallic", "knockout"],
  ] as const)("a solid backing on the %s stroke layer paints %s before the bars", async (strokeLayer, paint) => {
    const want = INK[paint];
    // Bars on the opposite plate, so the backing's paints are distinguishable.
    const layer = strokeLayer === "white" ? "metallic" : "white";
    const bars = strokeLayer === "white" ? WHITE : BLUE;
    const style = { layer, strokeLayer };
    const plain = await maskOpsFor("barcode", { barcode: { style } });
    const backed = await maskOpsFor("barcode", { barcode: { style, solidBackground: true } });
    // The backing is one stroked path: its outline and its fill.
    expect(backed.length).toBe(plain.length + 2);
    expect(backed.slice(0, 2)).toEqual([want, want]);
    expect(backed.slice(2)).toEqual(plain);
    expect(backed.at(-1)).toEqual(bars);
  });
});
