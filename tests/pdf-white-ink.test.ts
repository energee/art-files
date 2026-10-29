// pdf-white-ink.test.ts — structural resources and raster samples for the printer's White Ink spot plate.
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { embedWhiteInkMask, registerWhiteInk } from "../src/pdf/whiteInk";
import { WHITE_INK } from "../src/layout";

const name = (value: string) => PDFName.of(value);

describe("White Ink spot resources", () => {
  it("registers the named Separation, magenta alternate, overprint state, and enabled layer", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    registerWhiteInk(doc, page);

    const loaded = await PDFDocument.load(await doc.save());
    const resources = loaded.getPages()[0].node.Resources()!;
    const spaces = resources.lookup(name("ColorSpace"), PDFDict);
    const separation = spaces.lookup(name("CSW"), PDFArray);
    expect(separation.lookup(0, PDFName).decodeText()).toBe("Separation");
    expect(separation.lookup(1, PDFName).decodeText()).toBe(WHITE_INK);
    expect(separation.lookup(2, PDFName).decodeText()).toBe("DeviceCMYK");
    expect(separation.lookup(3, PDFDict).lookup(name("C1"), PDFArray).toString()).toBe("[ 0 1 0 0 ]");

    const state = resources.lookup(name("ExtGState"), PDFDict).lookup(name("GSW"), PDFDict);
    expect(state.lookup(name("OP"), PDFBool).asBoolean()).toBe(true);
    expect(state.lookup(name("op"), PDFBool).asBoolean()).toBe(true);
    expect(state.get(name("OPM"))?.toString()).toBe("1");

    const catalog = loaded.catalog;
    const ocProperties = catalog.lookup(name("OCProperties"), PDFDict);
    const on = ocProperties.lookup(name("D"), PDFDict).lookup(name("ON"), PDFArray);
    const ocg = loaded.context.lookup(on.get(0), PDFDict);
    expect(ocg.get(name("Name"))?.toString()).toBe(`(${WHITE_INK})`);
  });
});

describe("White Ink raster", () => {
  it("embeds red-inverted Separation samples", async () => {
    const doc = await PDFDocument.create();
    const ref = embedWhiteInkMask(doc, new Uint8ClampedArray([
      0, 156, 215, 255, // mask blue => full tint
      255, 255, 255, 255, // white => knockout
      127, 0, 0, 127, // anti-aliased edge => partial tint
    ]), 3, 1);
    const image = doc.context.lookup(ref);
    if (!(image instanceof PDFRawStream)) throw new Error("Expected a White Ink image stream");
    expect(image.dict.lookup(name("ColorSpace"), PDFArray).lookup(1, PDFName).decodeText()).toBe(WHITE_INK);
    expect(image.dict.get(name("BitsPerComponent"))?.toString()).toBe("8");
    expect([...inflateSync(image.getContents())]).toEqual([255, 0, 128]);
  });

  it("rejects malformed RGBA dimensions", async () => {
    const doc = await PDFDocument.create();
    expect(() => embedWhiteInkMask(doc, new Uint8ClampedArray(3), 1, 1)).toThrow(/RGBA/);
    expect(() => embedWhiteInkMask(doc, new Uint8ClampedArray(4), 0, 1)).toThrow(/dimensions/);
  });
});
