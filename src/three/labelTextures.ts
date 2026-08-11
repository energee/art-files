// labelTextures.ts — turns the app's preview-resolution PDF pair (art plate +
// white-ink mask plate) into the canvases the 3D label material consumes: the
// art itself and a binary per-pixel metalness mask. Rasterization is shared
// with the 2D preview (see pdf/render.ts).
import { renderPdfPage } from "@/pdf/render";

/** Longest rendered edge in px. The label wraps most of the way around the
 *  can, so at typical zoom the texture — not the framebuffer — is what limits
 *  sharpness; the cap still bounds each rebuild's canvases. */
const MAX_EDGE = 4096;

/** Oversample factor over the PDF's natural (72dpi) page size. Together with
 *  MAX_EDGE this is what sets the label's texel density: preview pages are
 *  small enough that this factor, not MAX_EDGE, is usually what binds. */
const MAX_SCALE = 4;

/** min(r,g,b) above this reads as "no white ink printed" = foil shows.
 *  The mask plate draws its ink in blue (min(r,g,b) = the blue channel's
 *  complement is irrelevant — blue pixels have low r), so near-white paper
 *  areas are the only ones that clear this bar. */
const WHITE_THRESHOLD = 230;

export interface LabelTextures {
  /** Art plate rendered to a canvas (used as the sRGB color map). */
  art: HTMLCanvasElement;
  /** Binary metalness mask: white = metallic foil, black = matte white ink.
   *  Same pixel dimensions as `art`. */
  metalness: HTMLCanvasElement;
  /** True if any pixel of `metalness` is foil — i.e. the label uses a metallic
   *  mask at all. Falls out of the pass that builds the mask. */
  hasFoil: boolean;
  /** Artwork width / height — drives the cylinder wrap angle. */
  aspect: number;
}

/** Render a plate, longest edge capped at MAX_EDGE. `size` forces exact
 *  output dimensions (the mask must match the art pixel-for-pixel so the maps
 *  sample in lockstep on the same UVs). Never cancelled, so never null. */
async function renderPlate(
  bytes: Uint8Array, size?: { width: number; height: number },
): Promise<HTMLCanvasElement> {
  // scaleCap, not a scale function: the page's natural size is only known in
  // the raster worker, which resolves the cap there (size, when set, wins).
  const canvas = await renderPdfPage(bytes, {
    size,
    scaleCap: { maxEdge: MAX_EDGE, maxScale: MAX_SCALE },
  });
  return canvas!;
}

/**
 * Derive the binary metalness mask from the rendered white-ink plate.
 * Semantics (see maskimage.ts / memory notes): the mask PDF is the white-ink
 * plate — BLUE pixels mean white ink IS printed there (matte), near-white
 * pixels mean NO white ink (the bare metal foil shows through). So metalness
 * is white exactly where the plate render is near-white. With no metallic
 * mask dropped, the plate floods solid blue = all matte = all black here,
 * which is the correct "no foil" default. `hasFoil` reports whether any pixel
 * came out white, so callers don't have to re-scan the finished mask.
 */
function deriveMetalness(
  maskRender: HTMLCanvasElement,
): { canvas: HTMLCanvasElement; hasFoil: boolean } {
  const { width, height } = maskRender;
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d")!;
  const src = maskRender.getContext("2d")!.getImageData(0, 0, width, height);
  const dst = ctx.createImageData(width, height);
  const s = src.data, d = dst.data;
  let hasFoil = false;
  for (let i = 0; i < s.length; i += 4) {
    const v = Math.min(s[i], s[i + 1], s[i + 2]) > WHITE_THRESHOLD ? 255 : 0;
    if (v) hasFoil = true;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(dst, 0, 0);
  return { canvas: out, hasFoil };
}

/**
 * Build the 3D label's texture inputs from the two preview PDFs. The art
 * drives the render dimensions; the mask plate is rendered to exactly the
 * same size so every derived map shares the art's UV grid.
 */
export async function buildLabelTextures(
  { artBytes, maskBytes }: { artBytes: Uint8Array; maskBytes: Uint8Array },
): Promise<LabelTextures> {
  const art = await renderPlate(artBytes);
  const maskRender = await renderPlate(maskBytes, { width: art.width, height: art.height });
  const { canvas: metalness, hasFoil } = deriveMetalness(maskRender);
  return { art, metalness, hasFoil, aspect: art.width / art.height };
}
