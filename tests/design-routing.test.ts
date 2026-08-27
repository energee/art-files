// design-routing.test.ts — where an edit LANDS, per mode. App's `update`
// routes Design-mode edits through designEditDoc (the master, or the editing
// variant) and Fill-mode edits through labelEditDoc (this label's config);
// both are exported from src/App.tsx precisely so the routing can be pinned
// without mounting the whole editor.
//
// The mutation under test is the REAL drag mutation the preview's onNudge
// hands to `update` — `dragTarget(...).set(...)` from src/elements.ts — not a
// stand-in, so this covers the composition the plan's Global Constraints
// name: "field values, and dragging an unlocked layer in Fill mode" stay
// per-label; everything else edited in Design mode is a master/variant edit.
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { type Doc, clampTarget, designEditDoc, labelEditDoc, layerEditDoc } from "../src/App";
import { addVariant } from "../src/model/document";
import { composeConfig, configDiff, valuesFromConfig } from "../src/model/document";
import { lolevMaster } from "../src/model/lolev";
import { dragTarget } from "../src/elements";
import { pushed, resetTo } from "../src/history";
import type { LabelConfig } from "../src/types";

/** A document on the shipped master with the collab variant enabled — the
 *  logo's offsetY (dragTarget's only unconditional target) is draggable only
 *  while collab is on. */
function docWithCollab(): Doc {
  const master = lolevMaster();
  const enabledVariants = ["collab"];
  const cfg = composeConfig(master, enabledVariants, {}, undefined).config;
  return { cfg, enabledVariants, master };
}

/** Exactly what App's onNudge passes to `update`. */
const nudgeLogo = (offsetY: number) => (c: LabelConfig) => {
  dragTarget(c, { left: true, center: true }, "logo")?.set(c, offsetY);
};

/** The label-level deviations a save would record for `doc` — {} means the
 *  edit went onto the master, not onto this label. */
const labelOverrides = (doc: Doc) => configDiff(
  composeConfig(
    doc.master, doc.enabledVariants,
    valuesFromConfig(doc.master, doc.enabledVariants, doc.cfg), undefined).config,
  doc.cfg);

describe("drag routing by mode", () => {
  it("Fill mode: a nudge writes the label and never touches the master", () => {
    const doc = docWithCollab();
    const next = labelEditDoc(doc, nudgeLogo(18));
    expect(next.cfg.logo.offsetY).toBe(18);
    expect(next.master).toBe(doc.master); // identity: the master is untouched
    expect(labelOverrides(next)).toEqual({ logo: { offsetY: 18 } });
  });

  it("Design mode on the master: a nudge writes master.defaults, not the label", () => {
    const doc = docWithCollab();
    const next = designEditDoc(doc, "master", nudgeLogo(18));
    expect(next.master).not.toBe(doc.master);
    expect(next.master.defaults.logo?.offsetY).toBe(18);
    // The recomposed preview shows it, and the label records nothing: the
    // offset is now the master's, so every label built from it inherits it.
    expect(next.cfg.logo.offsetY).toBe(18);
    expect(labelOverrides(next)).toEqual({});
  });

  it("Design mode on a variant: a nudge writes that variant's overrides", () => {
    const doc = docWithCollab();
    const next = designEditDoc(doc, { variant: "collab" }, nudgeLogo(18));
    const collab = next.master.variants.find((v) => v.id === "collab")!;
    expect(collab.overrides.logo?.offsetY).toBe(18);
    expect(next.master.defaults.logo).toBeUndefined();
    expect(next.cfg.logo.offsetY).toBe(18);
    expect(labelOverrides(next)).toEqual({});
  });

  it("a Design edit that changes nothing returns the doc by identity", () => {
    // Nudge once so the master carries an offset, then drop the layer back
    // on the same spot: the mutation runs, the diff is empty, and the doc
    // comes back by identity — no history entry, no phantom dirty dot.
    // (Note the offset must already EXIST: writing 0 over an absent
    // `offsetY` is a real change, absent and 0 being different documents.)
    const doc = designEditDoc(docWithCollab(), "master", nudgeLogo(18));
    expect(designEditDoc(doc, "master", nudgeLogo(18))).toBe(doc);
  });

  it("a whole Design-mode drag still collapses into ONE undo step", () => {
    // App passes coalesce=!first to `update`, which hands it straight to
    // useHistory's setter — so a drag's frames fold into the step its first
    // frame opened, exactly as before this routing existed. Driven through
    // history.ts's own `pushed`, which is the reducer that setter calls.
    let stacks = resetTo(docWithCollab());
    const before = stacks.present;
    // first frame: coalesce=false, opens a step
    stacks = pushed(stacks, designEditDoc(stacks.present, "master", nudgeLogo(4)), false);
    // every later frame: coalesce=true, folds in
    for (const y of [8, 12, 16, 18]) {
      stacks = pushed(stacks, designEditDoc(stacks.present, "master", nudgeLogo(y)), true);
    }
    expect(stacks.past).toHaveLength(1);
    expect(stacks.past[0]).toBe(before);          // one undo returns to pre-drag
    expect(stacks.present.master.defaults.logo?.offsetY).toBe(18); // final value kept
  });
});

