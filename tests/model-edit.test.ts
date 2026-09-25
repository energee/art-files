// tests/model-edit.test.ts — the pure v3 editing operations (model/edit.ts)
// exercised against the Lolev master: where an edit lands follows the layer
// (a variant-added layer edits that variant's diff, a master layer edits the
// master), bindings never dangle, drags snap horizontally and never break a
// binding, and every operation returns a new object without touching its
// input.
import { describe, expect, it } from "vitest";
import {
  addLayer, addVariant, bindBelow, checkLabelBindings, clearLabelOverride, clearOverride, clearValue,
  masterDiff, mintLayerId, moveBy, moveLayers, overriddenPaths, patchLayers, removeLayer,
  removeLayerIn, removeVariant, removeVariantIn, renameVariant, setLabelOverride, setLayer, setLayerIn, setValue,
  structureOnlyMaster, toggleVariant, unbind, whereLayerLives, type Doc,
} from "../src/model/edit";
import { lolevMaster } from "../src/model/lolevLayers";
import { PT_STEP, roundToStep } from "../src/numeric";
import { parseMaster } from "../src/model/layers";
import { placeLayers } from "../src/model/place";
import { resolveLayers } from "../src/model/resolveLayers";
import type {
  BarcodeLayer, ImageLayer, LabelFile, Layer, Master, QrLayer, RelativeY, TextLayer,
} from "../src/model/layers";
import type { GuideLines } from "../src/model/position";
import { CENTER_X, GOLD } from "../src/layout";

const byId = <T extends Layer = Layer>(m: Master, id: string) =>
  m.layers.find((l) => l.id === id) as T;
const collab = (m: Master) => m.variants.find((v) => v.id === "collab")!;
const label = (over: Partial<LabelFile> = {}): LabelFile => ({
  formatVersion: 3, masterId: "lolev", enabledVariants: [], values: {}, ...over,
});
const guides: GuideLines = { left: 28.68, center: CENTER_X, right: 556.44, top: 24.12, bottom: 345 };

describe("mintLayerId", () => {
  it("mints kind-prefixed six-hex ids that avoid the taken set", () => {
    const id = mintLayerId("text", new Set());
    expect(id).toMatch(/^text-[0-9a-f]{6}$/);
    const taken = new Set([id]);
    expect(mintLayerId("text", taken)).not.toBe(id);
  });
});

describe("addLayer", () => {
  it("appends a default text layer to the master at the center guide", () => {
    const { master, id } = addLayer(lolevMaster(), "text");
    expect(master.layers.at(-1)!.id).toBe(id);
    const l = byId<TextLayer>(master, id);
    expect(l).toMatchObject({ kind: "text", enabled: true, x: CENTER_X, y: 100, size: 12, align: "left" });
    expect(l.lines).toEqual([{ text: "", fill: GOLD, layer: "metallic" }]);
    expect(l.style).toMatchObject({ fill: GOLD, layer: "metallic" });
    expect(() => parseMaster(master)).not.toThrow();
  });
  it("gives every kind a parseable default", () => {
    let m = lolevMaster();
    for (const kind of ["image", "barcode", "qr"] as const) m = addLayer(m, kind).master;
    expect(() => parseMaster(m)).not.toThrow();
    const img = m.layers.find((l) => l.kind === "image" && l.id.startsWith("image-")) as ImageLayer;
    expect(img).toMatchObject({ asset: "", w: 60 });
    expect(m.layers.find((l) => l.kind === "barcode" && l.id.startsWith("barcode-")))
      .toMatchObject({ symbology: "upc-a", moduleW: 1, h: 15 });
    expect(m.layers.find((l) => l.id.startsWith("qr-"))).toMatchObject({ size: 40, qrStyle: "square" });
  });
  it("inserts after a named layer", () => {
    const { master, id } = addLayer(lolevMaster(), "qr", { after: "logo" });
    const ids = master.layers.map((l) => l.id);
    expect(ids[ids.indexOf("logo") + 1]).toBe(id);
  });
  it("with a variant, adds the complete layer to that variant's diff, not master.layers", () => {
    const { master, id } = addLayer(lolevMaster(), "text", { variant: "collab" });
    expect(master.layers.some((l) => l.id === id)).toBe(false);
    expect(collab(master).layers[id]).toMatchObject({ id, kind: "text", enabled: true });
    expect(Object.keys(collab(master).layers).at(-1)).toBe(id);
    expect(whereLayerLives(master, id)).toEqual({ variant: "collab" });
    expect(() => parseMaster(master)).not.toThrow();
  });
  it("refuses an unknown variant", () => {
    expect(() => addLayer(lolevMaster(), "text", { variant: "nope" })).toThrow(/nope/);
  });
  it("does not mutate the input", () => {
    const m = lolevMaster();
    addLayer(m, "text");
    addLayer(m, "text", { variant: "collab" });
    expect(m).toEqual(lolevMaster());
  });
});

describe("whereLayerLives", () => {
  it("master layers live in the master, collab's three in the collab diff", () => {
    const m = lolevMaster();
    expect(whereLayerLives(m, "logo")).toBe("master");
    expect(whereLayerLives(m, "collabLead")).toEqual({ variant: "collab" });
  });
  it("a variant override of a master layer does not move it", () => {
    const m = setLayerIn(lolevMaster(), "collab", "logo", { y: 120 });
    expect(whereLayerLives(m, "logo")).toBe("master");
  });
});

