// code128.ts — pure Code 128 encoding (no DOM), emitting the same
// {modules, guards} shape as upc.ts so barcode geometry can draw any
// symbology. Widths table transcribed from the Wikipedia "Code 128"
// article's "Bar code widths" table (mirrors ISO/IEC 15417), fetched
// 2026-08-27: https://en.wikipedia.org/wiki/Code_128
// tests/code128.test.ts pins a published reference vector (also from that
// article) against transcription errors.
import type { UpcModules } from "./upc";
import { t } from "@/i18n";

// ponytail: code set B, or C only for an all-digit even-length payload —
// no mid-string set switching; add optimal switching if labels ever need it.

/**
 * Bar/space widths for Code 128 symbol values 0-106, one 6-digit string per
 * value (each digit 1-4 modules, always summing to 11). Index = symbol
 * value: 0-95 are the code-set-B/C data symbols, 96-102 are shared special
 * functions, 103-105 are Start Code A/B/C, 106 is the Stop symbol.
 */
export const WIDTHS: string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "233111",
];

// The 7-width, 13-module termination pattern (the article's "Stop pattern
// (7 bars/spaces)" row): the 11-module Stop symbol (value 106, "233111")
// with its final 2-module termination bar already folded in. Used directly
// — it is not WIDTHS[106] plus a separate bar.
const STOP = "2331112";
const START_B = 104;
const START_C = 105;

const toModules = (widths: string): string =>
  [...widths].map((w, i) => (i % 2 === 0 ? "1" : "0").repeat(+w)).join("");

export function validateCode128(value: string): { ok: boolean; error?: string } {
  if (value.length === 0) return { ok: false, error: t("Code 128 value is empty.") };
  if (!/^[\x20-\x7e]+$/.test(value))
    return { ok: false, error: t("Code 128 supports printable ASCII only.") };
  return { ok: true };
}

export function encodeCode128(value: string): UpcModules {
  const setC = /^(\d\d)+$/.test(value);
  const symbols: number[] = [setC ? START_C : START_B];
  if (setC)
    for (let i = 0; i < value.length; i += 2) symbols.push(+value.slice(i, i + 2));
  else
    for (const ch of value) symbols.push(ch.charCodeAt(0) - 32);
  let check = symbols[0];
  for (let i = 1; i < symbols.length; i++) check += i * symbols[i];
  symbols.push(check % 103);
  const modules = symbols.map((s) => toModules(WIDTHS[s])).join("") + toModules(STOP);
  return { modules, guards: [] };
}
