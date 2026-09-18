// model-convert.test.ts — v1 .master / v2 .label / v1 embedded-config → the
// v3 layer model (spec 2026-09-04: Migration). The Lolev fixtures are the
// round-trip proof: the old lolevMaster() converts to the v3 lolevMaster()
// data, and a default LabelConfig converts to an override-free v3 label.
import { describe, expect, it } from "vitest";
import { convertConfigV1, convertLabelV2, convertMasterV1 } from "../src/model/convert";
import {
  parseMaster, type BarcodeLayer, type ImageLayer, type Layer, type TextLayer,
} from "../src/model/layers";
import { lolevMaster as lolevV3 } from "../src/model/lolevLayers";
import { lolevMaster as lolevV1 } from "./fixtures/lolevV1";
import type { LabelFileV2 } from "../src/model/types";
import { defaultConfig, KEYLINE } from "../src/defaults";
import { GOLD } from "../src/layout";

const layer = <T extends Layer = Layer>(layers: Layer[], id: string) =>
  layers.find((l) => l.id === id) as T;
const sansName = (l: unknown) => { const { name: _n, ...rest } = l as Layer; return rest; };
const logoY = () => layer(lolevV3().layers, "logo").y as number;

describe("convertMasterV1", () => {
  it("converts the Lolev v1 master into the v3 Lolev data", () => {
    const { master, warnings } = convertMasterV1(lolevV1());
    const want = lolevV3();
    expect(warnings).toEqual([]);
    expect(() => parseMaster(master)).not.toThrow();
    expect(master.formatVersion).toBe(3);
    expect([master.id, master.name, master.physical, master.guides])
      .toEqual([want.id, want.name, want.physical, want.guides]);
    expect(master.layers.map((l) => l.id)).toEqual(want.layers.map((l) => l.id));
    for (const w of want.layers) {
      const got = layer(master.layers, w.id);
      expect([got.kind, got.x, got.y, got.anchor, got.enabled, !!got.locked])
        .toEqual([w.kind, w.x, w.y, w.anchor, w.enabled, !!w.locked]);
    }
    expect(master.layers).toEqual(want.layers);
    expect(master.variants.map((v) => v.id)).toEqual(["collab"]);
    const diff = master.variants[0].layers;
    expect(Object.keys(diff)).toEqual(["collabLead", "collabLeft", "collabCenter"]);
    for (const id of Object.keys(diff))
      expect(sansName(diff[id])).toEqual(sansName(want.variants[0].layers[id]));
  });

  it("old defaults restyle and refill the table's layers", () => {
    const old = lolevV1();
    old.defaults = {
      beerName: "Peregrine", abv: "6.5", upc: "036000291452",
      description: "# HOPS\nCitra\n_Mosaic_",
      nameStyle: { fill: "#FF0000", layer: "white", ...KEYLINE },
      logo: { fill: GOLD, layer: "metallic", offsetY: 7, locked: true },
      barcodeFill: "#222222",
      volume: { text: "12 OZ", fill: GOLD, layer: "metallic", bold: false, ...KEYLINE },
      fontFamily: "poppins",
    };
    const { master, warnings } = convertMasterV1(old);
    expect(warnings).toEqual([]);
    const name = layer<TextLayer>(master.layers, "name");
    expect(name.lines).toEqual([{ text: "Peregrine", fill: "#FF0000", layer: "white" }]);
    expect(name.style.fill).toBe("#FF0000");
    expect(layer<TextLayer>(master.layers, "abv").lines[0].text).toBe("6.5");
    expect(layer<TextLayer>(master.layers, "description").lines).toEqual([
      { text: "HOPS", fill: GOLD, layer: "metallic", header: true },
      { text: "Citra", fill: GOLD, layer: "metallic" },
      { text: "Mosaic", fill: GOLD, layer: "white" },
    ]);
    const logo = layer<ImageLayer>(master.layers, "logo");
    expect(logo.y).toBe(logoY() + 7);
    expect(logo.locked).toBe(true);
    const barcode = layer<BarcodeLayer>(master.layers, "barcode");
    expect(barcode.value).toBe("036000291452");
    expect(barcode.style.fill).toBe("#222222");
    expect(layer<TextLayer>(master.layers, "volume").lines)
      .toEqual([{ text: "12 OZ", fill: GOLD, layer: "metallic" }]);
    expect(master.fontFamily).toBe("poppins");
  });

  it("carries policy (enabled, locked, names); fillable follows the FieldDecls", () => {
    const old = lolevV1();
    old.layers = old.layers.map((l) =>
      l.id === "qr" ? { ...l, enabled: false, name: "Code" } : l.id === "logo" ? { ...l, locked: true } : l);
    old.fields = old.fields.filter((f) => f.id !== "style");
    const { master } = convertMasterV1(old);
    const qr = layer(master.layers, "qr");
    expect([qr.enabled, qr.name]).toEqual([false, "Code"]);
    expect(layer(master.layers, "logo").locked).toBe(true);
    const abv = layer<TextLayer>(master.layers, "abv");
    expect([abv.input, abv.min, abv.max]).toEqual(["number", 0, 20]);
  });

  it("a field's {id}<literal> format becomes the layer's suffix; any other shape warns and drops", () => {
    const old = lolevV1();
    old.fields = old.fields.map((f) =>
      f.id === "abv" ? { ...f, format: "{abv}% alc by vol" }
        : f.id === "name" ? { ...f, format: "Beer: {name|upper}" } : f);
    const { master, warnings } = convertMasterV1(old);
    expect(layer<TextLayer>(master.layers, "abv").suffix).toBe("% alc by vol");
    expect(layer<TextLayer>(master.layers, "name").suffix).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/name.*format/i);
  });

  it("converts a kind-bearing custom layer from its stored styling, anchored over the guides", () => {
    const old = lolevV1();
    old.layers = [...old.layers,
      { id: "custom-t", name: "Tag", enabled: true, kind: "text" },
      { id: "custom-i", name: "Mark", enabled: true, locked: true, kind: "image", variant: "collab" }];
    old.defaults = {
      "custom-t": {
        type: "text", size: 12,
        position: { anchor: "center", vAnchor: "top", offsetX: 5, offsetY: 24 },
        line: { text: "Hello", fill: "#000000", layer: "white" },
      },
      "custom-i": {
        type: "image", asset: "art1", w: 80, aspect: 4,
        position: { anchor: "right", vAnchor: "bottom", offsetX: -3, offsetY: 0 },
        style: { fill: "none", layer: "white" },
      },
    } as unknown as typeof old.defaults;
    const { master, warnings } = convertMasterV1(old);
    expect(warnings).toEqual([]);
    const t = layer<TextLayer>(master.layers, "custom-t");
    expect([t.kind, t.anchor, t.size, t.name]).toEqual(["text", "center", 12, "Tag"]);
    expect(t.x).toBeCloseTo(585.12 / 2 + 5);
    expect(t.y).toBeCloseTo(4.56 + 24.12 + 24);
    expect(t.lines).toEqual([{ text: "Hello", fill: "#000000", layer: "white" }]);
    expect(master.layers.some((l) => l.id === "custom-i")).toBe(false);
    const i = master.variants[0].layers["custom-i"] as ImageLayer;
    expect([i.kind, i.asset, i.w, i.h, i.locked, i.anchor, i.vAnchor])
      .toEqual(["image", "art1", 80, 20, true, "right", "bottom"]);
    expect(i.x).toBeCloseTo(585.12 - 4.56 - 24.12 - 3);
    expect(i.y as number).toBeCloseTo(369.12 - 4.56 - 24.12);
    expect(() => parseMaster(master)).not.toThrow();
  });

  it("folds a variant's overrides, layerOverrides, fields and appended layers into its diff", () => {
    const old = lolevV1();
    old.variants = [...old.variants, {
      id: "lift", name: "Lift",
      overrides: {
        logo: { offsetY: 7 }, abvStyle: { fill: "#00FF00" },
        "custom-x": {
          type: "text", size: 10,
          position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 },
          line: { text: "X", fill: GOLD, layer: "metallic" },
        },
      } as never,
      layerOverrides: { qr: { enabled: false } },
      fields: [{ id: "partner", label: "Partner", kind: "text", path: "custom-x.line.text" }],
      layers: [{ id: "custom-x", name: "Extra", enabled: true, kind: "text" }],
    }];
    const { master, warnings } = convertMasterV1(old);
    expect(warnings).toEqual([]);
    const diff = master.variants[1].layers;
    expect(diff.logo!.y).toBe(logoY() + 7);
    expect(diff.abv!.style!.fill).toBe("#00FF00");
    expect(diff.qr).toEqual({ enabled: false });
    const x = diff["custom-x"] as TextLayer;
    expect([x.kind, x.lines[0].text, x.name]).toEqual(["text", "X", "Extra"]);
    expect(() => parseMaster(master)).not.toThrow();
  });

  it("warns about an unknown built-in id and an unmappable defaults key", () => {
    const old = lolevV1();
    old.layers = [...old.layers, { id: "mystery", name: "?", enabled: true }];
    old.defaults = { mystery: 1 } as never;
    const { master, warnings } = convertMasterV1(old);
    expect(master.layers.some((l) => l.id === "mystery")).toBe(false);
    expect(warnings.join(" ")).toMatch(/mystery/);
  });
});

