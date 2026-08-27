import { describe, expect, it } from "vitest";
import { parseLabelFile, serializeLabelFile } from "../src/model/labelfile";
import type { LabelFileV2 } from "../src/model/types";

const v2: LabelFileV2 = {
  formatVersion: 2, masterId: "m1", masterHint: "lolev.master",
  enabledVariations: ["collab"], values: { name: "HAZY", abv: "6.2" },
};

describe("label file v2", () => {
  it("round-trips", () => {
    expect(parseLabelFile(JSON.parse(serializeLabelFile(v2)))).toEqual(v2);
  });
  it("tags a legacy v1 file instead of throwing", () => {
    const legacy = { version: 1, beerName: "OLD" };
    expect(parseLabelFile(legacy)).toEqual({ legacy });
  });
  it("throws a plain message on garbage", () => {
    expect(() => parseLabelFile({ formatVersion: 2 })).toThrow(/masterId/);
    expect(() => parseLabelFile("nope")).toThrow(/label file/i);
  });
});
