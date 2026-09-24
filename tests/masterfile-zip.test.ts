// masterfile-zip.test.ts — the .master ZIP container (spec amendment
// 2026-08-29): master.json plus template assets under the same role
// directories .label uses (texture/<name>, mask/<name>, custom/<id>/<name>).
// Legacy JSON-only .master files still open ('{' sniff), and a corrupt
// archive fails loudly without half-applying.
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { packMaster, unpackMaster, serializeMaster, type MasterAssets } from "../src/model/masterfile";
import { lolevMaster } from "../src/model/lolev";

const png = (b: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, b]);

const assets: MasterAssets = {
  texture: { name: "rock.png", bytes: png(1) },
  mask: { name: "metal.png", bytes: png(2) },
  customImages: { art1: { name: "badge.svg", bytes: strToU8("<svg/>") } },
};

describe(".master ZIP container", () => {
  it("round-trips master.json and every asset role byte-for-byte", () => {
    const m = lolevMaster();
    const { master, assets: a } = unpackMaster(packMaster(m, assets));
    expect(master).toEqual(m);
    expect(a.texture).toEqual(assets.texture);
    expect(a.mask).toEqual(assets.mask);
    expect(a.customImages).toEqual(assets.customImages);
  });

  it("packs asset-less masters and unpacks them with empty assets", () => {
    const { master, assets: a } = unpackMaster(packMaster(lolevMaster(), {}));
    expect(master).toEqual(lolevMaster());
    expect(a.texture).toBeUndefined();
    expect(a.mask).toBeUndefined();
    expect(a.customImages).toBeUndefined();
  });

  it("opens a legacy JSON-only .master behind a UTF-8 BOM or leading whitespace (#101)", () => {
    const json = serializeMaster(lolevMaster());
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8(json)]);
    for (const bytes of [bom, strToU8(`\n  ${json}`)]) {
      const { master, assets: a } = unpackMaster(bytes);
      expect(master).toEqual(lolevMaster());
      expect(a).toEqual({});
    }
  });

  it("still opens a legacy JSON-only .master ('{' sniff), with no assets", () => {
    const { master, assets: a } = unpackMaster(strToU8(serializeMaster(lolevMaster())));
    expect(master).toEqual(lolevMaster());
    expect(a).toEqual({});
  });

  it("rejects a corrupt archive loudly", () => {
    expect(() => unpackMaster(new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9]))).toThrow();
  });

  it("rejects a ZIP with no master.json as not a master file", () => {
    const wrong = zipSync({ "label.json": strToU8("{}") });
    expect(() => unpackMaster(wrong)).toThrow(/master/i);
  });

  it("rejects a legacy JSON master with a bad shape via the same parser", () => {
    expect(() => unpackMaster(strToU8('{"formatVersion":9}'))).toThrow(/formatVersion/);
  });
});
