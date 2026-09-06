// app-edit-routing.test.ts — the master/label split (docs/plans/
// label-first-editing.md, Phase A). Every property edit lands in the LABEL as
// an override and the master stays identical to the template; content lands in
// label.values for ANY layer, with no `fillable` gate. The routing is a pure
// model function (edit.ts's patchLayers / setContentIn) so it can be tested
// without mounting App — App's `patch` / `patchMany` / `setContent` are thin
// wrappers over it.
import { describe, expect, it } from "vitest";
import {
  adoptMaster, addVariant, overrideBadges, patchLayers, setContentIn, setLabelOverride,
  setLayerIn, type Doc,
} from "../src/model/edit";
import { lolevMaster } from "../src/model/lolevLayers";
import { resolveLayers } from "../src/model/resolveLayers";
import type { LabelFile, Master, TextLayer } from "../src/model/layers";
import { GOLD } from "../src/layout";

const line = (text: string) => ({ text, fill: GOLD, layer: "metallic" } as const);
const newLabel = (master: Master): LabelFile =>
  ({ formatVersion: 3, masterId: master.id, enabledVariants: [], values: {} });
const doc = (): Doc => { const m = lolevMaster(); return { master: m, label: newLabel(m) }; };
const byId = <T = unknown>(d: Doc, id: string) =>
  resolveLayers(d.master, d.label.enabledVariants, d.label.values, d.label.overrides,
    { keepDisabled: true }).layers.find((l) => l.id === id) as T;

describe("property patches route to the label", () => {
  it("a position patch leaves the master identical to the template", () => {
    const d = patchLayers(doc(), [["name", { x: 300 }]]);
    expect(d.master).toEqual(lolevMaster());
    expect(d.label.overrides?.name).toEqual({ x: 300 });
    expect(byId<TextLayer>(d, "name").x).toBe(300);
  });

  it("patches several layers in one edit and merges into an existing override", () => {
    let d = patchLayers(doc(), [["name", { x: 300 }], ["styleLine", { size: 20 }]]);
    d = patchLayers(d, [["name", { y: 12 }]]);
    expect(d.master).toEqual(lolevMaster());
    expect(d.label.overrides?.name).toEqual({ x: 300, y: 12 });
    expect(d.label.overrides?.styleLine).toEqual({ size: 20 });
  });

  it("a nested style patch merges without dropping the master's other style keys", () => {
    const d = patchLayers(doc(), [["name", { style: { fill: "#FF0000" } }]]);
    const master = lolevMaster().layers.find((l) => l.id === "name") as TextLayer;
    expect(d.master).toEqual(lolevMaster());
    expect(byId<TextLayer>(d, "name").style)
      .toEqual({ ...master.style, fill: "#FF0000" });
  });

  it("clears an optional field the master set — the inspector's `undefined` rule", () => {
    // The master gives the description a wrap width; the label sets it back to
    // "none". `undefined` cannot survive JSON, so the override stores null and
    // the resolver treats null as "unset this key".
    const base = doc();
    base.master = {
      ...base.master,
      layers: base.master.layers.map((l) => (l.id === "description" ? { ...l, width: 200 } : l)),
    };
    const d = patchLayers(base, [["description", { width: undefined }]]);
    expect(d.label.overrides?.description).toEqual({ width: null });
    expect(byId<TextLayer>(d, "description").width).toBeUndefined();
    expect(JSON.parse(JSON.stringify(d.label)).overrides.description).toEqual({ width: null });
  });

  it("enabling a variant-owned layer switches its variant on, in the label", () => {
    const d = patchLayers(doc(), [["collabLeft", { enabled: true }]]);
    expect(d.label.enabledVariants).toContain("collab");
    expect(d.master).toEqual(lolevMaster());
  });

  // The working version is the LAST enabled variant (App reads it off the
  // label), so appending here silently retargeted the master Select and the
  // next save's promotions at a variant the user only switched a layer on in.
  it("enables that variant BENEATH the working version, leaving the target put", () => {
    const { master: m, id: winter } = addVariant(lolevMaster(), "Winter");
    const d = patchLayers(
      { master: m, label: { ...newLabel(m), enabledVariants: [winter] } },
      [["collabLeft", { enabled: true }]]);
    expect(d.label.enabledVariants).toEqual(["collab", winter]);
    expect(d.label.enabledVariants.at(-1)).toBe(winter);
  });

  it("ignores a design patch on a layer only a DISABLED variant adds", () => {
    const before = doc();
    const after = patchLayers(before, [["collabLeft", { locked: true }]]);
    expect(after).toBe(before);
  });

  it("still overrides that layer once its variant is on", () => {
    const on = patchLayers(doc(), [["collabLeft", { enabled: true }]]);
    const d = patchLayers(on, [["collabLeft", { locked: true }]]);
    expect(d.label.overrides?.collabLeft).toMatchObject({ locked: true });
  });
});

