// labelTextures.ts — turns the app's canvas-backend plates (art plate +
// white-ink mask plate) into the canvases the 3D label material consumes: the
// art itself and a binary per-pixel metalness mask. The plates come from the
// canvas backend's display-list walk (see canvas/draw.ts), not a PDF raster.
// The font is whatever CSS family the caller's render source is loaded
// under (see fonts.ts's gate); drawPlates just forwards it to drawPlate.
import { drawPlate, type CanvasAssets } from "@/canvas/draw";

import { deriveMetalnessPixels } from "./metalnessMask";
import type { PlacedLayer } from "@/planLayers";
import { PAGE } from "@/layout";

/** Longest rendered edge in px. The label wraps most of the way around the
 *  can, so at typical zoom the texture — not the framebuffer — is what limits
 *  sharpness; the cap still bounds each rebuild's canvases. */
const MAX_EDGE = 4096;

/** Oversample factor over the page's natural (72dpi) size. Together with
 *  MAX_EDGE this is what sets the label's texel density: preview pages are
 *  small enough that this factor, not MAX_EDGE, is usually what binds. */
const MAX_SCALE = 4;

export interface LabelTextures {
  /** Art plate rendered to a canvas (used as the sRGB color map). */
  art: HTMLCanvasElement;
  /** Binary metalness mask: white = metallic foil, black = matte white ink.
   *  Same pixel dimensions as `art`. */
  metalness: HTMLCanvasElement;

}

/**
 * Derive the binary metalness mask from the rendered white-ink plate: the
 * plate's ink (any color — uploaded masks pass through unrecolored) means
 * white ink IS printed there (matte), bare-page pixels mean NO white ink
 * (the metal foil shows through). This is the ONE binarization in the
 * pipeline — the upload is untouched — and canScene's edgeSoftness blur then
 * softens the result, same shape as captiva's soft mask. With no metallic
 * mask dropped, the plate floods solid ink = all matte = all black here,
 * which is the correct "no foil" default.
 */
async function deriveMetalness(
  maskRender: HTMLCanvasElement,
): Promise<HTMLCanvasElement> {
  const { width, height } = maskRender;
  const src = maskRender.getContext("2d")!.getImageData(0, 0, width, height);
  // The per-pixel classification runs in a worker (see metalnessMask.ts).
  const pixels = await deriveMetalnessPixels(src.data);
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  out.getContext("2d")!.putImageData(new ImageData(pixels, width, height), 0, 0);
  return out;
}

/** Draw both plates from the display list at texture resolution: MAX_SCALE
 *  over the page's natural pt size, long edge capped at MAX_EDGE — the same
 *  texel density the old PDF raster produced. One scale for both plates, so
 *  the maps share the art's UV grid pixel-for-pixel. */
export function drawPlates(
  // fontCss required for the same reason drawPlate's is — see its comment.
  plan: readonly PlacedLayer[], assets: CanvasAssets, fontCss: string,
): { art: HTMLCanvasElement; mask: HTMLCanvasElement } {
  const s = Math.min(MAX_SCALE, MAX_EDGE / Math.max(PAGE.w, PAGE.h));
  const plate = (mode: "art" | "mask") => {
    const c = document.createElement("canvas");
    c.width = Math.round(PAGE.w * s);
    c.height = Math.round(PAGE.h * s);
    drawPlate(c.getContext("2d")!, plan, assets, mode, fontCss);
    return c;
  };
  return { art: plate("art"), mask: plate("mask") };
}

/**
 * Build the 3D label's texture inputs from the two rendered plates. Pixel
 * work only — async because the mask classification runs in a worker;
 * drawing the plates is drawPlates' job.
 */
export async function buildLabelTextures(
  { art, mask }: { art: HTMLCanvasElement; mask: HTMLCanvasElement },
): Promise<LabelTextures> {
  return { art, metalness: await deriveMetalness(mask) };
}
