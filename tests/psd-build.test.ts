// psd-build.test.ts — the layered PSD deliverable from the display list:
// that every layer it promises lands as a group named after the app layer
// holding its editable type / shape / raster layer, that text runs fold
// back into one type layer per text layer, and that a keylined element
// carries a stroke effect Photoshop can show (the PDF strokes text via its
// text rendering mode, which has no PSD equivalent — a layer effect is the
// parallel), and that the file declares its export DPI so it opens at the
// label's print size (#338).
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readPsd } from "ag-psd";
import { readFileSync } from "node:fs";
import { openFont } from "../src/fontkit";
import { buildPsd, digitGroupPaths, qrBeziers, PSD_DOC, type PsdAssets } from "../src/psd/build";
import { qrShapes } from "../src/qr";
import * as L from "../src/layout";
import { DESIGN_DPI, setOutputDpi } from "../src/layout";
import type { Layer } from "../src/model/layers";
import { flatLayers, lolevLayers, lolevPlan, psdAssets as assets } from "./fixtures";

// Deliberately `any`: this file's assertions reach deep into ag-psd's layer
// shape (text runs, vector fills, effects) where the published types are
// stricter than the data. The tree walk itself is fixtures.ts's flatLayers.
const flat = (children: any[] = []): any[] => flatLayers(children);
const names = (children: any[] = []) => flat(children).map((l) => l.name ?? "");
/** The LEAF layer of that name — every app layer is a group of the same name. */
const layer = (children: any[] = [], name: string) =>
  flat(children).find((l) => l.name === name && !l.children);
const groups = (children: any[] = []) => children.map((l) => l.name);
/** ag-psd reads colours back with float dust (155.9988): round per channel. */
const rgb = (c: { r: number; g: number; b: number }) => ({ r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) });

/** The page size a reader derives from the declared resolution, in inches,
 *  per source: ResolutionInfo (0x03ED, Photoshop — with its units) and XMP
 *  tiff:XResolution (macOS ImageIO). Must be PAGE at any export DPI (#338). */
const printSize = (psd: ReturnType<typeof readPsd>) => {
  const r = psd.imageResources?.resolutionInfo;
  const xmp = Number(psd.imageResources?.xmpMetadata?.match(/<tiff:XResolution>([\d.]+)</)?.[1]);
  const inches = (px: number, dpi?: number) => Math.round((px / (dpi ?? 72)) * 1000) / 1000;
  return {
    resolutionInfo: [inches(psd.width, r?.horizontalResolution), inches(psd.height, r?.verticalResolution),
      r?.horizontalResolutionUnit, r?.verticalResolutionUnit, r?.widthUnit, r?.heightUnit],
    xmp: inches(psd.width, xmp),
  };
};
/** PAGE (points) in inches, as printSize reports it. */
const pageSize = () => {
  const w = Math.round((L.PAGE.w / 72) * 1000) / 1000, h = Math.round((L.PAGE.h / 72) * 1000) / 1000;
  return { resolutionInfo: [w, h, "PPI", "PPI", "Inches", "Inches"], xmp: w };
};

const read = (bytes: Uint8Array) =>
  readPsd(Buffer.from(bytes).buffer as ArrayBuffer,
    // No canvas in Node: skip every pixel surface, the layer TREE is what
    // this asserts.
    { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true });

const build = async (opts: Parameters<typeof lolevLayers>[0] = {}, mode?: "art" | "mask", psd: PsdAssets = assets) =>
  read(await buildPsd(await lolevPlan(opts), psd, mode, { layers: lolevLayers(opts) }));

