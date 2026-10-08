// metalness-mask.test.ts — the white-ink plate's per-pixel foil classifier
// (issue #396 moved it off the main thread into a worker): bright grey page
// pixels become foil (255), any ink becomes matte (0), alpha is opaque, and
// the async derive falls back to running inline where Worker is unavailable,
// pairs worker replies with their requests, and rejects if the worker fails.
import { afterEach, expect, it, vi } from "vitest";
import { classifyMetalness, deriveMetalnessPixels, type MaskJob } from "../src/three/metalnessMask";

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

// A fake Worker that runs the real classifier on postMessage (or fails, to
// stand in for a worker that won't load), so the request/response plumbing is
// exercised without a browser. Each test re-imports the module so its cached
// worker starts fresh.
function stubWorker(fail: boolean) {
  const made: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((e: { data: MaskJob }) => void) | null = null;
    onerror: ((e: { message: string }) => void) | null = null;
    terminated = false;
    constructor() { made.push(this); }
    postMessage(job: MaskJob) {
      queueMicrotask(() => {
        if (fail) { this.onerror?.({ message: "boom" }); return; }
        classifyMetalness(job.pixels);
        this.onmessage?.({ data: job });
      });
    }
    terminate() { this.terminated = true; }
  }
  vi.stubGlobal("Worker", FakeWorker);
  return made;
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it("matches each worker reply to its own request", async () => {
  stubWorker(false);
  const { deriveMetalnessPixels: derive } = await import("../src/three/metalnessMask");
  const [a, b] = await Promise.all([derive(px([255, 255, 255])), derive(px([0, 0, 0]))]);
  expect(Array.from(a)).toEqual([255, 255, 255, 255]);
  expect(Array.from(b)).toEqual([0, 0, 0, 255]);
});

it("rejects instead of hanging when the worker fails, and starts a fresh one next time", async () => {
  const made = stubWorker(true);
  const { deriveMetalnessPixels: derive } = await import("../src/three/metalnessMask");
  await expect(derive(px([255, 255, 255]))).rejects.toThrow(/foil-mask worker failed: boom/);
  expect(made[0].terminated).toBe(true);
  await expect(derive(px([255, 255, 255]))).rejects.toThrow();
  expect(made).toHaveLength(2);
});
