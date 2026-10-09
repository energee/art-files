// collab.ts — pixel work for raster collab logos. DOM-free, so the browser
// app and the Node harness share it: both decode the file themselves
// (canvas / pngjs), call in here, then re-encode.
import type { Fill } from "./types";
import { parseHexFill } from "./layout";

/** Which raster kind a filename holds, by extension — the one classification
 *  rule shared by the app's file drops and the Node harness's CLI paths. */
export const rasterKind = (name: string): "jpg" | "png" =>
  /\.jpe?g$/i.test(name) ? "jpg" : "png";

/** The two rasters pdf-lib can embed as-is, and so the test for "needs no
 *  transcode". Everything else a browser can decode (WebP) keeps its own
 *  bytes for Save and gets a PNG copy for embedding — see readRaster in
 *  assets/io.ts. rasterKind is only truthful for these two extensions. */
export const EMBEDDABLE_RASTER = /\.(png|jpe?g)$/i;

/** Filename → browser MIME: SVG, WebP, PNG or JPEG. Lives beside
 *  rasterKind so there is one home for "what image is this name" — the
 *  svg test had already started forking into call sites. */
export const mimeFor = (name: string): string =>
  /\.svg$/i.test(name) ? "image/svg+xml"
    : /\.webp$/i.test(name) ? "image/webp"
    : rasterKind(name) === "png" ? "image/png" : "image/jpeg";

/** Recolor every pixel to `fill`, keeping its alpha — the "color overlay" a
 *  partner's one-color PNG needs to sit on the label in label gold (or any
 *  other fill) instead of whatever color it was exported in.
 *
 *  Alpha is what carries the artwork here, so a logo exported as opaque
 *  black-on-white tints to a solid rectangle rather than a gold mark: the
 *  white background is opaque too, and nothing in the pixels says it was
 *  meant to be background. That is why this is opt-in per slot
 *  (CollabSlot.tintRaster) rather than applied to every raster automatically.
 *  Mutates in place, like prepareMaskForPdf. */
export function tintRgba(rgba: Uint8Array | Uint8ClampedArray, fill: Fill): void {
  const { r, g, b } = parseHexFill(fill);
  const R = Math.round(r * 255);
  const G = Math.round(g * 255);
  const B = Math.round(b * 255);
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue; // fully transparent: leave it alone
    rgba[i] = R;
    rgba[i + 1] = G;
    rgba[i + 2] = B;
  }
}
