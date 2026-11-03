// model-convert.test.ts — v2 .label / v1 embedded-config → the v3 layer
// model (spec 2026-09-04: Migration). A default LabelConfig converts to an
// override-free v3 label on the Lolev fixture master.
import { describe, expect, it } from "vitest";
import { convertConfigV1, convertLabelV2 } from "../src/model/convert";
import type { Layer } from "../src/model/layers";
import { lolevMaster as lolevV3 } from "./fixtures/lolevMaster";
import { resolveLayers } from "../src/model/resolveLayers";
import { rebindLabel } from "../src/model/rebindLayers";
import type { LabelFileV2 } from "../src/model/types";
import type { LabelConfig } from "../src/types";
import { defaultConfig } from "../src/defaults";
import { GOLD } from "./legacy/layout";

const layer = <T extends Layer = Layer>(layers: Layer[], id: string) =>
  layers.find((l) => l.id === id) as T;
const logoY = () => layer(lolevV3().layers, "logo").y as number;

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

  it("benches renamed v2 fields under their v3 layer ids so a rebind restores them (#97)", () => {
    const full = lolevV3();
    const bare = { ...full, layers: full.layers.filter((l) => l.id !== "styleLine" && l.id !== "barcode") };
    const { label } = convertLabelV2(v2({
      values: { name: "X", style: "IPA" },
      dormant: { values: { upc: "036000291452" }, variants: [] },
    }), bare);
    expect(label.dormant!.values).toEqual({ styleLine: "IPA", barcode: "036000291452" });
    const home = rebindLabel(label, bare, full).label;
    expect(home.values).toMatchObject({ styleLine: "IPA", barcode: "036000291452" });
    expect(home.dormant).toBeUndefined();
  });

  it("carries masterHint and enabledVariants verbatim", () => {
    const { label } = convertLabelV2(v2({ masterHint: "Lolev", enabledVariants: ["collab", "nope"] }), lolevV3());
    expect(label.masterHint).toBe("Lolev");
    expect(label.enabledVariants).toEqual(["collab", "nope"]);
  });
});

describe("convertConfigV1", () => {
  // A legacy config omits barcodeStrokeWidth deliberately (defaults.ts's
  // parseConfigFile). configDiff records that absence as a removal marker,
  // and since a v3 patch cannot express removal, the converter must say so
  // rather than silently let defaultConfig()'s value stand unannounced.
  it("reports a key the old file left unset instead of resurrecting the default silently", () => {
    const cfg: Partial<LabelConfig> = structuredClone(defaultConfig());
    delete cfg.barcodeStrokeWidth;
    const { warnings } = convertConfigV1(cfg as LabelConfig, false, lolevV3());
    expect(warnings).toContain('"barcodeStrokeWidth" was unset in the old file; the master\'s value stands.');
  });
  // Image scale is folded into w/h on read (image-scale-fold.test.ts); an old
  // collab slot's scale must arrive folded too, never as a `scale` key.
  it("folds a collab slot's scale into its size", () => {
    const cfg = structuredClone(defaultConfig());
    cfg.collabLeft.scale = 0.5;
    const { label } = convertConfigV1(cfg, true, lolevV3());
    expect(label.overrides?.collabLeft).toEqual({ w: 35, h: 22 });
    expect(JSON.stringify(label)).not.toContain('"scale"');
  });
  it("a default config becomes an override-free label with its filled values", () => {
    const { label, warnings } = convertConfigV1(defaultConfig(), false, lolevV3());
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
    const { label, warnings } = convertConfigV1(cfg, true, lolevV3());
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

  it("a legacy ABV saved with its own percent sign converts to a valid number (#95)", () => {
    const cfg = defaultConfig();
    cfg.abv = "6.5 %";
    const { label } = convertConfigV1(cfg, false, lolevV3());
    expect(label.values.abv).toEqual([{ text: "6.5", fill: GOLD, layer: "metallic" }]);
    const { errors } = resolveLayers(lolevV3(), label.enabledVariants, label.values, label.overrides);
    expect(errors.abv).toBeUndefined();
  });

  it("a legacy per-label custom layer rides along as a whole-layer override", () => {
    const cfg = defaultConfig();
    cfg.customLayers = [{
      id: "custom-z", name: "Z", type: "text", size: 10,
      position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 },
      line: { text: "Z", fill: GOLD, layer: "metallic" },
    }];
    const { label, warnings } = convertConfigV1(cfg, false, lolevV3());
    expect(warnings).toEqual([]);
    expect(label.overrides!["custom-z"]).toMatchObject({ kind: "text", name: "Z", enabled: true });
  });
});
