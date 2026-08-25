// fonts.ts — the ONE gate between the label's font and the DOM. Registers
// the same bundled TTFs the PDF builds embed (see pdf/fonts.ts) as document
// faces under LABEL_FONT_FAMILY, and hands back the canvas-metrics Measure
// that hit-testing and the in-place editor share. The font is Poppins today,
// but it is intended to become config-driven: when that lands, this module
// takes the choice and every consumer — measure, hit boxes, the editor's
// visible text — follows without touching a hardcoded family name.
import poppinsRegular from "./assets/fonts/Poppins-Regular.ttf?url";
import poppinsSemiBold from "./assets/fonts/Poppins-SemiBold.ttf?url";
import poppinsBold from "./assets/fonts/Poppins-Bold.ttf?url";
import type { Measure } from "./hittest";
import type { MeasureFace } from "./plan";

/** The registered family for label text drawn by the DOM (the in-place
 *  editor). Weights: 400 regular, 600 semibold, 700 the name's true Bold. */
export const LABEL_FONT_FAMILY = "LabelFont";

/** CSS weight per plan face. Measure and draw MUST agree on this mapping —
 *  a mismatch silently mismeasures or misdraws — so it lives once, beside
 *  the family it styles, and both loadLabelFaces and canvas/draw import it. */
export const FACE_WEIGHT = { regular: 400, semibold: 600, bold: 700 } as const;

let measurePromise: Promise<Measure> | null = null;

/** Memoized; a failed load clears the memo so the next caller retries.
 *  `bold` intentionally measures the SemiBold face: most bold targets use
 *  it, and the two true-Bold elements are centred and tolerate the small
 *  symmetric under-measurement (see hittest.ts). */
export function loadLabelFont(): Promise<Measure> {
  if (measurePromise) return measurePromise;
  measurePromise = Promise.all([
    new FontFace(LABEL_FONT_FAMILY, `url(${poppinsRegular})`, { weight: "400" }).load(),
    new FontFace(LABEL_FONT_FAMILY, `url(${poppinsSemiBold})`, { weight: "600" }).load(),
    new FontFace(LABEL_FONT_FAMILY, `url(${poppinsBold})`, { weight: "700" }).load(),
  ]).then((faces) => {
    faces.forEach((face) => document.fonts.add(face));
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("Could not create the font measurement canvas.");
    return (text: string, size: number, bold: boolean) => {
      ctx.font = `${bold ? 600 : 400} ${size}px ${LABEL_FONT_FAMILY}`;
      return ctx.measureText(text).width;
    };
  }).catch((error) => {
    measurePromise = null;
    throw error;
  });
  return measurePromise;
}

/** Face-aware canvas measure for the plan: the same loaded faces, measured
 *  at their true weights (unlike Measure's bold-boolean approximation, which
 *  hit boxes keep for compatibility). The canvas renderer places with THIS,
 *  so what it measures is what it draws. */
let facesPromise: Promise<MeasureFace> | null = null;

export function loadLabelFaces(): Promise<MeasureFace> {
  if (facesPromise) return facesPromise;
  // Memoized like loadLabelFont: callers sit on hot paths (the dev preview
  // effect re-asks per rebuild), and the measurement canvas is reusable.
  const p: Promise<MeasureFace> = loadLabelFont().then((): MeasureFace => {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("Could not create the font measurement canvas.");
    return (text, size, face) => {
      ctx.font = `${FACE_WEIGHT[face]} ${size}px ${LABEL_FONT_FAMILY}`;
      return ctx.measureText(text).width;
    };
  }).catch((error) => {
    facesPromise = null;
    throw error;
  });
  facesPromise = p;
  return p;
}
