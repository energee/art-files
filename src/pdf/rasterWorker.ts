// rasterWorker.ts — rasterizes a generated PDF's first page OFF the main
// thread. pdf.js parses in its own nested worker, but page.render() paints on
// the calling thread — and this label is expensive to paint (every stroke is
// a ring of up to 128 offset text copies), which froze the whole app for the
// duration. Running the paint here against an OffscreenCanvas keeps the UI
// live; the finished frame travels back as a transferred ImageBitmap.
// Protocol (see render.ts, the only client): {id, bytes, scale|scaleCap|size}
// in; {id, bitmap|cancelled|error} out; {cancel: id} aborts an in-flight render.
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const inFlight = new Map<number, { cancel(): void }>();
// Ids cancelled before their render started: a cancel landing while the
// request is still PARSING finds nothing in inFlight, and dropping it there
// meant the superseded request went on to do the expensive paint anyway.
const cancelled = new Set<number>();

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  if (msg.cancel !== undefined) {
    cancelled.add(msg.cancel);
    inFlight.get(msg.cancel)?.cancel();
    return;
  }
  const { id, bytes, scale, scaleCap, size } = msg;
  // disableFontFace: embedded fonts normally load through the DOM FontFace
  // API, which isn't available to canvas text here in the worker — glyphs
  // came out as .notdef boxes. With it off, pdf.js draws the embedded glyph
  // outlines as paths itself, which renders identically and needs no DOM.
  const task = pdfjs.getDocument({ data: bytes, disableFontFace: true });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    // Resolved here rather than sent as a function (not serializable): a
    // forced size wins, then the capped-longest-edge form, then a plain factor.
    const s = size ? size.width / base.width
      : scaleCap ? Math.min(scaleCap.maxScale, scaleCap.maxEdge / Math.max(base.width, base.height))
      : scale;
    const vp = page.getViewport({ scale: s });
    // Round like pdf.js does internally unless the caller forced a size.
    const width = size?.width ?? Math.round(vp.width);
    const height = size?.height ?? Math.round(vp.height);
    // Cancelled while parsing — skip the paint entirely.
    if (cancelled.has(id)) {
      postMessage({ id, cancelled: true });
      return;
    }
    const canvas = new OffscreenCanvas(width, height);
    // pdf.js accepts an OffscreenCanvas render target; its types don't yet.
    const render = page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport: vp });
    inFlight.set(id, render);
    try {
      await render.promise;
    } catch (error) {
      if (error instanceof Error && error.name === "RenderingCancelledException") {
        postMessage({ id, cancelled: true });
        return;
      }
      throw error;
    } finally {
      inFlight.delete(id);
    }
    // The bitmap carries its own width/height — no size fields in the reply.
    const bitmap = canvas.transferToImageBitmap();
    postMessage({ id, bitmap }, { transfer: [bitmap] });
  } catch (error) {
    postMessage({ id, error: String(error) });
  } finally {
    cancelled.delete(id);
    void task.destroy().catch(() => {});
  }
};
