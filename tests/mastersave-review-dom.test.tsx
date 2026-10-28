// mastersave-review-dom.test.tsx — DOM behavior of MasterSaveReview
// (src/components/MasterSaveReview.tsx): the dialog standing between an edit
// and the template (docs/plans/label-first-editing.md, Task 7). It renders
// masterChanges() grouped by layer — structural rows as plain text (they
// are ALREADY in the master; undoing one is ⌘Z's job, not a save option),
// promote rows with a checkbox, off by default — and hands back exactly the
// promote rows that were ticked. Same react-dom/client + act harness as
// masterpicker-dom.test.tsx; no @testing-library/react in this repo.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MasterSaveReview } from "../src/components/MasterSaveReview";
import type { MasterChange } from "../src/model/edit";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

const changes: MasterChange[] = [
  { kind: "renamed", layerId: "name", layerName: "Beer name", from: "Name", to: "Beer name" },
  { kind: "property", layerId: "styleLine", layerName: "Style", path: "placeholder", from: "Style", to: "Sub-style" },
  { kind: "promote", layerId: "name", layerName: "Beer name", path: "x", from: 100, to: 300 },
  { kind: "promote", layerId: "name", layerName: "Beer name", path: "style.fill", from: "#F3CD80", to: "#FF0000" },
];

function render(props: Partial<Parameters<typeof MasterSaveReview>[0]> = {}) {
  const full: Parameters<typeof MasterSaveReview>[0] = {
    open: true, changes, onCancel: vi.fn(), onConfirm: vi.fn(), ...props,
  };
  act(() => { root.render(createElement(MasterSaveReview, full)); });
  return full;
}

const boxes = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[role=checkbox]"));
// Rows are found by `data-row`, not `id`: base-ui's Checkbox mints its own
// id, and a dotted path like `style.fill` would parse as id-plus-class anyway.
const box = (row: string) => document.querySelector<HTMLElement>(`[data-row="${row}"]`)!;
/** base-ui backs each Checkbox with a hidden native input and listens there;
 *  a click on the visible span is not a real pointer interaction in happy-dom. */
const tick = (row: string) =>
  act(() => { box(row).closest("label")!.querySelector("input")!.click(); });
