import { describe, expect, it } from "vitest";
import { validateField, validateLayerInput } from "../src/model/fields";
import type { FieldDecl } from "../src/model/types";

const decl = (over: Partial<FieldDecl>): FieldDecl =>
  ({ id: "f", label: "F", kind: "text", path: "beerName", ...over });

describe("validateField", () => {
  it("accepts any string for text", () => {
    expect(validateField(decl({}), "Hazy").ok).toBe(true);
  });
  it("rejects a non-number for number", () => {
    expect(validateField(decl({ kind: "number" }), "abc").ok).toBe(false);
  });
  it("enforces number min/max", () => {
    const d = decl({ kind: "number", min: 0, max: 20 });
    expect(validateField(d, 6.2).ok).toBe(true);
    expect(validateField(d, 21).ok).toBe(false);
    expect(validateField(d, 21).error).toMatch(/20/);
  });
  it("accepts numeric strings for number (form inputs are strings)", () => {
    expect(validateField(decl({ kind: "number", min: 0, max: 20 }), "6.2").ok).toBe(true);
  });
  it("validates UPC-A check digit for code/upc-a", () => {
    const d = decl({ kind: "code", symbology: "upc-a" });
    expect(validateField(d, "036000291452").ok).toBe(true);   // valid check digit
    expect(validateField(d, "036000291453").ok).toBe(false);
  });
  it("restricts select to its options", () => {
    const d = decl({ kind: "select", options: ["ale", "lager"] });
    expect(validateField(d, "ale").ok).toBe(true);
    expect(validateField(d, "ipa").ok).toBe(false);
  });
  it("requires boolean for toggle", () => {
    expect(validateField(decl({ kind: "toggle" }), true).ok).toBe(true);
    expect(validateField(decl({ kind: "toggle" }), "yes").ok).toBe(false);
  });
  it("requires a string for image (asset key)", () => {
    expect(validateField(decl({ kind: "image" }), "logo.png").ok).toBe(true);
    expect(validateField(decl({ kind: "image" }), 5).ok).toBe(false);
  });
  it("defaults an unset symbology to UPC-A validation", () => {
    const d = decl({ kind: "code", symbology: undefined });
    expect(validateField(d, "036000291452").ok).toBe(true);    // valid UPC-A
    expect(validateField(d, "036000291453").ok).toBe(false);   // bad check digit
  });
  it("validates EAN-13 and Code 128 through the code kind", () => {
    const d = (s: "ean-13" | "code-128"): FieldDecl =>
      ({ id: "f", label: "F", kind: "code", path: "upc", symbology: s });
    expect(validateField(d("ean-13"), "4006381333931").ok).toBe(true);
    expect(validateField(d("ean-13"), "4006381333932").ok).toBe(false);
    expect(validateField(d("code-128"), "BEER-123").ok).toBe(true);
    expect(validateField(d("code-128"), "").ok).toBe(false);
  });
  it("accepts only plain decimal numbers, so the printed abv reads as typed", () => {
    const d = decl({ kind: "number" });
    for (const v of ["1e1", "0x10", "6.", ".5", "1 2", "+3"]) expect(validateField(d, v).ok, v).toBe(false);
    for (const v of ["6", " 6.5 ", "-1", "0.25"]) expect(validateField(d, v).ok, v).toBe(true);
  });
  it("treats a blank number as not filled yet", () => {
    expect(validateField(decl({ kind: "number", min: 1 }), "  ").ok).toBe(true);
  });
});

// One spelling of "check a number/code text layer's typed value" for the
// resolver and the on-canvas editor (UX audit #17 review).
describe("validateLayerInput", () => {
  const layer = { id: "abv", name: "ABV", input: "number" as const, min: 0, max: 20 };
  it("checks a number layer against its min/max", () => {
    expect(validateLayerInput(layer, "5.8").ok).toBe(true);
    expect(validateLayerInput(layer, "150").error).toBe("Must be at most 20.");
  });
  it("checks a code layer against its symbology", () => {
    const code = { id: "upc", name: "UPC", input: "code" as const, symbology: "upc-a" as const };
    expect(validateLayerInput(code, "036000291452").ok).toBe(true);
    expect(validateLayerInput(code, "123").ok).toBe(false);
  });
  it("passes a layer with no input", () => {
    expect(validateLayerInput({ id: "t", name: "T" }, "anything").ok).toBe(true);
  });
});
