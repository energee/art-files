import { describe, expect, it } from "vitest";
import { parseLabelFile, serializeLabelFile } from "../src/model/labelfile";
import type { LabelFileV2 } from "../src/model/types";

const v2: LabelFileV2 = {
  formatVersion: 2, masterId: "m1", masterHint: "lolev.master",
  enabledVariants: ["collab"], values: { name: "HAZY", abv: "6.2" },
};

describe("label file v2", () => {
  it("round-trips", () => {
    expect(parseLabelFile(JSON.parse(serializeLabelFile(v2)))).toEqual(v2);
  });
  it("has no dormant key when nothing is benched", () => {
    // A dormant store that does not survive a save is worthless (Task 4b) —
    // but the flip side matters too: a label that was never rebound must not
    // grow a phantom `dormant` key just from passing through save/load.
    const json = JSON.parse(serializeLabelFile(v2)) as Record<string, unknown>;
    expect("dormant" in json).toBe(false);
    expect((parseLabelFile(json) as LabelFileV2).dormant).toBeUndefined();
  });
  it("round-trips a benched dormant store (Task 4b)", () => {
    // The whole point of `dormant` (model/types.ts) is that a rebind's bench
    // survives a save/open — pinned here directly against the parse/
    // serialize pair, not just exercised indirectly through App.tsx's
    // save/open plumbing.
    const withBench: LabelFileV2 = {
      ...v2,
      dormant: { values: { untappd: "u/x", nope: "gone" }, variants: ["seasonal"] },
    };
    const roundTripped = parseLabelFile(JSON.parse(serializeLabelFile(withBench)));
    expect(roundTripped).toEqual(withBench);
  });
  it("defensively parses a mangled dormant block instead of throwing", () => {
    // A whole-block garbage value (not even an object) reads as "nothing
    // benched" — same as it being absent — rather than crashing the open.
    const wholeBlockGarbage = { ...JSON.parse(serializeLabelFile(v2)), dormant: "not an object" };
    expect((parseLabelFile(wholeBlockGarbage) as LabelFileV2).dormant).toBeUndefined();
    // A dormant block that IS an object but has mangled inner fields still
    // parses, with each field independently defaulted to empty.
    const mangledFields = {
      ...JSON.parse(serializeLabelFile(v2)),
      dormant: { values: "nope", variants: { not: "an array" } },
    };
    expect((parseLabelFile(mangledFields) as LabelFileV2).dormant).toEqual({ values: {}, variants: [] });
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
