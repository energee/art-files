import { describe, expect, it } from "vitest";
import { packLabel, packLabelV2, unpackLabel } from "@/labelfile";
import { defaultConfig, parseConfigFile } from "@/defaults";
import { zipSync, strToU8 } from "fflate";

const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe("labelfile", () => {
  it("round-trips config and assets", () => {
    const cfg = defaultConfig();
    cfg.beerName = "Test IPA";
    const zip = packLabel(cfg, {
      texture: { name: "rock.png", bytes: png() },
      mask: { name: "metal mask.png", bytes: png() },
      collabLeft: { name: "friend.svg", bytes: strToU8("<svg/>") },
    });
    const out = unpackLabel(zip);
    expect(parseConfigFile(out.config!).beerName).toBe("Test IPA");
    expect(out.assets.texture).toEqual({ name: "rock.png", bytes: png() });
    expect(out.assets.mask?.name).toBe("metal mask.png");
    expect(out.assets.collabLeft?.name).toBe("friend.svg");
    expect(out.assets.collabCenter).toBeUndefined();
  });

  it("packs with no assets", () => {
    const out = unpackLabel(packLabel(defaultConfig(), {}));
    expect(parseConfigFile(out.config!)).toBeTruthy();
    expect(out.assets).toEqual({});
  });

  it("rejects a zip without config.json or label.json", () => {
    const zip = zipSync({ "readme.txt": strToU8("hi") });
    expect(() => unpackLabel(zip)).toThrow(/missing label\.json\/config\.json/);
  });

  it("skips directory entries a re-zip adds (#100)", () => {
    // Finder "Compress" and `zip -r` write a zero-byte `texture/` entry ahead
    // of the file inside it; that entry must not win the role lookup.
    const zip = zipSync({
      "config.json": strToU8("{}"),
      "texture/": new Uint8Array(0),
      "texture/rock.png": png(),
      "mask/": new Uint8Array(0),
      "mask/metal mask.png": png(),
      "custom/": new Uint8Array(0),
      "custom/a1/": new Uint8Array(0),
      "custom/a1/logo.svg": strToU8("<svg/>"),
    });
    const { assets } = unpackLabel(zip);
    expect(assets.texture).toEqual({ name: "rock.png", bytes: png() });
    expect(assets.mask).toEqual({ name: "metal mask.png", bytes: png() });
    expect(assets.customImages).toEqual({ a1: { name: "logo.svg", bytes: strToU8("<svg/>") } });
  });

  it("round-trips an explicit fontFamily", () => {
    const cfg = { ...defaultConfig(), fontFamily: "poppins" as const };
    const out = unpackLabel(packLabel(cfg, {}));
    expect(parseConfigFile(out.config!).fontFamily).toBe("poppins");
  });

  it("parses a config with no fontFamily field", () => {
    const out = unpackLabel(packLabel(defaultConfig(), {}));
    expect(parseConfigFile(out.config!).fontFamily).toBeUndefined();
  });
});

describe("label v2 zip", () => {
  const v2 = {
    formatVersion: 2 as const, masterId: "lolev",
    enabledVariants: ["collab"], values: { name: "Peregrine" },
  };
  it("round-trips label.json and assets", () => {
    const bytes = packLabelV2(v2, { texture: { name: "rock.png", bytes: new Uint8Array([1, 2]) } });
    const u = unpackLabel(bytes);
    expect(u.config).toBeUndefined();
    expect(JSON.parse(u.label!)).toMatchObject({ formatVersion: 2, masterId: "lolev" });
    expect(u.assets.texture?.name).toBe("rock.png");
  });
  it("v1 zips still unpack as config", () => {
    const bytes = packLabel(defaultConfig(), {});
    const u = unpackLabel(bytes);
    expect(u.label).toBeUndefined();
    expect(JSON.parse(u.config!).version).toBe(1);
  });

  it("round-trips custom image layer assets under custom/<assetId>/<name>", () => {
    const bytes = packLabelV2(v2, {
      customImages: { "custom-asset-x": { name: "mark.svg", bytes: new Uint8Array([60]) } },
    });
    const u = unpackLabel(bytes);
    expect(u.assets.customImages).toEqual({
      "custom-asset-x": { name: "mark.svg", bytes: new Uint8Array([60]) },
    });
  });

  it("has no customImages key when none were packed", () => {
    const bytes = packLabelV2(v2, {});
    const u = unpackLabel(bytes);
    expect(u.assets.customImages).toBeUndefined();
  });
});