describe("setLayer", () => {
  it("deep-merges into a master layer", () => {
    const m = setLayer(lolevMaster(), "name", { size: 20, style: { fill: "#112233" }, locked: true });
    const l = byId<TextLayer>(m, "name");
    expect(l.size).toBe(20);
    expect(l.locked).toBe(true);
    expect(l.style).toEqual({ ...byId<TextLayer>(lolevMaster(), "name").style, fill: "#112233" });
    expect(l.lines).toEqual(byId<TextLayer>(lolevMaster(), "name").lines);
  });
  it("on a collab-added layer lands in the collab diff, not master.layers", () => {
    const m = setLayer(lolevMaster(), "collabLead", { enabled: false, size: 11 });
    expect(m.layers).toEqual(lolevMaster().layers);
    expect(collab(m).layers.collabLead).toMatchObject({ enabled: false, size: 11, name: "Lead-in" });
    expect(collab(m).layers.collabLead!.y).toEqual(collab(lolevMaster()).layers.collabLead!.y);
  });
  it("replaces a numeric y with a binding and back", () => {
    const bound = setLayer(lolevMaster(), "abv", { y: { below: "volume", gap: 2 } });
    expect(byId(bound, "abv").y).toEqual({ below: "volume", gap: 2 });
    expect(byId(setLayer(bound, "abv", { y: 30 }), "abv").y).toBe(30);
  });
  it("throws on an unknown layer id", () => {
    expect(() => setLayer(lolevMaster(), "nope", { enabled: false })).toThrow(/nope/);
  });
  it("does not mutate the input", () => {
    const m = lolevMaster();
    setLayer(m, "name", { size: 20 });
    setLayer(m, "collabLead", { size: 20 });
    expect(m).toEqual(lolevMaster());
  });
});

describe("setLayerIn", () => {
  it("moves the logo only for collab", () => {
    const m = setLayerIn(lolevMaster(), "collab", "logo", { y: 120 });
    expect(byId(m, "logo").y).toBe(byId(lolevMaster(), "logo").y);
    expect(collab(m).layers.logo).toEqual({ y: 120 });
    expect(() => parseMaster(m)).not.toThrow();
  });
  it("accumulates overrides across calls", () => {
    const m = setLayerIn(setLayerIn(lolevMaster(), "collab", "logo", { y: 120 }), "collab", "logo",
      { style: { fill: "#112233" } });
    expect(collab(m).layers.logo).toEqual({ y: 120, style: { fill: "#112233" } });
  });
  it("refuses an unknown variant or a layer the master lacks", () => {
    expect(() => setLayerIn(lolevMaster(), "nope", "logo", { y: 1 })).toThrow(/nope/);
    expect(() => setLayerIn(lolevMaster(), "collab", "ghost", { y: 1 })).toThrow(/ghost/);
  });
});

describe("clearOverride / overriddenPaths", () => {
  const overridden = () => setLayerIn(lolevMaster(), "collab", "logo",
    { y: 120, style: { fill: "#112233", stroke: "#000000" } });
  it("lists the dotted leaf paths a variant overrides on a master layer", () => {
    expect([...overriddenPaths(overridden(), "collab", "logo")].sort())
      .toEqual(["style.fill", "style.stroke", "y"]);
    expect(overriddenPaths(lolevMaster(), "collab", "logo").size).toBe(0);
    expect(overriddenPaths(lolevMaster(), "collab", "collabLead").size).toBe(0);
  });
  it("clears one path, pruning an emptied parent, or the whole entry", () => {
    const one = clearOverride(overridden(), "collab", "logo", "style.fill");
    expect(collab(one).layers.logo).toEqual({ y: 120, style: { stroke: "#000000" } });
    const two = clearOverride(one, "collab", "logo", "style.stroke");
    expect(collab(two).layers.logo).toEqual({ y: 120 });
    const all = clearOverride(overridden(), "collab", "logo");
    expect("logo" in collab(all).layers).toBe(false);
    expect(collab(all).layers).toEqual(collab(lolevMaster()).layers);
  });
  it("refuses to strip a layer the variant added (that is removeLayer's job)", () => {
    expect(() => clearOverride(lolevMaster(), "collab", "collabLead")).toThrow(/removeLayer/);
  });
});

describe("removeLayer", () => {
  it("removes a master layer and every variant's override of it", () => {
    const m = removeLayer(setLayerIn(lolevMaster(), "collab", "logo", { y: 120 }), "logo");
    expect(m.layers.some((l) => l.id === "logo")).toBe(false);
    expect("logo" in collab(m).layers).toBe(false);
  });
  it("of collabLead re-points collabLeft's binding onto collabLead's own y", () => {
    const m = removeLayer(lolevMaster(), "collabLead");
    expect("collabLead" in collab(m).layers).toBe(false);
    expect(collab(m).layers.collabLeft!.y).toEqual(collab(lolevMaster()).layers.collabLead!.y);
    expect(() => parseMaster(m)).not.toThrow();
  });
  it("of a master layer re-points a bound layer onto the removed layer's numeric y", () => {
    const m = removeLayer(lolevMaster(), "description");
    expect(collab(m).layers.collabLead!.y).toBe(byId(lolevMaster(), "description").y);
    expect(() => parseMaster(m)).not.toThrow();
  });
  it("pins a dependent at the removed layer's measured top, on the 0.01pt grid (#130)", () => {
    const boxes = new Map([["description", { x: 50, y: 210.12345678900003, w: 100, h: 20 }]]);
    const m = removeLayer(lolevMaster(), "description", boxes);
    expect(collab(m).layers.collabLead).toMatchObject({ y: 210.12, vAnchor: "top", guideY: "none" });
    expect(() => parseMaster(m)).not.toThrow();
  });
  it("throws on an unknown id and never mutates", () => {
    const m = lolevMaster();
    expect(() => removeLayer(m, "nope")).toThrow(/nope/);
    removeLayer(m, "collabLead");
    expect(m).toEqual(lolevMaster());
  });
});

