// model-master-changes.test.ts — the itemised master diff behind the Save
// Master review (docs/plans/label-first-editing.md, Task 6). `masterChanges`
// answers "what is this save about to write?": the structural and fill-contract
// edits already sitting in the edited master, plus the label's own overrides
// offered for PROMOTION into the template. Pure — the dialog does the rendering.
import { describe, expect, it } from "vitest";
import { applyPromotions, masterChanges, showVersion, addLayer, addVariant, removeVariant, renameVariant, setLayerIn, moveLayers, patchLayer, removeLayer, setLabelOverride } from "../src/model/edit";
import { lolevMaster } from "../src/model/lolevLayers";
import { resolveLayers } from "../src/model/resolveLayers";
import type { LabelFile, Master } from "../src/model/layers";

const newLabel = (master: Master): LabelFile =>
  ({ formatVersion: 3, masterId: master.id, enabledVariants: [], values: {} });

describe("masterChanges", () => {
  it("an untouched master with a clean label yields nothing", () => {
    const m = lolevMaster();
    expect(masterChanges(m, m, newLabel(m))).toEqual([]);
  });

  it("reports a rename and a property edit as two entries", () => {
    const base = lolevMaster();
    const was = base.layers.find((l) => l.id === "name") as { name: string };
    let edited = patchLayer(base, "name", { name: "Beer name" });
    edited = patchLayer(edited, "styleLine", { x: 42 });
    expect(masterChanges(base, edited, newLabel(base))).toEqual([
      { kind: "renamed", layerId: "name", layerName: "Beer name", from: was.name, to: "Beer name" },
      { kind: "property", layerId: "styleLine", layerName: "Style", path: "x",
        from: (base.layers.find((l) => l.id === "styleLine") as { x: number }).x, to: 42 },
    ]);
  });

  it("reports an added, a removed and a reordered layer", () => {
    const base = lolevMaster();
    const added = addLayer(base, "text");
    const edited = removeLayer(added.master, "styleLine");
    const kinds = masterChanges(base, edited, newLabel(base)).map((c) => `${c.kind}:${c.layerId}`);
    expect(kinds).toContain(`added:${added.id}`);
    expect(kinds).toContain("removed:styleLine");

    const moved = moveLayers(base, ["name"], "name", 1);
    expect(masterChanges(base, moved, newLabel(base)).some((c) => c.kind === "moved")).toBe(true);
  });

  it("offers each label override as a promote entry, with the master's current value", () => {
    const base = lolevMaster();
    const label = setLabelOverride(newLabel(base), "name", { x: 300, style: { fill: "#FF0000" } });
    const cur = base.layers.find((l) => l.id === "name") as { name: string; x: number; style: { fill: string } };
    expect(masterChanges(base, base, label)).toEqual([
      { kind: "promote", layerId: "name", layerName: cur.name, path: "x", from: cur.x, to: 300 },
      { kind: "promote", layerId: "name", layerName: cur.name, path: "style.fill",
        from: cur.style.fill, to: "#FF0000" },
    ]);
  });

  it("skips an override that already matches the master", () => {
    const base = lolevMaster();
    const cur = base.layers.find((l) => l.id === "name") as { x: number };
    const label = setLabelOverride(newLabel(base), "name", { x: cur.x });
    expect(masterChanges(base, base, label)).toEqual([]);
  });

  it("ignores an override for a layer the master no longer has", () => {
    const base = lolevMaster();
    const label = setLabelOverride(newLabel(base), "ghost", { x: 1 });
    expect(masterChanges(base, base, label)).toEqual([]);
  });
});

