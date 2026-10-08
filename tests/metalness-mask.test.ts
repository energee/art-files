// metalness-mask.test.ts — the white-ink plate's per-pixel foil classifier
// (issue #396 moved it off the main thread into a worker): bright grey page
// pixels become foil (255), any ink becomes matte (0), alpha is opaque, and
// the async derive falls back to running inline where Worker is unavailable.
import { expect, it } from "vitest";
import { classifyMetalness, deriveMetalnessPixels } from "../src/three/metalnessMask";

const px = (...rgb: number[][]) => new Uint8ClampedArray(rgb.flatMap((c) => [...c, 255]));

it("maps bare page to foil and any ink to matte, in place", () => {
  const d = px([255, 255, 255], [200, 200, 205], [0, 0, 255], [30, 30, 30], [250, 120, 120]);
  classifyMetalness(d);
  expect(Array.from(d)).toEqual([
    255, 255, 255, 255, 255, 255, 255, 255,
    0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
  ]);
});

it("derives without a Worker (inline fallback) and returns the same pixels", async () => {
  const out = await deriveMetalnessPixels(px([255, 255, 255], [0, 0, 0]));
  expect(Array.from(out)).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
});
