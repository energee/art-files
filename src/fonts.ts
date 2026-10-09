// fonts.ts — the ONE gate between the label's font and the DOM. Registers
// the bundled TTFs the PDF builds embed (see pdf/fonts.ts, which shares the
// FONT_URLS map below) as document faces under labelFontCss(id), and hands
// back the face-aware canvas measure that hit-testing and the in-place editor
// share. Measurement is unkerned, matching the PDF's drawText (#86). Text
// layers may override the master family; the same family choice reaches
// measurement, drawing, the editor and export. Loaded faces are cached.
// Parsing font bytes with fontkit (glyph outlines and metrics) goes through
// fontkit.ts instead: it must stay Node-safe, and this module's ?url imports
// are not.
import poppinsRegular from "./assets/fonts/Poppins-Regular.ttf?url";
import poppinsSemiBold from "./assets/fonts/Poppins-SemiBold.ttf?url";
import poppinsBold from "./assets/fonts/Poppins-Bold.ttf?url";
import barlowRegular from "./assets/fonts/BarlowCondensed-Regular.ttf?url";
import barlowSemiBold from "./assets/fonts/BarlowCondensed-SemiBold.ttf?url";
import barlowBold from "./assets/fonts/BarlowCondensed-Bold.ttf?url";
import type { FontFamilyId } from "./fontCatalog";
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

/** A measurement context with kerning OFF. The PDF is drawn unkerned
 *  (pdf-lib's drawText places raw glyph advances), and canvas/draw paints
 *  unkerned to match, so measuring with the canvas default (kerned) would
 *  size a kern-table family like Barlow Condensed ~8% narrower than both
 *  (#86). Exports plan with pdf/build's pdfMeasureFace instead, so the
 *  file stays exact even on an engine that ignores fontKerning. */
function unkernedContext(): CanvasRenderingContext2D {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) throw new Error("Could not create the font measurement canvas.");
  ctx.fontKerning = "none";
  return ctx;
}

const registrationPromises = new Map<FontFamilyId, Promise<void>>();

/** Register each family once; failed loads can be retried. */
function registerFaces(id: FontFamilyId = "poppins"): Promise<void> {
  const cached = registrationPromises.get(id);
  if (cached) return cached;
  const css = labelFontCss(id);
  const urls = FONT_URLS[id];
  const p = Promise.all([
    new FontFace(css, `url(${urls.regular})`, { weight: "400" }).load(),
    new FontFace(css, `url(${urls.semibold})`, { weight: "600" }).load(),
    new FontFace(css, `url(${urls.bold})`, { weight: "700" }).load(),
  ]).then((faces) => {
    faces.forEach((face) => document.fonts.add(face));
  }).catch((error) => {
    registrationPromises.delete(id);
    throw error;
  });
  registrationPromises.set(id, p);
  return p;
}

/** Face-aware canvas measure for the plan and renderer. */
const facesPromises = new Map<string, Promise<MeasureFace>>();

/** The measure for a label whose default family is `id` and whose layers
 *  also draw with `others` (see fontCatalog's usedFontFamilies). Only those
 *  families' faces are fetched (#411); a family a layer picks later loads on
 *  the next call that names it. Memoized per family set. */
export function loadLabelFaces(id: FontFamilyId = "poppins", others: readonly FontFamilyId[] = []): Promise<MeasureFace> {
  const families = [...new Set([id, ...others])];
  const key = [id, ...families.slice(1).sort()].join(",");
  const cached = facesPromises.get(key);
  if (cached) return cached;
  // Memoized like registerFaces: callers sit on hot paths (the dev preview
  // effect re-asks per rebuild), and the measurement canvas is reusable.
  const p: Promise<MeasureFace> = Promise.all(families.map(registerFaces)).then((): MeasureFace => {
    const ctx = unkernedContext();
    return (text, size, face, family = id) => {
      ctx.font = `${FACE_WEIGHT[face]} ${size}px ${labelFontCss(family)}`;
      return ctx.measureText(text).width;
    };
  }).catch((error) => {
    facesPromises.delete(key);
    throw error;
  });
  facesPromises.set(key, p);
  return p;
}
