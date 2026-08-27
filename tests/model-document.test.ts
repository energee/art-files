import { describe, expect, it } from "vitest";
import {
  composeConfig, configDiff, expandCustomFormats, toggleVariant,
  valuesFromConfig,
} from "../src/model/document";
import { lolevMaster } from "../src/model/lolev";
import { defaultConfig } from "../src/defaults";
import { parseLabelFile, serializeLabelFile } from "../src/model/labelfile";

describe("valuesFromConfig", () => {
  it("reads visible fields back out of the config by path", () => {
    const cfg = defaultConfig();
    cfg.beerName = "Peregrine";
    cfg.abv = "8";
    cfg.styleLine.text = "DIPA";
    const v = valuesFromConfig(lolevMaster(), [], cfg);
    expect(v.name).toBe("Peregrine");
    expect(v.abv).toBe("8");
    expect(v.style).toBe("DIPA");
    expect(v.upc).toBe(cfg.upc);
  });
});

describe("configDiff / composeConfig round-trip", () => {
  it("captures deviations and restores them exactly", () => {
    const m = lolevMaster();
    const base = composeConfig(m, [], {}, undefined).config;
    const cfg = structuredClone(base);
    cfg.nameStyle.fill = "#112233";
    cfg.volume.text = "12 OZ";
    const d = configDiff(base, cfg);
    expect(d).toEqual({ nameStyle: { fill: "#112233" }, volume: { text: "12 OZ" } });
    expect(composeConfig(m, [], {}, d).config).toEqual(cfg);
  });
  it("empty diff for an untouched document", () => {
    const m = lolevMaster();
    const base = composeConfig(m, [], {}, undefined).config;
    expect(configDiff(base, structuredClone(base))).toEqual({});
  });
  it("keeps arrays wholesale (customLayers)", () => {
    const m = lolevMaster();
    const base = composeConfig(m, [], {}, undefined).config;
    const cfg = structuredClone(base);
    cfg.customLayers = [{
      id: "custom-a", name: "Note", type: "text", size: 10,
      position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 },
      line: { text: "hi", fill: "#000000", layer: "white" },
    }];
    const d = configDiff(base, cfg);
    expect(d.customLayers).toEqual(cfg.customLayers);
  });

  // Golden test (C1): a legacy .label omits barcodeStrokeWidth deliberately
  // (see defaults.ts's parseConfigFile comments — that absence is what
  // preserves the pre-style measured halo). configDiff must record the
  // removal so a re-save/reopen round-trip does not resurrect
  // defaultConfig()'s barcodeStrokeWidth: 20 and change the printed barcode.
  it("records a key present in base but absent from cfg, so reopening omits it (legacy barcodeStrokeWidth)", () => {
    const m = lolevMaster();
    const base = composeConfig(m, [], {}, undefined).config;
    const cfg = structuredClone(base) as Partial<typeof base>;
    delete cfg.barcodeStrokeWidth;
    const values = valuesFromConfig(m, [], cfg as typeof base);
    const overrides = configDiff(base, cfg as typeof base);
    const reopened = composeConfig(m, [], values, overrides).config;
    expect("barcodeStrokeWidth" in reopened).toBe(false);
  });
});

describe("toggleVariant", () => {
  // Collab carries no boolean of its own any more, so what "enabling it"
  // means is: its overrides apply (the laurel's stack nudge), its three
  // layers leave the disabled set, and the user's own deviations survive
  // both directions.
  it("enabling collab applies its overrides and un-disables its layers, keeping user deviations", () => {
    const m = lolevMaster();
    const cfg = composeConfig(m, [], {}, undefined).config;
    cfg.beerName = "Peregrine";
    cfg.nameStyle.fill = "#112233";
    const on = toggleVariant(m, cfg, [], "collab", true);
    expect(on.enabled).toEqual(["collab"]);
    expect(on.config.logo.offsetY).toBe(0);
    expect(composeConfig(m, on.enabled, {}, undefined).disabledLayers.size).toBe(0);
    expect(on.config.beerName).toBe("Peregrine");
    expect(on.config.nameStyle.fill).toBe("#112233");
    const off = toggleVariant(m, on.config, on.enabled, "collab", false);
    expect(off.enabled).toEqual([]);
    expect(off.config.logo.offsetY).toBeUndefined();
    expect([...composeConfig(m, off.enabled, {}, undefined).disabledLayers].sort())
      .toEqual(["collabCenter", "collabLead", "collabLeft"]);
    expect(off.config.nameStyle.fill).toBe("#112233");
  });
});