describe("psd build", () => {
  // Built once: buildPsd embeds fonts, which is the slow part.
  let doc: ReturnType<typeof readPsd>;

  it("one group per app layer, in draw order, named after it", async () => {
    doc = await build();
    expect(groups(doc.children as any[])).toEqual([
      "Volume", "ABV", "Description", "Brand", "Logo", "Name", "Style", "Info", "Warning",
      "Store cold", "QR", "Barcode",
    ]);
  });

  it("includes the Info layer with its text, markers stripped, in SemiBold with a Bold run", () => {
    const info = layer(doc.children as any[], "Info");
    expect(info.text.text).toBe("@LOLEVBEER 5247 BUTLER ST, PITTSBURGH, PA");
    expect(info.text.styleRuns.map((r: any) => [r.length, r.style.font.name]))
      .toEqual([["@LOLEVBEER".length, "Poppins-Bold"], [" 5247 BUTLER ST, PITTSBURGH, PA".length, "Poppins-SemiBold"]]);
    // Rotated: rides on the affine transform, never orientation: vertical.
    expect(info.text.transform.slice(0, 4)).toEqual([0, -1, 1, 0]);
    expect(info.text.orientation).toBe("horizontal");
  });

  it("merges description while preserving justified warning runs at planned positions", () => {
    const all = names(doc.children);
    expect(all.filter((n) => /^Description \d/.test(n))).toEqual([]);

    const desc = layer(doc.children as any[], "Description");
    // Header line plus body, one editable layer; the header is the bold run.
    expect(desc.text.text).toBe("HOPS\n...");
    expect(desc.text.styleRuns[0].style.font.name).toBe("Poppins-SemiBold");
    expect(desc.text.style.leading).toBeCloseTo((10.8 / 72) * 600);
    const warning = doc.children!.find((l) => l.name === "Warning")!;
    expect(warning.children!.length).toBeGreaterThan(4);
    expect(warning.children![0].text!.text).toBe("GOVERNMENT");
    expect(warning.children![0].text!.style!.font!.name).toBe("Poppins-Bold");
  });

  it("turns Photoshop's auto-kerning off on every type layer and run, like the PDF (#143)", () => {
    // pdf-lib draws raw glyph advances and the plan measures unkerned (#86);
    // Photoshop's default auto-kerning would pull a kern-table face like
    // Barlow Condensed tighter than the PDF and the preview.
    const text = flat(doc.children as any[]).filter((l) => l.text);
    expect(text.length).toBeGreaterThan(0);
    for (const l of text) {
      expect(l.text.style.autoKerning, l.name).toBe(false);
      for (const r of l.text.styleRuns ?? []) expect(r.style.autoKerning ?? false, l.name).toBe(false);
    }
  });

  it("keeps a description line's own style as a run inside the merged layer", async () => {
    const psd = await build({ values: { description: [
      { text: "HOPS", fill: "#F3CD80", layer: "metallic", header: true },
      { text: "plain line", fill: "#F3CD80", layer: "metallic" },
      { text: "bold line", fill: "#F3CD80", layer: "metallic", bold: true },
    ] } });
    const desc = layer(psd.children as any[], "Description");
    expect(desc.text.text).toBe("HOPS\nplain line\nbold line");
    expect(desc.text.styleRuns.map((r: any) => r.style.font.name))
      .toEqual(["Poppins-SemiBold", "Poppins-Regular", "Poppins-SemiBold"]);
    // Run lengths cover the whole string, newlines included.
    expect(desc.text.styleRuns.reduce((n: number, r: any) => n + r.length, 0)).toBe(desc.text.text.length);
  });

  it("preserves every justified run's exported position and text", async () => {
    const items = (await lolevPlan()).filter((r) => r.id === "warning" && r.kind === "text");
    const warning = doc.children!.find((l) => l.name === "Warning")!.children!;
    expect(warning).toHaveLength(items.length);
    for (const [i, item] of items.entries()) {
      if (item.kind !== "text") throw new Error("Expected text");
      expect(warning[i].text!.text).toBe(item.text);
      expect(warning[i].text!.transform![4]).toBeCloseTo(item.x / 72 * 600);
      expect(warning[i].text!.transform![5]).toBeCloseTo(item.y / 72 * 600);
    }
  });

  it("gives the barcode the same stroke effect as other elements (white halo)", () => {
    const stroke = layer(doc.children as any[], "Barcode").effects?.stroke?.[0];
    // Default halo: 20px @600dpi, white.
    expect(stroke?.enabled).toBe(true);
    expect(stroke?.color).toEqual({ r: 255, g: 255, b: 255 });
    expect(stroke?.size?.value).toBeCloseTo(20);
  });

  it("mask mode repaints fills and independently defaults strokes to white ink", async () => {
    const psd = await build({}, "mask");
    // Base coats: white knockout page, then (no mask raster here) a solid
    // white-ink flood.
    expect(groups(psd.children as any[]).slice(0, 2)).toEqual(["Knockout base", "White ink flood"]);
    // Metallic elements knock out (white)…
    expect(rgb(layer(psd.children as any[], "Name").text.style.fillColor)).toEqual({ r: 255, g: 255, b: 255 });
    // …white-layer elements print ink (mask blue): the barcode ships white.
    expect(rgb(layer(psd.children as any[], "Barcode").vectorFill.color)).toEqual({ r: 0, g: 156, b: 215 });
    // The mask outline is the art outline: same bar rects and digit beziers.
    const artBarcode = layer(doc.children as any[], "Barcode");
    const maskBarcode = layer(psd.children as any[], "Barcode");
    expect(maskBarcode.vectorMask.paths.length).toBe(artBarcode.vectorMask.paths.length);
    // Every shipped stroke layer is white/non-metallic, hence mask blue.
    for (const name of ["Volume", "Name", "Logo", "QR", "Barcode"]) {
      const stroke = layer(psd.children as any[], name).effects?.stroke?.[0];
      expect([name, stroke?.enabled, stroke?.color]).toEqual([name, true, { r: 0, g: 156, b: 215 }]);
    }
  });

  it("keeps a metallic stroke independent from a white fill in the mask PSD", async () => {
    const psd = await build({ overrides: { name: {
      style: { layer: "white", strokeLayer: "metallic" }, lines: [{ text: "X", fill: "#F3CD80", layer: "white" }],
    } } }, "mask");
    const name = layer(psd.children as any[], "Name");
    expect(rgb(name.text.style.fillColor)).toEqual({ r: 0, g: 156, b: 215 });
    expect(rgb(name.effects.stroke[0].color)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("gives every keylined text layer a real stroke effect in black", () => {
    for (const name of ["Info", "Volume", "Name", "Style", "ABV", "Brand", "Logo", "QR"]) {
      const l = layer(doc.children as any[], name);
      expect([name, !!l]).toEqual([name, true]);
      const stroke = l.effects?.stroke?.[0];
      expect([name, stroke?.enabled, stroke?.color]).toEqual([name, true, { r: 0, g: 0, b: 0 }]);
      expect([name, stroke?.size?.value]).toEqual([name, 15]);
    }
  });

  it("keeps every stroke's physical width at a non-600 export DPI (#87)", async () => {
    // A 1.8pt keyline is 7.5px in a 300-DPI document, not 15: stroke sizes
    // are lengths in document pixels, so they follow OUTPUT_DPI like
    // everything else. The barcode's 20px halo likewise halves to 10.
    const expected: Record<string, number> = {
      Info: 7.5, Volume: 7.5, Name: 7.5, Style: 7.5, ABV: 7.5, Brand: 7.5, Logo: 7.5, QR: 7.5, Barcode: 10,
    };
    let psd: ReturnType<typeof readPsd>;
    try {
      setOutputDpi(300);
      psd = await build();
    } finally {
      setOutputDpi(DESIGN_DPI);
    }
    for (const [name, size] of Object.entries(expected)) {
      const value = layer(psd.children as any[], name).effects?.stroke?.[0]?.size?.value;
      expect([name, Math.round(value * 1000) / 1000]).toEqual([name, size]);
    }
    // …and the file says 300 ppi, so it still opens at print size (#338).
    expect(printSize(psd)).toEqual(pageSize());
  });

  it("declares the export resolution so Photoshop opens it at print size (#338)", () => {
    expect(printSize(doc)).toEqual(pageSize());
  });

  it("keeps page rasters in the display list's authored draw order", async () => {
    const text = (await lolevPlan()).find((r) => r.id === "volume")!;
    const page = { kind: "page", role: "background", id: "background", asset: "tex", x: 0, y: 0, w: 1, h: 1 } as const;
    const pixels = { data: new Uint8Array(4), width: 1, height: 1 };
    const psd = read(await buildPsd([text, page], { ...assets, images: { tex: pixels } }));
    expect(groups(psd.children)).toEqual(["volume", "background"]);
  });

  it("the mask page item becomes the Mask raster; the background the texture", async () => {
    const opts = { overrides: { background: { asset: "tex" }, mask: { asset: "msk" } }, custom: { tex: { aspect: 1 }, msk: { aspect: 1 } } };
    const px = { data: new Uint8Array(4), width: 1, height: 1 };
    const art = await build(opts, "art", { ...assets, images: { tex: px, msk: px } });
    expect(groups(art.children as any[])[0]).toBe("Background");
    // A square raster cover-fits the page width, like the PDF and canvas.
    expect(art.children![0].right! - art.children![0].left!).toBe(PSD_DOC.w);
    const mask = await build(opts, "mask", { ...assets, images: { tex: px, msk: px } });
    expect(groups(mask.children as any[]).slice(0, 3)).toEqual(["Knockout base", "Metallic mask", "Volume"]);
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

describe("added layers", () => {
  // Candidate baseline: PSD raster review remains pending (goldens/README.md).
  // sha256 of buildPsd's bytes for the shipped Lolev master, art and mask.
  // The shipped label must keep building byte-identical output — this fails
  // the moment the builder emits anything extra or differently. Mask
  // re-pinned 2026-09-28: the barcode shape is the glyph outline on both
  // plates. Art is unchanged. Re-pinned earlier that day when the quiet-zone
  // plate left the group, and for #143 (autoKerning: false).
  it("builds byte-identical output for the shipped label", async () => {
    const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
    const items = await lolevPlan();
    const layers = lolevLayers();
    const art = await buildPsd(items, assets, "art", { layers });
    const mask = await buildPsd(items, assets, "mask", { layers });
    expect({ art: hash(art), artLen: art.length, mask: hash(mask), maskLen: mask.length }).toEqual({
      art: "d3c39d261e7145566e4268a876060b2be9685311c86c662455a26f210de0aabc", artLen: 1155796,
      mask: "00742f1def011454c39fd01003400a83a25a2ff6b8c2289062b7a779d2bd0f6a", maskLen: 1156318,
    });
  });

  const at = { enabled: true, x: 28.68, y: 28.68, anchor: "left" } as const;

  it("an added text layer becomes a named type layer with its own text", async () => {
    const psd = await build({ extra: [{
      id: "t1", name: "Custom Text", kind: "text", ...at, size: 12, align: "left",
      lines: [{ text: "HELLO CUSTOM", fill: "#000000", layer: "metallic" }], style: { fill: "#000000", layer: "metallic" },
    }] });
    expect(groups(psd.children as any[])).toContain("Custom Text");
    expect(layer(psd.children as any[], "Custom Text").text.text).toBe("HELLO CUSTOM");
  });

  it("a raster image layer becomes a raster layer scaled to the placed rect", async () => {
    const image: Layer = { id: "i1", name: "Custom Image", kind: "image", ...at, w: 100, asset: "art1", style: { fill: "none", layer: "white" } };
    // 2x2 opaque red RGBA — natural size, deliberately smaller than the
    // placed box so a straight 1:1 pixel copy (like the texture's) would
    // prove nothing: this only passes if the builder actually resamples.
    const px2x2 = { data: new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]), width: 2, height: 2 };
    const psd = await build({ extra: [image], custom: { art1: { aspect: 1 } } }, "art", { ...assets, images: { art1: px2x2 } });
    const l = layer(psd.children as any[], "Custom Image");
    expect(l).toBeDefined();
    const expectedPx = Math.round((100 / 72) * 600);
    expect(l.right - l.left).toBe(expectedPx);
    expect(l.bottom - l.top).toBe(expectedPx);
  });

  it("an image layer with no loaded pixels is a no-op — no group at all — on either plate", async () => {
    const image: Layer = { id: "i2", name: "Unloaded Image", kind: "image", ...at, w: 100, asset: "missing", style: { fill: "none", layer: "white" } };
    const opts = { extra: [image], custom: { missing: { aspect: 1 } } };
    expect(names((await build(opts)).children)).not.toContain("Unloaded Image");
    // Mask mode must not lay a white-ink footprint under art the art plate
    // never prints.
    expect(names((await build(opts, "mask")).children)).not.toContain("Unloaded Image");
  });

  it("an added barcode layer draws through the same merged-shape approach as the template's", async () => {
    const psd = await build({ extra: [{
      id: "bc1", name: "Custom Barcode", kind: "barcode", ...at, symbology: "code-128", value: "LOLEV-123",
      h: 30, moduleW: 1, style: { fill: "#000000", layer: "white" },
    }] });
    const barcodeShapes = flat(psd.children as any[]).filter((l) => l.name === "Barcode" && !l.children);
    expect(barcodeShapes).toHaveLength(1); // bars and digit outlines, no quiet-zone plate
    expect(barcodeShapes[0].vectorMask.paths.length).toBeGreaterThan(1);
    expect(layer(psd.children as any[], "Custom Barcode").vectorMask?.paths?.length).toBeGreaterThan(0);
  });

  it("an added QR layer draws as its own node-editable shape layer", async () => {
    const psd = await build({ extra: [{
      id: "qr1", name: "Custom QR", kind: "qr", ...at, value: "https://lolev.beer/beer/test", size: 40,
      qrStyle: "square", style: { fill: "#000000", layer: "white" },
    }] });
    expect(layer(psd.children as any[], "Custom QR").vectorMask?.paths?.length).toBeGreaterThan(0);
    expect(layer(psd.children as any[], "QR")).toBeDefined();
  });

  it("a QR without its layer data cannot be rebuilt and says so", async () => {
    await expect(buildPsd(await lolevPlan(), assets)).rejects.toThrow(/opts\.layers/);
  });

  it("emits every added layer on the mask plate too, per the standard paint rules", async () => {
    const psd = await build({ extra: [{
      id: "t1", name: "Custom Text", kind: "text", ...at, size: 12, align: "left",
      lines: [{ text: "HELLO", fill: "#000000", layer: "white" }], style: { fill: "#000000", layer: "white" },
    }] }, "mask");
    // white-layer text prints ink on the mask plate: mask blue.
    expect(rgb(layer(psd.children as any[], "Custom Text").text.style.fillColor)).toEqual({ r: 0, g: 156, b: 215 });
  });
});

/** Issue #86, PSD side: the PDF draws barcode digits with pdf-lib's drawText,
 *  which places raw glyph advances and emits no kerning. The PSD's outlined
 *  digits must advance the same way, or a kern-table master font (Barlow
 *  Condensed kerns "41" by 46/1000 em) lands its digits off the PDF's. */
describe("barcode digit outlines advance unkerned, like the PDF (#86)", () => {
  const fk = openFont(readFileSync(new URL("../src/assets/fonts/BarlowCondensed-Regular.ttf", import.meta.url)));
  it("places each digit at the previous digits' raw advance", () => {
    const size = 10;
    const pair = digitGroupPaths(fk, "41", size, false, 0, 0).bbox;
    const last = digitGroupPaths(fk, "1", size, false, 0, 0).bbox;
    const advance4 = fk.layout("4").glyphs[0].advanceWidth * size / fk.unitsPerEm;
    expect(pair.maxX).toBeCloseTo(advance4 + last.maxX, 6);
  });
});
