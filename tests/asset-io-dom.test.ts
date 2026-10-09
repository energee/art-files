// asset-io-dom.test.ts — the asset I/O helpers split out of App.tsx (#416):
// typed Files for packed assets, SVG reads, the bytes a Save packs per slot
// and per image, and the plain-download anchor.
// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { strToU8 } from "fflate";
import {
  assetToFile, download, imageBundle, readCustomImage, readRaster, slotAsset, type CustomFile, type LoadedRaster,
} from "../src/assets/io";

afterEach(() => vi.restoreAllMocks());

it("assetToFile types a packed asset by its name, so an SVG thumbnails as itself", () => {
  const f = assetToFile({ name: "logo.svg", bytes: strToU8("<svg/>") });
  expect(f.name).toBe("logo.svg");
  expect(f.type).toBe("image/svg+xml");
});

it("readCustomImage keeps an SVG as source text with its own thumbnail URL", async () => {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test/1");
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect width="20" height="10"/></svg>';
  const c = await readCustomImage(new File([svg], "logo.svg", { type: "image/svg+xml" }));
  expect(c.image).toEqual({ kind: "svg", svg });
  expect(c.name).toBe("logo.svg");
  expect(c.previewUrl).toBe("blob:test/1");
  expect(c.aspect).toBeCloseTo(2);
});

it("slotAsset packs a slot's original upload, not its embed copy", () => {
  expect(slotAsset(null)).toBeUndefined();
  const src = new Uint8Array([1]);
  const raster = { name: "t.webp", srcBytes: src, bytes: new Uint8Array([2]) } as LoadedRaster;
  expect(slotAsset(raster)).toEqual({ name: "t.webp", bytes: src });
});

it("imageBundle packs only the named ids the store holds, SVG as UTF-8", () => {
  const png = new Uint8Array([9]);
  const store: Record<string, CustomFile> = {
    a: { image: { kind: "svg", svg: "<svg/>" }, name: "a.svg", previewUrl: "", aspect: 1 },
    b: { image: { kind: "png", bytes: png }, name: "b.png", previewUrl: "", aspect: 1 },
  };
  expect(imageBundle(store, ["a", "b", "gone"])).toEqual({
    a: { name: "a.svg", bytes: strToU8("<svg/>") },
    b: { name: "b.png", bytes: png },
  });
  expect(imageBundle(store, ["gone"])).toBeUndefined();
});

it("download clicks an anchor naming the file", () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  download("blob:test/2", "label.pdf");
  const a = click.mock.contexts[0] as HTMLAnchorElement;
  expect(a.href).toBe("blob:test/2");
  expect(a.download).toBe("label.pdf");
});

it("readRaster closes the decoded bitmap even when the preview encode fails", async () => {
  const close = vi.fn();
  class FakeBitmap { width = 4; height = 2; close = close; }
  vi.stubGlobal("ImageBitmap", FakeBitmap);
  vi.stubGlobal("createImageBitmap", vi.fn(async () => new FakeBitmap()));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage() {} } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(null));
  await expect(readRaster(new File([new Uint8Array([1])], "t.png"))).rejects.toThrow(/encode/i);
  expect(close).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});

it("readRaster reads the aspect before closing the bitmap (a closed bitmap reports 0×0)", async () => {
  class FakeBitmap {
    w = 4; h = 2;
    get width() { return this.w; }
    get height() { return this.h; }
    close() { this.w = 0; this.h = 0; }
  }
  vi.stubGlobal("ImageBitmap", FakeBitmap);
  vi.stubGlobal("createImageBitmap", vi.fn(async () => new FakeBitmap()));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test/3");
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage() {} } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(new Blob([new Uint8Array([7])])));
  const r = await readRaster(new File([new Uint8Array([1])], "t.png"));
  expect(r.aspect).toBe(2);
  vi.unstubAllGlobals();
});