describe("moveLayers", () => {
  it("carries every selected peer as one block, dragged layer landing where a solo move would", () => {
    const m = lolevMaster();
    const ids = m.layers.map((l) => l.id);
    // Select #0 and #2, drag #0 down three steps: block lands after #3.
    const moved = moveLayers(m, [ids[2], ids[0]], ids[0], 3);
    expect(moved.layers.map((l) => l.id)).toEqual([ids[1], ids[3], ids[0], ids[2], ...ids.slice(4)]);
    // Dragging the later one up one step keeps the block above its neighbour.
    const up = moveLayers(m, [ids[0], ids[2]], ids[2], -1);
    expect(up.layers.map((l) => l.id)).toEqual([ids[0], ids[2], ids[1], ...ids.slice(3)]);
    expect(moveLayers(m, [ids[0], ids[1]], ids[0], -1)).toBe(m);
  });
  it("ignores selected layers that live in a different container", () => {
    const m = lolevMaster();
    const ids = m.layers.map((l) => l.id);
    expect(moveLayers(m, [ids[0], "collabLead"], ids[0], 1)).toEqual(moveLayers(m, [ids[0]], ids[0], 1));
  });
});

describe("moveLayers (single layer)", () => {
  it("moves several steps at once and clamps at the ends", () => {
    const m = lolevMaster();
    const ids = m.layers.map((l) => l.id);
    const moved = moveLayers(m, [ids[0]], ids[0], 2);
    expect(moved.layers.map((l) => l.id)).toEqual([ids[1], ids[2], ids[0], ...ids.slice(3)]);
    expect(moveLayers(m, [ids[0]], ids[0], 99).layers.at(-1)!.id).toBe(ids[0]);
    expect(moveLayers(m, [ids[0]], ids[0], -3)).toBe(m);
  });
  it("swaps a master layer with its neighbour in draw order", () => {
    const m = moveLayers(lolevMaster(), ["logo"], "logo", 1);
    const ids = m.layers.map((l) => l.id);
    const was = lolevMaster().layers.map((l) => l.id);
    expect(ids[was.indexOf("logo")]).toBe("name");
    expect(ids[was.indexOf("logo") + 1]).toBe("logo");
  });
  it("reorders a variant-added layer within its diff's key order", () => {
    const m = moveLayers(lolevMaster(), ["collabCenter"], "collabCenter", -1);
    expect(Object.keys(collab(m).layers)).toEqual(["collabLead", "collabCenter", "collabLeft"]);
  });
  it("skips over override entries when reordering added layers", () => {
    const m = setLayerIn(lolevMaster(), "collab", "logo", { y: 120 });
    const moved = moveLayers(m, ["collabCenter"], "collabCenter", -1);
    expect(Object.keys(collab(moved).layers)).toEqual(["collabLead", "collabCenter", "collabLeft", "logo"]);
  });
  it("returns the master unchanged at either end", () => {
    const m = lolevMaster();
    expect(moveLayers(m, ["background"], "background", -1)).toBe(m);
    expect(moveLayers(m, ["collabCenter"], "collabCenter", 1)).toBe(m);
  });
});

describe("bindBelow / unbind", () => {
  it("binds a master layer below another and drops a stale vAnchor", () => {
    const m = bindBelow(setLayer(lolevMaster(), "abv", { vAnchor: "bottom" }), "abv", "volume", 3);
    const l = byId(m, "abv");
    expect(l.y).toEqual({ below: "volume", gap: 3 });
    expect(l.vAnchor).toBeUndefined();
  });
  it("to a cycle throws", () => {
    const m = bindBelow(lolevMaster(), "abv", "volume", 0);
    expect(() => bindBelow(m, "volume", "abv", 0)).toThrow(/cyclic/);
  });
  it("to a missing layer, or a master layer below a variant-only one, throws", () => {
    expect(() => bindBelow(lolevMaster(), "abv", "nope", 0)).toThrow(/missing layer "nope"/);
    expect(() => bindBelow(lolevMaster(), "logo", "collabLead", 0)).toThrow(/missing layer "collabLead"/);
  });
  it("unbind writes the passed y as the top edge", () => {
    const m = unbind(lolevMaster(), "collabLeft", 123.4);
    const l = collab(m).layers.collabLeft!;
    expect(l.y).toBe(123.4);
    expect(l.vAnchor).toBeUndefined();
    expect(() => parseMaster(m)).not.toThrow();
  });
});

