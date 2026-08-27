import { describe, expect, it } from "vitest";
import { parseMaster } from "../src/model/types";

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
