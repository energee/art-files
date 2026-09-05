// model-files.test.ts — the v3 .master / .label containers (model/files.ts):
// the same ZIP layout as before (master.json / label.json + role dirs), a
// v1 master.json converted on open, a v2 label.json handed back as `v2`
// (it needs the master to convert), a v1 config.json handed back raw, and
// saves that always write v3.
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  packLabel, packMaster, parseLabel, serializeLabel, serializeMaster, unpackLabel, unpackMaster,
} from "../src/model/files";
import { lolevMaster as lolevV3 } from "../src/model/lolevLayers";
import { lolevMaster as lolevV1 } from "../src/model/lolev";
import { serializeMaster as serializeMasterV1 } from "../src/model/masterfile";
import { packLabel as packLabelV1, packLabelV2 } from "../src/labelfile";
import { defaultConfig } from "../src/defaults";
import type { LabelFile } from "../src/model/layers";

const png = (b: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, b]);

describe(".master v3 container", () => {
  it("round-trips master.json and every asset role byte-for-byte", () => {
    const m = lolevV3();
    const assets = {
      texture: { name: "rock.png", bytes: png(1) }, mask: { name: "metal.png", bytes: png(2) },
      customImages: { art1: { name: "badge.svg", bytes: strToU8("<svg/>") } },
    };
    const { master, assets: a, warnings } = unpackMaster(packMaster(m, assets));
    expect(master).toEqual(m);
    expect(warnings).toEqual([]);
    expect(a).toEqual(assets);
  });

  it("opens a legacy JSON-only v1 master converted to v3, with no assets", () => {
    const { master, assets, warnings } = unpackMaster(strToU8(serializeMasterV1(lolevV1())));
    expect(master.formatVersion).toBe(3);
    expect(master.layers.map((l) => l.id)).toEqual(lolevV3().layers.map((l) => l.id));
    expect(assets).toEqual({});
    expect(warnings).toEqual([]);
  });

  it("opens a v1 ZIP master converted, keeping its assets", () => {
    const bytes = zipSync({
      "master.json": strToU8(serializeMasterV1(lolevV1())),
      "texture/rock.png": [png(3), { level: 0 }],
    });
    const { master, assets } = unpackMaster(bytes);
    expect(master.formatVersion).toBe(3);
    expect(assets.texture).toEqual({ name: "rock.png", bytes: png(3) });
  });

  it("saves always write v3", () => {
    expect(JSON.parse(serializeMaster(lolevV3())).formatVersion).toBe(3);
  });

  it("rejects a ZIP with no master.json, and an unsupported version, loudly", () => {
    expect(() => unpackMaster(zipSync({ "label.json": strToU8("{}") }))).toThrow(/master/i);
    expect(() => unpackMaster(strToU8('{"formatVersion":9}'))).toThrow(/formatVersion/);
    expect(() => unpackMaster(new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9]))).toThrow();
  });
});

describe(".label v3 container", () => {
  const label: LabelFile = {
    formatVersion: 3, masterId: "lolev", masterHint: "Lolev", enabledVariants: ["collab"],
    values: { name: [{ text: "Peregrine", fill: "#F3CD80", layer: "metallic" }], collabLeft: "a1" },
    overrides: { logo: { y: 5 } },
    dormant: { values: { old: "v" }, variants: ["retired"] },
  };

  it("round-trips label.json and assets", () => {
    const u = unpackLabel(packLabel(label, {
      texture: { name: "rock.png", bytes: png(1) },
      customImages: { a1: { name: "m.svg", bytes: strToU8("<svg/>") } },
    }));
    expect(u.label).toEqual(label);
    expect(u.v2).toBeUndefined();
    expect(u.legacy).toBeUndefined();
    expect(u.assets.texture).toEqual({ name: "rock.png", bytes: png(1) });
    expect(u.assets.customImages!.a1.name).toBe("m.svg");
  });

  it("a v2 label.json comes back as v2 (the master converts it)", () => {
    const u = unpackLabel(packLabelV2(
      { formatVersion: 2, masterId: "lolev", enabledVariants: [], values: { name: "X" } }, {}));
    expect(u.v2).toMatchObject({ formatVersion: 2, masterId: "lolev", values: { name: "X" } });
    expect(u.label).toBeUndefined();
    expect(u.legacy).toBeUndefined();
  });

  it("a v1 config.json comes back as the legacy JSON string", () => {
    const u = unpackLabel(packLabelV1(defaultConfig(), {}));
    expect(JSON.parse(u.legacy!).version).toBe(1);
    expect(u.label).toBeUndefined();
    expect(u.v2).toBeUndefined();
  });

  it("parseLabel: v3 direct, v2 tagged, v1 legacy, junk rejected", () => {
    expect(parseLabel(JSON.parse(serializeLabel(label)))).toEqual(label);
    expect(parseLabel({ formatVersion: 2, masterId: "lolev", values: {} }))
      .toEqual({ v2: { formatVersion: 2, masterId: "lolev", enabledVariants: [], values: {} } });
    expect(parseLabel({ version: 1, beerName: "x" })).toEqual({ legacy: { version: 1, beerName: "x" } });
    expect(() => parseLabel({ formatVersion: 3 })).toThrow(/masterId/);
    expect(() => parseLabel("nope")).toThrow();
  });

  it("serializeLabel writes v3 and drops nothing the file carries", () => {
    const j = JSON.parse(serializeLabel(label));
    expect(j.formatVersion).toBe(3);
    expect(j).toEqual(label);
  });

  it("rejects a ZIP without label.json or config.json", () => {
    expect(() => unpackLabel(zipSync({ "readme.txt": strToU8("hi") }))).toThrow(/label\.json\/config\.json/);
  });
});
