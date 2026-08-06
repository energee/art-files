// selection.test.ts — the multi-select rules: shift-ranges in both
// directions and across group boundaries, ⌘-toggling (including removing the
// anchor), document layers staying single-select, mixed-value detection, and
// the promise that a multi-element style edit is ONE history entry.
import { describe, expect, it } from "vitest";
import { EMPTY_SELECTION, resolveSelect, sharedValue } from "../src/selection";
import { PANEL_ORDER, type LayerId } from "../src/components/layers";
import { applyStyle, elementById } from "../src/elements";
import { defaultConfig } from "../src/defaults";
import type { LabelConfig } from "../src/types";

const sel = (ids: LayerId[], anchor: LayerId | null) => ({ ids, anchor });
const click = (s: ReturnType<typeof sel>, id: LayerId, mods = {}) =>
  resolveSelect(s, id, mods, PANEL_ORDER);

describe("resolveSelect", () => {
  it("replaces the selection and sets the anchor on a plain click", () => {
    expect(click(sel(["name", "abv"], "name"), "qr")).toEqual(sel(["qr"], "qr"));
  });

  it("extends a range downward from the anchor, in panel order", () => {
    expect(click(sel(["name"], "name"), "abv", { shift: true }))
      .toEqual(sel(["name", "styleLine", "abv"], "name"));
  });

  it("extends a range upward, reading out from the anchor", () => {
    expect(click(sel(["abv"], "abv"), "name", { shift: true }))
      .toEqual(sel(["abv", "styleLine", "name"], "abv"));
  });

  it("keeps the anchor stable across successive shift-clicks", () => {
    const first = click(sel(["name"], "name"), "abv", { shift: true });
    expect(click(first, "styleLine", { shift: true }))
      .toEqual(sel(["name", "styleLine"], "name"));
  });

  it("crosses group boundaries — Beer into Collab", () => {
    const r = click(sel(["qr"], "qr"), "collabLeft", { shift: true });
    expect(r.ids).toEqual(["qr", "collabLead", "collabLeft"]);
    expect(r.anchor).toBe("qr");
  });

  it("falls back to a plain select when there is no anchor to extend from", () => {
    expect(click(EMPTY_SELECTION, "abv", { shift: true })).toEqual(sel(["abv"], "abv"));
  });

  it("adds with the toggle modifier, in click order", () => {
    expect(click(sel(["name"], "name"), "warning", { toggle: true }))
      .toEqual(sel(["name", "warning"], "warning"));
  });

  it("removes an already-selected layer — including the anchor", () => {
    const r = click(sel(["name", "abv"], "name"), "name", { toggle: true });
    expect(r.ids).toEqual(["abv"]);
    // The removed row still becomes the anchor: a range has to extend from
    // the last row the user actually clicked.
    expect(r.anchor).toBe("name");
  });

  it("keeps document layers single-select in both directions", () => {
    // ⌘-clicking a document layer replaces rather than mixing a Settings
    // panel into a style edit...
    expect(click(sel(["name", "abv"], "name"), "settings", { toggle: true }))
      .toEqual(sel(["settings"], "settings"));
    // ...and ⌘-clicking an element while one is selected replaces too.
    expect(click(sel(["settings"], "settings"), "name", { toggle: true }))
      .toEqual(sel(["name"], "name"));
    // A shift-range from a document anchor has no element range to read.
    expect(click(sel(["mask"], "mask"), "name", { shift: true }))
      .toEqual(sel(["name"], "name"));
  });
});

describe("sharedValue", () => {
  it("returns the value when every element agrees, undefined when they don't", () => {
    expect(sharedValue(["#ffffff", "#ffffff"])).toBe("#ffffff");
    expect(sharedValue(["#ffffff", "#000000"])).toBeUndefined();
    expect(sharedValue([])).toBeUndefined();
    expect(sharedValue([false, false])).toBe(false);
  });

  it("detects a mixed fill across a real selection, and one write fixes it", () => {
    const c = defaultConfig();
    applyStyle(c, "name", { fill: "#ffffff" });
    applyStyle(c, "abv", { fill: "#000000" });
    const fillsOf = (cfg: LabelConfig) =>
      (["name", "abv"] as const).map((id) => elementById(id).style(cfg).fill);
    expect(sharedValue(fillsOf(c))).toBeUndefined();
    // What the inspector's onChange does: the same patch to every selected id.
    for (const id of ["name", "abv"] as const) applyStyle(c, id, { fill: "#123456" });
    expect(sharedValue(fillsOf(c))).toBe("#123456");
  });
});

describe("a multi-element edit", () => {
  it("is one history entry, not one per element", () => {
    // App's `update` clones the config once per call and pushes it as one
    // history entry (see useHistory); the inspector's loop runs INSIDE that
    // one call. Modelled here so the guarantee is checked without a DOM.
    const ids = ["name", "styleLine", "abv"] as const;
    const stack: LabelConfig[] = [defaultConfig()];
    const update = (fn: (c: LabelConfig) => void) => {
      const next = structuredClone(stack[stack.length - 1]);
      fn(next);
      stack.push(next);
    };
    const layersOf = (cfg: LabelConfig) => ids.map((id) => elementById(id).style(cfg).layer);

    // All three ship metallic (see defaults.ts), so "white" is a real change
    // for every one of them.
    expect(layersOf(stack[0])).toEqual(["metallic", "metallic", "metallic"]);

    update((c) => { for (const id of ids) applyStyle(c, id, { layer: "white" }); });

    expect(stack).toHaveLength(2);
    expect(layersOf(stack[1])).toEqual(["white", "white", "white"]);
    // The previous entry is untouched, so ONE undo restores all three.
    expect(layersOf(stack[0])).toEqual(["metallic", "metallic", "metallic"]);
  });
});
