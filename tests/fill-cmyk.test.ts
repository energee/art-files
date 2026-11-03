// fill-cmyk.test.ts — CMYK fills (`cmyk(c,m,y,k)`, percentages): parsing and
// canonical form, the PDF's exact DeviceCMYK operator, and the print PDF's
// PDF/X-4 output intent.
import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFStream, PDFString, decodePDFRawStream } from "pdf-lib";
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

describe("PDF/X-4 output intent", () => {
  it("marks the print PDF as PDF/X-4 with an embedded sRGB output profile", async () => {
    const bytes = await buildPrintPdf(square("#D0B070"), assets);
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe("%PDF-1.6");
    const doc = await PDFDocument.load(bytes);
    const { catalog, context } = doc;

    const intent = catalog.lookup(PDFName.of("OutputIntents"), PDFArray).lookup(0, PDFDict);
    expect(intent.get(PDFName.of("S"))).toBe(PDFName.of("GTS_PDFX"));
    expect(intent.lookup(PDFName.of("OutputConditionIdentifier"), PDFString).asString()).toBe("sRGB IEC61966-2.1");
    const profile = intent.lookup(PDFName.of("DestOutputProfile"), PDFStream);
    expect(profile.dict.get(PDFName.of("N"))?.toString()).toBe("3");
    const icc = decodePDFRawStream(profile as never).decode();
    expect(new TextDecoder().decode(icc.slice(36, 40))).toBe("acsp");

    const info = context.lookup(context.trailerInfo.Info, PDFDict);
    expect(info.lookup(PDFName.of("GTS_PDFXVersion"), PDFString).asString()).toBe("PDF/X-4");
    expect(info.get(PDFName.of("Trapped"))).toBe(PDFName.of("False"));
    expect(context.trailerInfo.ID).toBeDefined();

    const xmp = new TextDecoder().decode(catalog.lookup(PDFName.of("Metadata"), PDFStream).getContents());
    expect(xmp).toContain("<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>");
    expect(xmp).toContain("<rdf:li xml:lang=\"x-default\">Label label</rdf:li>");
  });

  it("leaves the two-file art PDF unmarked", async () => {
    const doc = await PDFDocument.load(await buildArtPdf(square("#D0B070"), assets));
    expect(doc.catalog.get(PDFName.of("OutputIntents"))).toBeUndefined();
  });
});
