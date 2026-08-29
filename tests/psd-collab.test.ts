// psd-collab.test.ts — the REAL collab-art PSD regression test. The
// collab-variant-goldens suite pins PSD bytes with NO collab assets loaded,
// so (as its own comment admits) it cannot catch a collab regression in the
// PSD path. This suite drives buildPsd WITH partner art in both slots and
// asserts the art actually lands: a "Collab" group with the lead-in type
// layer, the left slot's vector art, and the center slot's raster art — on
// the art plate and, as a white-ink footprint, on the mask plate.
import { describe, expect, it } from "vitest";
import { readPsd } from "ag-psd";
import { buildPsd, type PsdAssets } from "../src/psd/build";
import { resolve } from "../src/model/resolve";
import { lolevMaster } from "../src/model/lolev";
import * as L from "../src/layout";
import { flatLayers, psdAssets } from "./fixtures";

// `any` return: assertions reach into ag-psd fields the published types
// call optional (text runs, bounds); the walk itself is fixtures.ts's.
const layer = (children: any[] = [], name: string): any =>
  flatLayers(children).find((l) => l.name === name);

const read = (bytes: Uint8Array) =>
  readPsd(Buffer.from(bytes).buffer as ArrayBuffer,
    { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true });

/** The shipped master with the Collab variant ON — the config the app hands
 *  buildPsd for a collab label. */
const collabCfg = () => resolve(lolevMaster(), ["collab"], {}).config;

/** 2x2 opaque red RGBA at natural size — like the custom-image tests, small
 *  enough that a passing bounds assertion proves the builder resampled to
 *  the PLACED rect rather than copying pixels 1:1. */
const px2x2 = {
  kind: "raster" as const,
  data: new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]),
  width: 2, height: 2,
};

/** Both slots loaded: left vector (the fixture logo SVG — guaranteed to
 *  parse through the same parseLogo path real partner SVGs take), center
 *  raster. Covers both art kinds in one build. */
const withCollab: PsdAssets = {
  ...psdAssets,
  collabLeft: { kind: "svg", svg: psdAssets.logoSvg },
  collabCenter: px2x2,
};

describe("PSD collab art", () => {
  it("art plate: a Collab group carries the lead-in and both logos", async () => {
    const psd = read(await buildPsd(collabCfg(), withCollab));
    const group = layer(psd.children as any[], "Collab");
    expect(group).toBeDefined();
    expect((group.children ?? []).map((l: any) => l.name)).toEqual([
      "Collab lead-in", "Collab left logo", "Collab center logo",
    ]);
    // The lead-in is the fixed template text, one editable type layer.
    expect(layer(psd.children as any[], "Collab lead-in").text.text)
      .toBe(L.COLLAB_LEAD.lines.join("\n"));
    // The raster center logo landed resampled to its placed box: nonzero,
    // and NOT the source's native 2x2.
    const center = layer(psd.children as any[], "Collab center logo");
    expect(center.right - center.left).toBeGreaterThan(2);
    expect(center.bottom - center.top).toBeGreaterThan(2);
  });

  it("mask plate: both slots paint on the white-ink plate", async () => {
    const psd = read(await buildPsd(collabCfg(), withCollab, "mask"));
    // Raster art prints on white ink: the mask carries the slot's footprint
    // (same rule as custom raster images and the PDF mask plate).
    expect(layer(psd.children as any[], "Collab center logo")).toBeDefined();
    expect(layer(psd.children as any[], "Collab left logo")).toBeDefined();
  });

  it("no collab assets: no Collab group at all", async () => {
    // Byte identity with the pre-feature PSD is pinned by the goldens in
    // collab-variant-goldens.test.ts and psd-build.test.ts; this asserts the
    // structural half — an absent slot must add nothing.
    const psd = read(await buildPsd(collabCfg(), psdAssets));
    expect(layer(psd.children as any[], "Collab")).toBeUndefined();
  });

  it("left slot alone brings the lead-in; an empty center slot adds nothing", async () => {
    const psd = read(await buildPsd(collabCfg(), {
      ...psdAssets, collabLeft: { kind: "svg", svg: psdAssets.logoSvg },
    }));
    expect(layer(psd.children as any[], "Collab lead-in")).toBeDefined();
    expect(layer(psd.children as any[], "Collab left logo")).toBeDefined();
    expect(layer(psd.children as any[], "Collab center logo")).toBeUndefined();
  });
});
