import { describe, expect, it } from "vitest";
import {
  addField, addLayer, addVariant, applyDesignEdit, applyLayerEdit, applyMaterializedLayerEdit,
  composeConfig, moveLayer, overriddenPaths, resetOverride,
} from "../src/model/document";
import { resolve } from "../src/model/resolve";
import { lolevMaster } from "../src/model/lolev";
import { parseMasterFile, serializeMaster } from "../src/model/masterfile";

const configOf = (m = lolevMaster(), enabled: string[] = []) =>
  composeConfig(m, enabled, {}, undefined).config;

describe("applyDesignEdit", () => {
  it("records a style edit into master.defaults, not the label", () => {
    const m = applyDesignEdit(lolevMaster(), "master", [], {},
      (c) => { c.nameStyle.fill = "#112233"; });
    expect(m.defaults).toEqual({ nameStyle: { fill: "#112233" } });
    expect(configOf(m).nameStyle.fill).toBe("#112233");
  });
  it("never mutates the master it was given", () => {
    const before = lolevMaster();
    applyDesignEdit(before, "master", [], {}, (c) => { c.abv = "9"; });
    expect(before.defaults).toEqual({});
  });
  it("returns the same master by identity when nothing changed", () => {
    const before = lolevMaster();
    expect(applyDesignEdit(before, "master", [], {}, () => {})).toBe(before);
  });
  it("records into a variant's overrides when that is the target", () => {
    const m = applyDesignEdit(lolevMaster(), { variant: "collab" }, [], {},
      (c) => { c.nameStyle.fill = "#445566"; });
    expect(m.defaults).toEqual({});
    expect(m.variants[0].overrides).toMatchObject({ nameStyle: { fill: "#445566" } });
    expect(configOf(m, []).nameStyle.fill).not.toBe("#445566");
    expect(configOf(m, ["collab"]).nameStyle.fill).toBe("#445566");
  });
  it("editing a variant does not disturb what it already overrides", () => {
    // The shipped Collab variant overrides nothing (see lolev.ts), so this
    // seeds an override first: a second, unrelated edit must add its own
    // leaf and leave the first exactly as it was.
    const seeded = applyDesignEdit(lolevMaster(), { variant: "collab" }, [], {},
      (c) => { c.nameStyle.fill = "#445566"; });
    const m = applyDesignEdit(seeded, { variant: "collab" }, [], {},
      (c) => { c.abv = "7"; });
    expect(m.variants[0].overrides.abv).toBe("7");
    expect(m.variants[0].overrides.nameStyle).toEqual({ fill: "#445566" });
  });
});

describe("applyLayerEdit", () => {
  it("patches the master's own layer", () => {
    const m = applyLayerEdit(lolevMaster(), "master", "qr", { enabled: false, name: "Web QR" });
    expect(m.layers.find((x) => x.id === "qr")!).toMatchObject({ enabled: false, name: "Web QR" });
    expect(lolevMaster().layers.find((x) => x.id === "qr")!.enabled).toBe(true);
  });
  it("patches a variant's layerOverrides", () => {
    const m = applyLayerEdit(lolevMaster(), { variant: "collab" }, "qr", { enabled: false });
    expect(m.layers.find((x) => x.id === "qr")!.enabled).toBe(true);
    expect(m.variants[0].layerOverrides.qr).toEqual({ enabled: false });
  });
});

describe("overriddenPaths / resetOverride", () => {
  it("reports a variant's overridden leaves and resets one", () => {
    let m = applyDesignEdit(lolevMaster(), { variant: "collab" }, [], {},
      (c) => { c.nameStyle.fill = "#445566"; c.abv = "7"; });
    const target = { variant: "collab" } as const;
    expect(overriddenPaths(m, target))
      .toEqual(new Set(["nameStyle.fill", "abv"]));
    m = resetOverride(m, target, "nameStyle.fill");
    expect(overriddenPaths(m, target)).toEqual(new Set(["abv"]));
    expect(m.variants[0].overrides.nameStyle).toBeUndefined();
  });
  it("the master overrides nothing", () => {
    expect(overriddenPaths(lolevMaster(), "master").size).toBe(0);
  });
});

