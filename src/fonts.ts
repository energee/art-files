// fonts.ts — the ONE gate between the label's font and the DOM. Registers
// the bundled TTFs the PDF builds embed (see pdf/fonts.ts, which shares the
// FONT_URLS map below) as document faces under labelFontCss(id), and hands
// back the canvas-metrics Measure that hit-testing and the in-place editor
// share. Text layers may override the master family; the same family choice
// reaches measurement, drawing, the editor and export. Loaded faces are cached.
import poppinsRegular from "./assets/fonts/Poppins-Regular.ttf?url";
import poppinsSemiBold from "./assets/fonts/Poppins-SemiBold.ttf?url";
import poppinsBold from "./assets/fonts/Poppins-Bold.ttf?url";
import barlowRegular from "./assets/fonts/BarlowCondensed-Regular.ttf?url";
import barlowSemiBold from "./assets/fonts/BarlowCondensed-SemiBold.ttf?url";
import barlowBold from "./assets/fonts/BarlowCondensed-Bold.ttf?url";
import type { FontFamilyId } from "./fontCatalog";
type Measure = (text: string, size: number, bold: boolean) => number;
import type { MeasureFace } from "./plan";

type Face = "regular" | "semibold" | "bold";

/** The ?url side of the catalog: Vite needs static imports, so this is the
 *  one place a family's face URLs are wired up. Consumed here and by
 *  pdf/fonts.ts (loadFonts), so the URL side has one source. */
export const FONT_URLS: Record<FontFamilyId, Record<Face, string>> = {
  poppins: { regular: poppinsRegular, semibold: poppinsSemiBold, bold: poppinsBold },
  "barlow-condensed": { regular: barlowRegular, semibold: barlowSemiBold, bold: barlowBold },
};

/** The CSS font-family a family's faces register under — one distinct name
 *  per family, so two families' faces never collide in `document.fonts`. */
export const labelFontCss = (id: FontFamilyId) => "LabelFont-" + id;

/** CSS weight per plan face. Measure and draw MUST agree on this mapping —
 *  a mismatch silently mismeasures or misdraws — so it lives once, beside
 *  the family it styles, and both loadLabelFaces and canvas/draw import it. */
export const FACE_WEIGHT = { regular: 400, semibold: 600, bold: 700 } as const;

const measurePromises = new Map<FontFamilyId, Promise<Measure>>();

/** Memoized per family; a failed load clears that family's memo so the next
 *  caller retries. `bold` intentionally measures the SemiBold face: most
 *  bold targets use it, and the two true-Bold elements are centred and
 *  tolerate the small symmetric under-measurement (see hittest.ts). */
export function loadLabelFont(id: FontFamilyId = "poppins"): Promise<Measure> {
  const cached = measurePromises.get(id);
  if (cached) return cached;
  const css = labelFontCss(id);
  const urls = FONT_URLS[id];
  const p = Promise.all([
    new FontFace(css, `url(${urls.regular})`, { weight: "400" }).load(),
    new FontFace(css, `url(${urls.semibold})`, { weight: "600" }).load(),
    new FontFace(css, `url(${urls.bold})`, { weight: "700" }).load(),
  ]).then((faces) => {
    faces.forEach((face) => document.fonts.add(face));
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("Could not create the font measurement canvas.");
    return (text: string, size: number, bold: boolean) => {
      ctx.font = `${bold ? 600 : 400} ${size}px ${css}`;
      return ctx.measureText(text).width;
    };
  }).catch((error) => {
    measurePromises.delete(id);
    throw error;
  });
  measurePromises.set(id, p);
  return p;
}

/** Face-aware canvas measure for the plan: the same loaded faces, measured
 *  at their true weights (unlike Measure's bold-boolean approximation, which
 *  hit boxes keep for compatibility). The canvas renderer places with THIS,
 *  so what it measures is what it draws. */
const facesPromises = new Map<FontFamilyId, Promise<MeasureFace>>();

export function loadLabelFaces(id: FontFamilyId = "poppins"): Promise<MeasureFace> {
  const cached = facesPromises.get(id);
  if (cached) return cached;
  // Memoized like loadLabelFont: callers sit on hot paths (the dev preview
  // effect re-asks per rebuild), and the measurement canvas is reusable.
  // Both bundled families are ready before editing; switching a layer cannot
  // measure a fallback font while its actual face is still loading.
  const p: Promise<MeasureFace> = Promise.all(
    (Object.keys(FONT_URLS) as FontFamilyId[]).map(loadLabelFont),
  ).then((): MeasureFace => {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("Could not create the font measurement canvas.");
    return (text, size, face, family = id) => {
      ctx.font = `${FACE_WEIGHT[face]} ${size}px ${labelFontCss(family)}`;
      return ctx.measureText(text).width;
    };
  }).catch((error) => {
    facesPromises.delete(id);
    throw error;
  });
  facesPromises.set(id, p);
  return p;
}
