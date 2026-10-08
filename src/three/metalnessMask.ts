// metalnessMask.ts — the white-ink plate's per-pixel foil classifier, and an
// async wrapper that runs it in a Web Worker so the ~3.4Mpx loop doesn't
// hitch the main thread while the operator types in the 3D view (#396).
// Where Worker is unavailable (Node tests, the headless harness) it runs inline.

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

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, (d: Uint8ClampedArray<ArrayBuffer>) => void>();

/** Classify `pixels` off the main thread. The buffer is transferred, so the
 *  caller must not reuse it; the classified copy comes back. */
export function deriveMetalnessPixels(pixels: Uint8ClampedArray<ArrayBuffer>): Promise<Uint8ClampedArray<ArrayBuffer>> {
  if (typeof Worker === "undefined") {
    classifyMetalness(pixels);
    return Promise.resolve(pixels);
  }
  if (!worker) {
    worker = new Worker(new URL("./metalnessMask.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; pixels: Uint8ClampedArray<ArrayBuffer> }>) => {
      pending.get(e.data.id)?.(e.data.pixels);
      pending.delete(e.data.id);
    };
  }
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker!.postMessage({ id, pixels }, [pixels.buffer]);
  });
}
