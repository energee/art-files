// mastersave-review-dom.test.tsx — DOM behavior of MasterSaveReview
// (src/components/MasterSaveReview.tsx): the dialog standing between an edit
// and the template (docs/plans/label-first-editing.md, Task 7). It renders
// masterChanges() grouped by layer — structural rows checked and disabled
// (they are ALREADY in the master; unchecking one is an undo, not a save
// option), promote rows off by default — and hands back exactly the promote
// rows that were ticked. Same react-dom/client + act harness as
// masterpicker-dom.test.tsx; no @testing-library/react in this repo.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MasterSaveReview } from "../src/components/MasterSaveReview";
import type { MasterChange } from "../src/model/edit";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    expect(boxes()).toHaveLength(4);
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
    expect(boxes()).toHaveLength(2);
    tick("promote-name-lines-value");
    act(() => { button("Save Master").click(); });
    expect(props.onConfirm).toHaveBeenCalledWith([same[1]]);
  });

  it("checks and locks the structural rows, and leaves promotions off", () => {
    render();
    expect(box("renamed-name").getAttribute("aria-checked")).toBe("true");
    expect(box("renamed-name").getAttribute("aria-disabled")).toBe("true");
    expect(box("promote-name-x").getAttribute("aria-disabled")).toBeNull();
    expect(box("property-styleLine-placeholder").getAttribute("aria-checked")).toBe("true");
    expect(box("promote-name-x").getAttribute("aria-checked")).toBe("false");
    expect(box("promote-name-style.fill").getAttribute("aria-checked")).toBe("false");
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

  it("has exactly one primary action (docs/plans/template-switch.md, Task 3)", () => {
    render();
    const primary = Array.from(document.querySelectorAll<HTMLElement>("*"))
      .filter((el) => (el.getAttribute("class") ?? "").split(" ").includes("bg-primary"));
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
