import { describe, expect, it } from "vitest";
import { serializeMaster, unpackLabel, unpackMaster } from "../src/model/files";
import { lolevMaster } from "./fixtures/lolevMaster";
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
    expect(() => unpackLabel(zip)).toThrow(/texture\/.*"one\.png" and "two\.png"/);
  });

  it("still reads the legacy collab roles from an old file", () => {
    const zip = zipSync({
      "config.json": strToU8("{}"),
      "collab-left/left.png": png(),
      "collab-center/center.png": png(),
    });
    const { assets } = unpackLabel(zip);
    expect(assets.collabLeft).toEqual({ name: "left.png", bytes: png() });
    expect(assets.collabCenter).toEqual({ name: "center.png", bytes: png() });
  });

  it("ignores Windows re-zip junk beside an asset", () => {
    const zip = zipSync({
      "config.json": strToU8("{}"),
      "texture/rock.png": png(),
      "texture/Thumbs.db": png(),
      "custom/a1/logo.png": png(),
      "custom/a1/desktop.ini": png(),
    });
    const { assets } = unpackLabel(zip);
    expect(assets.texture).toEqual({ name: "rock.png", bytes: png() });
    expect(assets.customImages).toEqual({ a1: { name: "logo.png", bytes: png() } });
  });

  it("reports a non-label ZIP as not a .label, even with duplicate slots", () => {
    const zip = zipSync({ "texture/a.png": png(), "texture/b.png": png() });
    expect(() => unpackLabel(zip)).toThrow(/Not a \.label file/);
  });

  it("writes an imported font as fonts/<hex>/family.txt plus one level-0 file per face", () => {
    const zip: Zippable = {};
    const bold = { name: "SVN-Poppins-Bold.ttf", bytes: png() };
    packAssets(zip, { fonts: { "imported:abc123": { family: "SVN-Poppins", faces: { regular: bold, semibold: bold, bold } } } });
    expect(Object.keys(zip).sort()).toEqual([
      "fonts/abc123/bold/SVN-Poppins-Bold.ttf",
      "fonts/abc123/family.txt",
      "fonts/abc123/regular/SVN-Poppins-Bold.ttf",
      "fonts/abc123/semibold/SVN-Poppins-Bold.ttf",
    ]);
    expect(zip["fonts/abc123/bold/SVN-Poppins-Bold.ttf"]).toEqual([png(), { level: 0 }]);
  });

  it("reads no fonts key from an archive without fonts/", () => {
    const { assets } = unpackLabel(zipSync({ "config.json": strToU8("{}"), "texture/rock.png": png() }));
    expect("fonts" in assets).toBe(false);
  });

  describe("refuses a malformed font directory", () => {
    const full = (): Zippable => ({
      "config.json": strToU8("{}"),
      "fonts/": new Uint8Array(0),
      "fonts/abc/": new Uint8Array(0),
      "fonts/abc/family.txt": strToU8("SVN-Poppins"),
      "fonts/abc/regular/a.ttf": png(),
      "fonts/abc/semibold/a.ttf": png(),
      "fonts/abc/bold/a.ttf": png(),
    });

    it("accepts the complete directory, skipping re-zip directory entries (#100)", () => {
      const { assets } = unpackLabel(zipSync(full()));
      const a = { name: "a.ttf", bytes: png() };
      expect(assets.fonts).toEqual({ "imported:abc": { family: "SVN-Poppins", faces: { regular: a, semibold: a, bold: a } } });
    });

    it("missing a face", () => {
      const z = full();
      delete z["fonts/abc/semibold/a.ttf"];
      expect(() => unpackLabel(zipSync(z))).toThrow(/fonts\/abc\//);
    });

    it("missing family.txt", () => {
      const z = full();
      delete z["fonts/abc/family.txt"];
      expect(() => unpackLabel(zipSync(z))).toThrow(/fonts\/abc\//);
    });

    it("with two files in one face", () => {
      const z = { ...full(), "fonts/abc/bold/b.ttf": png() };
      expect(() => unpackLabel(zipSync(z))).toThrow(/fonts\/abc\/bold\//);
    });
  });

  it("rejects a .master with two files in one slot", () => {
    const zip = zipSync({
      "master.json": strToU8(serializeMaster(lolevMaster())),
      "mask/a.png": png(),
      "mask/b.png": png(),
    });
    expect(() => unpackMaster(zip)).toThrow(/mask\//);
  });
});