describe("applyPromotions", () => {
  it("writes exactly the promoted paths into the master and drops them from the label", () => {
    const base = lolevMaster();
    const label = setLabelOverride(newLabel(base), "name", { x: 300, style: { fill: "#FF0000" } });
    const promote = masterChanges(base, base, label).filter((c) => c.path === "x");
    const r = applyPromotions(base, label, promote);
    expect((r.master.layers.find((l) => l.id === "name") as { x: number }).x).toBe(300);
    // The unpromoted one stays the label's own.
    expect(r.label.overrides?.name).toEqual({ style: { fill: "#FF0000" } });
  });

  it("drops the overrides key entirely once nothing is left", () => {
    const base = lolevMaster();
    const label = setLabelOverride(newLabel(base), "name", { x: 300 });
    const r = applyPromotions(base, label, masterChanges(base, base, label));
    expect(r.label.overrides).toBeUndefined();
  });

  it("promoting nothing changes nothing", () => {
    const base = lolevMaster();
    const label = setLabelOverride(newLabel(base), "name", { x: 300 });
    const r = applyPromotions(base, label, []);
    expect(r.master).toEqual(base);
    expect(r.label).toEqual(label);
  });
});

// --- Task 12: promotion targets the version you switched to ----------------
// Enabling a variant means "show me this version". CHANGING it means switching
// to it, which is a separate, explicit act — so promotion defaults to the base
// master and only writes a variant while that variant is the working version.
describe("a variant as the promotion target", () => {
  const collabOn = (base: Master): LabelFile =>
    ({ ...newLabel(base), enabledVariants: ["collab"] });

  it("compares a promote row against the version it targets, not the base", () => {
    // The shipped Collab variant only ADDS layers, so give it an override of
    // a master layer to have two baselines to tell apart.
    const base = setLayerIn(lolevMaster(), "collab", "name", { x: 222 });
    const label = setLabelOverride(collabOn(base), "name", { x: 999 });
    const from = (c: { from?: unknown }) => c.from;
    expect(masterChanges(base, base, label).map(from))
      .toEqual([(lolevMaster().layers.find((l) => l.id === "name") as { x: number }).x]);
    expect(masterChanges(base, base, label, "collab").map(from)).toEqual([222]);
  });

  it("writes a promotion into the variant's diff, leaving the base master alone", () => {
    const base = lolevMaster();
    const label = setLabelOverride(collabOn(base), "name", { x: 300 });
    const promote = masterChanges(base, base, label, "collab");
    const r = applyPromotions(base, label, promote, "collab");
    expect(r.master.layers).toEqual(base.layers);
    expect((r.master.variants.find((v) => v.id === "collab")!.layers.name as { x: number }).x).toBe(300);
    expect(r.label.overrides).toBeUndefined();
  });

  it("writes into the base master when no version is switched to", () => {
    const base = lolevMaster();
    const label = setLabelOverride(collabOn(base), "name", { x: 300 });
    const r = applyPromotions(base, label, masterChanges(base, base, label), undefined);
    expect((r.master.layers.find((l) => l.id === "name") as { x: number }).x).toBe(300);
    expect(r.master.variants).toEqual(base.variants);
  });
});

// The review is the ONLY thing between an edit and the template, and
// `masterDirty` is now its length — so a change it cannot see is a change that
// gets saved unannounced, or worse, cannot be saved at all because Save Master
// never lights up. Variants live in the same .master file and count.
describe("changes inside the variants", () => {
  it("reports a new variant", () => {
    const base = lolevMaster();
    const { master: edited, id } = addVariant(base, "Barrel-aged");
    expect(masterChanges(base, edited, newLabel(base)))
      .toEqual([{ kind: "added", layerId: id, layerName: "Barrel-aged" }]);
  });

  it("reports a removed and a renamed variant", () => {
    const base = lolevMaster();
    expect(masterChanges(base, removeVariant(base, "collab"), newLabel(base)))
      .toEqual([{ kind: "removed", layerId: "collab", layerName: "Collab" }]);
    expect(masterChanges(base, renameVariant(base, "collab", "Collaboration"), newLabel(base)))
      .toEqual([{ kind: "renamed", layerId: "collab", layerName: "Collaboration",
        from: "Collab", to: "Collaboration" }]);
  });

  it("reports a fill-contract edit made inside a variant", () => {
    const base = lolevMaster();
    // collabLead is a layer the variant ADDS, so patchLayer writes the variant.
    const edited = patchLayer(base, "collabLead", { placeholder: "Lead" });
    expect(masterChanges(base, edited, newLabel(base))).toEqual([
      { kind: "property", layerId: "collabLead", layerName: "Lead-in",
        path: "placeholder", from: undefined, to: "Lead" },
    ]);
  });

  it("reports a variant's override of a master layer", () => {
    const base = lolevMaster();
    const edited = setLayerIn(base, "collab", "name", { x: 222 });
    expect(masterChanges(base, edited, newLabel(base))).toEqual([
      { kind: "property", layerId: "name", layerName: "Name", path: "x",
        from: undefined, to: 222 },
    ]);
  });
});

