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

/** The registered family for label text drawn by the DOM (the in-place
 *  editor). Weights: 400 regular, 600 semibold, 700 the name's true Bold. */
export const LABEL_FONT_FAMILY = "LabelFont";

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
