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
import {
  addLayerDoc, designEditDoc, type Doc, materializedLayerEditDoc, moveLayerDoc,
} from "../src/model/doc";
import { buildSkip } from "../src/model/skip";
import { composeConfig } from "../src/model/document";
import { resolve } from "../src/model/resolve";
import { lolevMaster } from "../src/model/lolev";
import type { CustomLayer } from "../src/types";
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

// Task 5b fix round 2: resolve() OWNS `config.customLayers` for every
// MATERIALIZED layer — it rebuilds the array from `master.layers` +
// `defaults[layerId]` on every recompose — but four UI paths still wrote to
// that array as ordinary per-label state (drag/restyle, Remove layer, the
// Name input, the inspector's lock Switch). Since configDiff treats an array
// as ONE leaf, each of those recorded a stale whole-array snapshot at
// `master.defaults.customLayers`, which resolve() then ignored and
// overwrote: the edit was recomposed away and the junk accumulated in the
// saved `.master`. The fix decomposes that array diff once, at the seam
// (model/document.ts's routeCustomLayers), so every one of those editors
// keeps mutating a plain LabelConfig through `update` and the write lands
// where resolve() reads it back. Each test below is one of the reviewer's
// own repro shapes, and each fails without that routing.
describe("designEditDoc on a MATERIALIZED custom layer (fix round 2)", () => {
  const withLayer = (): Doc =>
    addLayerDoc(docOn(), "master", textLayer("custom-a", "Text"), textStyle("Hi"));
  const defaultsOf = (d: Doc) => d.master.defaults as unknown as Record<string, any>;
  /** What a FRESH resolve against the doc's master says — the half the bug
   *  reverted. `doc.cfg` alone proves nothing: it can carry the edit by
   *  accident and still lose it on the next recompose. */
  const fresh = (d: Doc) => resolve(d.master, d.enabledVariants, {}).config.customLayers;

  // Finding 2 (Critical): drag to offsetY 99.
  it("a drag records position on defaults[layerId], not a whole-array defaults.customLayers", () => {
    const doc = withLayer();
    expect(doc.cfg.customLayers![0].position.offsetY).toBe(24);
    const next = designEditDoc(doc, "master", (c) => {
      c.customLayers!.find((l) => l.id === "custom-a")!.position.offsetY = 99;
    });
    expect(next.cfg.customLayers![0].position.offsetY).toBe(99);
    expect(fresh(next)![0].position.offsetY).toBe(99);
    expect(defaultsOf(next).customLayers).toBeUndefined();
    expect(defaultsOf(next)["custom-a"].position.offsetY).toBe(99);
  });

  // Finding 2, the restyle half: the same seam, through applyStyle's write.
  it("a restyle records the style on defaults[layerId] and survives a recompose", () => {
    const next = designEditDoc(withLayer(), "master", (c) => {
      const l = c.customLayers!.find((x) => x.id === "custom-a")!;
      if (l.type === "text") l.line.fill = "#ff0000";
    });
    expect(fresh(next)![0]).toMatchObject({ line: { fill: "#ff0000" } });
    expect(defaultsOf(next).customLayers).toBeUndefined();
  });

  // Finding 3 (Critical): "Remove layer" — the ONLY delete affordance.
  it("Remove layer deletes the MasterLayer and its stored style, and it stays deleted", () => {
    const next = designEditDoc(withLayer(), "master", (c) => {
      c.customLayers = c.customLayers!.filter((l) => l.id !== "custom-a");
    });
    expect(next.master.layers.some((l) => l.id === "custom-a")).toBe(false);
    expect(defaultsOf(next)["custom-a"]).toBeUndefined();
    expect(defaultsOf(next).customLayers).toBeUndefined();
    expect(next.cfg.customLayers ?? []).toEqual([]);
    expect(fresh(next)).toBeUndefined();
  });

  it("Remove layer reaches a layer a VARIANT owns, wherever addLayer put it", () => {
    const doc = addLayerDoc(docOn(["collab"]), { variant: "collab" },
      textLayer("custom-a", "Text"), textStyle("Hi"));
    const next = designEditDoc(doc, { variant: "collab" }, (c) => {
      c.customLayers = c.customLayers!.filter((l) => l.id !== "custom-a");
    });
    const v = next.master.variants.find((x) => x.id === "collab")!;
    expect(v.layers ?? []).toEqual([]);
    expect((v.overrides as Record<string, unknown>)["custom-a"]).toBeUndefined();
    expect(next.cfg.customLayers ?? []).toEqual([]);
  });

  // Finding 4 (High): the Name input — the only rename path a custom row has.
  it("the Name input renames the MasterLayer, and the rename survives a recompose", () => {
    const next = designEditDoc(withLayer(), "master", (c) => {
      c.customLayers!.find((l) => l.id === "custom-a")!.name = "Renamed";
    });
    expect(next.master.layers.find((l) => l.id === "custom-a")!.name).toBe("Renamed");
    expect(fresh(next)![0].name).toBe("Renamed");
    expect(defaultsOf(next).customLayers).toBeUndefined();
    expect(defaultsOf(next)["custom-a"]?.name).toBeUndefined();
  });

  // Finding 4, the lock Switch in the same inspector row (the layers panel's
  // Lock already goes through materializedLayerEditDoc — fix round 1).
  it("the inspector's lock Switch sets MasterLayer.locked, not a cfg array entry", () => {
    const locked = designEditDoc(withLayer(), "master", (c) => {
      c.customLayers!.find((l) => l.id === "custom-a")!.locked = true;
    });
    expect(locked.master.layers.find((l) => l.id === "custom-a")!.locked).toBe(true);
    expect(fresh(locked)![0].locked).toBe(true);
    expect(defaultsOf(locked).customLayers).toBeUndefined();
    const unlocked = designEditDoc(locked, "master", (c) => {
      c.customLayers!.find((l) => l.id === "custom-a")!.locked = false;
    });
    expect(fresh(unlocked)![0].locked).toBe(false);
  });

  it("is still a no-op (identity) when the mutation changes nothing", () => {
    const doc = withLayer();
    expect(designEditDoc(doc, "master", (c) => {
      c.customLayers!.find((l) => l.id === "custom-a")!.position.offsetY = 24;
    })).toBe(doc);
  });
});

