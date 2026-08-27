// app-layer-doc.test.ts — the pure doc transitions behind the four "Add
// layer" buttons and the layers panel's custom-row reorder chevrons
// (src/model/doc.ts's addLayerDoc / moveLayerDoc, Task 5b). Same shape as
// design-routing.test.ts's coverage of designEditDoc/layerEditDoc/etc.: these
// are user-facing controls, so the routing they exercise (Add layer lands on
// the master or the editing variant, never in a per-label cfg.customLayers
// append; reorder moves the entry within master.layers/variant.layers, not a
// wholesale array diff back into master.defaults) gets a test that fails if
// that routing regresses, without mounting the whole editor.
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { addLayerDoc, type Doc, materializedLayerEditDoc, moveLayerDoc } from "../src/model/doc";
import { buildSkip } from "../src/model/skip";
import { composeConfig } from "../src/model/document";
import { resolve } from "../src/model/resolve";
import { lolevMaster } from "../src/model/lolev";
import type { MasterLayer } from "../src/model/types";

function docOn(enabledVariants: string[] = []): Doc {
  const master = lolevMaster();
  const cfg = composeConfig(master, enabledVariants, {}, undefined).config;
  return { cfg, enabledVariants, master };
}

const textLayer = (id: string, name: string): MasterLayer =>
  ({ id, name, enabled: true, kind: "text" });
const textStyle = (text: string) => ({
  type: "text", size: 12,
  position: { anchor: "center", vAnchor: "top", offsetX: 0, offsetY: 24 },
  line: { text, fill: "#000000", layer: "white" },
});

describe("addLayerDoc", () => {
  it("records the layer on the master, and the resolved cfg carries it", () => {
    const doc = docOn();
    const next = addLayerDoc(doc, "master", textLayer("custom-a", "Text"), textStyle("Hi"));
    expect(next.master.layers.at(-1)).toEqual(textLayer("custom-a", "Text"));
    expect((next.master.defaults as unknown as Record<string, unknown>).customLayers).toBeUndefined();
    expect(next.cfg.customLayers?.map((l) => l.id)).toEqual(["custom-a"]);
  });

  it("records the layer on the editing variant, not the master, and gates on enable", () => {
    const doc = docOn(); // collab not enabled
    const next = addLayerDoc(doc, { variant: "collab" }, textLayer("custom-a", "Text"), textStyle("Hi"));
    expect(next.master.layers.some((l) => l.id === "custom-a")).toBe(false);
    expect(next.master.variants[0].layers).toEqual([textLayer("custom-a", "Text")]);
    // collab is off in this doc's enabledVariants, so the layer doesn't resolve.
    expect(next.cfg.customLayers).toBeUndefined();
    const withCollab = addLayerDoc(docOn(["collab"]), { variant: "collab" },
      textLayer("custom-a", "Text"), textStyle("Hi"));
    expect(withCollab.cfg.customLayers?.map((l) => l.id)).toEqual(["custom-a"]);
  });

  it("falls back to the master when the target names a variant the master doesn't declare (clampTarget)", () => {
    const doc = docOn();
    const next = addLayerDoc(doc, { variant: "no-such-variant" },
      textLayer("custom-a", "Text"), textStyle("Hi"));
    expect(next.master.layers.at(-1)?.id).toBe("custom-a");
  });
});

describe("moveLayerDoc", () => {
  function withTwoCustomLayers(): Doc {
    let doc = docOn();
    doc = addLayerDoc(doc, "master", textLayer("custom-a", "First"), textStyle("one"));
    doc = addLayerDoc(doc, "master", textLayer("custom-b", "Second"), textStyle("two"));
    return doc;
  }

  it("swaps the resolved cfg.customLayers draw order, not a wholesale defaults.customLayers write", () => {
    const doc = withTwoCustomLayers();
    expect(doc.cfg.customLayers?.map((l) => l.id)).toEqual(["custom-a", "custom-b"]);
    const moved = moveLayerDoc(doc, "custom-b", -1);
    expect(moved.cfg.customLayers?.map((l) => l.id)).toEqual(["custom-b", "custom-a"]);
    expect((moved.master.defaults as unknown as Record<string, unknown>).customLayers).toBeUndefined();
  });

  it("is a no-op (identity) at either end of the custom range", () => {
    const doc = withTwoCustomLayers();
    expect(moveLayerDoc(doc, "custom-a", -1)).toBe(doc);
    expect(moveLayerDoc(doc, "custom-b", 1)).toBe(doc);
  });
});

