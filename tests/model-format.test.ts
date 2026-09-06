import { describe, expect, it } from "vitest";
import { expandFormat, fieldRefs, formatLink, parseLink, segments } from "../src/model/format";

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

describe("segments", () => {
  it("splits literal text and refs, plain and transformed, in order", () => {
    expect(segments("beer {name|slug} end")).toEqual([
      { lit: "beer " },
      { id: "name", tr: "slug" },
      { lit: " end" },
    ]);
  });
  it("returns a single literal segment for a ref-free string", () => {
    expect(segments("1 PINT")).toEqual([{ lit: "1 PINT" }]);
  });
  it("returns a single ref segment for a bare ref, with no tr key when untransformed", () => {
    expect(segments("{upc}")).toEqual([{ id: "upc" }]);
  });
  it("returns an empty array for an empty string", () => {
    expect(segments("")).toEqual([]);
  });
});

describe("parseLink", () => {
  it("splits a link into its URL prefix and the one trailing ref", () => {
    expect(parseLink("https://lolev.beer/beer/{name|slug}"))
      .toEqual({ prefix: "https://lolev.beer/beer/", id: "name" });
  });

  it("reads a bare URL as a prefix with no ref", () => {
    expect(parseLink("https://lolev.beer")).toEqual({ prefix: "https://lolev.beer", id: undefined });
  });

  it("rejects a template with a ref before the tail, so the raw box keeps it", () => {
    expect(parseLink("{a}/x/{b}")).toBeUndefined();
  });

  it("round-trips through formatLink, always slugified", () => {
    const l = parseLink("https://x/{name}")!;
    expect(formatLink(l.prefix, l.id!)).toBe("https://x/{name|slug}");
    expect(formatLink("https://x/", "")).toBe("https://x/");
  });
});