// I1: the Editing selector is UI state outside history while the variants it
// names ride IN history, so the two can disagree. Without clampTarget,
// applyDesignEdit maps over `variants`, matches nothing, and returns a
// new-but-identical master — which slips past designEditDoc's identity guard,
// so the document goes dirty, a history entry is pushed, and the edit
// vanishes.
describe("a target naming a variant the master no longer declares", () => {
  /** The undo path, exactly: create "Winter" (the selector moves onto it),
   *  then undo — history hands back the pre-add doc while the selector still
   *  says {variant:"winter"}. */
  function afterUndoingTheNewVariant(): { before: Doc; target: { variant: string } } {
    const before = docWithCollab();
    const { master, id } = addVariant(before.master, "Winter");
    const withVariant: Doc = { ...before, master };
    expect(withVariant.master.variants.some((v) => v.id === id)).toBe(true);
    // undo === the previous history entry, which is `before`
    expect(before.master.variants.some((v) => v.id === id)).toBe(false);
    return { before, target: { variant: id } };
  }

  it("clamps to the master", () => {
    const { before, target } = afterUndoingTheNewVariant();
    expect(clampTarget(before.master, target)).toBe("master");
    // A variant the master DOES declare is left alone.
    expect(clampTarget(before.master, { variant: "collab" })).toEqual({ variant: "collab" });
  });

  it("keeps the design edit instead of silently discarding it", () => {
    const { before, target } = afterUndoingTheNewVariant();
    const next = designEditDoc(before, target, nudgeLogo(18));
    expect(next.master.defaults.logo?.offsetY).toBe(18);
    expect(next.cfg.logo.offsetY).toBe(18);
    expect(next.master.variants.some((v) => v.id === "winter")).toBe(false);
  });

  it("still reports a genuine no-op by identity, rather than a phantom edit", () => {
    const { before, target } = afterUndoingTheNewVariant();
    const doc = designEditDoc(before, "master", nudgeLogo(18));
    // Same value again, through the STALE target: nothing changed, so the doc
    // comes back by identity — no dirty flag, no undo step.
    expect(designEditDoc(doc, target, nudgeLogo(18))).toBe(doc);
  });

  it("routes a layer policy edit to the master too", () => {
    const { before, target } = afterUndoingTheNewVariant();
    const next = layerEditDoc(before, target, "wordmark", { enabled: false });
    expect(next.master.layers.find((l) => l.id === "wordmark")!.enabled).toBe(false);
  });
});

describe("layer policy edits", () => {
  it("record on the master, and on a variant's layerOverrides", () => {
    const doc = docWithCollab();
    expect(layerEditDoc(doc, "master", "wordmark", { name: "Logotype" })
      .master.layers.find((l) => l.id === "wordmark")!.name).toBe("Logotype");
    expect(layerEditDoc(doc, { variant: "collab" }, "wordmark", { name: "Logotype" })
      .master.variants.find((v) => v.id === "collab")!.layerOverrides.wordmark)
      .toEqual({ name: "Logotype" });
  });

  it("M1: a patch the target already stores returns the doc by identity", () => {
    const doc = docWithCollab();
    // The shipped wordmark is already enabled and already named "Brand".
    expect(layerEditDoc(doc, "master", "wordmark", { enabled: true })).toBe(doc);
    expect(layerEditDoc(doc, "master", "wordmark", { name: "Brand" })).toBe(doc);
    // …and for a VARIANT target the comparison is against its own stored
    // override, not the resolved row: the variant overrides nothing for this
    // layer yet, so the same patch IS a change there.
    expect(layerEditDoc(doc, { variant: "collab" }, "wordmark", { name: "Brand" })).not.toBe(doc);
  });
});