// Task 5b fix round 1 (Important): the layers panel's Lock button, for a
// MATERIALIZED custom row, used to route through `update` → designEdit,
// which diffs the mutated cfg against a recomposed base — since arrays are
// leaves to configDiff/deepMerge, that diff was the WHOLE customLayers
// array, recorded wholesale into master.defaults.customLayers. The real
// lock state (MasterLayer.locked) never moved, so resolve()'s
// unconditional overwrite of config.customLayers whenever a kind-bearing
// layer materializes silently reverted the toggle on the very next
// recompose. materializedLayerEditDoc fixes this by patching
// MasterLayer.locked directly (applyMaterializedLayerEdit, id-search
// based) instead of mutating cfg.customLayers.
describe("materializedLayerEditDoc (Task 5b fix round 1)", () => {
  it("locking a materialized custom layer sets MasterLayer.locked and leaves master.defaults.customLayers undefined", () => {
    const doc = addLayerDoc(docOn(), "master", textLayer("custom-a", "Text"), textStyle("Hi"));
    const locked = materializedLayerEditDoc(doc, "custom-a", { locked: true });
    expect(locked.master.layers.find((l) => l.id === "custom-a")!.locked).toBe(true);
    expect((locked.master.defaults as unknown as Record<string, unknown>).customLayers).toBeUndefined();
    expect(locked.cfg.customLayers?.[0]).toMatchObject({ id: "custom-a", locked: true });
  });

  // The half of the bug that silently reverted: prove the lock is read back
  // out of a FRESH resolve() against the mutated master, not carried by
  // accident in the doc's existing `cfg` object — this is what "survives a
  // recompose" (undo/redo, any other edit, reopening the file) actually
  // means.
  it("the lock survives an independent recompose, not just the one doc transition produced", () => {
    const doc = addLayerDoc(docOn(), "master", textLayer("custom-a", "Text"), textStyle("Hi"));
    const locked = materializedLayerEditDoc(doc, "custom-a", { locked: true });
    const recomposed = resolve(locked.master, locked.enabledVariants, {});
    expect(recomposed.config.customLayers?.[0]).toMatchObject({ id: "custom-a", locked: true });
    // And again — two independent resolves, same answer both times.
    expect(resolve(locked.master, locked.enabledVariants, {}).config.customLayers?.[0].locked)
      .toBe(true);
  });

  it("is a no-op (identity) when the patch is already what's stored", () => {
    const doc = addLayerDoc(docOn(), "master", textLayer("custom-a", "Text"), textStyle("Hi"));
    const locked = materializedLayerEditDoc(doc, "custom-a", { locked: true });
    expect(materializedLayerEditDoc(locked, "custom-a", { locked: true })).toBe(locked);
  });
});

// buildSkip is the ONE spelling of "what a plan-driven build must omit",
// shared by the preview's skip memo and buildFull's export assets. They used
// to compute it separately and the export forgot the resolution's disabled
// layers, so a master layer disabled in the panel vanished from the preview
// and still PRINTED. The union is pinned here; the end-to-end consequence is
// pinned in tests/pdf-build.test.ts ("a master layer disabled in the panel is
// absent from the exported PDF").
describe("buildSkip", () => {
  it("unions the layers-panel eyes with the resolution's disabled layers", () => {
    const skip = buildSkip(new Set(["mask"]), new Set(["volume"]));
    expect(skip.has("volume" as never)).toBe(true);   // disabled on the master
    expect(skip.has("mask" as never)).toBe(true);     // hidden by the eye
    expect(skip.has("name" as never)).toBe(false);
  });

  it("omits a layer the panel disabled on the shipped master", () => {
    const m = lolevMaster();
    m.layers.find((l) => l.id === "volume")!.enabled = false;
    const skip = buildSkip(new Set(), resolve(m, [], {}).disabledLayers);
    expect(skip.has("volume" as never)).toBe(true);
    // …and the collab block, which has no flag left to suppress it.
    expect(skip.has("collabLeft" as never)).toBe(true);
  });
});