describe("moveBy", () => {
  const nameLayer = () => byId<TextLayer>(lolevMaster(), "name");
  it("on a bound layer changes gap only, keeping the binding", () => {
    const l = { ...collab(lolevMaster()).layers.collabLeft } as ImageLayer;
    const patch = moveBy(l, 0, 5);
    const y = l.y as RelativeY;
    expect(patch).toEqual({ y: { below: "collabLead", gap: y.gap + 5 } });
  });
  it("moves x by dx and leaves the anchor alone", () => {
    // It used to adopt the nearest guide's anchor on every move, which flipped
    // a centred layer to left- or right-anchored partway across the page.
    // Snapping lives in snapDelta now (tests/model-group-drag.test.ts).
    const l: TextLayer = { ...nameLayer(), x: CENTER_X - 10, anchor: "left" };
    expect(moveBy(l, 8, 0)).toEqual({ x: CENTER_X - 2 });
    expect(moveBy(nameLayer(), 12, 0)).toEqual({ x: CENTER_X + 12 });
  });
  it("moves an unbound y by dy, bottom-anchored layers included", () => {
    // The shipped tops are derived from baselines (off the 0.01pt grid); a
    // move lands them on it, as typing the inspector's value back would.
    const onGrid = (v: number) => roundToStep(v, PT_STEP);
    expect(moveBy(nameLayer(), 0, -7)).toEqual({ y: onGrid((nameLayer().y as number) - 7) });
    const store = byId<TextLayer>(lolevMaster(), "storeCold");
    expect(store.vAnchor).toBe("bottom");
    expect(moveBy(store, 0, 2)).toEqual({ y: onGrid((store.y as number) + 2) });
  });
  it("returns an empty patch for a locked layer", () => {
    expect(moveBy(byId(lolevMaster(), "warning"), 5, 5)).toEqual({});
  });
  // #130: a pointer drag hands over raw float deltas, and the sum kept their
  // noise (x: 292.56 -> 193.08552000000003 in the Save Master review). Moves
  // land on the same 0.01pt grid the inspector types and nudges on.
  it("rounds a dragged position to 0.01pt (#130)", () => {
    const l: TextLayer = { ...nameLayer(), x: 292.56, y: 100, anchor: "left" };
    expect(moveBy(l, -99.47448, 147.52530452012383)).toEqual({ x: 193.09, y: 247.53 });
    const bound = { ...collab(lolevMaster()).layers.collabLeft } as ImageLayer;
    const gap = (bound.y as RelativeY).gap;
    expect(moveBy(bound, 0, 0.1 + 0.2)).toEqual({ y: { below: "collabLead", gap: roundToStep(gap + 0.3, PT_STEP) } });
  });
});

describe("variants", () => {
  it("toggleVariant appends on enable and removes on disable, preserving order", () => {
    const l = toggleVariant(toggleVariant(label(), "collab"), "seasonal");
    expect(l.enabledVariants).toEqual(["collab", "seasonal"]);
    expect(toggleVariant(l, "collab").enabledVariants).toEqual(["seasonal"]);
  });
  it("addVariant slugs the name and dedupes the id", () => {
    const a = addVariant(lolevMaster(), "Collab");
    expect(a.id).toBe("collab-2");
    expect(a.master.variants.at(-1)).toEqual({ id: "collab-2", name: "Collab", layers: {} });
    expect(addVariant(lolevMaster(), "Fall Seasonal!").id).toBe("fall-seasonal");
  });
  it("renameVariant and removeVariant", () => {
    const m = renameVariant(lolevMaster(), "collab", "Collaboration");
    expect(collab(m).name).toBe("Collaboration");
    expect(removeVariant(m, "collab").variants).toEqual([]);
    expect(() => renameVariant(m, "nope", "x")).toThrow(/nope/);
  });
});

describe("label values and overrides", () => {
  it("setValue / clearValue", () => {
    const l = setValue(label(), "name", [{ text: "Peregrine", fill: GOLD, layer: "metallic" }]);
    expect(l.values.name).toEqual([{ text: "Peregrine", fill: GOLD, layer: "metallic" }]);
    expect(clearValue(l, "name").values).toEqual({});
  });
  it("setLabelOverride deep-merges and clearLabelOverride prunes to no key", () => {
    const l = setLabelOverride(setLabelOverride(label(), "name", { style: { fill: "#112233" } }),
      "name", { size: 20 });
    expect(l.overrides).toEqual({ name: { style: { fill: "#112233" }, size: 20 } });
    const one = clearLabelOverride(l, "name", "style.fill");
    expect(one.overrides).toEqual({ name: { size: 20 } });
    expect("overrides" in clearLabelOverride(one, "name")).toBe(false);
  });
  it("never mutates the label", () => {
    const l = label({ values: { name: "x" }, overrides: { name: { size: 1 } } });
    setValue(l, "name", "y"); clearValue(l, "name");
    setLabelOverride(l, "name", { size: 2 }); clearLabelOverride(l, "name");
    toggleVariant(l, "collab");
    expect(l).toEqual(label({ values: { name: "x" }, overrides: { name: { size: 1 } } }));
  });
});

describe("masterDiff", () => {
  it("is false for an untouched master and true after any edit", () => {
    expect(masterDiff(lolevMaster(), lolevMaster())).toBe(false);
    expect(masterDiff(lolevMaster(), setLayer(lolevMaster(), "name", { size: 20 }))).toBe(true);
    expect(masterDiff(lolevMaster(), setLayer(lolevMaster(), "collabLead", { size: 20 }))).toBe(true);
  });
  it("ignores key order", () => {
    const m = lolevMaster();
    const spun = { ...m, layers: m.layers.map((l) => ({ ...l, y: l.y })) };
    expect(masterDiff(m, spun)).toBe(false);
  });
});

