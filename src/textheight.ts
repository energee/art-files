// textheight.ts — physical glyph heights from the same font outlines as export,
// and the characters a layer's font cannot print. Loaded lazily by the
// inspector; point geometry makes this independent of DPI. Node-safe (the
// headless generator imports it): the DOM font loader is imported on demand.
import type { Face, PlacedText } from "./plan";
import type { TextLayer } from "./model/layers";
import type { FontFamilyId } from "./fontCatalog";
import { planText } from "./planLayers";
import { openFont } from "./fontkit";
import { t } from "@/i18n";

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
      throw new Error(t("Could not measure printed text width."));
    if (line.count) cpi = Math.max(cpi, line.count * 72 / width);
  }
  return cpi;
}

type FaceFonts = Record<Face, ReturnType<typeof openFont>>;

function openFaces(bytes: Record<Face, Uint8Array>): FaceFonts {
  return { regular: openFont(bytes.regular), semibold: openFont(bytes.semibold), bold: openFont(bytes.bold) };
}

/** The layer's printed runs, as export plans them, measured with `fonts`. */
function layerRuns(layer: TextLayer, fonts: FaceFonts): PlacedText[] {
  return planText(layer, (text, size, face) =>
    fonts[face].layout(text).glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0)
      * size / fonts[face].unitsPerEm);
}

export function createHeightMeasure(bytes: Record<Face, Uint8Array>): HeightMeasure {
  const fonts = openFaces(bytes);
  return (layer) => {
    const runs = layerRuns(layer, fonts);
    let min = Infinity, max = 0;
    for (const run of runs) {
      const font = fonts[run.face];
      for (const glyph of font.layout(run.text).glyphs) {
        // Punctuation and spaces are not letters/numerals. Keep shaped
        // ligatures, whose codePoints can contain more than one letter.
        if (!glyph.codePoints.some((cp) => /[\p{L}\p{N}]/u.test(String.fromCodePoint(cp)))) continue;
        if (glyph.id === 0) throw new Error(t("A character is missing from the label font."));
        const height = (glyph.bbox.maxY - glyph.bbox.minY) * run.size / font.unitsPerEm * 25.4 / 72;
        if (!Number.isFinite(height) || height <= 0) throw new Error(t("Could not measure a printed character."));
        min = Math.min(min, height);
        max = Math.max(max, height);
      }
    }
    return max ? { min, max, cpi: charactersPerInch(runs) } : null;
  };
}

/** One variation selector (the emoji picker's ™️). fontkit folds it into the
 *  base glyph, so it is never a missing character. Shared with pdf/build's
 *  export check so the inspector and export agree on what cannot print. */
export const VARIATION_SELECTOR = /^[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]$/u;

/** Codepoints in a layer's printed text that its font maps to glyph 0
 *  (.notdef), in first-seen order. Each run is checked in the face it prints
 *  in; variation selectors fold into their base glyph and are never reported.
 *  Looked up per codepoint: fontkit's layout reports the wrong codePoints on
 *  consecutive .notdef glyphs. */
export function createMissingGlyphCheck(bytes: Record<Face, Uint8Array>): (layer: TextLayer) => number[] {
  const fonts = openFaces(bytes);
  return (layer) => {
    const missing = new Set<number>();
    for (const run of layerRuns(layer, fonts))
      for (const ch of run.text) {
        const cp = ch.codePointAt(0)!;
        if (!VARIATION_SELECTOR.test(ch) && fonts[run.face].glyphForCodePoint(cp).id === 0) missing.add(cp);
      }
    return [...missing];
  };
}

/** "“→” (U+2192), …" — how a missing-glyph list reads to the operator, in
 *  the inspector, the CLI and the export error alike. */
export function describeCodepoints(codepoints: readonly number[]): string {
  return codepoints.map((cp) => `“${String.fromCodePoint(cp)}” (U+${cp.toString(16).toUpperCase().padStart(4, "0")})`).join(", ");
}

export function sizeForMinimum(size: number, currentMin: number, targetMm: number): number {
  if (![size, currentMin, targetMm].every((n) => Number.isFinite(n) && n > 0))
    throw new Error(t("Character height must be a positive number."));
  // Round upward so a requested minimum is never rounded below its target.
  return Math.min(300, Math.max(1, Math.ceil((size * targetMm / currentMin - 1e-9) * 100) / 100));
}

export interface TextChecks { measure: HeightMeasure; missingGlyphs: (layer: TextLayer) => number[] }

const cached = new Map<FontFamilyId, Promise<TextChecks>>();
/** The inspector's checks for one family, loaded once. The DOM font loader is
 *  imported here, on demand, so Node callers can import this module. */
export function loadTextChecks(family: FontFamilyId): Promise<TextChecks> {
  let result = cached.get(family);
  if (!result) {
    result = import("./pdf/fonts").then(({ loadFonts }) => loadFonts(family))
      .then((bytes) => ({ measure: createHeightMeasure(bytes), missingGlyphs: createMissingGlyphCheck(bytes) })).catch((error) => {
      cached.delete(family);
      throw error;
    });
    cached.set(family, result);
  }
  return result;
}
