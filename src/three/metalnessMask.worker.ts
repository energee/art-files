// metalnessMask.worker.ts — Web Worker entry: classifies one white-ink plate's
// pixels (see classifyMetalness) and transfers them back with the request id.
import { classifyMetalness } from "./metalnessMask";

self.onmessage = (e: MessageEvent<{ id: number; pixels: Uint8ClampedArray<ArrayBuffer> }>) => {
  classifyMetalness(e.data.pixels);
  (self as unknown as Worker).postMessage(e.data, [e.data.pixels.buffer]);
};
