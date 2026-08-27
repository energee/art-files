// app-layer-doc.test.ts — the pure doc transitions behind the four "Add
// layer" buttons and the layers panel's custom-row reorder chevrons
// (App.tsx's addLayerDoc / moveLayerDoc, Task 5b). Same shape as
// design-routing.test.ts's coverage of designEditDoc/layerEditDoc/etc.: these
// are user-facing controls, so the routing they exercise (Add layer lands on
// the master or the editing variant, never in a per-label cfg.customLayers
// append; reorder moves the entry within master.layers/variant.layers, not a
// wholesale array diff back into master.defaults) gets a test that fails if
// that routing regresses, without mounting the whole editor.
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { addLayerDoc, type Doc, moveLayerDoc } from "../src/App";
import { composeConfig } from "../src/model/document";
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
