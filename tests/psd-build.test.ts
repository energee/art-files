// psd-build.test.ts — the layered PSD deliverable: that every element it
// promises actually lands as a layer, and that a keylined element carries a
// stroke effect Photoshop can show (the PDF strokes text via its text
// rendering mode, which has no PSD equivalent — a layer effect is the parallel).
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readPsd } from "ag-psd";
import { buildPsd, qrBeziers, type PsdAssets } from "../src/psd/build";
import { defaultConfig } from "../src/defaults";
import { qrShapes } from "../src/qr";
import type { CustomBarcodeLayer, CustomImageLayer, CustomQrLayer, CustomTextLayer } from "../src/types";
import { psdAssets as assets } from "./fixtures";

/** Every layer in the document, groups flattened. Deliberately `any`: this
 *  file's assertions reach deep into ag-psd's layer shape (text runs, vector
 *  fills, effects) where the published types are stricter than the data. */
function flat(children: any[] = []): any[] {
  return children.flatMap((l) => [l, ...flat(l.children ?? [])]);
}

const names = (children: any[] = []) => flat(children).map((l) => l.name ?? "");
const layer = (children: any[] = [], name: string) =>
  flat(children).find((l) => l.name === name);

describe("psd build", () => {
  // Built once: buildPsd embeds fonts, which is the slow part.
  let doc: ReturnType<typeof readPsd>;

  it("includes the Info layer with its text, markers stripped", async () => {
    doc = readPsd(
      Buffer.from(await buildPsd(defaultConfig(), assets)).buffer as ArrayBuffer,
      // No canvas in Node: skip every pixel surface, the layer TREE is what
      // this asserts.
      { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true },
    );
    expect(names(doc.children)).toContain("Info");
  });

  it("merges the description and the warning into one layer each", () => {
    const all = names(doc.children);
    expect(all).toContain("Description");
    expect(all).toContain("Warning");
    // The old per-line / per-column layers are gone.
    expect(all.filter((n) => /^Description \d/.test(n))).toEqual([]);
    expect(all.filter((n) => /^Warning \d/.test(n))).toEqual([]);
    const desc = layer(doc.children as any[], "Description");
    // Every body line is in that one layer.
    expect((desc.text.text as string).split(/\r|\n/).filter(Boolean).length)
      .toBe(defaultConfig().description.split("\n").length - 1); // less the header
  });

  it("keeps a description line's own style as a run inside the merged layer", async () => {
    const cfg = defaultConfig();
    cfg.description = "# HOPS\nplain line\n**bold line**";
    const psd = readPsd(
      Buffer.from(await buildPsd(cfg, assets)).buffer as ArrayBuffer,
      { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true },
    );
    const desc = layer(psd.children as any[], "Description");
    // Two lines, two faces — so the merged layer must carry more than one
    // style run. (ag-psd collapses runs that are identical, which is why the
    // shipped all-regular block reads as a single run.)
    expect(desc.text.styleRuns?.length ?? 1).toBeGreaterThan(1);
  });

  it("gives the barcode the same stroke effect as other elements (white halo)", () => {
    expect(layer(doc.children as any[], "Barcode stroke")).toBeUndefined();
    const stroke = layer(doc.children as any[], "Barcode").effects?.stroke?.[0];
    // Default halo: 20px @600dpi, white (defaults.ts barcodeStrokeWidth).
    expect(stroke?.enabled).toBe(true);
    expect(stroke?.color).toEqual({ r: 255, g: 255, b: 255 });
    expect(stroke?.size?.value).toBeCloseTo(20);
  });

  it("mask mode repaints fills and independently defaults strokes to white ink", async () => {
    const psd = readPsd(
      Buffer.from(await buildPsd(defaultConfig(), assets, "mask")).buffer as ArrayBuffer,
      { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true },
    );
    const all = flat(psd.children as any[]);
    // Base coats: white knockout page, then (no mask raster here) a solid
    // white-ink flood.
    expect(names(psd.children)).toContain("Knockout base");
    expect(names(psd.children)).toContain("White ink flood");
    // Metallic elements knock out (white)…
    expect(layer(psd.children as any[], "Beer name").text.style.fillColor)
      .toEqual({ r: 255, g: 255, b: 255 });
    // …white-layer elements print ink (mask blue): the barcode ships white.
    expect(layer(psd.children as any[], "Barcode").vectorFill.color)
      .toEqual({ r: 0, g: 156, b: 215 });
    // Every shipped stroke layer is white/non-metallic, hence mask blue.
    for (const name of ["Volume", "Beer name", "Logo", "QR", "Barcode"]) {
      const stroke = layer(psd.children as any[], name).effects?.stroke?.[0];
      expect([name, stroke?.enabled, stroke?.color]).toEqual([
        name, true, { r: 0, g: 156, b: 215 },
      ]);
    }
  });

  it("keeps a metallic stroke independent from a white fill in the mask PSD", async () => {
    const cfg = defaultConfig();
    cfg.nameStyle.layer = "white";
    cfg.nameStyle.strokeLayer = "metallic";
    const psd = readPsd(
      Buffer.from(await buildPsd(cfg, assets, "mask")).buffer as ArrayBuffer,
      { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true },
    );
    const name = layer(psd.children as any[], "Beer name");
    expect(name.text.style.fillColor.r).toBeCloseTo(0, 2);
    expect(name.text.style.fillColor.g).toBeCloseTo(156, 2);
    expect(name.text.style.fillColor.b).toBeCloseTo(215, 2);
    expect(name.effects.stroke[0].color.r).toBeCloseTo(255, 2);
    expect(name.effects.stroke[0].color.g).toBeCloseTo(255, 2);
    expect(name.effects.stroke[0].color.b).toBeCloseTo(255, 2);
  });

  it("gives every keylined text layer a real stroke effect in black", () => {
    const layers = flat(doc.children as any[]);
    // Logo and QR are vector layers, not type layers — they take the same
    // effect through shapeLayer.
    for (const name of [
      "Info", "Volume", "Beer name", "Style line", "ABV", "Wordmark", "Logo", "QR",
    ]) {
      const l = layers.find((x) => x.name === name);
      expect([name, !!l]).toEqual([name, true]);
      const stroke = l.effects?.stroke?.[0];
      expect([name, stroke?.enabled, stroke?.color]).toEqual([
        name, true, { r: 0, g: 0, b: 0 },
      ]);
      expect([name, stroke?.size?.value]).toEqual([name, 15]);
    }
  });
});