describe("LabelFileV2 overrides", () => {
  it("round-trips through serialize/parse", () => {
    const l: import("../src/model/types").LabelFileV2 = {
      formatVersion: 2, masterId: "lolev", enabledVariants: [],
      values: { name: "Peregrine" }, overrides: { nameStyle: { fill: "#112233" } },
    };
    const back = parseLabelFile(JSON.parse(serializeLabelFile(l)));
    expect("legacy" in back).toBe(false);
    if (!("legacy" in back)) expect(back.overrides).toEqual(l.overrides);
  });

  it("save/open round-trip: v2 label reproduces the exact config", () => {
    const m = lolevMaster();
    const cfg = composeConfig(m, ["collab"], {}, undefined).config;
    cfg.beerName = "Peregrine";
    cfg.nameStyle.fill = "#112233";
    const values = valuesFromConfig(m, ["collab"], cfg);
    const overrides = configDiff(composeConfig(m, ["collab"], values, undefined).config, cfg);
    const reopened = composeConfig(m, ["collab"], values, overrides).config;
    expect(reopened).toEqual(cfg);
  });
});

describe("expandCustomFormats", () => {
  const barcodeLayer = (value: string): import("../src/types").CustomBarcodeLayer => ({
    id: "custom-a", name: "Coupon", type: "barcode", symbology: "upc-a", value,
    h: 40, moduleW: 1,
    position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 },
    style: { fill: "#000000", layer: "white" },
  });

  it("expands a format-string barcode value over the given field values", () => {
    const cfg = defaultConfig();
    cfg.customLayers = [barcodeLayer("{upc}")];
    const out = expandCustomFormats(cfg, { upc: "012345678905" });
    expect((out.customLayers![0] as { value: string }).value).toBe("012345678905");
  });

  it("returns cfg by identity when there are no custom layers", () => {
    const cfg = defaultConfig();
    expect(expandCustomFormats(cfg, {})).toBe(cfg);
  });

  it("returns cfg by identity when no custom barcode/qr layer's value contains a ref", () => {
    const cfg = defaultConfig();
    cfg.customLayers = [barcodeLayer("012345678905")];
    expect(expandCustomFormats(cfg, {})).toBe(cfg);
  });

  it("leaves text/image custom layers untouched even with brace-like text", () => {
    const cfg = defaultConfig();
    cfg.customLayers = [{
      id: "custom-b", name: "Note", type: "text", size: 10,
      position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 },
      line: { text: "{upc}", fill: "#000000", layer: "white" },
    }];
    const out = expandCustomFormats(cfg, { upc: "012345678905" });
    expect(out).toBe(cfg);
  });
});

describe("layer policy passthrough", () => {
  it("a label-level lock override beats the master's locked layer", () => {
    const m = lolevMaster();
    m.layers.find((l) => l.id === "logo")!.locked = true;
    const { config } = composeConfig(m, [], {}, { logo: { locked: false } });
    expect(config.logo.locked).toBe(false);
  });
  it("composeConfig passes layers and disabledLayers through", () => {
    const r = composeConfig(lolevMaster(), [], {}, undefined);
    expect(r.layers.map((l) => l.id)).toContain("barcode");
    expect(r.disabledLayers.has("collabLead")).toBe(true);
  });
});