describe("addVariant", () => {
  it("slugs the name and de-duplicates ids", () => {
    const a = addVariant(lolevMaster(), "Winter Release");
    expect(a.id).toBe("winter-release");
    const b = addVariant(a.master, "Winter Release");
    expect(b.id).toBe("winter-release-2");
    expect(b.master.variants).toHaveLength(3);
  });
});

describe("applyDesignEdit / REMOVE markers (fix round 1)", () => {
  it("actually unsets a previously-recorded default, not a silent no-op", () => {
    const seeded = applyDesignEdit(lolevMaster(), "master", [], {}, (c) => { c.abv = "5"; });
    expect(seeded.defaults).toEqual({ abv: "5" });
    const m = applyDesignEdit(seeded, "master", [], {},
      (c) => { delete (c as unknown as Record<string, unknown>).abv; });
    expect(m.defaults).toEqual({});
  });
  it("prunes a nested object left empty by the unset, not just the leaf", () => {
    const seeded = applyDesignEdit(lolevMaster(), "master", [], {},
      (c) => { c.nameStyle.fill = "#112233"; });
    expect(seeded.defaults).toEqual({ nameStyle: { fill: "#112233" } });
    const m = applyDesignEdit(seeded, "master", [], {},
      (c) => { delete (c.nameStyle as unknown as Record<string, unknown>).fill; });
    expect(m.defaults.nameStyle).toBeUndefined();
  });
});

describe(".master file", () => {
  it("round-trips through serialize/parse", () => {
    const m = applyDesignEdit(lolevMaster(), "master", [], {}, (c) => { c.abv = "6"; });
    expect(parseMasterFile(serializeMaster(m))).toEqual(m);
  });
  it("rejects a file that is not a master", () => {
    expect(() => parseMasterFile('{"formatVersion":9}')).toThrow();
  });
});

// Task 3: the dot-paths the inspector's overridden badges key off of.
describe("overriddenPaths for the inspector's badges", () => {
  it("style edits produce the dot-paths the inspector badges", () => {
    const m = applyDesignEdit(lolevMaster(), { variant: "collab" }, [], {},
      (c) => { c.nameStyle.fill = "#445566"; c.nameStyle.strokeWidth = 9; });
    const paths = overriddenPaths(m, { variant: "collab" });
    expect(paths.has("nameStyle.fill")).toBe(true);
    expect(paths.has("nameStyle.strokeWidth")).toBe(true);
  });
});

// Task 5: "Make fillable" from a selection.
describe("addField", () => {
  it("addField declares a field on the master and refuses a duplicate path", () => {
    const decl = { id: "volume", label: "Volume", kind: "text" as const, path: "volume.text" };
    const m = addField(lolevMaster(), "master", decl);
    expect(m.fields.map((f) => f.id)).toContain("volume");
    expect(addField(m, "master", { ...decl, id: "volume2" })).toBe(m);
  });
  it("addField on a variant declares it there, not on the master", () => {
    const m = addField(lolevMaster(), { variant: "collab" },
      { id: "partner", label: "Partner", kind: "text", path: "storeCold.text" });
    expect(m.fields.map((f) => f.id)).not.toContain("partner");
    expect(m.variants[0].fields.map((f) => f.id)).toContain("partner");
  });
  // Fix round 1 (Critical): a path already declared on ONE target refuses a
  // duplicate on a DIFFERENT target too — master vs. variant, and variant
  // vs. variant — even though the colliding variant isn't enabled.
  it("refuses a path already declared on the master when adding to a variant", () => {
    const m = addField(lolevMaster(), "master",
      { id: "upc2", label: "UPC 2", kind: "code", path: "upc" });
    expect(addField(m, { variant: "collab" },
      { id: "upc3", label: "UPC 3", kind: "code", path: "upc" })).toBe(m);
  });
  it("refuses a path already declared on a variant when adding to the master", () => {
    const m = addField(lolevMaster(), { variant: "collab" },
      { id: "partner", label: "Partner", kind: "text", path: "storeCold.text" });
    expect(addField(m, "master",
      { id: "cold", label: "Store cold", kind: "text", path: "storeCold.text" })).toBe(m);
  });
  it("refuses a path already declared on a DISABLED variant from a second variant", () => {
    // Neither variant needs to be enabled — a disabled variant can still be
    // enabled later, at which point the collision becomes live.
    let m = addVariant(lolevMaster(), "Winter").master;
    m = addField(m, { variant: "winter" },
      { id: "partner", label: "Partner", kind: "text", path: "storeCold.text" });
    expect(addField(m, { variant: "collab" },
      { id: "cold", label: "Store cold", kind: "text", path: "storeCold.text" })).toBe(m);
  });
});

