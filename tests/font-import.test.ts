// font-import.test.ts — readImportedFont turns one to three picked font files
// into an imported family: faces placed by OS/2 weight, a content-hash id
// that ignores file order, and refusals for mixed families, fonts whose
// licence forbids embedding, and anything that isn't a single TTF/OTF.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importedFamily, readImportedFont } from "../src/fontImport";
import type { FontAsset } from "../src/labelfile";

const asset = (path: string): FontAsset => {
  const url = new URL(path, import.meta.url);
  return { name: url.pathname.split("/").pop()!, bytes: new Uint8Array(readFileSync(url)) };
};
const svnBold = asset("./fixtures/fonts/SVN-Poppins-Bold.ttf");
const svnRegular = asset("./fixtures/fonts/SVN-Poppins-Regular.ttf");
const barlowBold = asset("../src/assets/fonts/BarlowCondensed-Bold.ttf");

/** A copy of `font` whose OS/2 fsType is `fsType`, found through the sfnt
 *  table directory (numTables at 4, 16-byte records from 12; fsType is the
 *  uint16 at offset 8 of the OS/2 table). */
function withFsType(font: FontAsset, fsType: number): FontAsset {
  const bytes = font.bytes.slice();
  const view = new DataView(bytes.buffer);
  const numTables = view.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    if (String.fromCharCode(...bytes.subarray(record, record + 4)) === "OS/2") {
      view.setUint16(view.getUint32(record + 8) + 8, fsType);
      return { name: font.name, bytes };
    }
  }
  throw new Error("no OS/2 table");
}

describe("readImportedFont", () => {
  it("fills all three faces with the one file given", async () => {
    const { font } = await readImportedFont([svnBold]);
    expect(font.faces.regular).toBe(svnBold);
    expect(font.faces.semibold).toBe(svnBold);
    expect(font.faces.bold).toBe(svnBold);
    expect(font.family).toBe("SVN-Poppins");
  });

  it("places Regular and Bold by weight, semibold taking the nearer Bold", async () => {
    const { font } = await readImportedFont([svnRegular, svnBold]);
    expect(font.faces.regular).toBe(svnRegular);
    expect(font.faces.semibold).toBe(svnBold);
    expect(font.faces.bold).toBe(svnBold);
  });

  it("gives the same id whatever the file order", async () => {
    const a = await readImportedFont([svnRegular, svnBold]);
    const b = await readImportedFont([svnBold, svnRegular]);
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^imported:[0-9a-f]{12}$/);
    expect((await readImportedFont([svnBold])).id).not.toBe(a.id);
  });

  it("refuses files from two families", async () => {
    await expect(readImportedFont([svnBold, barlowBold])).rejects.toThrow(/different font families/);
  });

  it("refuses a font whose licence restricts embedding", async () => {
    await expect(readImportedFont([withFsType(svnBold, 0x0002)])).rejects.toThrow(/does not allow embedding/);
  });

  it("refuses a bitmap-only font", async () => {
    await expect(readImportedFont([withFsType(svnBold, 0x0200)])).rejects.toThrow(/bitmap-only/);
  });

  it("refuses bytes that aren't a font, and a font collection", async () => {
    const junk = { name: "notes.ttf", bytes: new TextEncoder().encode("not a font at all") };
    await expect(readImportedFont([junk])).rejects.toThrow(/notes\.ttf is not a TTF or OTF font/);
    const ttc = { name: "Family.ttc", bytes: new Uint8Array([...new TextEncoder().encode("ttcf"), ...svnBold.bytes.subarray(4)]) };
    await expect(readImportedFont([ttc])).rejects.toThrow(/Family\.ttc is not a TTF or OTF font/);
  });

  it("refuses no files and more than three", async () => {
    await expect(readImportedFont([])).rejects.toThrow(/one to three font files/);
    await expect(readImportedFont([svnBold, svnBold, svnRegular, svnRegular])).rejects.toThrow(/one to three font files/);
  });
});

describe("importedFamily", () => {
  it("names each face by the PostScript name inside its file", async () => {
    const { font } = await readImportedFont([svnRegular, svnBold]);
    expect(importedFamily(font)).toEqual({
      label: "SVN-Poppins",
      ps: { regular: "SVN-Poppins", semibold: "SVN-PoppinsBold", bold: "SVN-PoppinsBold" },
    });
  });
});