// --- App write-path helpers -------------------------------------------------
import { assetReferenced, labelOverriddenPaths, patchLayer, patchLayerIn, unsetLayerKeys } from "../src/model/edit";

describe("patchLayer (inspector write path)", () => {
  it("merges defined keys and DELETES own-property undefineds", () => {
    const m = lolevMaster();
    const w = patchLayer(m, "warning", { width: undefined, size: 9 });
    const l = w.layers.find((x) => x.id === "warning")!;
    expect(l.kind === "text" && l.size).toBe(9);
    expect("width" in l).toBe(false);
    // unchanged input
    expect("width" in m.layers.find((x) => x.id === "warning")!).toBe(true);
  });
  it("unsetLayerKeys reaches a variant-added layer's diff entry", () => {
    const m = unsetLayerKeys(lolevMaster(), "collabLeft", ["h"]);
    expect("h" in m.variants[0].layers.collabLeft).toBe(false);
  });
});

describe("labelOverriddenPaths / assetReferenced", () => {
  const label = { formatVersion: 3 as const, masterId: "lolev", enabledVariants: [], values: { collabLeft: "a1" },
    overrides: { name: { style: { fill: "#000000" as const }, x: 3 } } };
  it("flattens the label's overrides to leaf paths", () => {
    expect([...labelOverriddenPaths(label, "name")].sort()).toEqual(["style.fill", "x"]);
    expect(labelOverriddenPaths(label, "logo").size).toBe(0);
  });
  it("finds an asset in values, the master, a variant diff, or an override", () => {
    const m = lolevMaster();
    expect(assetReferenced(m, label, "a1")).toBe(true);
    expect(assetReferenced(m, label, "a2")).toBe(false);
    m.variants[0].layers.collabCenter = { ...m.variants[0].layers.collabCenter, asset: "a2" };
    expect(assetReferenced(m, label, "a2")).toBe(true);
    expect(assetReferenced(m, { ...label, overrides: { logo: { asset: "a3" } } }, "a3")).toBe(true);
  });
});

describe("validated inspector patches", () => {
  it("rejects disabling a binding target without changing the master", () => {
    const m = lolevMaster();
    expect(() => patchLayer(m, "description", { enabled: false })).toThrow(/disabled layer/);
    expect(byId(m, "description").enabled).toBe(true);
  });
  it("edits and clears variant overrides without changing master defaults", () => {
    const m = lolevMaster();
    const changed = patchLayerIn(m, "collab", "warning", { width: 200 });
    expect(collab(changed).layers.warning).toMatchObject({ width: 200 });
    expect(collab(m).layers.warning).toBeUndefined();
    const cleared = patchLayerIn(changed, "collab", "warning", { width: undefined });
    expect(collab(cleared).layers.warning).not.toHaveProperty("width");
    expect(collab(changed).layers.warning).toMatchObject({ width: 200 });
  });
});

it("dragging horizontally adjusts a guide offset without replacing the guide anchor", () => {
  const layer = { ...byId(lolevMaster(), "name"), guideX: "right" as const, x: -5 };
  expect(moveBy({ ...layer, locked: false }, 3, 0)).toEqual({ x: -2 });
});

import { bindingPatch, unbindPatch } from "../src/model/edit";

it("switches binding axes and detaches at the measured position", () => {
  const m = lolevMaster();
  const layer = collab(m).layers.collabLeft as ImageLayer;
  const box = { x: 30, y: 140, w: 40, h: 20 };
  const patch = bindingPatch(layer, "logo", "left", box);
  const changed = patchLayer(m, layer.id, patch);
  const bound = collab(changed).layers.collabLeft as ImageLayer;
  expect(bound).toMatchObject({ x: 30, y: 140, binding: { to: "logo", side: "left" } });
  const moved = { x: 80, y: 140, w: 40, h: 20 };
  expect(unbindPatch(bound, moved)).toEqual({ binding: null, x: 80, anchor: "left", guideX: "none" });
  expect(bindingPatch(bound, "logo", "top", moved)).toMatchObject({ x: 80, y: 140, binding: { to: "logo", side: "top" } });
});

// #130 regression sweep: Unbind writes the MEASURED box edge, which carries
// the same float noise a drag did.
it("detaches at the measured position on the 0.01pt grid", () => {
  const bound = { ...(collab(lolevMaster()).layers.collabLeft as ImageLayer), binding: { to: "logo", side: "left" as const, gap: 0 } };
  const box = { x: 80.12345678901, y: 140.00000000000003, w: 40, h: 20 };
  expect(unbindPatch(bound, box)).toMatchObject({ x: 80.12 });
  expect(bindingPatch(bound, "logo", "top", box)).toMatchObject({ x: 80.12, y: 140 });
});

it.each(["top", "left", "right", "bottom"] as const)("dragging a %s binding edits its signed gap and preserves the free axis", (side) => {
  const l = { ...byId(lolevMaster(), "volume"), binding: { to: "logo", side, gap: 10 }, locked: false };
  const patch = moveBy(l, 3, 4);
  expect(patch.binding).toEqual({ to: "logo", side, gap: ({ top: 6, left: 7, right: 13, bottom: 14 })[side] });
  if (side === "top" || side === "bottom") expect(patch).not.toHaveProperty("y");
  else expect(patch).toMatchObject({ y: (l.y as number) + 4 });
});

