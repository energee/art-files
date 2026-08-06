// upc.ts — pure UPC-A validation + module encoding (no DOM). Validation
// mirrors the barcode-qr app's behavior; encoding implements the standard
// L/R patterns so the PDF builder can draw bars directly.

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

export function validateUpc(value: string): { ok: boolean; error?: string } {
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
