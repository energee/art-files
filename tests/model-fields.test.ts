// model-fields.test.ts — validateInput: the number and code inputs a text
// layer can declare, and the result union that carries the message.
import { describe, expect, it } from "vitest";
import { validateInput } from "../src/model/fields";

describe("validateInput", () => {
  it("rejects a non-number for number", () => {
    expect(validateInput("number", "abc").ok).toBe(false);
  });
  it("enforces number min/max and names the bound", () => {
    expect(validateInput("number", "6.2", { min: 0, max: 20 }).ok).toBe(true);
    const r = validateInput("number", "21", { min: 0, max: 20 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/20/);
  });
  it("a blank number is not filled yet, not invalid — even under a min", () => {
    expect(validateInput("number", "", { min: 1 }).ok).toBe(true);
    expect(validateInput("number", "0", { min: 1 }).ok).toBe(false);
  });
  it("defaults an unset symbology to UPC-A validation", () => {
    expect(validateInput("code", "036000291452").ok).toBe(true);    // valid UPC-A
    expect(validateInput("code", "036000291453").ok).toBe(false);   // bad check digit
  });
  it("validates EAN-13 and Code 128 through the code input", () => {
    expect(validateInput("code", "4006381333931", { symbology: "ean-13" }).ok).toBe(true);
    expect(validateInput("code", "4006381333932", { symbology: "ean-13" }).ok).toBe(false);
    expect(validateInput("code", "BEER-123", { symbology: "code-128" }).ok).toBe(true);
    expect(validateInput("code", "", { symbology: "code-128" }).ok).toBe(false);
  });
});
