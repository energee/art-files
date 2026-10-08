// bitmap-cache.test.ts — the preview's per-source-bytes bitmap cache (#413):
// an unchanged asset reuses its decode, and only dropped bitmaps are closed.
import { afterEach, expect, it, vi } from "vitest";
import { createBitmapCache } from "../src/canvas/bitmapCache";

class FakeBitmap { closed = false; close() { this.closed = true; } }
const decodes = vi.fn(async () => new FakeBitmap() as unknown as ImageBitmap);
afterEach(() => { vi.unstubAllGlobals(); decodes.mockClear(); });
/** Closing waits on the decode promise, so let its callbacks run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

it("decodes the same source bytes once", async () => {
  vi.stubGlobal("createImageBitmap", decodes);
  const cache = createBitmapCache();
  const bytes = new Uint8Array([1]);
  const a = await cache.get(bytes);
  const b = await cache.get(bytes);
  expect(b).toBe(a);
  expect(decodes).toHaveBeenCalledOnce();
});

it("retain closes and forgets only the bitmaps not kept", async () => {
  vi.stubGlobal("createImageBitmap", decodes);
  const cache = createBitmapCache();
  const kept = new Uint8Array([1]), dropped = new Uint8Array([2]);
  const k = await cache.get(kept);
  const d = await cache.get(dropped);
  cache.retain([kept]);
  await flush();
  expect((k as unknown as FakeBitmap).closed).toBe(false);
  expect((d as unknown as FakeBitmap).closed).toBe(true);
  expect(await cache.get(kept)).toBe(k);
  expect(await cache.get(dropped)).not.toBe(d); // re-decoded after being dropped
  expect(decodes).toHaveBeenCalledTimes(3);
});

it("a failed decode is not cached", async () => {
  vi.stubGlobal("createImageBitmap", vi.fn()
    .mockRejectedValueOnce(new Error("Invalid image"))
    .mockResolvedValueOnce(new FakeBitmap()));
  const cache = createBitmapCache();
  const bytes = new Uint8Array([1]);
  await expect(cache.get(bytes)).rejects.toThrow("Invalid image");
  await expect(cache.get(bytes)).resolves.toBeInstanceOf(FakeBitmap);
});

it("retain([]) closes every bitmap, including one still decoding", async () => {
  let finish!: (b: ImageBitmap) => void;
  vi.stubGlobal("createImageBitmap", vi.fn()
    .mockResolvedValueOnce(new FakeBitmap())
    .mockReturnValueOnce(new Promise<ImageBitmap>((r) => { finish = r; })));
  const cache = createBitmapCache();
  const done = await cache.get(new Uint8Array([1]));
  const pending = cache.get(new Uint8Array([2]));
  cache.retain([]);
  const late = new FakeBitmap();
  finish(late as unknown as ImageBitmap);
  await pending;
  await flush();
  expect((done as unknown as FakeBitmap).closed).toBe(true);
  expect(late.closed).toBe(true);
});
