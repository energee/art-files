// fontCatalog.ts — the label's font families as DATA: id, display label,
// PostScript names (what Photoshop resolves type layers against), and, for
// the bundled families, TTF basenames under src/assets/fonts. A family is
// either bundled (FONT_FAMILIES) or imported into the file (an
// `imported:<hash>` id whose label and PostScript names the caller passes in
// as `imported`). Node-safe on purpose (no ?url imports): the headless
// harness and psd/build.ts read names from here, while the DOM/URL side of
// each family lives in fonts.ts — the one gate.
import type { Face } from "./plan";

export const FONT_FAMILIES = {
  poppins: {
    label: "Poppins",
    ps: { regular: "Poppins-Regular", semibold: "Poppins-SemiBold", bold: "Poppins-Bold" },
    files: { regular: "Poppins-Regular.ttf", semibold: "Poppins-SemiBold.ttf", bold: "Poppins-Bold.ttf" },
  },
  "barlow-condensed": {
    label: "Barlow Condensed",
    ps: { regular: "BarlowCondensed-Regular", semibold: "BarlowCondensed-SemiBold", bold: "BarlowCondensed-Bold" },
    files: { regular: "BarlowCondensed-Regular.ttf", semibold: "BarlowCondensed-SemiBold.ttf", bold: "BarlowCondensed-Bold.ttf" },
  },
} as const;
/** A family shipped with the app, whose face files live in src/assets/fonts. */
export type BundledFontId = keyof typeof FONT_FAMILIES;
/** A family imported into a .master or .label, keyed by its content hash. */
export type ImportedFontId = `imported:${string}`;
export type FontFamilyId = BundledFontId | ImportedFontId;

/** What the app needs to name a family: its menu label and the PostScript
 *  name of each face. */
export type FontFamily = { label: string; ps: Record<Face, string> };

export const isImportedFontId = (id: string): id is ImportedFontId => id.startsWith("imported:");

/** The family behind an id. An imported id missing from `imported` (a file
 *  that lost its font) reads as Poppins, the same fallback as fontFamilyOf. */
export function fontFamily(id: FontFamilyId, imported?: ReadonlyMap<ImportedFontId, FontFamily>): FontFamily {
  const found = isImportedFontId(id) ? imported?.get(id) : FONT_FAMILIES[id];
  const { label, ps } = found ?? FONT_FAMILIES.poppins;
  return { label, ps };
}

/** The config's family, with the fallback that makes the field optional:
 *  absent (every pre-0.1.22 file), unknown, and imported-but-not-in-`imported`
 *  ids all mean Poppins. */
export const fontFamilyOf = (
  cfg: { fontFamily?: string }, imported?: ReadonlyMap<ImportedFontId, FontFamily>,
): FontFamilyId => {
  const id = cfg.fontFamily;
  if (!id) return "poppins";
  if (isImportedFontId(id)) return imported?.has(id) ? id : "poppins";
  return Object.hasOwn(FONT_FAMILIES, id) ? id as BundledFontId : "poppins";
};

/** The families a label draws with: the master's default first, then every
 *  layer's override, deduplicated and sorted so layer order never changes the
 *  set. The preview loads only these (#411); another family loads when a
 *  layer first picks it. */
export function usedFontFamilies(
  master: FontFamilyId,
  layers: readonly { kind: string; fontFamily?: FontFamilyId }[],
): FontFamilyId[] {
  const others = new Set(layers.flatMap((l) => l.fontFamily && l.fontFamily !== master ? [l.fontFamily] : []));
  return [master, ...[...others].sort()];
}