const button = (text: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((b) => b.textContent?.trim() === text)!;

describe("MasterSaveReview", () => {
  it("lists every change under its layer", () => {
    render();
    const text = document.body.textContent ?? "";
    expect(text).toContain("Beer name");
    expect(text).toContain("Style");
    expect(text).toContain("placeholder");
    expect(text).toContain("style.fill");
    expect(boxes()).toHaveLength(3); // 2 promote rows + the "promote all" tick
  });

  // A layer can hold BOTH an override and a fill value on the same path
  // ("lines" for text), and the two promote rows collided on one key — so one
  // checkbox drove both and React warned about duplicate children.
  it("keeps an override and a fill value on the same path apart", () => {
    const same: MasterChange[] = [
      { kind: "promote", layerId: "name", layerName: "Beer name", path: "lines", from: 1, to: 2 },
      { kind: "promote", layerId: "name", layerName: "Beer name", path: "lines", from: 3, to: 4,
        source: "value" },
    ];
    const props = render({ changes: same });
    expect(boxes()).toHaveLength(3); // 2 rows + the "promote all" tick
    tick("promote-name-lines-value");
    act(() => { button("Save Master").click(); });
    expect(props.onConfirm).toHaveBeenCalledWith([same[1]]);
  });

  // #130: an edited line is one removed and one added entry at the same
  // count, which fell back to the bare counts — "lines: 1 → 1" says nothing.
  it("names the line an edit replaced instead of printing 1 → 1 (#130)", () => {
    render({ changes: [{ kind: "property", layerId: "name", layerName: "Beer name", path: "lines",
      from: [{ text: "Labradorite" }], to: [{ text: "Moonstone" }] }] });
    expect(document.body.textContent).toContain('1 → 1 ("Labradorite" → "Moonstone")');
  });

  // A structural row offers no choice, so it shows none: no disabled,
  // pre-checked box that looks like a control that doesn't work.
  it("lists structural rows as plain text, and leaves promotions off", () => {
    render();
    expect(box("renamed-name").getAttribute("role")).toBeNull();
    expect(box("renamed-name").querySelector("[role=checkbox]")).toBeNull();
    expect(box("renamed-name").textContent).toContain('Renamed from "Name"');
    expect(box("property-styleLine-placeholder").querySelector("[role=checkbox]")).toBeNull();
    expect(box("promote-name-x").getAttribute("aria-disabled")).toBeNull();
    expect(box("promote-name-x").getAttribute("aria-checked")).toBe("false");
    expect(box("promote-name-style.fill").getAttribute("aria-checked")).toBe("false");
  });

  // Reviewing a long delta one tick at a time is the common case for a
  // wholesale "make the label the template" save.
  it("ticks and unticks every promotion at once", () => {
    const p = render();
    tick("all");
    expect(box("promote-name-x").getAttribute("aria-checked")).toBe("true");
    expect(box("promote-name-style.fill").getAttribute("aria-checked")).toBe("true");
    tick("all");
    expect(box("promote-name-x").getAttribute("aria-checked")).toBe("false");
    act(() => { button("Save Master").click(); });
    expect(p.onConfirm).toHaveBeenCalledWith([]);
  });

  it("offers no all-tick when there is nothing to promote", () => {
    render({ changes: changes.slice(0, 2) });
    expect(document.querySelector("[data-row=all]")).toBeNull();
  });

  it("cancelling confirms nothing", () => {
    const p = render();
    act(() => { button("Cancel").click(); });
    expect(p.onCancel).toHaveBeenCalled();
    expect(p.onConfirm).not.toHaveBeenCalled();
  });

  it("confirms with exactly the promotions that were ticked", () => {
    const p = render();
    tick("promote-name-style.fill");
    act(() => { button("Save Master").click(); });
    expect(p.onConfirm).toHaveBeenCalledWith([changes[3]]);
  });

  it("a structural-only save confirms with no promotions", () => {
    const p = render({ changes: changes.slice(0, 2) });
    act(() => { button("Save Master").click(); });
    expect(p.onConfirm).toHaveBeenCalledWith([]);
  });

  it("marks its single master-writing action with attention (#245)", () => {
    render();
    const primary = Array.from(document.querySelectorAll<HTMLElement>("*"))
      .filter((el) => (el.getAttribute("class") ?? "").split(" ").includes("bg-attention-soft"));
    expect(primary).toHaveLength(1);
    expect(primary[0].textContent?.trim()).toBe("Save Master");
  });
});

// docs/plans/choice-input.md, Task 7. A vocabulary is one leaf to leafPaths,
// so it arrives as ONE row whose from/to are whole arrays. Stringifying eight
// tier objects into a review row is unreadable, and the review is the only
// thing standing between a learned value and the template — so the row has to
// say what actually changed.
describe("MasterSaveReview list rows", () => {
  const tiers = [{ title: "Tier 1", value: "8500" }, { title: "Tier 2", value: "8600" }];
  const row = (from: unknown, to: unknown): MasterChange =>
    ({ kind: "property", layerId: "barcode", layerName: "Barcode", path: "choices", from, to });
  const text = (from: unknown, to: unknown) => {
    render({ changes: [row(from, to)] });
    return document.body.textContent ?? "";
  };

  it("names what one edit added", () => {
    expect(text(tiers, [...tiers, { value: "036000291452" }]))
      .toContain('choices: 2 → 3 (+ "036000291452")');
  });

  it("names an entry by its title when it has one", () => {
    expect(text(tiers, [...tiers, { title: "Tier 3", value: "8700" }]))
      .toContain('(+ "Tier 3")');
  });

  it("names what was removed", () => {
    expect(text(tiers, [tiers[0]])).toContain('choices: 2 → 1 (− "Tier 2")');
  });

  it("falls back to the counts when several things moved at once", () => {
    const shuffled = [{ title: "Tier 9", value: "9" }, { title: "Tier 8", value: "8" }];
    const out = text(tiers, shuffled);
    expect(out).toContain("choices: 2 → 2");
    expect(out).not.toContain("+");
  });

  it("reads a list of plain strings too", () => {
    expect(text(["a"], ["a", "b"])).toContain('(+ "b")');
  });

  it("still spells out a value that is not a list", () => {
    render({ changes: [{ kind: "property", layerId: "name", layerName: "Name",
      path: "x", from: 148, to: 162 }] });
    expect(document.body.textContent).toContain("x: 148 → 162");
  });
});
