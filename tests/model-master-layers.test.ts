import { describe, expect, it } from "vitest";
import { lolevMaster } from "../src/model/lolev";
import { parseMaster } from "../src/model/types";
import { resolve } from "../src/model/resolve";

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

// Task 5b: a `kind`-bearing MasterLayer is Design mode's "Add layer" — its
// identity/policy sits in `layers` like any other master layer, and its
// styling sits in the resolved config at its own id (addLayer, document.ts).
// resolve() materializes it back into `config.customLayers` so planLabel and
// the three backends see precisely the array they saw before this feature.
describe("resolve: kind-bearing layers materialize into customLayers (Task 5b)", () => {
  const textStyle = {
    type: "text", size: 12,
    position: { anchor: "center" as const, vAnchor: "top" as const, offsetX: 0, offsetY: 24 },
    line: { text: "Hello", fill: "#000000", layer: "white" as const },
  };
  const withCustomText = (variant?: string) => {
    const m = lolevMaster();
    m.layers = [...m.layers, { id: "custom-a", name: "Text", enabled: true, kind: "text" as const, variant }];
    m.defaults = { ...m.defaults, "custom-a": textStyle } as typeof m.defaults;
    return m;
  };

  it("resolves a master's own kind layer into config.customLayers, in declaration order", () => {
    const r = resolve(withCustomText(), [], {});
    expect(r.config.customLayers).toEqual([
      { ...textStyle, id: "custom-a", name: "Text", type: "text" },
    ]);
  });

  it("does not also appear in the returned layers list (no phantom master row)", () => {
    const r = resolve(withCustomText(), [], {});
    expect(r.layers.some((l) => l.id === "custom-a")).toBe(false);
  });

  it("a kind layer on a disabled variant resolves to no custom layer, and lands in disabledLayers", () => {
    const m = withCustomText("collab");
    const off = resolve(m, [], {});
    expect(off.config.customLayers).toBeUndefined();
    expect(off.disabledLayers.has("custom-a")).toBe(true);
    const on = resolve(m, ["collab"], {});
    expect(on.config.customLayers?.map((l) => l.id)).toEqual(["custom-a"]);
  });

  it("a master with no added layers resolves to the same empty customLayers as today", () => {
    expect(resolve(lolevMaster(), [], {}).config.customLayers).toBeUndefined();
  });
});