describe("convertLabelV2", () => {
  const v2 = (over: Partial<LabelFileV2> = {}): LabelFileV2 => ({
    formatVersion: 2, masterId: "lolev", enabledVariants: ["collab"],
    values: {
      name: "Peregrine", style: "IPA", abv: 6.5, description: "# HOPS\nCitra",
      upc: "036000291452", collabLeft: "asset-1",
    },
    ...over,
  });

  it("re-keys values to layer ids and parses text into lines", () => {
    const { label, warnings } = convertLabelV2(v2(), lolevV3());
    expect(warnings).toEqual([]);
    expect([label.formatVersion, label.masterId, label.enabledVariants]).toEqual([3, "lolev", ["collab"]]);
    expect(label.values.name).toEqual([{ text: "Peregrine", fill: GOLD, layer: "metallic" }]);
    expect(label.values.styleLine).toEqual([{ text: "IPA", fill: GOLD, layer: "metallic" }]);
    expect(label.values.abv).toEqual([{ text: "6.5", fill: GOLD, layer: "metallic" }]);
    expect(label.values.description).toEqual([
      { text: "HOPS", fill: GOLD, layer: "metallic", header: true },
      { text: "Citra", fill: GOLD, layer: "metallic" },
    ]);
    expect(label.values.barcode).toBe("036000291452");
    expect(label.values.collabLeft).toBe("asset-1");
    expect(label.values.style).toBeUndefined();
    expect(label.values.upc).toBeUndefined();
    expect(label.overrides).toBeUndefined();
    expect(label.dormant).toBeUndefined();
  });

  it("maps overrides onto layers, styles the value's lines with them, and warns on the unmappable", () => {
    const overrides = {
      nameStyle: { fill: "#FF0000" }, logo: { offsetY: 5 }, qrFill: "#123456",
      wordmark: { fill: "#0000FF" }, bogus: 1,
    } as never;
    const { label, warnings } = convertLabelV2(v2({ overrides }), lolevV3());
    expect(label.overrides!.name).toEqual({ style: { fill: "#FF0000" } });
    expect(label.values.name).toEqual([{ text: "Peregrine", fill: "#FF0000", layer: "metallic" }]);
    expect(label.overrides!.logo).toEqual({ y: logoY() + 5 });
    expect(label.overrides!.qr).toEqual({ style: { fill: "#123456" } });
    // A non-fillable text layer's restyle has to reach its lines (a run's
    // own fill wins over the block style), so the override carries both.
    expect(label.overrides!.wordmark).toEqual({
      style: { fill: "#0000FF" },
      lines: [{ text: "Lolev Beer", fill: "#0000FF", layer: "metallic" }],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/bogus/);
  });

  it("benches values for layers the master lacks and carries the old bench forward", () => {
    const { label } = convertLabelV2(v2({
      values: { name: "X", partner: "p.png" },
      dormant: { values: { old: "v" }, variants: ["retired"] },
    }), lolevV3());
    expect(label.values.partner).toBeUndefined();
    expect(label.dormant).toEqual({ values: { partner: "p.png", old: "v" }, variants: ["retired"] });
  });

  it("carries masterHint and enabledVariants verbatim", () => {
    const { label } = convertLabelV2(v2({ masterHint: "Lolev", enabledVariants: ["collab", "nope"] }), lolevV3());
    expect(label.masterHint).toBe("Lolev");
    expect(label.enabledVariants).toEqual(["collab", "nope"]);
  });
});

describe("convertConfigV1", () => {
  it("a default config becomes an override-free label with its filled values", () => {
    const { label, warnings } = convertConfigV1(defaultConfig(), false);
    expect(warnings).toEqual([]);
    expect(label).toMatchObject({ formatVersion: 3, masterId: "lolev", enabledVariants: [] });
    expect(label.values.name).toEqual([{ text: "", fill: GOLD, layer: "metallic" }]);
    expect(label.values.styleLine).toEqual([{ text: "", fill: GOLD, layer: "metallic" }]);
    expect(label.values.abv).toEqual([{ text: "", fill: GOLD, layer: "metallic" }]);
    expect(label.values.description).toEqual([
      { text: "HOPS", fill: GOLD, layer: "metallic", header: true },
      { text: "...", fill: GOLD, layer: "metallic" },
    ]);
    expect(label.values.barcode).toBe("850051366224");
    expect(label.values.collabLeft).toBeUndefined();
    expect(label.overrides).toBeUndefined();
  });

  it("collab on, filled values, and styling deviations as overrides", () => {
    const cfg = defaultConfig();
    cfg.beerName = "Hazy";
    cfg.abv = "7";
    cfg.nameStyle.fill = "#FF0000";
    cfg.collabLeft.image = "a1";
    cfg.logo.offsetY = 4;
    const { label, warnings } = convertConfigV1(cfg, true);
    expect(warnings).toEqual([]);
    expect(label.enabledVariants).toEqual(["collab"]);
    expect(label.values.name).toEqual([{ text: "Hazy", fill: "#FF0000", layer: "metallic" }]);
    expect(label.values.abv).toEqual([{ text: "7", fill: GOLD, layer: "metallic" }]);
    expect(label.values.collabLeft).toBe("a1");
    expect(label.overrides).toEqual({
      name: { style: { fill: "#FF0000" } },
      logo: { y: logoY() + 4 },
    });
  });

  it("a legacy per-label custom layer rides along as a whole-layer override", () => {
    const cfg = defaultConfig();
    cfg.customLayers = [{
      id: "custom-z", name: "Z", type: "text", size: 10,
      position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 },
      line: { text: "Z", fill: GOLD, layer: "metallic" },
    }];
    const { label, warnings } = convertConfigV1(cfg, false);
    expect(warnings).toEqual([]);
    expect(label.overrides!["custom-z"]).toMatchObject({ kind: "text", name: "Z", enabled: true });
  });
});
