// selection.test.ts — the multi-select rules: shift-ranges in both
// directions, ⌘-toggling (including removing the anchor), and modsOf's
// platform rule.
import { describe, expect, it } from "vitest";
import { EMPTY_SELECTION, modsOf, resolveSelect, type Selection } from "../src/selection";

// resolveSelect is generic over any row order — the real order comes from
// the Layers list's rows (model/rows.ts). Any distinct ids will do here.
const ORDER = ["name", "styleLine", "abv", "description", "barcode", "qr", "background", "mask"];
const sel = (ids: string[], anchor: string | null): Selection => ({ ids, anchor });
const click = (s: Selection, id: string, mods = {}) => resolveSelect(s, id, mods, ORDER);

describe("resolveSelect", () => {
  it("replaces the selection and sets the anchor on a plain click", () => {
    expect(click(sel(["name", "abv"], "name"), "qr")).toEqual(sel(["qr"], "qr"));
  });
  it("extends a range downward from the anchor, in list order", () => {
    expect(click(sel(["name"], "name"), "abv", { shift: true }))
      .toEqual(sel(["name", "styleLine", "abv"], "name"));
  });
  it("extends a range upward, reading out from the anchor", () => {
    expect(click(sel(["abv"], "abv"), "name", { shift: true }))
      .toEqual(sel(["abv", "styleLine", "name"], "abv"));
  });
  it("shift with no anchor is a plain click", () => {
    expect(click(EMPTY_SELECTION, "qr", { shift: true })).toEqual(sel(["qr"], "qr"));
  });
  it("shift-selects across the page-art rows like any other", () => {
    expect(click(sel(["qr"], "qr"), "mask", { shift: true }).ids).toEqual(["qr", "background", "mask"]);
  });
  it("⌘ toggles a row in and out, moving the anchor to the click", () => {
    const added = click(sel(["name"], "name"), "abv", { toggle: true });
    expect(added).toEqual(sel(["name", "abv"], "abv"));
    expect(click(added, "name", { toggle: true })).toEqual(sel(["abv"], "name"));
  });
  it("⌘ that empties the selection clears the anchor too", () => {
    expect(click(sel(["name"], "name"), "name", { toggle: true })).toEqual(sel([], null));
  });
  it("modsOf reads ⌘ or Ctrl as toggle", () => {
    expect(modsOf({ shiftKey: false, metaKey: true, ctrlKey: false })).toEqual({ shift: false, toggle: true });
    expect(modsOf({ shiftKey: true, metaKey: false, ctrlKey: true })).toEqual({ shift: true, toggle: true });
  });
});
