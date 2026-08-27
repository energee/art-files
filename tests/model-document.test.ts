import { describe, expect, it } from "vitest";
import {
  composeConfig, configDiff, toggleVariation, valuesFromConfig,
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
});

describe("toggleVariation", () => {
  it("enabling collab flips collabEnabled and keeps user deviations", () => {
    const m = lolevMaster();
    const cfg = composeConfig(m, [], {}, undefined).config;
    cfg.beerName = "Peregrine";
    cfg.nameStyle.fill = "#112233";
    const on = toggleVariation(m, cfg, [], "collab", true);
    expect(on.enabled).toEqual(["collab"]);
    expect(on.config.collabEnabled).toBe(true);
    expect(on.config.beerName).toBe("Peregrine");
    expect(on.config.nameStyle.fill).toBe("#112233");
    const off = toggleVariation(m, on.config, on.enabled, "collab", false);
    expect(off.enabled).toEqual([]);
    expect(off.config.collabEnabled).toBe(false);
    expect(off.config.nameStyle.fill).toBe("#112233");
  });
});

describe("LabelFileV2 overrides", () => {
  it("round-trips through serialize/parse", () => {
    const l: import("../src/model/types").LabelFileV2 = {
      formatVersion: 2, masterId: "lolev", enabledVariations: [],
      values: { name: "Peregrine" }, overrides: { nameStyle: { fill: "#112233" } },
    };
    const back = parseLabelFile(JSON.parse(serializeLabelFile(l)));
    expect("legacy" in back).toBe(false);
    if (!("legacy" in back)) expect(back.overrides).toEqual(l.overrides);
  });
});
