// multi-edit.test.ts — the rule for which selected layers an inspector change
// reaches (src/model/multiEdit.ts): a change goes to every selected layer
// that has the control it came from, and to nothing else.
import { describe, expect, it } from "vitest";
import { isMixed, pickPaths, sharedPatch, sharesPath } from "../src/model/multiEdit";
import type { BarcodeLayer, ImageLayer, QrLayer, TextLayer } from "../src/model/layers";

const STYLE = { fill: "#F3CD80", layer: "metallic" } as const;
const text = (over: Partial<TextLayer> = {}): TextLayer => ({
  id: "name", name: "Name", kind: "text", enabled: true, x: 100, anchor: "center", y: 20,
  lines: [{ text: "Hazy", ...STYLE }], size: 15, align: "center", style: STYLE, ...over,
});
const image = (over: Partial<ImageLayer> = {}): ImageLayer => ({
  id: "logo", name: "Logo", kind: "image", enabled: true, x: 100, anchor: "center", y: 40,
  asset: "builtin:logo", w: 33.5, style: STYLE, ...over,
});
const barcode = (over: Partial<BarcodeLayer> = {}): BarcodeLayer => ({
  id: "barcode", name: "Barcode", kind: "barcode", enabled: true, x: 500, anchor: "left", y: 200,
  symbology: "upc-a", value: "850051366224", h: 15, moduleW: 1.03, style: STYLE, ...over,
});
const qr = (over: Partial<QrLayer> = {}): QrLayer => ({
  id: "qr", name: "QR", kind: "qr", enabled: true, x: 24, anchor: "left", y: 280,
  value: "https://lolev.beer", size: 59, qrStyle: "square", style: STYLE, ...over,
});
const peer = (layer: Parameters<typeof sharedPatch>[1][number]["layer"], raster = false) => ({ layer, raster });

describe("sharedPatch", () => {
  it("sends a style change to every selected layer, the edited one first", () => {
    const patch = { style: { fill: "#000000" } } as const;
    expect(sharedPatch(text(), [peer(barcode()), peer(image())], patch)).toEqual([
      ["name", patch], ["barcode", patch], ["logo", patch],
    ]);
  });

  it("keeps a kind's own settings to layers of that kind", () => {
    // `size` is type size on text and the symbol's size on a QR.
    const other = text({ id: "tagline" });
    expect(sharedPatch(text(), [peer(other), peer(qr())], { size: 30 })).toEqual([
      ["name", { size: 30 }], ["tagline", { size: 30 }],
    ]);
  });

  it("never fans out a name or a binding", () => {
    const other = text({ id: "tagline" });
    expect(sharedPatch(text(), [peer(other)], { name: "Brand" })).toEqual([["name", { name: "Brand" }]]);
    const binding = { to: "logo", side: "bottom" as const, gap: 4 };
    expect(sharedPatch(text(), [peer(other)], { binding })).toEqual([["name", { binding }]]);
  });

  it("leaves a bound layer's axis alone, so a typed Y cannot unbind it", () => {
    const below = text({ id: "tagline", y: { below: "name", gap: 4 } });
    const beside = text({ id: "abv", binding: { to: "name", side: "right", gap: 4 } });
    expect(sharedPatch(text(), [peer(below), peer(beside)], { y: 50 })).toEqual([
      ["name", { y: 50 }], ["abv", { y: 50 }],
    ]);
    expect(sharedPatch(text(), [peer(below), peer(beside)], { x: 50 })).toEqual([
      ["name", { x: 50 }], ["tagline", { x: 50 }],
    ]);
  });

  it("skips page art for position, style and lock, but not power", () => {
    const texture = image({ id: "texture", role: "background" });
    expect(sharedPatch(text(), [peer(texture)], { x: 5, locked: true, style: { fill: "#000" } }))
      .toEqual([["name", { x: 5, locked: true, style: { fill: "#000" } }]]);
    expect(sharedPatch(text(), [peer(texture)], { enabled: false }))
      .toEqual([["name", { enabled: false }], ["texture", { enabled: false }]]);
  });

  it("does not rotate an image", () => {
    expect(sharedPatch(text(), [peer(image()), peer(qr())], { rotation: 90 }))
      .toEqual([["name", { rotation: 90 }], ["qr", { rotation: 90 }]]);
  });

  it("keeps the plate off raster art and no-ink off a code", () => {
    expect(sharedPatch(text(), [peer(image(), true)], { style: { layer: "white" } }))
      .toEqual([["name", { style: { layer: "white" } }]]);
    expect(sharedPatch(text(), [peer(barcode()), peer(image())], { style: { fill: "none" } }))
      .toEqual([["name", { style: { fill: "none" } }], ["logo", { style: { fill: "none" } }]]);
  });

  it("tints only raster images", () => {
    const svg = image({ id: "mark" });
    const photo = image({ id: "photo" });
    expect(sharedPatch(image(), [peer(svg), peer(photo, true)], { tintRaster: true }))
      .toEqual([["logo", { tintRaster: true }], ["photo", { tintRaster: true }]]);
  });

  it("keeps a cleared field's undefined, so the write can delete it everywhere", () => {
    const other = text({ id: "tagline", width: 80 });
    const entries = sharedPatch(text(), [peer(other)], { width: undefined });
    expect(entries.map(([id, p]) => [id, "width" in p])).toEqual([["name", true], ["tagline", true]]);
  });
});

describe("isMixed", () => {
  it("is true when a layer that shares the control holds another value", () => {
    const others = [peer(barcode({ style: { ...STYLE, fill: "#000000" } }))];
    expect(isMixed(text(), others, ["style.fill"])).toBe(true);
    expect(isMixed(text(), others, ["style.layer"])).toBe(false);
  });

  it("ignores layers the control does not reach", () => {
    expect(isMixed(text(), [peer(qr())], ["size"])).toBe(false);
    expect(isMixed(text(), [peer(text({ id: "tagline", size: 9 }))], ["size"])).toBe(true);
  });
});

describe("pickPaths and sharesPath", () => {
  it("reads the layer's values at dotted paths as a patch", () => {
    expect(pickPaths(text(), ["style.fill", "align"])).toEqual({ style: { fill: "#F3CD80" }, align: "center" });
  });

  it("says whether a path's control exists on the other layer", () => {
    expect(sharesPath(text(), peer(qr()), "style.fill")).toBe(true);
    expect(sharesPath(text(), peer(qr()), "size")).toBe(false);
  });
});