it("deleting a binding target detaches its dependent at its measured position", () => {
  const m = lolevMaster();
  const changed = patchLayer(m, "name", { binding: { to: "volume", side: "right", gap: 4 } });
  const boxes = new Map([["name", { x: 123, y: 45, w: 80, h: 20 }]]);
  const removed = removeLayer(changed, "volume", boxes);
  expect(byId(removed, "name")).toMatchObject({ x: 123, binding: null, anchor: "left" });
  expect(() => parseMaster(removed)).not.toThrow();
  expect(() => removeLayer(changed, "volume")).toThrow(/without the position/);
  expect(byId(changed, "name").binding).not.toBeNull();
});

import { resizeBy, type ResizeHandle } from "../src/model/edit";
describe("resizeBy", () => {
  const box = { w: 100, h: 50 };
  const BR: ResizeHandle = { hx: 1, hy: 1 }, TL: ResizeHandle = { hx: -1, hy: -1 };
  const L: ResizeHandle = { hx: -1, hy: 0 }, B: ResizeHandle = { hx: 0, hy: 1 };
  const img = () => ({ ...byId<ImageLayer>(lolevMaster(), "logo"), w: 40, h: 20, x: 300, y: 100, anchor: "left" as const, guideY: undefined, vAnchor: undefined });
  it("text changes wrap width only; vertical handles do nothing", () => {
    const t = { ...byId<TextLayer>(lolevMaster(), "description"), width: 200 };
    expect(resizeBy(t, box, BR, 10, 30, false)).toEqual({ width: 210 });
    expect(resizeBy({ ...t, width: undefined }, box, BR, 10, 30, false)).toEqual({ width: 110 });
    expect(resizeBy(t, box, B, 10, 30, false)).toEqual({});
  });
  it("a rotated text layer takes the page's vertical delta as its width", () => {
    const t = byId<TextLayer>(lolevMaster(), "warning");
    expect(t.rotation).toBe(90);
    // Bottom-anchored: y IS the bottom edge, so it follows the grabbed edge.
    expect(resizeBy({ ...t, locked: false, width: 200 }, { w: 20, h: 300 }, BR, 5, 30, false)).toEqual({ width: 230, y: (t.y as number) + 30 });
  });
  it("image stretches freely, shift keeps it uniform, no h keeps aspect", () => {
    expect(resizeBy(img(), box, BR, 100, 0, false)).toEqual({ w: 80, h: 20 });
    expect(resizeBy(img(), box, BR, 100, 0, true)).toEqual({ w: 80, h: 40 });
    expect(resizeBy({ ...img(), h: undefined }, box, B, 0, 50, false)).toEqual({ w: 80 });
  });
  it("qr is always uniform; barcode scales bars and modules", () => {
    const q = byId<QrLayer>(lolevMaster(), "qr");
    expect(resizeBy({ ...q, size: 30, anchor: "left", vAnchor: undefined, guideY: undefined }, box, BR, 50, 0, false)).toEqual({ size: 45 });
    const b = { ...byId<BarcodeLayer>(lolevMaster(), "barcode"), h: 40, moduleW: 1, rotation: 0 as const, vAnchor: undefined };
    expect(resizeBy(b, box, BR, 100, 50, false)).toEqual({ h: 80, moduleW: 2 });
  });
  it("rounds the position and size a resize writes to 0.01pt (#130)", () => {
    expect(resizeBy({ ...img(), x: 292.56 }, box, L, 20.123456789, 0, false)).toEqual({ x: 312.68, w: 31.95, h: 20 });
  });
  it("the opposite edge stays put from any handle, per anchor", () => {
    // Left handle dragged 20pt right: box shrinks by 20 and its left edge moves right.
    expect(resizeBy(img(), box, L, 20, 0, false)).toEqual({ w: 32, h: 20, x: 320 });
    expect(resizeBy({ ...img(), anchor: "center" }, box, L, 20, 0, false)).toEqual({ w: 32, h: 20, x: 310 });
    expect(resizeBy({ ...img(), anchor: "right" }, box, L, 20, 0, false)).toEqual({ w: 32, h: 20 });
    // Top-left corner, bottom-anchored: y (the bottom edge) never moves.
    expect(resizeBy({ ...img(), vAnchor: "bottom" }, box, TL, -10, -10, false)).toEqual({ w: 44, h: 24, x: 290 });
    expect(resizeBy(img(), box, TL, -10, -10, false)).toEqual({ w: 44, h: 24, x: 290, y: 90 });
  });
  // place.ts positions x with `guideX ?? anchor`, so the compensation has to
  // read the guide too — the y half always did (vAnchorOf).
  it("reads the guide before the raw anchor, on both axes", () => {
    const right = { ...img(), guideX: "right" as const };
    expect(resizeBy(right, box, L, 20, 0, false)).toEqual({ w: 32, h: 20 });
    const centre = { ...img(), guideX: "center" as const };
    expect(resizeBy(centre, box, L, 20, 0, false)).toEqual({ w: 32, h: 20, x: 310 });
    // "none" is not a guide: the raw anchor still decides.
    expect(resizeBy({ ...img(), guideX: "none" as const }, box, L, 20, 0, false))
      .toEqual({ w: 32, h: 20, x: 320 });
  });

  it("a bound axis sizes but keeps its binding", () => {
    const l = { ...img(), binding: { to: "name", side: "right" as const, gap: 4 } };
    expect(resizeBy(l, box, L, 20, 0, false)).toEqual({ w: 32, h: 20 });
  });
  it("locked layers and empty boxes return {}", () => {
    expect(resizeBy(byId(lolevMaster(), "warning"), box, BR, 5, 5, false)).toEqual({});
    expect(resizeBy(byId(lolevMaster(), "qr"), { w: 0, h: 0 }, BR, 5, 5, false)).toEqual({});
  });
});

