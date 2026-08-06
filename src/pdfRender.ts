// pdfRender.ts — the one pdf.js entry point: worker registration plus the
// render-page-1-to-a-canvas call both preview surfaces need (PreviewCompare's
// 2D compare and the 3D views' label textures). Centralized because every
// pdfjs-dist major moves something here — the render target moved from
// `canvasContext` to `canvas`, and destroy() moved onto the loading task —
// and those breaks must not have to be found and fixed twice.
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** How big to render page 1.
 *  - `scale`: fixed multiple of the PDF's natural size.
 *  - `maxEdge`: scale so the longest edge lands at most here (capped at 2x).
 *  - `size`: exact output pixels — used when two plates must line up
 *    pixel-for-pixel so their textures sample on one UV grid. */
export type RenderSize =
  | { scale: number }
  | { maxEdge: number }
  | { size: { width: number; height: number } };

/** Render page 1 of `bytes` into `canvas` (or a fresh one), sized per `how`.
 *  `isCancelled` is polled after the async document/page fetches so a
 *  superseded render bails before touching a shared canvas. */
export async function renderPdfPage(
  bytes: Uint8Array,
  how: RenderSize,
  canvas?: HTMLCanvasElement | null,
  isCancelled: () => boolean = () => false,
): Promise<HTMLCanvasElement | null> {
  if (canvas === null) return null;
  // pdf.js transfers the buffer to its worker — hand it a copy.
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    // bytes can change while this render is in flight (each call spins up its
    // own worker doc); bail before touching a shared canvas so a slower,
    // superseded render can't overwrite a newer one.
    if (isCancelled()) return null;
    const base = page.getViewport({ scale: 1 });
    const exact = "size" in how ? how.size : null;
    const scale = "scale" in how
      ? how.scale
      : "size" in how
        ? how.size.width / base.width
        : Math.min(2, how.maxEdge / Math.max(base.width, base.height));
    const vp = page.getViewport({ scale });
    const target = canvas ?? document.createElement("canvas");
    // Round like pdf.js does internally, unless an exact size was demanded —
    // a half-pixel viewport mismatch must not desync two plates.
    target.width = exact?.width ?? Math.round(vp.width);
    target.height = exact?.height ?? Math.round(vp.height);
    // `canvas` (not the legacy `canvasContext`) is the required render target.
    await page.render({ canvas: target, viewport: vp }).promise;
    return target;
  } finally {
    void task.destroy().catch(() => {});
  }
}
