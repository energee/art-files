import { describe, expect, it } from "vitest";
import { validateField } from "../src/model/fields";
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
});
