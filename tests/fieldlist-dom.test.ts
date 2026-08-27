// fieldlist-dom.test.ts — DOM behavior of FieldList (src/components/FieldList.tsx):
// Fill mode's sidebar. Scoped to a DOM environment per-file, matching
// description-editor-dom.test.ts's convention (see its header) — no
// @testing-library/react in this repo, so this drives real DOM nodes through
// react-dom/client + act, the same as that suite.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FieldList } from "../src/components/FieldList";
import { lolevMaster } from "../src/model/lolev";
import { defaultConfig } from "../src/defaults";

// React only honours act() when the environment opts in (see
// description-editor-dom.test.ts for the same line).
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

function renderList(props: Parameters<typeof FieldList>[0]) {
  act(() => { root.render(createElement(FieldList, props)); });
}

function change(el: Element, value: string) {
  const input = el as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input), "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("FieldList", () => {
  it("lists the master's fields with current values", () => {
    const cfg = defaultConfig();
    cfg.beerName = "Peregrine";
    renderList({
      master: lolevMaster(), enabledVariations: [], cfg,
      onValue: vi.fn(), onVariation: vi.fn(),
    });
    const nameInput = container.querySelector("#field-name") as HTMLInputElement;
    expect(nameInput.value).toBe("Peregrine");
    const collabCheckbox = container.querySelector("#variation-collab") as HTMLInputElement;
    expect(collabCheckbox.checked).toBe(false);
  });

  it("edits write through onValue and variations through onVariation", () => {
    const onValue = vi.fn();
    const onVariation = vi.fn();
    renderList({
      master: lolevMaster(), enabledVariations: [], cfg: defaultConfig(),
      onValue, onVariation,
    });
    change(container.querySelector("#field-name")!, "Kestrel");
    expect(onValue).toHaveBeenCalledWith(expect.objectContaining({ id: "name" }), "Kestrel");

    const collabCheckbox = container.querySelector("#variation-collab") as HTMLInputElement;
    act(() => { collabCheckbox.click(); });
    expect(onVariation).toHaveBeenCalledWith("collab", true);
  });

  it("shows a validation error for a bad code value", () => {
    const cfg = defaultConfig();
    cfg.upc = "123";
    renderList({
      master: lolevMaster(), enabledVariations: [], cfg,
      onValue: vi.fn(), onVariation: vi.fn(),
    });
    // Pinned to validateUpc's real message (src/upc.ts): `"${value}" is not
    // a valid UPC-A code (12 digits).`
    expect(container.textContent).toMatch(/digit/i);
  });
});
