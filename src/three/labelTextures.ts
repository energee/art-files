// labelTextures.ts — turns the app's preview-resolution PDF pair (art plate +
// white-ink mask plate) into the canvases the 3D label material consumes: the
// art itself and a binary per-pixel metalness mask. Rasterization goes through
// the shared pdfRender helper, and the mask's polarity rule comes from
// maskimage.ts, which owns that convention for the whole app.
import { isWhite } from "@/maskimage";
import { renderPdfPage } from "@/pdfRender";

/** Longest rendered edge in px. ~2x the PDF's preview scale is plenty for a
 *  wrapped texture; capping keeps each rebuild's canvases a few MB. */
const MAX_EDGE = 2048;

export interface LabelTextures {
  /** Art plate rendered to a canvas (used as the sRGB color map). */
  art: HTMLCanvasElement;
  /** Binary metalness mask: white = metallic foil, black = matte white ink.
   *  Same pixel dimensions as `art`. */
  metalness: HTMLCanvasElement;
  /** Artwork width / height — drives the cylinder wrap angle. */
  aspect: number;
}

/**
 * Rewrite the rendered white-ink plate in place as a binary metalness mask.
 * Semantics (see maskimage.ts, which owns the convention): the mask PDF is
 * the white-ink plate — BLUE pixels mean white ink IS printed there (matte),
 * near-white pixels mean NO white ink, so the bare metal foil shows through.
 * Metalness is therefore white exactly where the plate render is near-white.
 * With no metallic mask dropped the plate floods solid blue = all matte =
 * all black here, which is the correct "no foil" default.
 *
 * In place because the plate render has no other consumer — one full-size
 * canvas per rebuild instead of two.
 */
function toMetalnessInPlace(plate: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = plate.getContext("2d")!;
  const img = ctx.getImageData(0, 0, plate.width, plate.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = isWhite(d[i], d[i + 1], d[i + 2]) ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return plate;
}

/**
 * Build the 3D label's texture inputs from the two preview PDFs. The art
 * drives the render dimensions; the mask plate is rendered to exactly the
 * same size so every derived map shares the art's UV grid.
 */
export async function buildLabelTextures(
  { artBytes, maskBytes }: { artBytes: Uint8Array; maskBytes: Uint8Array },
): Promise<LabelTextures> {
  const art = (await renderPdfPage(artBytes, { maxEdge: MAX_EDGE }))!;
  const plate = (await renderPdfPage(maskBytes, {
    size: { width: art.width, height: art.height },
  }))!;
  return { art, metalness: toMetalnessInPlace(plate), aspect: art.width / art.height };
}
