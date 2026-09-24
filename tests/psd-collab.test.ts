// psd-collab.test.ts — the REAL collab-art PSD regression test. The
// collab-variant-goldens suite pins PSD bytes with NO collab art loaded, so
// it cannot catch a collab regression in the PSD path. This suite plans the
// Lolev label with the Collab variant ON and partner art in both slots and
// asserts the art actually lands: the variant's three layers as groups —
// the lead-in type layer, the left slot's vector art, the center slot's
// raster art — on the art plate and, as white-ink footprints, on the mask.
import { describe, expect, it } from "vitest";
import { readPsd } from "ag-psd";
import { buildPsd, type PsdAssets } from "../src/psd/build";
import { flatLayers, lolevLayers, lolevPlan, logoSvg, psdAssets, type LolevOpts } from "./fixtures";

// `any` return: assertions reach into ag-psd fields the published types
// call optional (text runs, bounds); the walk itself is fixtures.ts's.
const layer = (children: any[] = [], name: string): any =>
  flatLayers(children).find((l) => l.name === name && !l.children);
const groups = (children: any[] = []) => children.map((l: any) => l.name);

const read = (bytes: Uint8Array) =>
  readPsd(Buffer.from(bytes).buffer as ArrayBuffer,
    { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true });

/** 2x2 opaque red RGBA at natural size — small enough that a passing bounds
 *  assertion proves the builder resampled to the PLACED rect rather than
 *  copying pixels 1:1. */
const px2x2 = { data: new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]), width: 2, height: 2 };

/** Both slots loaded: left vector (the fixture logo SVG — guaranteed to
 *  parse through the same parseLogo path real partner SVGs take), center
 *  raster. Covers both art kinds in one build. */
const both: LolevOpts = {
  variants: ["collab"],
  overrides: { collabLeft: { asset: "left" }, collabCenter: { asset: "center" } },
  custom: { left: { aspect: 480 / 525, art: { kind: "svg", svg: logoSvg } }, center: { aspect: 1 } },
};
const withCollab: PsdAssets = { ...psdAssets, images: { center: px2x2 } };

const build = async (opts: LolevOpts, mode?: "art" | "mask", a = withCollab) =>
  read(await buildPsd(await lolevPlan(opts), a, mode, { layers: lolevLayers(opts) }));

describe("PSD collab art", () => {
  it("art plate: the variant's three groups carry the lead-in and both logos", async () => {
    const psd = await build(both);
    expect(groups(psd.children as any[]).slice(-3)).toEqual(["Lead-in", "Text logo", "Graphic logo"]);
    // The lead-in is the variant's fixed text, one editable type layer, bold.
    const lead = layer(psd.children as any[], "Lead-in");
    expect(lead.text.text).toBe("A collaborative\nproject with");
    expect(lead.text.style.font.name).toBe("Poppins-SemiBold");
    // The vector left logo is a shape layer; the raster center logo landed
    // resampled to its placed box: nonzero, and NOT the source's native 2x2.
    expect(layer(psd.children as any[], "Text logo").vectorMask.paths.length).toBeGreaterThan(0);
    const center = layer(psd.children as any[], "Graphic logo");
    expect(center.right - center.left).toBeGreaterThan(2);
    expect(center.bottom - center.top).toBeGreaterThan(2);
  });

  it("mask plate: both slots paint on the white-ink plate", async () => {
    const psd = await build(both, "mask");
    // Raster art prints on white ink: the mask carries the slot's footprint
    // (same rule as every raster image and the PDF mask plate).
    expect(layer(psd.children as any[], "Graphic logo").vectorFill.color).toEqual({ r: 0, g: 156, b: 215 });
    expect(layer(psd.children as any[], "Text logo")).toBeDefined();
  });

  it("variant off: none of the three groups exist", async () => {
    const psd = await build({});
    for (const n of ["Lead-in", "Text logo", "Graphic logo"]) expect(groups(psd.children as any[])).not.toContain(n);
  });

  it("variant on with empty slots: the lead-in stays, the logos add nothing", async () => {
    const psd = await build({ variants: ["collab"] }, "art", psdAssets);
    expect(groups(psd.children as any[]).slice(-1)).toEqual(["Lead-in"]);
  });

  it("a quadratic-curve SVG (Q/T) still lands as vector art (#67)", async () => {
    const quad = '<svg viewBox="0 0 10 10"><path d="M0 0 Q5 10 10 0 Z"/></svg>';
    const psd = await build({ ...both, custom: { ...both.custom, left: { aspect: 1, art: { kind: "svg", svg: quad } } } });
    expect(layer(psd.children as any[], "Text logo").vectorMask.paths.length).toBeGreaterThan(0);
  });
});
