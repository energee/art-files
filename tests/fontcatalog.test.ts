import { describe, expect, it } from "vitest";
import { FONT_FAMILIES, fontFamilyOf } from "../src/fontCatalog";
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
});
