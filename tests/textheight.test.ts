// textheight.test.ts — printed heights against the bundled font's outline units.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { charactersPerInch, createHeightMeasure, sizeForMinimum } from "../src/textheight";
import { OUTPUT_DPI, setOutputDpi } from "../src/layout";
import type { TextLayer } from "../src/model/layers";

const bytes = (face: string) => readFileSync(new URL(`../src/assets/fonts/Poppins-${face}.ttf`, import.meta.url));
const measure = createHeightMeasure({ regular: bytes("Regular"), semibold: bytes("SemiBold"), bold: bytes("Bold") });
const style = { fill: "#000000", layer: "white" } as const;
const text = (value: string, patch: Partial<TextLayer> = {}): TextLayer => ({
  id: "text", name: "Text", kind: "text", enabled: true, x: 0, y: 0,
  anchor: "left", align: "left", size: 10, style,
  lines: [{ text: value, ...style }], ...patch,
});

it("measures the smallest and tallest letters/numerals using real outlines, not the em box", () => {
  // Poppins Regular: 1000 units/em; x is 548 units high, 1 is 723.
  const result = measure(text("Hx1. ,"))!;
  expect(result.min).toBeCloseTo(548 / 1000 * 10 * 25.4 / 72, 10);
  expect(result.max).toBeCloseTo(723 / 1000 * 10 * 25.4 / 72, 10);
  expect(measure(text("  . , !"))).toBeNull();
  expect(measure(text("Hx1", { rotation: 90, leading: 4, width: 500, style: { ...style, stroke: "#FFFFFF", strokeWidth: 60 } }))).toMatchObject({ min: result.min, max: result.max });
  const enlarged = measure(text("Hx1", { size: 20 }))!;
  expect(enlarged.min).toBeCloseTo(result.min * 2);
  expect(enlarged.max).toBeCloseTo(result.max * 2);
});

it("follows export transformations, placeholders, suffixes and heading scales", () => {
  expect(measure(text("", { placeholder: "Hx1" }))).toEqual(measure(text("Hx1")));
  expect(measure(text("x", { uppercase: true }))).toEqual(measure(text("X")));
  expect(measure(text("H", { suffix: "x1" }))).toEqual(measure(text("Hx1")));
  expect(measure(text("**Hx1**"))).toEqual(measure(text("Hx1", { faces: { base: "semibold", bold: "semibold" } })));
  const header = measure(text("", { lines: [{ text: "H", ...style, header: true }], headerScale: 2 }))!;
  expect(header).toEqual(measure(text("H", { size: 20, faces: { base: "semibold", bold: "semibold" } })));
});

it("sets a requested minimum without undershooting, preserves point bounds and rejects invalid input", () => {
  const layer = text("Hx1");
  const size = sizeForMinimum(layer.size, measure(layer)!.min, 2);
  expect(measure({ ...layer, size })!.min).toBeGreaterThanOrEqual(2);
  expect(measure({ ...layer, size: size - 0.01 })!.min).toBeLessThan(2);
  expect(sizeForMinimum(10, 1, 100)).toBe(300);
  expect(sizeForMinimum(10, 1, 0.001)).toBe(1);
  expect(() => sizeForMinimum(10, 0, 2)).toThrow();
});


it("keeps physical character heights unchanged across output resolutions", () => {
  const previous = OUTPUT_DPI;
  try {
    setOutputDpi(300);
    const at300 = measure(text("Hx1"));
    setOutputDpi(1200);
    expect(measure(text("Hx1"))).toEqual(at300);
  } finally { setOutputDpi(previous); }
});


it("computes the densest line from placed widths, including justified gaps and rotated runs", () => {
  const run = { kind: "text", id: "t", text: "AB C!", x: 0, y: 10, w: 36, size: 10,
    face: "regular", tracking: 0, fill: "#000000", layer: "white", stroke: null, rotated: false } as const;
  expect(charactersPerInch([run])).toBe(8); // 4 printed characters / half inch
  expect(charactersPerInch([{ ...run, rotated: true, x: 10, y: 0 }])).toBe(8);
  expect(charactersPerInch([{ ...run, text: "AB", w: 12 },
    { ...run, text: "CD", x: 60, w: 12 }])).toBe(4); // one justified inch
  expect(charactersPerInch([run, { ...run, y: 30, w: 18 }])).toBe(16);
  expect(charactersPerInch([])).toBe(0);
  expect(() => charactersPerInch([{ ...run, w: 0 }])).toThrow(/width/);
  const layer = text("Hello world");
  expect(measure({ ...layer, size: 20 })!.cpi).toBeCloseTo(measure(layer)!.cpi / 2);
});