describe("the fill contract routes to the master", () => {
  it("a placeholder edit writes the master, not an override", () => {
    const d = patchLayers(doc(), [["name", { placeholder: "Beer name" }]]);
    expect(d.label.overrides).toBeUndefined();
    expect((d.master.layers.find((l) => l.id === "name") as TextLayer).placeholder)
      .toBe("Beer name");
  });

  it("every fill-contract field takes the master path", () => {
    let d = doc();
    for (const p of [{ input: "number" as const }, { min: 1 }, { max: 9 },
      { suffix: "% abv" }, { symbology: "ean-13" as const }, { placeholder: "x" }]) {
      d = patchLayers(d, [["abv", p]]);
    }
    expect(d.label.overrides).toBeUndefined();
    const abv = d.master.layers.find((l) => l.id === "abv") as TextLayer;
    expect([abv.input, abv.min, abv.max, abv.suffix, abv.symbology, abv.placeholder])
      .toEqual(["number", 1, 9, "% abv", "ean-13", "x"]);
  });

  it("splits a mixed patch: contract to the master, the rest to the label", () => {
    const d = patchLayers(doc(), [["name", { placeholder: "Beer name", x: 300 }]]);
    expect((d.master.layers.find((l) => l.id === "name") as TextLayer).placeholder)
      .toBe("Beer name");
    expect(d.label.overrides?.name).toEqual({ x: 300 });
  });
});

describe("content routes to the label for any layer", () => {
  it("fills a layer the master never marked fillable", () => {
    const d = setContentIn(doc(), "warning", [line("Drink responsibly")]);
    expect(d.master).toEqual(lolevMaster());
    expect(d.label.values.warning).toEqual([line("Drink responsibly")]);
    expect(byId<TextLayer>(d, "warning").lines).toEqual([line("Drink responsibly")]);
  });

  it("fills a code layer's value into the label, and teaches the master the code", () => {
    // The barcode ships a tier vocabulary, so a UPC nobody listed joins it —
    // the ONE thing a content edit writes to the master, and the Save Master
    // review is what stands between it and the file (Task 4 of
    // docs/plans/choice-input.md). Everything else about the master is
    // untouched, which is what this file is really guarding.
    const d = setContentIn(doc(), "barcode", "036000291452");
    expect(d.label.values.barcode).toBe("036000291452");
    const before = lolevMaster();
    const learned = (id: string, m: Master) =>
      (m.layers.find((l) => l.id === id) as { choices?: unknown[] }).choices;
    expect(learned("barcode", d.master)).toEqual([
      ...(learned("barcode", before) as unknown[]), { value: "036000291452" },
    ]);
    expect({ ...d.master, layers: undefined }).toEqual({ ...before, layers: undefined });
  });
});

// docs/plans/choice-input.md, Task 3. The vocabulary and the caption declare
// what a filler may put in a layer, which is the fill contract's own
// definition — so they route to the master like placeholder and symbology,
// not into this label's overrides.
describe("the vocabulary is part of the fill contract", () => {
  const choices = [{ value: "Ultra Hopped Ale" }, { title: "Tier 1", value: "8500" }];

  it("routes choices and title to the master", () => {
    const d = patchLayers(doc(), [["styleLine", { choices, title: "Style" }]]);
    expect(d.label.overrides).toBeUndefined();
    const layer = d.master.layers.find((l) => l.id === "styleLine") as
      { choices?: unknown; title?: string };
    expect(layer.choices).toEqual(choices);
    expect(layer.title).toBe("Style");
  });

  it("splits a patch that carries a vocabulary and a nudge", () => {
    const d = patchLayers(doc(), [["styleLine", { choices, x: 300 }]]);
    expect(d.label.overrides?.styleLine).toEqual({ x: 300 });
    expect((d.master.layers.find((l) => l.id === "styleLine") as { choices?: unknown }).choices)
      .toEqual(choices);
  });
});

// --- Reset badges, split by source ------------------------------------------
// The inspector shows two kinds of badge and they must stay apart: a `variant`
// path lives in the master file and belongs to every label with that variant
// on; a `label` path is this label's alone. A variant-ADDED layer has no
// variant-vs-master baseline to diff, but a label can still override it, and
// that override needs its reset badge like any other.
describe("overrideBadges", () => {
  const collabOn = (m: Master): LabelFile => ({ ...newLabel(m), enabledVariants: ["collab"] });

  it("reports the label's own overrides on a variant-added layer", () => {
    const m = lolevMaster();
    const label = setLabelOverride(collabOn(m), "collabCenter", { x: 120 });
    const b = overrideBadges(m, label, "collabCenter");
    expect([...b.label]).toEqual(["x"]);
    expect([...b.variant]).toEqual([]);
    expect(b.variantName).toBeUndefined();
  });

  it("still splits variant and label paths on a master layer", () => {
    const m = setLayerIn(lolevMaster(), "collab", "name", { x: 222 });
    const label = setLabelOverride(collabOn(m), "name", { y: 9 });
    const b = overrideBadges(m, label, "name");
    expect([...b.variant]).toEqual(["x"]);
    expect([...b.label]).toEqual(["y"]);
    expect(b.variantName).toBe("Collab");
  });

  it("ignores a variant that is not switched on", () => {
    const m = setLayerIn(lolevMaster(), "collab", "name", { x: 222 });
    const b = overrideBadges(m, newLabel(m), "name");
    expect([...b.variant]).toEqual([]);
  });
});

// --- Save Master As forks, and the document must follow ---------------------
describe("adoptMaster", () => {
  it("rebinds the label onto a forked master's new id", () => {
    const m = lolevMaster();
    const forked = { ...m, id: "master-fork1" };
    expect(adoptMaster(newLabel(m), forked).masterId).toBe("master-fork1");
  });

  it("returns the same label object when the id already matches", () => {
    const m = lolevMaster();
    const label = newLabel(m);
    expect(adoptMaster(label, m)).toBe(label);
  });
});
