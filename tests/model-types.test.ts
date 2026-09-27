import { describe, expect, it } from "vitest";
import { parseMaster } from "../src/model/types";
import { lolevMaster } from "./fixtures/lolevV1";

const minimal = {
  formatVersion: 1, id: "m1", name: "Test",
  physical: { labelWidthIn: 8.125, labelHeightIn: 3.625, bleedIn: 0.125, canDiameterIn: 2.6 },
  defaults: {}, guides: { left: 24.12, center: "auto", right: 24.12, top: 24.12, bottom: 24.12 },
  fields: [], variants: [], layers: [],
};

describe("parseMaster", () => {
  it("accepts a minimal master", () => {
    const m = parseMaster(minimal);
    expect(m.id).toBe("m1");
    expect(m.guides.top).toBe(24.12);
  });
  it("rejects a missing physical block with a plain message", () => {
    expect(() => parseMaster({ ...minimal, physical: undefined }))
      .toThrow(/physical/);
  });
  it("rejects an unknown formatVersion", () => {
    expect(() => parseMaster({ ...minimal, formatVersion: 99 }))
      .toThrow(/format/i);
  });
  it("rejects a variant with a duplicate id", () => {
    const v = { id: "collab", name: "Collab", overrides: {}, layerOverrides: {}, fields: [] };
    expect(() => parseMaster({ ...minimal, variants: [v, v] }))
      .toThrow(/duplicate/i);
  });
  it("rejects a field with an unknown kind", () => {
    const f = { id: "weird", label: "Weird", kind: "date", path: "x" };
    expect(() => parseMaster({ ...minimal, fields: [f] }))
      .toThrow(/kind/i);
  });
  it("rejects a code field with an unknown symbology", () => {
    const f = { id: "code1", label: "Code", kind: "code", path: "upc", symbology: "code-39" };
    expect(() => parseMaster({ ...minimal, fields: [f] }))
      .toThrow(/symbology/i);
  });
});

// Layer validation against the v1 Lolev master (tests/fixtures/lolevV1.ts),
// the shape files.ts still parses before convertMasterV1.
describe("parseMaster layer validation", () => {
  const withLayers = (layers: unknown) => ({ ...lolevMaster(), layers });
  it("accepts the v1 Lolev master", () => {
    expect(() => parseMaster(lolevMaster())).not.toThrow();
  });
  it("rejects a missing layers array", () => {
    expect(() => parseMaster(withLayers(undefined))).toThrow(/layers/i);
  });
  it("rejects a layer without an id or name", () => {
    expect(() => parseMaster(withLayers([{ name: "x", enabled: true }]))).toThrow(/id/i);
    expect(() => parseMaster(withLayers([{ id: "x", enabled: true }]))).toThrow(/name/i);
  });
  it("rejects duplicate layer ids", () => {
    expect(() => parseMaster(withLayers([
      { id: "a", name: "A", enabled: true }, { id: "a", name: "A2", enabled: true },
    ]))).toThrow(/duplicate/i);
  });
  it("rejects a layer owned by an undeclared variant", () => {
    expect(() => parseMaster(withLayers([
      { id: "a", name: "A", enabled: true, variant: "nope" },
    ]))).toThrow(/nope/);
  });
});

// M2: Variant.layers (the appended-layer path) went through parseMaster
// unvalidated — an appended layer with a bad shape, or one whose id
// duplicated a master layer id, passed silently and would have produced
// duplicate panel rows / duplicate React keys downstream.
describe("parseMaster Variant.layers validation (M2)", () => {
  const withCollabLayers = (layers: unknown) => {
    const m = lolevMaster();
    m.variants = m.variants.map((v) =>
      v.id === "collab" ? { ...v, layers: layers as never } : v);
    return m;
  };

  it("accepts a well-formed appended layer with a fresh id", () => {
    const m = withCollabLayers([{ id: "collab-extra", name: "Extra", enabled: true }]);
    expect(() => parseMaster(m)).not.toThrow();
  });

  it("rejects an appended layer without an id or name", () => {
    expect(() => parseMaster(withCollabLayers([{ name: "x", enabled: true }]))).toThrow(/id/i);
    expect(() => parseMaster(withCollabLayers([{ id: "x", enabled: true }]))).toThrow(/name/i);
  });

  it("rejects an appended layer missing enabled", () => {
    expect(() => parseMaster(withCollabLayers([{ id: "x", name: "X" }]))).toThrow(/enabled/i);
  });

  it("rejects an appended layer id colliding with a master layer id", () => {
    expect(() => parseMaster(withCollabLayers([
      { id: "barcode", name: "Duplicate", enabled: true },
    ]))).toThrow(/duplicate/i);
  });

  it("rejects two appended layers with the same id", () => {
    expect(() => parseMaster(withCollabLayers([
      { id: "x", name: "X", enabled: true }, { id: "x", name: "X2", enabled: true },
    ]))).toThrow(/duplicate/i);
  });

  it("rejects a layer with an unknown kind", () => {
    const m = lolevMaster();
    m.layers = [...m.layers, { id: "custom-a", name: "X", enabled: true, kind: "vector" as never }];
    expect(() => parseMaster(m)).toThrow(/kind/i);
  });

  it("accepts a layer with a valid kind", () => {
    const m = lolevMaster();
    m.layers = [...m.layers, { id: "custom-a", name: "X", enabled: true, kind: "text" }];
    expect(() => parseMaster(m)).not.toThrow();
  });
});
