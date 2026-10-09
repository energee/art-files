import { describe, expect, it } from "vitest";
import { unpackLabel } from "../src/model/files";
import { zipSync, strToU8, type Zippable } from "fflate";
import { packAssets } from "../src/labelfile";
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe("legacy zip directory entries", () => {
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

});

describe("packAssets contract (#430)", () => {
  it("never writes the read-only legacy collab roles", () => {
    const zip: Zippable = {};
    packAssets(zip, {
      texture: { name: "rock.png", bytes: png() },
      collabLeft: { name: "left.png", bytes: png() },
      collabCenter: { name: "center.png", bytes: png() },
    });
    expect(Object.keys(zip)).toEqual(["texture/rock.png"]);
  });

  it("rejects an archive with two files under one custom/<id>/", () => {
    const zip = zipSync({
      "config.json": strToU8("{}"),
      "custom/a1/one.png": png(),
      "custom/a1/two.png": png(),
    });
    expect(() => unpackLabel(zip)).toThrow(/custom\/a1\//);
  });

  it("rejects an archive with two files under one fixed role", () => {
    const zip = zipSync({
      "config.json": strToU8("{}"),
      "texture/one.png": png(),
      "texture/two.png": png(),
    });
    expect(() => unpackLabel(zip)).toThrow(/texture\//);
  });
});
