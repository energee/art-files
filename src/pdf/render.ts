// render.ts — rasterize a generated PDF's first page to a canvas. One place
// owns the pdf.js worker bootstrap and the open/render/destroy dance; the two
// consumers (the 2D compare preview and the 3D label's textures) differ only
// in how they size the output.
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface RenderPageOptions {
  /** Draw into this canvas instead of a fresh one (the preview reuses its
   *  mounted canvases). Resized to the rendered viewport either way. */
  canvas?: HTMLCanvasElement;
  /** Oversample factor, or a function of the page's natural size for callers
   *  that cap the longest edge. */
  scale: number | ((base: { width: number; height: number }) => number);
  /** Force exact output dimensions. The mask plate uses this to match the art
   *  pixel-for-pixel — a half-pixel viewport mismatch desyncs the two maps. */
  size?: { width: number; height: number };
  /** Checked once the document is open: `bytes` can be superseded while a
   *  render is in flight, and a slow render must not overwrite a newer one. */
  isCancelled?: () => boolean;
}

/** Render page 1. Returns the canvas, or null if the render was cancelled. */
export async function renderPdfPage(
  bytes: Uint8Array, opts: RenderPageOptions,
): Promise<HTMLCanvasElement | null> {
  // pdf.js transfers the buffer to its worker — hand it a copy. destroy()
  // lives on the loading task (not the resolved PDFDocumentProxy) in this
  // pdfjs-dist major, so the task is kept around for cleanup.
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    if (opts.isCancelled?.()) return null;
    const base = page.getViewport({ scale: 1 });
    const scale = typeof opts.scale === "function" ? opts.scale(base) : opts.scale;
    const vp = page.getViewport({ scale });
    const canvas = opts.canvas ?? document.createElement("canvas");
    // Round like pdf.js does internally unless the caller forced a size.
    canvas.width = opts.size?.width ?? Math.round(vp.width);
    canvas.height = opts.size?.height ?? Math.round(vp.height);
    // `canvas` (not the legacy `canvasContext`) is the required render target.
    await page.render({ canvas, viewport: vp }).promise;
    return canvas;
  } finally {
    void task.destroy().catch(() => {});
  }
}
