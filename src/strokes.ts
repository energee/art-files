// strokes.ts — what every consumer of a stroke has to agree about: the layer
// a stroke lands on, and the ring both renderers stamp to bridge a wide
// stroke's interior. Saved version-1 projects from before independent stroke
// plates have no strokeLayer field, so every consumer resolves absence here
// instead of choosing its own fallback.
import type { Layer, Style } from "./types";

export const DEFAULT_STROKE_LAYER: Layer = "white";

/** White/non-metallic is the safe legacy and shipped default: a stroke only
 * exposes metallic stock after an operator explicitly enables that plate. */
export const strokeLayerOf = (style: Pick<Style, "strokeLayer">): Layer =>
  style.strokeLayer ?? DEFAULT_STROKE_LAYER;

/** Printer-scale sampling bound for the bridge ring below, in points — the
 *  same one the former perimeter-only stroke approximation used. */
const PRINT_STEP = 0.4;

/** Where to stamp the filled glyph copies that bridge a wide stroke's
 *  interior, as offsets in points from the run's own position. Both renderers
 *  need them — neither engine paints a wide text stroke as the solid envelope
 *  it describes (pdf.js underpaints the interior; Skia leaves cavities where
 *  the stroke folds over itself around a tiny feature) — so the geometry
 *  lives here and each backend stamps the ring in its own idiom.
 *
 *  The radius is w/2, which keeps every copy's outermost ink inside the true
 *  w-wide envelope: the real stroke still owns the outer edge and the print
 *  geometry. `step` is how far apart adjacent copies may sit, floored at
 *  PRINT_STEP: the PDF has no fixed output density so it always samples for
 *  print, and a raster backend passing its own device bound can only ever
 *  ask for FEWER copies — sampling finer than the plate it has to match
 *  would be pure waste. The UI's 60px maximum asks for 57 samples at the
 *  print bound, and the 64 ceiling is only a backstop so a hand-edited
 *  project file cannot turn one run into unbounded work.
 *
 *  Memoized: callers sit on hot paths (every stroked run of every canvas
 *  repaint, every run of a PDF build) and re-ask for the same few widths. */
const ringCache = new Map<string, { dx: number; dy: number }[]>();
export function bridgeOffsets(w: number, step = 0): { dx: number; dy: number }[] {
  const radius = w / 2;
  const spacing = Math.max(PRINT_STEP, step);
  const key = `${w}|${spacing}`;
  let ring = ringCache.get(key);
  if (!ring) {
    const count = Math.min(64, Math.max(8, Math.ceil((2 * Math.PI * radius) / spacing)));
    ring = Array.from({ length: count }, (_, i) => {
      const angle = (i * 2 * Math.PI) / count;
      return { dx: radius * Math.cos(angle), dy: radius * Math.sin(angle) };
    });
    ringCache.set(key, ring);
  }
  return ring;
}
