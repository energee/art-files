// labelTextures.ts — turns the app's preview-resolution PDF pair (art plate +
// white-ink mask plate) into the canvases the 3D label material consumes: the
// art itself and a binary per-pixel metalness mask. Rendering goes through
// pdfjs-dist exactly like PreviewCompare does (same worker, same "pdf.js
// neuters the buffer it's handed" copy caveat).
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Longest rendered edge in px. ~2x the PDF's preview scale is plenty for a
 *  wrapped texture; capping keeps each rebuild's canvases a few MB. */
const MAX_EDGE = 2048;

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
  /** Artwork width / height — drives the cylinder wrap angle. */
  aspect: number;
}

/** Render page 1 of a PDF into a canvas, longest edge capped at MAX_EDGE.
 *  `size` forces exact output dimensions (the mask must match the art
 *  pixel-for-pixel so the maps sample in lockstep on the same UVs). */
async function renderPdfPage(
  bytes: Uint8Array, size?: { width: number; height: number },
): Promise<HTMLCanvasElement> {
  // pdf.js transfers the buffer to its worker — hand it a copy. destroy()
  // lives on the loading task in this pdfjs-dist major.
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = size
      ? size.width / base.width
      : Math.min(2, MAX_EDGE / Math.max(base.width, base.height));
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    // Round like pdf.js does internally, then force the exact target size —
    // a half-pixel viewport mismatch must not desync the two plates.
    canvas.width = size?.width ?? Math.round(vp.width);
    canvas.height = size?.height ?? Math.round(vp.height);
    await page.render({ canvas, viewport: vp }).promise;
    return canvas;
  } finally {
    void task.destroy().catch(() => {});
  }
}

/**
 * Derive the binary metalness mask from the rendered white-ink plate.
 * Semantics (see maskimage.ts / memory notes): the mask PDF is the white-ink
 * plate — BLUE pixels mean white ink IS printed there (matte), near-white
 * pixels mean NO white ink (the bare metal foil shows through). So metalness
 * is white exactly where the plate render is near-white. With no metallic
 * mask dropped, the plate floods solid blue = all matte = all black here,
 * which is the correct "no foil" default.
 */
function deriveMetalness(maskRender: HTMLCanvasElement): HTMLCanvasElement {
  const { width, height } = maskRender;
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d")!;
  const src = maskRender.getContext("2d")!.getImageData(0, 0, width, height);
  const dst = ctx.createImageData(width, height);
  const s = src.data, d = dst.data;
  for (let i = 0; i < s.length; i += 4) {
    const v = Math.min(s[i], s[i + 1], s[i + 2]) > WHITE_THRESHOLD ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(dst, 0, 0);
  return out;
}

/**
 * Build the 3D label's texture inputs from the two preview PDFs. The art
 * drives the render dimensions; the mask plate is rendered to exactly the
 * same size so every derived map shares the art's UV grid.
 */
export async function buildLabelTextures(
  { artBytes, maskBytes }: { artBytes: Uint8Array; maskBytes: Uint8Array },
): Promise<LabelTextures> {
  const art = await renderPdfPage(artBytes);
  const maskRender = await renderPdfPage(maskBytes, { width: art.width, height: art.height });
  return {
    art,
    metalness: deriveMetalness(maskRender),
    aspect: art.width / art.height,
  };
}
