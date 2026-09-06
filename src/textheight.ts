// textheight.ts — physical glyph heights from the same font outlines as export.
// Loaded lazily by the inspector; point geometry makes this independent of DPI.
import fontkit, { type Font } from "@pdf-lib/fontkit";
import type { Face, PlacedText } from "./plan";
import type { TextLayer } from "./model/layers";
import type { FontFamilyId } from "./fontCatalog";
import { planText } from "./planLayers";
import { loadFonts } from "./pdf/fonts";

export interface CharacterHeights { min: number; max: number; cpi: number }
export type HeightMeasure = (layer: TextLayer) => CharacterHeights | null;

/** Highest line-average density, not a sliding one-inch compliance check.
 * Spaces occupy width but are not printed letters, numbers or marks. */
export function charactersPerInch(runs: readonly PlacedText[]): number {
  const lines = new Map<string, { count: number; start: number; end: number }>();
  for (const run of runs) {
    const key = `${run.rotated}:${run.rotated ? run.x : run.y}`;
    const start = run.rotated ? -run.y : run.x;
    const count = (run.text.match(/[\p{L}\p{N}\p{P}\p{S}]/gu) ?? []).length;
    const line = lines.get(key);
    if (line) {
      line.count += count;
      line.start = Math.min(line.start, start);
      line.end = Math.max(line.end, start + run.w);
    } else lines.set(key, { count, start, end: start + run.w });
  }
  let cpi = 0;
  for (const line of lines.values()) {
    const width = line.end - line.start;
    if (line.count && (!Number.isFinite(width) || width <= 0))
      throw new Error("Could not measure printed text width.");
    if (line.count) cpi = Math.max(cpi, line.count * 72 / width);
  }
  return cpi;
}

export function createHeightMeasure(bytes: Record<Face, Uint8Array>): HeightMeasure {
  const fonts = Object.fromEntries(Object.entries(bytes).map(([face, data]) =>
    [face, fontkit.create(data)])) as Record<Face, Font>;
  return (layer) => {
    const runs = planText(layer, (text, size, face) =>
      fonts[face].layout(text).glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0)
        * size / fonts[face].unitsPerEm);
    let min = Infinity, max = 0;
    for (const run of runs) {
      const font = fonts[run.face];
      for (const glyph of font.layout(run.text).glyphs) {
        // Punctuation and spaces are not letters/numerals. Keep shaped
        // ligatures, whose codePoints can contain more than one letter.
        if (!glyph.codePoints.some((cp) => /[\p{L}\p{N}]/u.test(String.fromCodePoint(cp)))) continue;
        if (glyph.id === 0) throw new Error("A character is missing from the label font.");
        const height = (glyph.bbox.maxY - glyph.bbox.minY) * run.size / font.unitsPerEm * 25.4 / 72;
        if (!Number.isFinite(height) || height <= 0) throw new Error("Could not measure a printed character.");
        min = Math.min(min, height);
        max = Math.max(max, height);
      }
    }
    return max ? { min, max, cpi: charactersPerInch(runs) } : null;
  };
}

export function sizeForMinimum(size: number, currentMin: number, targetMm: number): number {
  if (![size, currentMin, targetMm].every((n) => Number.isFinite(n) && n > 0))
    throw new Error("Character height must be a positive number.");
  // Round upward so a requested minimum is never rounded below its target.
  return Math.min(300, Math.max(1, Math.ceil((size * targetMm / currentMin - 1e-9) * 100) / 100));
}

const cached = new Map<FontFamilyId, Promise<HeightMeasure>>();
export function loadHeightMeasure(family: FontFamilyId): Promise<HeightMeasure> {
  let result = cached.get(family);
  if (!result) {
    result = loadFonts(family).then(createHeightMeasure).catch((error) => {
      cached.delete(family);
      throw error;
    });
    cached.set(family, result);
  }
  return result;
}