describe("structureOnlyMaster", () => {
  it("keeps layer ids and positions, drops fillable text and raster assets", () => {
    const filled = lolevMaster();
    const name = byId<TextLayer>(filled, "name");
    name.lines = [{ ...name.lines[0], text: "Old Beer" }];
    byId<ImageLayer>(filled, "background").asset = "custom-rock";
    const collabLeft = collab(filled).layers.collabLeft as ImageLayer;
    collab(filled).layers.collabLeft = { ...collabLeft, asset: "custom-logo" };
    const next = structureOnlyMaster(filled);
    expect(next).not.toBe(filled);
    expect(byId<TextLayer>(filled, "name").lines[0].text).toBe("Old Beer");
    const stripped = byId<TextLayer>(next, "name");
    expect(stripped.lines[0].text).toBe("");
    expect(stripped.x).toBe(name.x);
    expect(stripped.y).toBe(name.y);
    expect(stripped.size).toBe(name.size);
    expect(byId<ImageLayer>(next, "background").asset).toBe("");
    expect(byId<ImageLayer>(next, "logo").asset).toBe("builtin:logo");
    expect(byId<TextLayer>(next, "volume").lines[0].text).toBe("1 PINT");
    expect((collab(next).layers.collabLeft as ImageLayer).asset).toBe("");
  });

  it("a kind+placeholder variant patch without lines does not throw", () => {
    const filled = lolevMaster();
    collab(filled).layers.name = { kind: "text", placeholder: "Name", x: 12 };
    const next = structureOnlyMaster(filled);
    expect(collab(next).layers.name).toMatchObject({
      kind: "text", placeholder: "Name", x: 12,
    });
  });

  it("a kind-less lines override of a fillable master layer is cleared", () => {
    const filled = lolevMaster();
    collab(filled).layers.name = { lines: [{ text: "Old Beer", fill: "#F3CD80", layer: "metallic" }] };
    collab(filled).layers.wordmark = { lines: [{ text: "Collab Brand", fill: "#F3CD80", layer: "metallic" }] };
    const next = structureOnlyMaster(filled);
    expect((collab(next).layers.name as { lines: { text: string }[] }).lines[0].text).toBe("");
    expect((collab(next).layers.wordmark as { lines: { text: string }[] }).lines[0].text)
      .toBe("Collab Brand");
  });
});

// Issue #98: removing a layer must not move the layers bound below it. The
// dependent takes the vacated slot, i.e. its top lands where the removed
// layer's top WAS — whatever guide or vertical anchor placed it there.
describe("removeLayer keeps a bound dependent where the removed layer sat", () => {
  const sizeOf = (l: Layer) => ({ w: 100, h: l.id === "description" ? 29 : 12 });
  const boxesOf = (m: Master) =>
    placeLayers(resolveLayers(m, ["collab"], {}, undefined, { keepDisabled: true }).layers, sizeOf, guides);
  it.each([
    ["a top-guide", { guideY: "top", y: 10 }],
    ["a bottom-anchored", { y: 150, vAnchor: "bottom" }],
  ] as const)("old-style `below` dependent of %s layer", (_, pos) => {
    const m = setLayer(lolevMaster(), "description", pos as Partial<Layer>);
    const before = boxesOf(m);
    const after = boxesOf(removeLayer(m, "description", before));
    expect(after.get("collabLead")!.y).toBeCloseTo(before.get("description")!.y);
  });
  it("old-style `below` dependent of a layer placed by a new-style binding", () => {
    const m = setLayer(lolevMaster(), "description", { binding: { to: "name", side: "bottom", gap: 5 } });
    const before = boxesOf(m);
    const removed = removeLayer(m, "description", before);
    expect(boxesOf(removed).get("collabLead")!.y).toBeCloseTo(before.get("description")!.y);
    expect(() => parseMaster(removed)).not.toThrow();
  });
  it("a chained `below` dependent keeps its binding", () => {
    const m = lolevMaster();
    const removed = removeLayer(m, "collabLead", boxesOf(m));
    expect(collab(removed).layers.collabLeft!.y).toEqual(collab(m).layers.collabLead!.y);
  });
});