// Task 5b: Design mode's "Add layer" records into the master (or the
// editing variant), never into `defaults.customLayers` wholesale.
describe("addLayer", () => {
  const layer = { id: "custom-a", name: "Text", enabled: true, kind: "text" as const };
  const style = { type: "text", size: 12, line: { text: "Hi", fill: "#000", layer: "white" } };

  it("appends to master.layers and leaves master.defaults.customLayers undefined", () => {
    const m = addLayer(lolevMaster(), "master", layer, style);
    expect(m.layers.at(-1)).toEqual(layer);
    expect((m.defaults as unknown as Record<string, unknown>).customLayers).toBeUndefined();
    expect((m.defaults as unknown as Record<string, unknown>)["custom-a"]).toEqual(style);
  });

  it("never mutates the master it was given", () => {
    const before = lolevMaster();
    addLayer(before, "master", layer, style);
    expect(before.layers.some((l) => l.id === "custom-a")).toBe(false);
  });

  it("appends to the variant's own layers, not master.layers, when the target is a variant", () => {
    const m = addLayer(lolevMaster(), { variant: "collab" }, layer, style);
    expect(m.layers.some((l) => l.id === "custom-a")).toBe(false);
    expect(m.variants[0].layers).toEqual([layer]);
    expect((m.variants[0].overrides as unknown as Record<string, unknown>)["custom-a"]).toEqual(style);
  });
});

describe("moveLayer", () => {
  const a = { id: "custom-a", name: "A", enabled: true, kind: "text" as const };
  const b = { id: "custom-b", name: "B", enabled: true, kind: "text" as const };
  const style = { type: "text", size: 12, line: { text: "x", fill: "#000", layer: "white" } };

  it("swaps two adjacent kind-bearing master layers", () => {
    let m = addLayer(lolevMaster(), "master", a, style);
    m = addLayer(m, "master", b, style);
    expect(m.layers.slice(-2).map((l) => l.id)).toEqual(["custom-a", "custom-b"]);
    const moved = moveLayer(m, "custom-b", -1);
    expect(moved.layers.slice(-2).map((l) => l.id)).toEqual(["custom-b", "custom-a"]);
  });

  it("never moves a built-in layer, or past either end of the custom range", () => {
    let m = addLayer(lolevMaster(), "master", a, style);
    m = addLayer(m, "master", b, style);
    expect(moveLayer(m, "custom-a", -1)).toBe(m); // already the first custom entry
    expect(moveLayer(m, "custom-b", 1)).toBe(m); // already the last custom entry
    expect(moveLayer(m, "qr", -1)).toBe(m); // built-in — no kind, no reorder
  });

  it("moves within the owning variant's own layers, not the master's", () => {
    let m = addLayer(lolevMaster(), { variant: "collab" }, a, style);
    m = addLayer(m, { variant: "collab" }, b, style);
    const moved = moveLayer(m, "custom-b", -1);
    expect(moved.variants[0].layers!.map((l) => l.id)).toEqual(["custom-b", "custom-a"]);
    expect(moved.layers.some((l) => l.id === "custom-a" || l.id === "custom-b")).toBe(false);
  });
});

