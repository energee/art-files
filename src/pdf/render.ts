// render.ts — rasterize a generated PDF's first page to a canvas. One place
// owns the raster worker and its request/cancel protocol. Its only consumer
// now is src/dev/parity.ts, a dev-only harness kept to compare the canvas
// backend's plates against the PDF's own raster; the 2D preview and the 3D
// label's textures both moved to the canvas backend in Phase 3. The painting
// itself happens in rasterWorker.ts (which stays with this file) against an
// OffscreenCanvas — pdf.js paints on the calling thread, so painting here
// froze the whole app for the duration. The worker sends the finished frame
// back as a transferred ImageBitmap, and the only main-thread work left is
// one drawImage.

export interface RenderPageOptions {
  /** Draw into this canvas instead of a fresh one (the preview reuses its
   *  mounted canvases). Resized to the rendered bitmap either way. */
  canvas?: HTMLCanvasElement;
  /** Oversample factor. Exactly one of scale / scaleCap should be set unless
   *  `size` is, which overrides both. */
  scale?: number;
  /** Cap-the-longest-edge sizing for callers that don't know the page's
   *  natural size (it is resolved in the worker, where the page is parsed). */
  scaleCap?: { maxEdge: number; maxScale: number };
  /** Force exact output dimensions. The mask plate uses this to match the art
   *  pixel-for-pixel — a half-pixel viewport mismatch desyncs the two maps. */
  size?: { width: number; height: number };
  /** Abort a render that is no longer wanted. `bytes` can be superseded while
   *  a render is in flight, and a superseded render has to be STOPPED, not
   *  merely ignored on the way out: the worker paints one request at a time,
   *  so anything still running delays the render the user is actually waiting
   *  for. Aborting is the difference between one wasted raster and a queue of
   *  them. */
  signal?: AbortSignal;
}

type WorkerReply =
  | { id: number; bitmap: ImageBitmap }
  | { id: number; cancelled: true }
  | { id: number; error: string };

let worker: Worker | null = null;
const pending = new Map<number, (r: WorkerReply) => void>();
let nextId = 0;

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./rasterWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const resolve = pending.get(e.data.id);
      pending.delete(e.data.id);
      resolve?.(e.data);
    };
    // A dead worker (failed to load, crashed) fails every waiting render
    // rather than leaving them pending forever, and is dropped so the next
    // call respawns a fresh one.
    worker.onerror = (e) => {
      for (const [id, resolve] of pending) resolve({ id, error: String(e.message ?? e) });
      pending.clear();
      // Terminate before dropping, matching client.ts's worker lifecycle.
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

/** Render page 1. Returns the canvas, or null if the render was cancelled. */
export async function renderPdfPage(
  bytes: Uint8Array, opts: RenderPageOptions,
): Promise<HTMLCanvasElement | null> {
  if (opts.signal?.aborted) return null;
  const id = nextId++;
  const w = ensureWorker();
  const reply = new Promise<WorkerReply>((resolve) => pending.set(id, resolve));
  // The buffer is transferred (no copy into the worker), so the caller's
  // array is sliced first — the same bytes back the on-screen 2D preview and
  // the 3D textures at once.
  const copy = bytes.slice();
  w.postMessage(
    { id, bytes: copy, scale: opts.scale, scaleCap: opts.scaleCap, size: opts.size },
    [copy.buffer],
  );
  const abort = () => w.postMessage({ cancel: id });
  opts.signal?.addEventListener("abort", abort, { once: true });
  let r: WorkerReply;
  try {
    r = await reply;
  } finally {
    opts.signal?.removeEventListener("abort", abort);
  }
  if ("error" in r) throw new Error(r.error);
  // Cancelled in the worker, or superseded after it finished: either way the
  // frame is stale — leave the visible canvas alone rather than flashing it.
  if ("cancelled" in r || opts.signal?.aborted) {
    if ("bitmap" in r) r.bitmap.close();
    return null;
  }
  // Painting a mounted canvas blanks it only for this one drawImage — the
  // scratch-canvas swap the main-thread version needed is now free.
  const target = opts.canvas ?? document.createElement("canvas");
  target.width = r.bitmap.width;
  target.height = r.bitmap.height;
  target.getContext("2d")!.drawImage(r.bitmap, 0, 0);
  r.bitmap.close();
  return target;
}
