import { describe, expect, it } from "vitest";
import { ean13CheckDigit, encodeEan13, validateEan13, encodeUpc } from "../src/upc";

describe("EAN-13", () => {
  it("computes the check digit (spec example 400638133393 -> 1)", () => {
    expect(ean13CheckDigit("400638133393")).toBe(1);
  });
  it("validates format and check digit", () => {
    expect(validateEan13("4006381333931").ok).toBe(true);
    expect(validateEan13("4006381333932").ok).toBe(false);
    expect(validateEan13("40063813339").ok).toBe(false);      // 11 digits
    expect(validateEan13("400638133393a").ok).toBe(false);
  });
  it("emits 95 modules with UPC guard positions", () => {
    const { modules, guards } = encodeEan13("4006381333931");
    expect(modules).toHaveLength(95);
    expect(guards).toEqual([[0, 10], [45, 50], [85, 95]]);
  });
  it("a leading-zero EAN-13 encodes identically to the UPC-A it wraps", () => {
    expect(encodeEan13("0036000291452").modules).toBe(encodeUpc("036000291452").modules);
  });
  it("first digit changes left-half parity for the same body digits", () => {
    const a = encodeEan13("0" + "00638133393" + String(ean13CheckDigit("0" + "00638133393")));
    const b = encodeEan13("4" + "00638133393" + String(ean13CheckDigit("4" + "00638133393")));
    expect(a.modules.slice(3, 45)).not.toBe(b.modules.slice(3, 45));
  });
});