// Issue #220: a binding made in the inspector lives in the LABEL's overrides
// until Save Master promotes it. Removing its target must detach it there
// too, or the label keeps a binding to a missing layer (the edit is refused)
// or its override `y` snaps the dependent back to where it sat at bind time.
describe("removeLayerIn detaches label-override bindings to the removed layer", () => {
  const sizeOf = (l: Layer) => ({ w: 100, h: l.id === "logo" ? 40 : 12 });
  const boxesOf = (d: Doc) => placeLayers(resolveLayers(d.master, d.label.enabledVariants, {},
    d.label.overrides, { keepDisabled: true }).layers, sizeOf, guides);
  const boundToLogo = (d: Doc) =>
    patchLayers(d, [["volume", bindingPatch(byId(d.master, "volume"), "logo", "bottom", boxesOf(d).get("volume")!)]]);

  const labelOnly = (): Doc => boundToLogo({ master: lolevMaster(), label: label() });
  /** Save Master promoted the binding alone; its y/vAnchor/guideY stayed. */
  const promoted = (): Doc => {
    const bound = labelOnly();
    const { binding, ...position } = bound.label.overrides!.volume;
    return {
      master: setLayer(bound.master, "volume", { binding: binding as Layer["binding"] }),
      label: { ...bound.label, overrides: { volume: position } },
    };
  };
  it.each([["a label-only binding", labelOnly], ["a promoted binding", promoted]])("%s", (_, make) => {
    const d = make();
    const before = boxesOf(d);
    const after = removeLayerIn(d, "logo", before);
    expect(() => checkLabelBindings(after)).not.toThrow();
    expect(boxesOf(after).get("volume")!.y).toBeCloseTo(before.get("volume")!.y);
  });
  it("a label-only binding on a layer of a switched-off version", () => {
    const on: Doc = { master: lolevMaster(), label: label({ enabledVariants: ["collab"] }) };
    const boxes = boxesOf(on);
    const bound = patchLayers(on, [["collabLeft",
      bindingPatch(collab(on.master).layers.collabLeft as Layer, "logo", "bottom", boxes.get("collabLeft")!)]]);
    const off: Doc = { ...bound, label: { ...bound.label, enabledVariants: [] } };
    // Unmeasured, it is refused like a master binding would be, not left dangling.
    expect(() => removeLayerIn(off, "logo", boxesOf(off))).toThrow(/collabLeft/);
    const after = removeLayerIn(off, "logo", boxes);
    expect(() => checkLabelBindings({ ...after, label: { ...after.label, enabledVariants: ["collab"] } })).not.toThrow();
  });
  it("leaves an override that holds no position key alone", () => {
    const m = setLayer(lolevMaster(), "volume", { binding: { to: "logo", side: "bottom", gap: 0 } });
    const d: Doc = { master: m, label: label({ overrides: { volume: { size: 11 } } }) };
    expect(removeLayerIn(d, "logo", boxesOf(d)).label.overrides).toEqual({ volume: { size: 11 } });
  });
});

// Deleting a VERSION removes the layers it adds, so a label-override binding
// to one of them (bound in the inspector while the version was on) must be
// detached like a deleted layer's (#220), not left dangling — the delete was
// refused with "bound to missing layer".
describe("removeVariantIn detaches label bindings to the layers the version adds", () => {
  const sizeOf = (l: Layer) => ({ w: 100, h: l.id === "collabLead" ? 32 : 12 });
  const boxesOf = (d: Doc) => placeLayers(resolveLayers(d.master, d.label.enabledVariants, {},
    d.label.overrides, { keepDisabled: true }).layers, sizeOf, guides);
  it("the delete goes through and the bound layer stays where it was", () => {
    const on: Doc = { master: lolevMaster(), label: label({ enabledVariants: ["collab"] }) };
    const d = patchLayers(on, [["volume",
      bindingPatch(byId(on.master, "volume"), "collabLead", "bottom", boxesOf(on).get("volume")!)]]);
    const before = boxesOf(d);
    const after = removeVariantIn(d, "collab", before);
    expect(after.master.variants.map((v) => v.id)).not.toContain("collab");
    const shown = { ...after, label: { ...after.label, enabledVariants: [] } };
    expect(() => checkLabelBindings(shown)).not.toThrow();
    expect(boxesOf(shown).get("volume")!.y).toBeCloseTo(before.get("volume")!.y);
  });
  it("a switched-off version whose own layers bind to each other deletes unmeasured", () => {
    const { master: m1, id: v } = addVariant(lolevMaster(), "Extra");
    const { master: m2, id: a } = addLayer(m1, "text", { variant: v });
    const { master: m3, id: b } = addLayer(m2, "text", { variant: v });
    const m = setLayer(m3, b, { binding: { to: a, side: "bottom", gap: 0 } });
    const d: Doc = { master: m, label: label() };
    expect(removeVariantIn(d, v).master.variants.map((x) => x.id)).toEqual(["collab"]);
  });
  it("so does one that binds a master layer to its own layer", () => {
    const m = { ...lolevMaster(), variants: lolevMaster().variants.map((v) => ({ ...v,
      layers: { ...v.layers, volume: { binding: { to: "collabLead", side: "bottom" as const, gap: 0 } } } })) };
    expect(removeVariantIn({ master: m, label: label() }, "collab").master.variants).toEqual([]);
  });
  it("so does one whose layers are bound to each other only on the label", () => {
    const { master: m1, id: v } = addVariant(lolevMaster(), "Extra");
    const { master: m2, id: a } = addLayer(m1, "text", { variant: v });
    const { master: m, id: b } = addLayer(m2, "text", { variant: v });
    const on: Doc = { master: m, label: label({ enabledVariants: [v] }) };
    const bound = patchLayers(on, [[b, bindingPatch(m.variants[1].layers[b] as Layer, a, "bottom", boxesOf(on).get(b)!)]]);
    const off: Doc = { ...bound, label: { ...bound.label, enabledVariants: [] } };
    expect(removeVariantIn(off, v).label.overrides).toEqual({});
  });
  it("drops only the deleted version from the label's shown versions", () => {
    const { master: m, id: v } = addVariant(lolevMaster(), "Extra");
    const d: Doc = { master: m, label: label({ enabledVariants: [v, "collab"] }) };
    expect(removeVariantIn(d, v).label.enabledVariants).toEqual(["collab"]);
    expect(removeVariantIn(d, "collab").label.enabledVariants).toEqual([v]);
  });
});
