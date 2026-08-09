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
  /** Abort a render that is no longer wanted. `bytes` can be superseded while
   *  a render is in flight, and this label is expensive to raster — every
   *  stroke is a ring of up to 128 offset text copies — so a superseded render
   *  has to be STOPPED, not merely ignored on the way out. pdf.js paints one
   *  page at a time, so anything still running delays the render the user is
   *  actually waiting for: aborting is the difference between one wasted raster
   *  and a queue of them. */
  signal?: AbortSignal;
}

/** pdf.js rejects a cancelled render with this. Matched by name rather than by
 *  importing the class, so the check survives pdf.js moving its export around. */
const isCancellation = (e: unknown) =>
  e instanceof Error && e.name === "RenderingCancelledException";

/** Render page 1. Returns the canvas, or null if the render was cancelled. */
export async function renderPdfPage(
  bytes: Uint8Array, opts: RenderPageOptions,
): Promise<HTMLCanvasElement | null> {
  if (opts.signal?.aborted) return null;
  // pdf.js transfers the buffer to its worker — hand it a copy. destroy()
  // lives on the loading task (not the resolved PDFDocumentProxy) in this
  // pdfjs-dist major, so the task is kept around for cleanup.
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    if (opts.signal?.aborted) return null;
    const base = page.getViewport({ scale: 1 });
    const scale = typeof opts.scale === "function" ? opts.scale(base) : opts.scale;
    const vp = page.getViewport({ scale });
    // Round like pdf.js does internally unless the caller forced a size.
    const width = opts.size?.width ?? Math.round(vp.width);
    const height = opts.size?.height ?? Math.round(vp.height);

    // Paint into a scratch canvas and swap at the end when the caller passed a
    // MOUNTED one. Assigning canvas.width clears the bitmap, so painting
    // straight into a visible canvas blanks the preview for the whole render —
    // seconds, on a page whose size just changed. The scratch copy costs one
    // extra bitmap for the render's lifetime and keeps the last good frame on
    // screen until the new one is ready. Callers that take the RETURNED canvas
    // (the 3D textures) have nothing on screen to protect, so they paint
    // directly into the canvas they are about to be handed.
    const target = opts.canvas;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    // `canvas` (not the legacy `canvasContext`) is the required render target.
    const render = page.render({ canvas, viewport: vp });
    const abort = () => render.cancel();
    opts.signal?.addEventListener("abort", abort, { once: true });
    try {
      await render.promise;
    } catch (error) {
      if (isCancellation(error)) return null;
      throw error;
    } finally {
      opts.signal?.removeEventListener("abort", abort);
    }
    // Superseded between finishing and swapping: leave the visible canvas
    // alone rather than flashing a frame that is already stale.
    if (opts.signal?.aborted) return null;
    if (!target) return canvas;
    target.width = width;
    target.height = height;
    target.getContext("2d")!.drawImage(canvas, 0, 0);
    return target;
  } finally {
    void task.destroy().catch(() => {});
  }
}
