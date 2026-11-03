// ai-format-proof.test.ts — structure of the #597 format proof
// (scripts/ai-format-proof.ts): outlined text, the White Ink spot, and an
// embedded transparent raster. It checks what the builder emitted; whether
// Illustrator accepts it stays a manual gate (docs/plans/ai-export.md).
import { expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { buildAiFormatProof } from "../scripts/ai-format-proof";
import { contentStreamText } from "./fixtures";

it("draws no live type and no live strokes", async () => {
  const stream = await contentStreamText(await buildAiFormatProof());
  expect(stream).not.toMatch(/\b(?:BT|Tf|Tj|TJ|Tr)\b/);
  // `S`/`B` paint strokes; outlined geometry fills only (f, f*).
  expect(stream).not.toMatch(/^(?:S|s|B|B\*|b|b\*)$/m);
  expect(stream.match(/^f$/gm)?.length).toBeGreaterThan(10);
});

// newDoc still embeds the faces it is given, unreferenced; dropping them from
// the AI build is plan Task 4. The page itself must name no font.
it("references no font from the page", async () => {
  const doc = await PDFDocument.load(await buildAiFormatProof());
  const fonts = doc.getPage(0).node.Resources()?.lookupMaybe(PDFName.of("Font"), PDFDict);
  expect(fonts?.keys() ?? []).toEqual([]);
});

it("paints White Ink as an overprinting Separation", async () => {
  const bytes = await buildAiFormatProof();
  const doc = await PDFDocument.load(bytes);
  const resources = doc.getPage(0).node.Resources()!;
  const space = resources.lookup(PDFName.of("ColorSpace"), PDFDict).lookup(PDFName.of("CSW"));
  expect(String(space)).toMatch(/^\[ \/Separation \/White#20Ink \/DeviceCMYK/);
  const gs = resources.lookup(PDFName.of("ExtGState"), PDFDict).lookup(PDFName.of("GSW"), PDFDict);
  expect(String(gs.get(PDFName.of("OP")))).toBe("true");
  expect(String(gs.get(PDFName.of("op")))).toBe("true");
  const stream = await contentStreamText(bytes);
  const white = stream.slice(stream.indexOf("/OC /OCW BDC"));
  expect(white).toContain("/CSW cs\n1 scn");
  expect(white).toContain("/CSW cs\n0 scn");
});

it("embeds the transparent raster at full resolution with its alpha", async () => {
  const doc = await PDFDocument.load(await buildAiFormatProof());
  const images = doc.context.enumerateIndirectObjects()
    .map(([, o]) => o)
    .filter((o): o is PDFRawStream => o instanceof PDFRawStream && String(o.dict.get(PDFName.of("Subtype"))) === "/Image");
  const art = images.filter((o) => String(o.dict.get(PDFName.of("ColorSpace"))) === "/DeviceRGB");
  expect(art).toHaveLength(1);
  expect(String(art[0].dict.get(PDFName.of("Width")))).toBe("256");
  expect(String(art[0].dict.get(PDFName.of("Height")))).toBe("256");
  expect(String(art[0].dict.get(PDFName.of("Filter")))).toBe("/FlateDecode");
  expect(art[0].dict.has(PDFName.of("SMask"))).toBe(true);
});

it("embeds the uploaded mask as a White Ink image with its alpha", async () => {
  const doc = await PDFDocument.load(await buildAiFormatProof());
  const spot = doc.context.enumerateIndirectObjects()
    .map(([, o]) => o)
    .filter((o): o is PDFRawStream => o instanceof PDFRawStream
      && String(o.dict.lookup(PDFName.of("ColorSpace"))).startsWith("[ /Separation /White#20Ink"));
  expect(spot).toHaveLength(1);
  expect(spot[0].dict.has(PDFName.of("SMask"))).toBe(true);
});
