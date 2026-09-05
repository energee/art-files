// model-resolve-layers.test.ts — the v3 resolver: master layers + enabled
// variant diffs (enable order) + label overrides + label values → the
// layer list the renderer measures and places. No relative-y resolution
// here (that needs measured heights); format refs in barcode/qr values
// expand over the text layers' plain text.
import { describe, expect, it } from "vitest";
import { resolveLayers, valueOf } from "../src/model/resolveLayers";
import { lolevMaster } from "../src/model/lolevLayers";
import type {
  BarcodeLayer, ImageLayer, Layer, QrLayer, TextLayer, TextLine,
} from "../src/model/layers";
import { GOLD } from "../src/layout";

const line = (text: string): TextLine => ({ text, fill: GOLD, layer: "metallic" });
const byId = <T extends Layer = Layer>(layers: Layer[], id: string) =>
  layers.find((l) => l.id === id) as T;
const masterLogoY = () => byId(lolevMaster().layers, "logo").y;
/** The master's layers as they resolve with nothing filled: only the qr
 *  changes, its {name|slug} ref expanding through the blank name's
 *  placeholder ("Name" → "name"). */
const bare = (): Layer[] => lolevMaster().layers.map((l) =>
  l.id === "qr" ? { ...l, value: "https://lolev.beer/beer/name" } : l);

