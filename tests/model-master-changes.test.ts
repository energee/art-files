// model-master-changes.test.ts — the itemised master diff behind the Save
// Master review (docs/plans/label-first-editing.md, Task 6). `masterChanges`
// answers "what is this save about to write?": the structural and fill-contract
// edits already sitting in the edited master. Pure — the dialog does the
// rendering.
//
// (2026-09-06: this used to also take the label and a target version, and
// itemise the label's own overrides as `promote` rows offered to fold into
// the template — removed by docs/plans/template-switch.md along with
// applyPromotions; see docs/plans/label-first-editing.md's Tasks 6/7/12 for
// the history.)
import { describe, expect, it } from "vitest";
import { masterChanges, showVersion, addLayer, addVariant, removeVariant, renameVariant, setLayerIn, moveLayers, patchLayer, removeLayer } from "../src/model/edit";
import { lolevMaster } from "../src/model/lolevLayers";
import type { LabelFile, Master } from "../src/model/layers";

const newLabel = (master: Master): LabelFile =>
  ({ formatVersion: 3, masterId: master.id, enabledVariants: [], values: {} });

describe("masterChanges", () => {
  it("a 2-argument call reports no promote kind", () => {
    const base = lolevMaster();
    const edited = patchLayer(base, "name", { x: 300 });
    const kinds: string[] = masterChanges(base, edited).map((c) => c.kind);
    expect(kinds).not.toContain("promote");
  });

  it("an untouched master yields nothing", () => {
    const m = lolevMaster();
    expect(masterChanges(m, m)).toEqual([]);
  });

  it("reports a rename and a property edit as two entries", () => {
    const base = lolevMaster();
    const was = base.layers.find((l) => l.id === "name") as { name: string };
    let edited = patchLayer(base, "name", { name: "Beer name" });
    edited = patchLayer(edited, "styleLine", { x: 42 });
    expect(masterChanges(base, edited)).toEqual([
      { kind: "renamed", layerId: "name", layerName: "Beer name", from: was.name, to: "Beer name" },
      { kind: "property", layerId: "styleLine", layerName: "Style", path: "x",
        from: (base.layers.find((l) => l.id === "styleLine") as { x: number }).x, to: 42 },
    ]);
  });

  it("reports an added, a removed and a reordered layer", () => {
    const base = lolevMaster();
    const added = addLayer(base, "text");
    const edited = removeLayer(added.master, "styleLine");
    const kinds = masterChanges(base, edited).map((c) => `${c.kind}:${c.layerId}`);
    expect(kinds).toContain(`added:${added.id}`);
    expect(kinds).toContain("removed:styleLine");

    const moved = moveLayers(base, ["name"], "name", 1);
    expect(masterChanges(base, moved).some((c) => c.kind === "moved")).toBe(true);
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
    expect(masterChanges(base, edited))
      .toEqual([{ kind: "added", layerId: id, layerName: "Barrel-aged" }]);
  });

  it("reports a removed and a renamed variant", () => {
    const base = lolevMaster();
    expect(masterChanges(base, removeVariant(base, "collab")))
      .toEqual([{ kind: "removed", layerId: "collab", layerName: "Collab" }]);
    expect(masterChanges(base, renameVariant(base, "collab", "Collaboration")))
      .toEqual([{ kind: "renamed", layerId: "collab", layerName: "Collaboration",
        from: "Collab", to: "Collaboration" }]);
  });

  it("reports a fill-contract edit made inside a variant", () => {
    const base = lolevMaster();
    // collabLead is a layer the variant ADDS, so patchLayer writes the variant.
    const edited = patchLayer(base, "collabLead", { placeholder: "Lead" });
    expect(masterChanges(base, edited)).toEqual([
      { kind: "property", layerId: "collabLead", layerName: "Lead-in",
        path: "placeholder", from: undefined, to: "Lead" },
    ]);
  });

  it("reports a variant's override of a master layer", () => {
    const base = lolevMaster();
    const edited = setLayerIn(base, "collab", "name", { x: 222 });
    expect(masterChanges(base, edited)).toEqual([
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
