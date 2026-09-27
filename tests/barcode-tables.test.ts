// Standard symbol data cross-checked against ZXing's independent readers.
// Source URLs are stored with the fixture; no production encoder builds expectations.
import { expect, it } from "vitest";
import { encodeUpc, encodeEan13 } from "../src/upc";
import { encodeCode128, WIDTHS } from "../src/code128";
import reference from "./fixtures/barcode-reference.json";
const bits = (widths: string, black = true) => [...widths].map((w, i) => ((i % 2 === 0) === black ? "1" : "0").repeat(+w)).join("");
const left = reference.eanL.map((w) => bits(w, false));
const right = reference.eanL.map((w) => bits(w));
it("pins every UPC digit and EAN parity row (#294)", () => {
  for (let n = 0; n < 10; n++) {
    expect(encodeUpc(String(n).repeat(12)).modules).toBe("101" + left[n].repeat(6) + "01010" + right[n].repeat(6) + "101");
    const expected = reference.eanParity[n].split("").map((p) => p === "L" ? left[n] : bits([...reference.eanL[n]].reverse().join(""), false)).join("");
    expect(encodeEan13(String(n).repeat(13)).modules).toBe("101" + expected + "01010" + right[n].repeat(6) + "101");
  }
});
it("pins Code 128's whole table and printable set-B alphabet (#294)", () => {
  expect(WIDTHS).toEqual(reference.code128.map((w) => w.slice(0, 6)));
  const value = Array.from({ length: 95 }, (_, i) => String.fromCharCode(i + 32)).join("");
  const check = (104 + Array.from({ length: 95 }, (_, i) => (i + 1) * i).reduce((a, b) => a + b, 0)) % 103;
  const expected = [104, ...Array.from({ length: 95 }, (_, i) => i), check, 106].map((n) => bits(reference.code128[n])).join("");
  expect(encodeCode128(value).modules).toBe(expected);
});
it("pins complete UPC-A and EAN-13 vectors containing every digit", () => {
  expect(encodeUpc(reference.upc.value).modules).toBe(reference.upc.modules);
  expect(encodeEan13(reference.ean13.value).modules).toBe(reference.ean13.modules);
});
