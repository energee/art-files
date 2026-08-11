// strokes.ts — shared stroke-layer defaults. Saved version-1 projects from
// before independent stroke plates have no strokeLayer field, so every
// consumer resolves absence here instead of choosing its own fallback.
import type { Layer, Style } from "./types";

export const DEFAULT_STROKE_LAYER: Layer = "white";

/** White/non-metallic is the safe legacy and shipped default: a stroke only
 * exposes metallic stock after an operator explicitly enables that plate. */
export const strokeLayerOf = (style: Pick<Style, "strokeLayer">): Layer =>
  style.strokeLayer ?? DEFAULT_STROKE_LAYER;