describe("PSD QR squares", () => {
  it("square style emits one closed path per dark module", () => {
    const s = qrShapes("proof", { style: "square" });
    expect(qrBeziers(s, 100).length).toBe(s.squares!.length);
  });

  it("rounded style emits paths too", () => {
    expect(qrBeziers(qrShapes("proof", { style: "rounded" }), 100).length).toBeGreaterThan(0);
  });

  it("dots style output is unchanged in shape count", () => {
    const s = qrShapes("proof", { style: "dots" });
    // dots: one circle per data dot + 3 per finder (outer ring, hole, center)
    expect(qrBeziers(s, 100).length).toBe(s.dots.length + s.finders.length * 3);
  });
});

describe("Master-variant custom layers", () => {
  // Pinned BEFORE the custom-layer builder work landed (sha256 of buildPsd's
  // bytes for defaultConfig() + the shared fixtures, art and mask, both
  // plates): a config with NO customLayers must still build byte-identical
  // output, so this test would fail the moment the builder started emitting
  // a "Custom layers" group (or anything else) unconditionally.
  it("builds byte-identical output for a config with no custom layers", async () => {
    const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
    const art = await buildPsd(defaultConfig(), assets);
    const mask = await buildPsd(defaultConfig(), assets, "mask");
    expect({ art: hash(art), artLen: art.length }).toEqual({
      art: "5421f3775cc47dbf3d272b374b63b5b84eddf0ce11b43240868402f19b6ea445",
      artLen: 882336,
    });
    expect({ mask: hash(mask), maskLen: mask.length }).toEqual({
      mask: "96fb0328cb76f2b5b7c4f68b545aba50f416c904b1cc2eb60413dc9d30d1c37a",
      maskLen: 875834,
    });
  });

  const position = { anchor: "left" as const, vAnchor: "top" as const, offsetX: 0, offsetY: 0 };

  it("a custom text layer becomes a named type layer with its own text", async () => {
    const cfg = defaultConfig();
    const textLayer: CustomTextLayer = {
      id: "custom-t1", name: "Custom Text", type: "text", size: 12, position,
      line: { text: "HELLO CUSTOM", fill: "#000000", layer: "metallic" },
    };
    cfg.customLayers = [textLayer];
    const psd = readPsd(
      Buffer.from(await buildPsd(cfg, assets)).buffer as ArrayBuffer,
      { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true },
    );
    const l = layer(psd.children as any[], "Custom Text");
    expect(l).toBeDefined();
    expect(l.text.text).toBe("HELLO CUSTOM");
  });

  it("a custom raster image layer becomes a raster layer scaled to the placed rect", async () => {
    const cfg = defaultConfig();
    const imageLayer: CustomImageLayer = {
      id: "custom-i1", name: "Custom Image", type: "image", w: 100, aspect: 1, asset: "art1",
      position, style: { fill: "none", layer: "white" },
    };
    cfg.customLayers = [imageLayer];
    // 2x2 opaque red RGBA — natural size, deliberately smaller than the
    // placed box so a straight 1:1 pixel copy (like `texture`'s) would prove
    // nothing: this only passes if the builder actually resamples.
    const px2x2: PsdAssets["customImages"] = {
      art1: { data: new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]), width: 2, height: 2 },
    };
    const psd = readPsd(
      Buffer.from(await buildPsd(cfg, { ...assets, customImages: px2x2 })).buffer as ArrayBuffer,
      // Node has no canvas to decode pixel data through — this test only
      // needs the layer's bounding box, which readPsd populates either way.
      { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true },
    );
    const l = layer(psd.children as any[], "Custom Image");
    expect(l).toBeDefined();
    // Placed box: 100pt square (aspect 1) at the 600dpi export resolution —
    // NOT the source's native 2x2, which only passes if the builder actually
    // resampled rather than copying pixels through 1:1.
    const expectedPx = Math.round((100 / 72) * 600);
    expect(l.right - l.left).toBe(expectedPx);
    expect(l.bottom - l.top).toBe(expectedPx);
  });

  it("a custom image layer with no loaded asset bytes is a no-op, not a crash", async () => {
    const cfg = defaultConfig();
    const imageLayer: CustomImageLayer = {
      id: "custom-i2", name: "Unloaded Image", type: "image", w: 100, aspect: 1, asset: "missing",
      position, style: { fill: "none", layer: "white" },
    };
    cfg.customLayers = [imageLayer];
    const psd = readPsd(
      Buffer.from(await buildPsd(cfg, assets)).buffer as ArrayBuffer,
      { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true },
    );
    expect(layer(psd.children as any[], "Unloaded Image")).toBeUndefined();
  });

  it("a custom barcode layer draws through the same merged-shape approach as the template's, without disturbing it", async () => {
    const cfg = defaultConfig();
    const barcodeLayer: CustomBarcodeLayer = {
      id: "custom-bc1", name: "Custom Barcode", type: "barcode",
      symbology: "code-128", value: "LOLEV-123", h: 30, moduleW: 1, position,
      style: { fill: "#000000", layer: "white" },
    };
    cfg.customLayers = [barcodeLayer];
    const psd = readPsd(
      Buffer.from(await buildPsd(cfg, assets)).buffer as ArrayBuffer,
      { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true },
    );
    // The template barcode is untouched…
    const template = layer(psd.children as any[], "Barcode");
    expect(template).toBeDefined();
    expect(template.vectorMask?.paths?.length).toBeGreaterThan(0);
    // …and the custom one emits alongside it, as its own merged shape.
    const custom = layer(psd.children as any[], "Custom Barcode");
    expect(custom).toBeDefined();
    expect(custom.vectorMask?.paths?.length).toBeGreaterThan(0);
  });

  it("a custom QR layer draws as its own node-editable shape layer", async () => {
    const cfg = defaultConfig();
    const qrLayer: CustomQrLayer = {
      id: "custom-qr1", name: "Custom QR", type: "qr",
      value: "https://lolev.beer/beer/test", size: 40, qrStyle: "square", position,
      style: { fill: "#000000", layer: "white" },
    };
    cfg.customLayers = [qrLayer];
    const psd = readPsd(
      Buffer.from(await buildPsd(cfg, assets)).buffer as ArrayBuffer,
      { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true },
    );
    const l = layer(psd.children as any[], "Custom QR");
    expect(l).toBeDefined();
    expect(l.vectorMask?.paths?.length).toBeGreaterThan(0);
    // The template QR is still there too.
    expect(layer(psd.children as any[], "QR")).toBeDefined();
  });

  it("emits every custom layer on the mask plate too, per the standard paint rules", async () => {
    const cfg = defaultConfig();
    const textLayer: CustomTextLayer = {
      id: "custom-t1", name: "Custom Text", type: "text", size: 12, position,
      line: { text: "HELLO", fill: "#000000", layer: "white" },
    };
    cfg.customLayers = [textLayer];
    const psd = readPsd(
      Buffer.from(await buildPsd(cfg, assets, "mask")).buffer as ArrayBuffer,
      { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true },
    );
    const l = layer(psd.children as any[], "Custom Text");
    expect(l).toBeDefined();
    // white-layer text prints ink on the mask plate: mask blue.
    expect(l.text.style.fillColor.r).toBeCloseTo(0, 2);
    expect(l.text.style.fillColor.g).toBeCloseTo(156, 2);
    expect(l.text.style.fillColor.b).toBeCloseTo(215, 2);
  });
});
