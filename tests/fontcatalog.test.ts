import { describe, expect, it } from "vitest";
import { FONT_FAMILIES, fontFamily, fontFamilyOf, isImportedFontId, type FontFamily, type ImportedFontId } from "../src/fontCatalog";
import { defaultConfig } from "../src/defaults";

describe("font catalog", () => {
  it("defaults to poppins; unknown ids from hand-edited files fall back", () => {
    expect(fontFamilyOf(defaultConfig())).toBe("poppins");
    expect(fontFamilyOf({ ...defaultConfig(), fontFamily: "poppins" })).toBe("poppins");
    expect(fontFamilyOf({ ...defaultConfig(), fontFamily: "papyrus" as never })).toBe("poppins");
  });
  it("every family names three faces and three files", () => {
    for (const fam of Object.values(FONT_FAMILIES)) {
      expect(Object.keys(fam.ps)).toEqual(["regular", "semibold", "bold"]);
      expect(Object.keys(fam.files)).toEqual(["regular", "semibold", "bold"]);
    }
  });

  const svn: FontFamily = { label: "SVN-Poppins", ps: { regular: "SVN-Poppins-Bold", semibold: "SVN-Poppins-Bold", bold: "SVN-Poppins-Bold" } };
  const imported = new Map<ImportedFontId, FontFamily>([["imported:abc123", svn]]);
  it("an imported id resolves to its family when the file carries it", () => {
    expect(fontFamily("imported:abc123", imported)).toEqual(svn);
    expect(fontFamilyOf({ fontFamily: "imported:abc123" }, imported)).toBe("imported:abc123");
  });
  it("an unknown imported id falls back to the default family", () => {
    expect(fontFamily("imported:missing", imported)).toEqual({ label: FONT_FAMILIES.poppins.label, ps: FONT_FAMILIES.poppins.ps });
    expect(fontFamily("imported:abc123")).toEqual({ label: FONT_FAMILIES.poppins.label, ps: FONT_FAMILIES.poppins.ps });
    expect(fontFamilyOf({ fontFamily: "imported:missing" }, imported)).toBe("poppins");
    expect(fontFamilyOf({ fontFamily: "imported:abc123" })).toBe("poppins");
  });
  it("bundled ids are unchanged by the lookup", () => {
    for (const [id, fam] of Object.entries(FONT_FAMILIES) as [keyof typeof FONT_FAMILIES, (typeof FONT_FAMILIES)[keyof typeof FONT_FAMILIES]][]) {
      expect(fontFamily(id, imported)).toEqual({ label: fam.label, ps: fam.ps });
      expect(fontFamilyOf({ fontFamily: id }, imported)).toBe(id);
    }
  });
  it("isImportedFontId tells imported ids from bundled ones", () => {
    expect(isImportedFontId("imported:abc123")).toBe(true);
    expect(isImportedFontId("poppins")).toBe(false);
    expect(isImportedFontId("barlow-condensed")).toBe(false);
    expect(isImportedFontId("papyrus")).toBe(false);
  });
});
