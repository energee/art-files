import { describe, expect, it } from "vitest";
import {
  addVariant, applyDesignEdit, applyLayerEdit, composeConfig,
  overriddenPaths, resetOverride,
} from "../src/model/document";
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
  it("editing a variant does not re-record what it already overrides", () => {
    const m = applyDesignEdit(lolevMaster(), { variant: "collab" }, [], {},
      (c) => { c.abv = "7"; });
    expect(m.variants[0].overrides.abv).toBe("7");
    // collabEnabled was already the variant's own override — the diff must
    // not double-record it as a fresh edit.
    expect(m.variants[0].overrides.collabEnabled).toBe(true);
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
      .toEqual(new Set(["collabEnabled", "nameStyle.fill", "abv"]));
    m = resetOverride(m, target, "nameStyle.fill");
    expect(overriddenPaths(m, target)).toEqual(new Set(["collabEnabled", "abv"]));
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
