import { describe, expect, it } from "vitest";
import { WIDTHS, encodeCode128, validateCode128 } from "../src/code128";

describe("Code 128", () => {
  it("validates printable ASCII, rejects empty and control chars", () => {
    expect(validateCode128("BEER-123").ok).toBe(true);
    expect(validateCode128("").ok).toBe(false);
    expect(validateCode128("a\tb").ok).toBe(false);
  });
  it("widths table is 107 unique entries, each summing to 11 modules", () => {
    expect(WIDTHS).toHaveLength(107);
    expect(new Set(WIDTHS).size).toBe(107);
    for (const w of WIDTHS)
      expect([...w].reduce((a, b) => a + +b, 0)).toBe(11);
  });
  it("structure: start + data + check + stop module count", () => {
    const { modules, guards } = encodeCode128("AB");
    // start(11) + 2 data(22) + check(11) + stop(13) = 57
    expect(modules).toHaveLength(57);
    expect(guards).toEqual([]);
  });
  it("all-digit even-length payloads use code set C (shorter)", () => {
    expect(encodeCode128("123456").modules.length)
      .toBeLessThan(encodeCode128("12345A").modules.length);
  });
  it("check symbol changes when the payload changes", () => {
    expect(encodeCode128("AB").modules).not.toBe(encodeCode128("AC").modules);
  });
  it("matches a published reference encoding", () => {
    // Source: Wikipedia "Code 128" article, "Check digit calculation" section,
    // worked example for the alphanumeric string "PJJ123C" (adapted from the
    // article's Code Set A walkthrough to Code Set B, which this encoder
    // uses — Start Code B = 104 instead of Start Code A = 103; all other
    // symbol values are identical between sets A and B for these printable
    // ASCII characters). Check digit recomputed for Start B: 104 + 1*48 +
    // 2*42 + 3*42 + 4*17 + 5*18 + 6*19 + 7*35 = 879; 879 mod 103 = 55.
    // Full module pattern independently assembled from the same article's
    // "Bar code widths" table (values 104, 48, 42, 42, 17, 18, 19, 35, 55)
    // plus its 7-width "Stop pattern (7 bars/spaces)" row (2331112, 13
    // modules): https://en.wikipedia.org/wiki/Code_128
    expect(encodeCode128("PJJ123C").modules).toBe(
      "1101001000011101110110101101110001011011100010011100110110011100101100101110010001000110111010001101100011101011",
    );
  });
});
