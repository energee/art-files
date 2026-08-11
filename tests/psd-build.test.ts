// psd-build.test.ts — the layered PSD deliverable: that every element it
// promises actually lands as a layer, and that a keylined element carries a
// stroke effect Photoshop can show (the PDF fakes strokes as a ring of offset
// text copies, which has no PSD equivalent — a layer effect is the parallel).
import { describe, expect, it } from "vitest";
import { readPsd } from "ag-psd";
import { buildPsd } from "../src/psd/build";
import { defaultConfig } from "../src/defaults";
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
