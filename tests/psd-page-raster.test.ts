// psd-page-raster.test.ts — issue #88: the App's PSD export must hand the
// page texture and mask to buildPsd at their NATURAL size. pageLayer already
// resamples a page raster into its planned cover-fit rect, so pixels
// pre-fit to PSD_DOC get fit twice — a square texture came out 4876×4876
// built from 4876×3076 pixels, stretched ~1.585× vertically.
import { describe, expect, it } from "vitest";
import { psdImages, type Rgba } from "../src/psd/build";
import { PAGE_ART_ID } from "../src/model/layers";

/** Stand-in for App.tsx's decodeToCanvas contract: natural size unless a
 *  `size` is forced, in which case the canvas takes that size. */
const NATURAL = { width: 1000, height: 1000 };
const decode = async (_bytes: Uint8Array, size?: { width: number; height: number }): Promise<Rgba> => {
  const { width, height } = size ?? NATURAL;
  return { data: new Uint8Array(width * height * 4), width, height };
};
const bytes = new Uint8Array([1]);

describe("psdImages", () => {
  it("keeps a square texture and mask at natural size (no double cover-fit)", async () => {
    const out = await psdImages({}, { texture: bytes, mask: bytes }, decode);
    for (const id of [PAGE_ART_ID.background, PAGE_ART_ID.mask]) {
      expect([id, out[id].width, out[id].height]).toEqual([id, NATURAL.width, NATURAL.height]);
    }
  });

  it("decodes raster image assets, skips SVGs, and omits absent page art", async () => {
    const out = await psdImages({ logo: { kind: "png", bytes }, mark: { kind: "svg", svg: "<svg/>" } }, {}, decode);
    expect(Object.keys(out)).toEqual(["logo"]);
    expect(out.logo.width).toBe(NATURAL.width);
  });
});
