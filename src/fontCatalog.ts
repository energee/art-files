// fontCatalog.ts — the label's font families as DATA: id, display label,
// PostScript names (what Photoshop resolves type layers against), and TTF
// basenames under src/assets/fonts. Node-safe on purpose (no ?url imports):
// the headless harness and psd/build.ts read names from here, while the
// DOM/URL side of each family lives in fonts.ts — the one gate.
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
export type FontFamilyId = keyof typeof FONT_FAMILIES;

/** The config's family, with the fallback that makes the field optional:
 *  absent (every pre-0.1.22 file) and unknown ids both mean Poppins. */
export const fontFamilyOf = (cfg: { fontFamily?: string }): FontFamilyId =>
  (cfg.fontFamily && Object.hasOwn(FONT_FAMILIES, cfg.fontFamily) ? cfg.fontFamily : "poppins") as FontFamilyId;
