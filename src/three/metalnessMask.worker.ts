// metalnessMask.worker.ts — Web Worker entry: classifies one white-ink plate's
// pixels (see classifyMetalness) and transfers them back with the request id.
import { classifyMetalness, type MaskJob } from "./metalnessMask";

self.onmessage = (e: MessageEvent<MaskJob>) => {
  classifyMetalness(e.data.pixels);
  (self as unknown as Worker).postMessage(e.data, [e.data.pixels.buffer]);
};
