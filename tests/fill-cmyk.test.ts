// fill-cmyk.test.ts — CMYK fills (`cmyk(c,m,y,k)`, percentages):
// canonical form and the PDF's exact DeviceCMYK operator.
import { describe, expect, it } from "vitest";
import { buildArtPdf, buildPrintPdf } from "../src/pdf/build";
import { cssFill, normalizeFill, parseFill } from "../src/layout";
import { patchProblem } from "../src/model/layers";
import type { PlacedLayer } from "../src/planLayers";
import type { Fill } from "../src/types";
import { assets, contentStreamText } from "./fixtures";

const square = (fill: Fill): PlacedLayer[] => [{
  kind: "paths", id: "sq", paths: ["M0 0 L10 0 L10 10 L0 10 Z"],
  x: 100, y: 100, fill, layer: "metallic", stroke: null,
}];

describe("parseFill / normalizeFill", () => {
  it("round-trips a CMYK fill through its canonical form", () => {
    const fill = normalizeFill(" CMYK( 15, 25,70 , 5 ) ");
    expect(fill).toBe("cmyk(15,25,70,5)");
    expect(parseFill(fill!).cmyk).toEqual([15, 25, 70, 5]);
    expect(normalizeFill(fill!)).toBe(fill);
  });

  it("keeps hex fills as they were, with no CMYK", () => {
    expect(normalizeFill("#FFF")).toBe("#ffffff");
    expect(parseFill("#D0B070")).toEqual({ rgb: { r: 208 / 255, g: 176 / 255, b: 112 / 255 } });
  });

  it("rejects out-of-range or malformed CMYK", () => {
    for (const bad of ["cmyk(101,0,0,0)", "cmyk(1,2,3)", "cmyk(-1,0,0,0)", "cmyk(a,0,0,0)"])
      expect(normalizeFill(bad)).toBeUndefined();
  });

  it("approximates CMYK as RGB for the screen", () => {
    expect(parseFill("cmyk(0,0,0,0)").rgb).toEqual({ r: 1, g: 1, b: 1 });
    expect(cssFill("cmyk(0,100,100,0)")).toBe("#ff0000");
    expect(cssFill("cmyk(0,0,0,100)")).toBe("#000000");
  });

  it("is accepted and canonicalized by the master validator", () => {
    const patch = { style: { fill: "cmyk( 15,25,70,5 )", stroke: "CMYK(0,0,0,100)" } };
    expect(patchProblem(patch)).toBeUndefined();
    expect(patch.style).toEqual({ fill: "cmyk(15,25,70,5)", stroke: "cmyk(0,0,0,100)" });
  });
});

describe("CMYK in the PDF", () => {
  it("writes a CMYK fill exactly as DeviceCMYK", async () => {
    const stream = await contentStreamText(await buildPrintPdf(square("cmyk(15,25,70,5)"), assets));
    expect(stream).toContain("0.15 0.25 0.7 0.05 k");
  });

  it("leaves hex fills on DeviceRGB and DeviceGray", async () => {
    expect(await contentStreamText(await buildArtPdf(square("#D0B070"), assets))).not.toMatch(/ k\b/);
  });
});
