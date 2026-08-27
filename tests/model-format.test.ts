import { describe, expect, it } from "vitest";
import { expandFormat, fieldRefs } from "../src/model/format";

describe("expandFormat", () => {
  it("substitutes plain refs", () => {
    expect(expandFormat("{abv}% alc by vol", { abv: "6.2" }).text).toBe("6.2% alc by vol");
  });
  it("applies the slug transform", () => {
    expect(expandFormat("http://lolev.beer/beer/{name|slug}", { name: "Hazy IPA!" }).text)
      .toBe("http://lolev.beer/beer/hazy-ipa");
  });
  it("applies upper, lower, trim", () => {
    expect(expandFormat("{a|upper}/{b|lower}/{c|trim}", { a: "x", b: "Y", c: " z " }).text)
      .toBe("X/y/z");
  });
  it("reports missing fields and leaves the ref visible", () => {
    const r = expandFormat("{upc}", {});
    expect(r.missing).toEqual(["upc"]);
    expect(r.text).toBe("{upc}");
  });
  it("passes literal text through, including braces-free strings", () => {
    expect(expandFormat("1 PINT", {}).text).toBe("1 PINT");
  });
  it("lists referenced fields", () => {
    expect(fieldRefs("{name|slug} and {upc}")).toEqual(["name", "upc"]);
  });
  it("ignores an unknown transform, keeping the raw value", () => {
    expect(expandFormat("{a|nope}", { a: "v" }).text).toBe("v");
  });
});