describe("resolveLayers", () => {
  it("Lolev alone is its own layers; collab on appends the three collab layers after them", () => {
    const off = resolveLayers(lolevMaster(), [], {});
    expect(off.warnings).toEqual([]);
    expect(off.errors).toEqual({});
    expect(off.layers).toEqual(bare());
    const on = resolveLayers(lolevMaster(), ["collab"], {});
    expect(on.layers.slice(0, -3)).toEqual(bare());
    expect(on.layers.slice(-3).map((l) => l.id)).toEqual(["collabLead", "collabLeft", "collabCenter"]);
    expect(byId<ImageLayer>(on.layers, "collabLeft").y).toEqual({ below: "collabLead", gap: 8 - 0.35 * 9 });
  });

  it("warns on an unknown variant id and skips it", () => {
    const r = resolveLayers(lolevMaster(), ["nope"], {});
    expect(r.warnings.join(" ")).toMatch(/nope/);
    expect(r.layers).toEqual(bare());
  });

  it("a variant's y override on the logo wins, last-enabled first", () => {
    const m = lolevMaster();
    m.variants.push(
      { id: "lift", name: "Lift", layers: { logo: { y: 100 } } },
      { id: "drop", name: "Drop", layers: { logo: { y: 200 } } },
    );
    expect(byId(resolveLayers(m, ["lift"], {}).layers, "logo").y).toBe(100);
    expect(byId(resolveLayers(m, ["lift", "drop"], {}).layers, "logo").y).toBe(200);
    expect(byId(resolveLayers(m, ["drop", "lift"], {}).layers, "logo").y).toBe(100);
    expect(byId(resolveLayers(m, [], {}).layers, "logo").y).toBe(masterLogoY());
  });

  it("never mutates the master", () => {
    const m = lolevMaster();
    m.variants.push({ id: "lift", name: "Lift", layers: { logo: { y: 100 } } });
    resolveLayers(m, ["lift"], { name: [line("X")] }, { abv: { size: 30 } });
    expect(m).toEqual({ ...lolevMaster(), variants: [...lolevMaster().variants,
      { id: "lift", name: "Lift", layers: { logo: { y: 100 } } }] });
  });

  it("a variant-added layer appends only while its variant is on", () => {
    const m = lolevMaster();
    const extra: TextLayer = {
      id: "extra", name: "Extra", kind: "text", enabled: true, x: 10, anchor: "left", y: 10,
      size: 9, align: "left", lines: [line("extra")], style: { fill: GOLD, layer: "metallic" },
    };
    m.variants.push({ id: "more", name: "More", layers: { extra } });
    expect(resolveLayers(m, ["more"], {}).layers.at(-1)).toEqual(extra);
    expect(resolveLayers(m, [], {}).layers.some((l) => l.id === "extra")).toBe(false);
  });

  it("label overrides apply after the variants", () => {
    const m = lolevMaster();
    m.variants.push({ id: "lift", name: "Lift", layers: { logo: { y: 100 } } });
    const r = resolveLayers(m, ["lift"], {}, { logo: { y: 5 }, abv: { style: { fill: "#FF0000" } } });
    expect(byId(r.layers, "logo").y).toBe(5);
    const abv = byId<TextLayer>(r.layers, "abv");
    expect(abv.style).toEqual({ ...byId<TextLayer>(lolevMaster().layers, "abv").style, fill: "#FF0000" });
  });

  it("an override with an unknown id warns unless it is a whole layer, which appends", () => {
    const extra: TextLayer = {
      id: "custom-z", name: "Z", kind: "text", enabled: true, x: 10, anchor: "left", y: 10,
      size: 9, align: "left", lines: [line("z")], style: { fill: GOLD, layer: "metallic" },
    };
    const r = resolveLayers(lolevMaster(), [], {}, { "custom-z": extra, ghost: { y: 1 } });
    expect(r.layers.at(-1)).toEqual(extra);
    expect(r.warnings.join(" ")).toMatch(/ghost/);
  });

  it("values fill a text layer's lines, an image's asset and a barcode's value", () => {
    const r = resolveLayers(lolevMaster(), ["collab"], {
      name: [line("Peregrine")], collabLeft: "asset-1", barcode: "036000291452",
    });
    expect(r.errors).toEqual({});
    expect(byId<TextLayer>(r.layers, "name").lines).toEqual([line("Peregrine")]);
    expect(byId<ImageLayer>(r.layers, "collabLeft").asset).toBe("asset-1");
    expect(byId<BarcodeLayer>(r.layers, "barcode").value).toBe("036000291452");
  });

  it("a string value on a number input becomes one line in the layer's style", () => {
    const r = resolveLayers(lolevMaster(), [], { abv: "6.5" });
    expect(r.errors).toEqual({});
    expect(byId<TextLayer>(r.layers, "abv").lines).toEqual([{ text: "6.5", fill: GOLD, layer: "metallic" }]);
  });

  it("an out-of-range abv lands in errors and the layer keeps the master's lines", () => {
    const r = resolveLayers(lolevMaster(), [], { abv: [line("99")] });
    expect(r.errors.abv).toMatch(/20/);
    expect(byId<TextLayer>(r.layers, "abv").lines)
      .toEqual(byId<TextLayer>(lolevMaster().layers, "abv").lines);
  });

  it("a non-numeric abv and a bad barcode check digit are errors", () => {
    const r = resolveLayers(lolevMaster(), [], { abv: "lots", barcode: "036000291453" });
    expect(r.errors.abv).toMatch(/number/i);
    expect(r.errors.barcode).toBeTruthy();
    expect(byId<BarcodeLayer>(r.layers, "barcode").value).toBe("850051366224");
  });

  it("a wrong-shaped value is an error", () => {
    const r = resolveLayers(lolevMaster(), ["collab"], { name: 5 as never, collabLeft: [line("x")] });
    expect(r.errors.name).toMatch(/text/i);
    expect(r.errors.collabLeft).toMatch(/image/i);
  });

  it("a value applies to any known layer; unknown ids are ignored", () => {
    const r = resolveLayers(lolevMaster(), [], { wordmark: [line("X")], nope: "x" });
    expect(r.errors).toEqual({});
    expect(r.warnings).toEqual([]);
    expect(byId<TextLayer>(r.layers, "wordmark").lines).toEqual([line("X")]);
  });

  it("the qr value expands {name|slug} from the filled name, markers stripped", () => {
    const r = resolveLayers(lolevMaster(), [], { name: [line("**Peregrine** _Falcon_")] });
    expect(byId<QrLayer>(r.layers, "qr").value).toBe("https://lolev.beer/beer/peregrine-falcon");
  });

  it("a blank name expands through its placeholder, like the old displayName", () => {
    const r = resolveLayers(lolevMaster(), [], {});
    expect(byId<QrLayer>(r.layers, "qr").value).toBe("https://lolev.beer/beer/name");
  });

  it("a ref to a missing layer keeps its literal and warns", () => {
    const m = lolevMaster();
    byId<QrLayer>(m.layers, "qr").value = "x/{ghost}";
    const r = resolveLayers(m, [], {});
    expect(byId<QrLayer>(r.layers, "qr").value).toBe("x/{ghost}");
    expect(r.warnings.join(" ")).toMatch(/ghost/);
  });

  it("drops layers switched off by the master, a variant or the label", () => {
    const m = lolevMaster();
    byId(m.layers, "qr").enabled = false;
    m.variants.push({ id: "quiet", name: "Quiet", layers: { volume: { enabled: false } } });
    const ids = resolveLayers(m, ["quiet"], {}, { wordmark: { enabled: false } }).layers.map((l) => l.id);
    expect(ids).not.toContain("qr");
    expect(ids).not.toContain("volume");
    expect(ids).not.toContain("wordmark");
    expect(ids).toContain("name");
  });
});

describe("valueOf", () => {
  it("reads each kind's content", () => {
    const r = resolveLayers(lolevMaster(), ["collab"], { name: [line("P")], collabLeft: "a1" });
    expect(valueOf(byId(r.layers, "name"))).toEqual([line("P")]);
    expect(valueOf(byId(r.layers, "collabLeft"))).toBe("a1");
    expect(valueOf(byId(r.layers, "barcode"))).toBe("850051366224");
    expect(valueOf(byId(r.layers, "qr"))).toBe("https://lolev.beer/beer/p");
  });
});
