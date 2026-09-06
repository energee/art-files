// app-edit-routing.test.ts — the master/label split (docs/plans/
// label-first-editing.md, Phase A). Every property edit lands in the LABEL as
// an override and the master stays identical to the template; content lands in
// label.values for ANY layer, with no `fillable` gate. The routing is a pure
// model function (edit.ts's patchLayers / setContentIn) so it can be tested
// without mounting App — App's `patch` / `patchMany` / `setContent` are thin
// wrappers over it.
import { describe, expect, it } from "vitest";
import { patchLayers, setContentIn, type Doc } from "../src/model/edit";
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

// Task 4 of docs/plans/template-switch.md: a third `target` argument sends
// the whole patch — contract or not — to the master (base or a variant's
// diff) instead of splitting it between master and label.
describe("patchLayers takes a target", () => {
  it("\"master\" on a base layer writes master.layers and leaves the label untouched, by identity", () => {
    const base = doc();
    const d = patchLayers(base, [["name", { x: 5 }]], "master");
    expect((d.master.layers.find((l) => l.id === "name") as TextLayer).x).toBe(5);
    expect(d.label.overrides).toBeUndefined();
    expect(d.label).toBe(base.label);
  });

  it("\"master\" on a variant-added layer writes that variant's diff, not the base", () => {
    const d = patchLayers(doc(), [["collabLeft", { x: 5 }]], "master");
    expect(d.master.variants.find((v) => v.id === "collab")!.layers.collabLeft).toMatchObject({ x: 5 });
    expect(d.master.layers.some((l) => l.id === "collabLeft")).toBe(false);
    expect(d.label.overrides).toBeUndefined();
  });

  it("\"master\" leaves an unknown id untouched", () => {
    const base = doc();
    const d = patchLayers(base, [["not-a-layer", { x: 5 }]], "master");
    expect(d.master).toEqual(base.master);
    expect(d.label).toBe(base.label);
  });

  it("\"master\" on a mixed patch writes both keys to the base layer", () => {
    const d = patchLayers(doc(), [["name", { x: 5, placeholder: "p" }]], "master");
    const name = d.master.layers.find((l) => l.id === "name") as TextLayer;
    expect(name.x).toBe(5);
    expect(name.placeholder).toBe("p");
    expect(d.label.overrides).toBeUndefined();
  });

  it("{ variant } on a base layer writes the variant's diff and leaves the base and label untouched", () => {
    const base = doc();
    const d = patchLayers(base, [["name", { x: 5 }]], { variant: "collab" });
    expect(d.master.variants.find((v) => v.id === "collab")!.layers.name).toMatchObject({ x: 5 });
    expect(d.master.layers.find((l) => l.id === "name")).toEqual(base.master.layers.find((l) => l.id === "name"));
    expect(d.label).toBe(base.label);
  });

  it("\"label\" behaves exactly as it does today", () => {
    const d = patchLayers(doc(), [["name", { x: 300 }]], "label");
    expect(d.master).toEqual(lolevMaster());
    expect(d.label.overrides?.name).toEqual({ x: 300 });
  });
});
