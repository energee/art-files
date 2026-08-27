import { describe, expect, it } from "vitest";
import { lolevMaster } from "../src/model/lolev";
import { parseMaster } from "../src/model/types";

describe("lolevMaster layers", () => {
  it("declares every built-in element in draw order", () => {
    expect(lolevMaster().layers.map((l) => l.id)).toEqual([
      "volume", "abv", "description", "collabLead", "collabLeft", "wordmark",
      "logo", "collabCenter", "name", "styleLine", "handleAddress", "warning",
      "storeCold", "qr", "barcode",
    ]);
  });
  it("tags the collab block as the Collab variant's layers", () => {
    const owned = lolevMaster().layers.filter((l) => l.variant === "collab");
    expect(owned.map((l) => l.id)).toEqual(["collabLead", "collabLeft", "collabCenter"]);
  });
  it("renames the wordmark to Brand and ships every layer enabled", () => {
    const m = lolevMaster();
    expect(m.layers.find((l) => l.id === "wordmark")!.name).toBe("Brand");
    expect(m.layers.every((l) => l.enabled)).toBe(true);
  });
  it("ships the government warning locked", () => {
    expect(lolevMaster().layers.find((l) => l.id === "warning")!.locked).toBe(true);
  });
});

describe("parseMaster layer validation", () => {
  const withLayers = (layers: unknown) => ({ ...lolevMaster(), layers });
  it("accepts the shipped master", () => {
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