// A LEGACY custom layer — one that lives in a `customLayers` array with no
// `kind`-bearing MasterLayer behind it — must keep behaving exactly as it did
// before the routing above existed: it is ordinary config, and its edits stay
// in the array. The routing must not swallow it, and (finding 10) resolve()'s
// materialization must not swallow it either.
describe("legacy (non-materialized) custom layers (fix round 2)", () => {
  const legacy = (text: string): CustomLayer => ({
    id: "custom-legacy", name: "Legacy", type: "text", size: 10,
    position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 8 },
    line: { text, fill: "#000000", layer: "white" },
  } as CustomLayer);

  it("a design edit to a legacy master layer still records it in defaults.customLayers", () => {
    const master = lolevMaster();
    (master.defaults as Record<string, unknown>).customLayers = [legacy("one")];
    let doc: Doc = { cfg: composeConfig(master, [], {}, undefined).config, enabledVariants: [], master };
    doc = addLayerDoc(doc, "master", textLayer("custom-a", "Text"), textStyle("Hi"));
    const next = designEditDoc(doc, "master", (c) => {
      const l = c.customLayers!.find((x) => x.id === "custom-legacy")!;
      if (l.type === "text") l.line.text = "two";
    });
    const stored = (next.master.defaults as Record<string, unknown>).customLayers as CustomLayer[];
    // Only the legacy layer — the materialized one no longer rides along as
    // a stale snapshot — and the edit is really there.
    expect(stored.map((l) => l.id)).toEqual(["custom-legacy"]);
    expect((stored[0] as { line: { text: string } }).line.text).toBe("two");
    const composed = resolve(next.master, [], {}).config.customLayers!;
    expect(composed.map((l) => l.id)).toEqual(["custom-a", "custom-legacy"]);
    expect((composed[1] as { line: { text: string } }).line.text).toBe("two");
  });

  // Finding 10 (Medium): composeConfig's deepMerge replaced `customLayers`
  // wholesale, so a label carrying its OWN legacy array swallowed the
  // master's materialized layers — a newly added design layer never rendered
  // even though the master and the dirty flag both recorded it.
  it("a label's own legacy customLayers override no longer swallows a new design layer", () => {
    const base = docOn();
    const doc: Doc = { ...base, cfg: { ...base.cfg, customLayers: [legacy("mine")] } };
    const next = addLayerDoc(doc, "master", textLayer("custom-a", "Text"), textStyle("Hi"));
    expect(next.master.layers.some((l) => l.id === "custom-a")).toBe(true);
    expect(next.cfg.customLayers!.map((l) => l.id)).toEqual(["custom-a", "custom-legacy"]);
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