// Task 5b fix round 1 (Important): a materialized custom row's Lock must
// land on MasterLayer.locked, where resolve() actually reads it — not on
// cfg.customLayers, which resolve() unconditionally OVERWRITES on the very
// next materialize (the "silently reverts" half of the bug). Pinned at two
// levels: applyMaterializedLayerEdit itself here, and the App-level
// materializedLayerEditDoc round-trip through resolve() in
// tests/app-layer-doc.test.ts.
describe("applyMaterializedLayerEdit", () => {
  const layer = { id: "custom-a", name: "Text", enabled: true, kind: "text" as const };
  const style = { type: "text", size: 12, line: { text: "Hi", fill: "#000", layer: "white" } };

  it("patches a materialized layer's own entry in master.layers, leaving master.defaults untouched", () => {
    const m = addLayer(lolevMaster(), "master", layer, style);
    const locked = applyMaterializedLayerEdit(m, "custom-a", { locked: true });
    expect(locked.layers.find((l) => l.id === "custom-a")!.locked).toBe(true);
    // The style recorded by addLayer is untouched — only the layer's own
    // policy entry changed.
    expect((locked.defaults as unknown as Record<string, unknown>)["custom-a"]).toEqual(style);
    expect((locked.defaults as unknown as Record<string, unknown>).customLayers).toBeUndefined();
  });

  it("never mutates the master it was given", () => {
    const m = addLayer(lolevMaster(), "master", layer, style);
    applyMaterializedLayerEdit(m, "custom-a", { locked: true });
    expect(m.layers.find((l) => l.id === "custom-a")!.locked).toBeUndefined();
  });

  it("is a no-op (identity) when the patch is already what's stored", () => {
    const m = addLayer(lolevMaster(), "master", layer, style);
    const locked = applyMaterializedLayerEdit(m, "custom-a", { locked: true });
    expect(applyMaterializedLayerEdit(locked, "custom-a", { locked: true })).toBe(locked);
  });

  it("patches the entry in the OWNING VARIANT's own layers, not master.layers — applyLayerEdit's layerOverrides can't reach it", () => {
    const m = addLayer(lolevMaster(), { variant: "collab" }, layer, style);
    // applyLayerEdit's variant branch only ever writes layerOverrides, which
    // resolve() applies to `master.layers` BEFORE appending a variant's own
    // `layers` — so it can never reach an entry that lives in `v.layers` in
    // the first place. This is exactly the bug: confirm it here so a future
    // "just use applyLayerEdit" fix stays caught.
    const viaLayerOverrides = applyLayerEdit(m, { variant: "collab" }, "custom-a", { locked: true });
    expect(resolve(viaLayerOverrides, ["collab"], {}).config.customLayers?.[0].locked).toBeUndefined();

    const locked = applyMaterializedLayerEdit(m, "custom-a", { locked: true });
    expect(locked.variants[0].layers!.find((l) => l.id === "custom-a")!.locked).toBe(true);
    expect(locked.layers.some((l) => l.id === "custom-a")).toBe(false);
  });

  it("returns the master unchanged for an id that isn't a kind-bearing layer anywhere", () => {
    const m = lolevMaster();
    expect(applyMaterializedLayerEdit(m, "qr", { locked: true })).toBe(m); // built-in — no kind
    expect(applyMaterializedLayerEdit(m, "no-such-id", { locked: true })).toBe(m);
  });
});

describe("resolve: a locked materialized layer survives recompose (Task 5b fix round 1)", () => {
  it("stays locked across repeated resolve() calls, unlike a value living only in cfg.customLayers", () => {
    const layer = { id: "custom-a", name: "Text", enabled: true, kind: "text" as const };
    const style = { type: "text", size: 12, line: { text: "Hi", fill: "#000", layer: "white" } };
    let m = addLayer(lolevMaster(), "master", layer, style);
    m = applyMaterializedLayerEdit(m, "custom-a", { locked: true });
    // Two independent resolve() calls, as undo/redo or a reopen would do —
    // the lock has to come from master.layers each time, not survive by
    // accident because the same in-memory config object was reused.
    expect(resolve(m, [], {}).config.customLayers?.[0]).toMatchObject({ id: "custom-a", locked: true });
    expect(resolve(m, [], {}).config.customLayers?.[0]).toMatchObject({ id: "custom-a", locked: true });
  });
});
