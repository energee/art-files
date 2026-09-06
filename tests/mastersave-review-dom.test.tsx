// mastersave-review-dom.test.tsx — DOM behavior of MasterSaveReview
// (src/components/MasterSaveReview.tsx): the dialog standing between an edit
// and the template (docs/plans/label-first-editing.md, Task 7). It renders
// masterChanges() as a read-only list grouped by layer, plus Save / Cancel.
// Same react-dom/client + act harness as masterpicker-dom.test.tsx; no
// @testing-library/react in this repo.
//
// (2026-09-06: this dialog used to also render a checkbox per row — checked
// and disabled for structural rows, off by default for a label override the
// reviewer could tick to fold into the template — removed by
// docs/plans/template-switch.md along with applyPromotions; see
// docs/plans/label-first-editing.md's Tasks 6/7 for the history.)
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
const button = (text: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((b) => b.textContent?.trim() === text)!;

describe("MasterSaveReview", () => {
  it("renders no checkboxes", () => {
    render();
    expect(boxes()).toHaveLength(0);
  });

  it("lists every change under its layer", () => {
    render();
    const text = document.body.textContent ?? "";
    expect(text).toContain("Beer name");
    expect(text).toContain("Style");
    expect(text).toContain("placeholder");
  });

  it("cancelling confirms nothing", () => {
    const p = render();
    act(() => { button("Cancel").click(); });
    expect(p.onCancel).toHaveBeenCalled();
    expect(p.onConfirm).not.toHaveBeenCalled();
  });

  it("confirms on Save Master", () => {
    const p = render();
    act(() => { button("Save Master").click(); });
    expect(p.onConfirm).toHaveBeenCalled();
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
