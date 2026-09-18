// upc.ts — pure UPC-A + EAN-13 validation + module encoding (no DOM).
// Validation mirrors the barcode-qr app's behavior; encoding implements the
// standard L/R/G patterns so the PDF builder can draw bars directly.
import type { Validation } from "./validation";

/** Left-hand (odd parity) patterns for digits 0-9; right-hand = bitwise NOT. */
const L: string[] = [
  "0001101", "0011001", "0010011", "0111101", "0100011",
  "0110001", "0101111", "0111011", "0110111", "0001011",
];

export function upcCheckDigit(first11: string): number {
  let odd = 0, even = 0;
  for (let i = 0; i < 11; i++) {
    const d = first11.charCodeAt(i) - 48;
    if (i % 2 === 0) odd += d;
    else even += d;
  }
  return (10 - ((odd * 3 + even) % 10)) % 10;
}

export function validateUpc(value: string): Validation {
  if (!/^\d{12}$/.test(value))
    return { ok: false, error: `"${value}" is not a valid UPC-A code (12 digits).` };
  if (upcCheckDigit(value.slice(0, 11)) !== +value[11])
    return { ok: false, error: "UPC-A check digit does not match." };
  return { ok: true };
}

export interface UpcModules {
  /** 95 chars of "0"/"1"; 1 = bar. */
  modules: string;
  /** Module ranges drawn at full guard height. Per UPC-A (and JsBarcode's
   *  reference rendering) that is not just the three guard patterns: the
   *  number-system and check digits print *outside* the symbol, so their
   *  bars run tall alongside the start/end guards. Hence [0,10), the center
   *  guard [45,50), and [85,95). */
  guards: [number, number][];
}

/** Encode a validated 12-digit UPC-A into its 95-module bar pattern. */
export function encodeUpc(value: string): UpcModules {
  let m = "101";
  for (let i = 0; i < 6; i++) m += L[value.charCodeAt(i) - 48];
  m += "01010";
  for (let i = 6; i < 12; i++)
    m += [...L[value.charCodeAt(i) - 48]].map((b) => (b === "0" ? "1" : "0")).join("");
  m += "101";
  return {
    modules: m,
    guards: [
      [0, 10],
      [45, 50],
      [85, 95],
    ],
  };
}

/** EAN-13 parity selection by first digit: which of the left six digits use
 *  G (even parity) patterns. UPC-A is EAN-13 with first digit 0 = all-L. */
const PARITY: string[] = [
  "LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
  "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL",
];

/** R pattern = L pattern bit-inverted. */
const rOf = (l: string) => [...l].map((b) => (b === "0" ? "1" : "0")).join("");
/** G pattern = bitwise complement of reversed L pattern. */
const gOf = (l: string) => rOf([...l].reverse().join(""));

export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++)
    sum += (first12.charCodeAt(i) - 48) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function validateEan13(value: string): Validation {
  if (!/^\d{13}$/.test(value))
    return { ok: false, error: `"${value}" is not a valid EAN-13 code (13 digits).` };
  if (ean13CheckDigit(value.slice(0, 12)) !== +value[12])
    return { ok: false, error: "EAN-13 check digit does not match." };
  return { ok: true };
}

/** Encode a validated EAN-13 into its 95-module pattern. The first digit is
 *  implied by the left half's L/G parity sequence, not drawn as bars. */
export function encodeEan13(value: string): UpcModules {
  const parity = PARITY[value.charCodeAt(0) - 48];
  let m = "101";
  for (let i = 1; i <= 6; i++) {
    const l = L[value.charCodeAt(i) - 48];
    m += parity[i - 1] === "L" ? l : gOf(l);
  }
  m += "01010";
  for (let i = 7; i < 13; i++) m += rOf(L[value.charCodeAt(i) - 48]);
  m += "101";
  return { modules: m, guards: [[0, 10], [45, 50], [85, 95]] };
}
