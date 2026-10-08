// metalnessMask.ts — the white-ink plate's per-pixel foil classifier, and an
// async wrapper that runs it in a Web Worker so the ~3.4Mpx loop doesn't
// hitch the main thread while the operator types in the 3D view (#396).
// Where Worker is unavailable (Node tests) it runs inline.

/** Brightness/saturation classifier (captiva's metalness rule): a pixel is
 *  the bare page — foil shows — when it is bright and nearly grey. Any
 *  colored or dark pixel is ink, whatever color it was authored in, so
 *  uploaded masks work regardless of their exact ink color. Rewrites RGBA
 *  `d` in place: page -> white (foil), ink -> black (matte), alpha opaque. */
export function classifyMetalness(d: Uint8ClampedArray<ArrayBuffer>): void {
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const max = Math.max(r, g, b);
    const saturation = max > 0 ? (max - Math.min(r, g, b)) / max : 0;
    const v = max > 180 && saturation < 0.15 ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
}

/** One worker round trip: the request id and the plate's RGBA pixels, which
 *  are transferred each way (classified in place by the worker). */
export interface MaskJob { id: number; pixels: Uint8ClampedArray<ArrayBuffer> }

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, {
  resolve: (d: Uint8ClampedArray<ArrayBuffer>) => void;
  reject: (err: Error) => void;
}>();

/** Classify `pixels` off the main thread. The buffer is transferred, so the
 *  caller must not reuse it; the classified copy comes back. Rejects if the
 *  worker fails to load or throws, so the caller can report it instead of
 *  waiting forever; the next call starts a fresh worker. */
export function deriveMetalnessPixels(pixels: Uint8ClampedArray<ArrayBuffer>): Promise<Uint8ClampedArray<ArrayBuffer>> {
  if (typeof Worker === "undefined") {
    classifyMetalness(pixels);
    return Promise.resolve(pixels);
  }
  if (!worker) {
    const w = new Worker(new URL("./metalnessMask.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<MaskJob>) => {
      pending.get(e.data.id)?.resolve(e.data.pixels);
      pending.delete(e.data.id);
    };
    w.onerror = (e: ErrorEvent) => {
      const err = new Error(`foil-mask worker failed: ${e.message || "could not load"}`);
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      w.terminate();
      if (worker === w) worker = null;
    };
    worker = w;
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, pixels } satisfies MaskJob, [pixels.buffer]);
  });
}
