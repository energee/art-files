// fonts.ts — the ONE gate between the label's font and the DOM. Registers
// the bundled TTFs the PDF builds embed (see pdf/fonts.ts, which shares the
// FONT_URLS map below) as document faces under labelFontCss(id), and hands
// back the canvas-metrics Measure that hit-testing and the in-place editor
// share. The gate is family-aware: every consumer — measure, hit boxes, the
// editor's visible text — takes the config's fontFamilyOf(cfg) choice
// (fontCatalog.ts) and follows it, memoized per family so switching families
// never re-fetches a face already loaded.
import poppinsRegular from "./assets/fonts/Poppins-Regular.ttf?url";
import poppinsSemiBold from "./assets/fonts/Poppins-SemiBold.ttf?url";
import poppinsBold from "./assets/fonts/Poppins-Bold.ttf?url";
import type { FontFamilyId } from "./fontCatalog";
import type { Measure } from "./hittest";
import type { MeasureFace } from "./plan";

type Face = "regular" | "semibold" | "bold";

/** The ?url side of the catalog: Vite needs static imports, so this is the
 *  one place a family's face URLs are wired up. Consumed here and by
 *  pdf/fonts.ts (loadFonts), so the URL side has one source. */
export const FONT_URLS: Record<FontFamilyId, Record<Face, string>> = {
  poppins: { regular: poppinsRegular, semibold: poppinsSemiBold, bold: poppinsBold },
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
  const css = labelFontCss(id);
  // Memoized like loadLabelFont: callers sit on hot paths (the dev preview
  // effect re-asks per rebuild), and the measurement canvas is reusable.
  const p: Promise<MeasureFace> = loadLabelFont(id).then((): MeasureFace => {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("Could not create the font measurement canvas.");
    return (text, size, face) => {
      ctx.font = `${FACE_WEIGHT[face]} ${size}px ${css}`;
      return ctx.measureText(text).width;
    };
  }).catch((error) => {
    facesPromises.delete(id);
    throw error;
  });
  facesPromises.set(id, p);
  return p;
}