// The master Select is a VERSION picker: what it names is what you see.
// Switching to Collab shows Collab; going back to the base hides it again.
// Leaving that to the chips meant switching back to the master still drew the
// variant's layers, which is not what "back to Lolev" says.
describe("showVersion", () => {
  const base = lolevMaster();
  const on = (ids: string[]): LabelFile => ({ ...newLabel(base), enabledVariants: ids });

  it("turns the version you switch to on", () => {
    expect(showVersion(on([]), null, "collab").enabledVariants).toEqual(["collab"]);
  });

  it("turns the version you switch away from off", () => {
    expect(showVersion(on(["collab"]), "collab", null).enabledVariants).toEqual([]);
  });

  it("swaps one version for another", () => {
    expect(showVersion(on(["collab"]), "collab", "barrel").enabledVariants).toEqual(["barrel"]);
  });

  it("leaves variants it was not switching between alone", () => {
    // A label can still show more than one version at once — the chips say so,
    // and this only moves the one being switched.
    expect(showVersion(on(["other", "collab"]), "collab", null).enabledVariants).toEqual(["other"]);
  });

  it("is a no-op when the version does not change", () => {
    const label = on(["collab"]);
    expect(showVersion(label, "collab", "collab")).toBe(label);
  });
});

// --- A promoted CLEAR keeps its tombstone in a variant -----------------------
// Deleting a key from a variant's diff means "inherit from the master", which
// is the opposite of what clearing an inherited property asked for. Only the
// base master, which owns the property outright, may clear by deletion.
describe("promoting an explicit unset", () => {
  const collabOn = (base: Master): LabelFile =>
    ({ ...newLabel(base), enabledVariants: ["collab"] });

  it("keeps a null tombstone when the target is a variant", () => {
    const base = lolevMaster();
    const had = (base.layers.find((l) => l.id === "warning") as { width: number }).width;
    expect(typeof had).toBe("number");
    const label = setLabelOverride(collabOn(base), "warning", { width: undefined });
    expect(label.overrides?.warning).toEqual({ width: null });

    const r = applyPromotions(base, label, masterChanges(base, base, label, "collab"), "collab");
    expect(r.master.variants.find((v) => v.id === "collab")!.layers.warning).toEqual({ width: null });
    expect((r.master.layers.find((l) => l.id === "warning") as { width: number }).width).toBe(had);
    const seen = resolveLayers(r.master, ["collab"], {}, r.label.overrides, { keepDisabled: true })
      .layers.find((l) => l.id === "warning") as { width?: number };
    expect(seen.width).toBeUndefined();
  });

  it("still clears by deletion when the target is the base master", () => {
    const base = lolevMaster();
    const label = setLabelOverride(newLabel(base), "warning", { width: undefined });
    const r = applyPromotions(base, label, masterChanges(base, base, label), undefined);
    expect(r.master.layers.find((l) => l.id === "warning")).not.toHaveProperty("width");
  });
});
