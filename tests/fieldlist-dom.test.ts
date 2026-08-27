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

function renderList(props: Omit<Parameters<typeof FieldList>[0], "onImageFile"> & {
  onImageFile?: Parameters<typeof FieldList>[0]["onImageFile"];
}) {
  act(() => {
    root.render(createElement(FieldList, {
      onImageFile: vi.fn(async () => "asset-x"), ...props,
    }));
  });
}

/** Drive a file <input>: happy-dom's `files` is read-only, so define it. */
function drop(el: Element, file: File) {
  Object.defineProperty(el, "files", { value: [file], configurable: true });
  act(() => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
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
      master: lolevMaster(), enabledVariants: [], cfg,
      onValue: vi.fn(), onVariant: vi.fn(),
    });
    const nameInput = container.querySelector("#field-name") as HTMLInputElement;
    expect(nameInput.value).toBe("Peregrine");
    const collabCheckbox = container.querySelector("#variant-collab") as HTMLInputElement;
    expect(collabCheckbox.checked).toBe(false);
  });

  it("edits write through onValue and variants through onVariant", () => {
    const onValue = vi.fn();
    const onVariant = vi.fn();
    renderList({
      master: lolevMaster(), enabledVariants: [], cfg: defaultConfig(),
      onValue, onVariant,
    });
    change(container.querySelector("#field-name")!, "Kestrel");
    expect(onValue).toHaveBeenCalledWith(expect.objectContaining({ id: "name" }), "Kestrel");

    const collabCheckbox = container.querySelector("#variant-collab") as HTMLInputElement;
    act(() => { collabCheckbox.click(); });
    expect(onVariant).toHaveBeenCalledWith("collab", true);
  });

  it("shows a validation error for a bad code value", () => {
    const cfg = defaultConfig();
    cfg.upc = "123";
    renderList({
      master: lolevMaster(), enabledVariants: [], cfg,
      onValue: vi.fn(), onVariant: vi.fn(),
    });
    // Pinned to validateUpc's real message (src/upc.ts): `"${value}" is not
    // a valid UPC-A code (12 digits).`
    expect(container.textContent).toMatch(/digit/i);
  });

  // The Collab variant's two logo slots are ordinary image fields now (Task
  // 5c) — the bespoke inspector wells are gone, so this well IS the only way
  // to load a partner's logo. Its file input, its mint-and-write, and its
  // clear each have a test here for exactly that reason.
  describe("image fields", () => {
    const png = () => new File([new Uint8Array([1, 2, 3])], "partner.png", { type: "image/png" });

    it("renders a real file well, not a Design-mode note", () => {
      renderList({
        master: lolevMaster(), enabledVariants: ["collab"], cfg: defaultConfig(),
        onValue: vi.fn(), onVariant: vi.fn(),
      });
      const well = container.querySelector("#field-collabLeft") as HTMLInputElement;
      expect(well).not.toBeNull();
      expect(well.type).toBe("file");
      expect(container.textContent).not.toMatch(/Set in Design mode/);
    });

    it("mints an asset id for a dropped file and writes it as the field value", async () => {
      const onValue = vi.fn();
      const onImageFile = vi.fn(async () => "asset-42");
      renderList({
        master: lolevMaster(), enabledVariants: ["collab"], cfg: defaultConfig(),
        onValue, onVariant: vi.fn(), onImageFile,
      });
      const file = png();
      drop(container.querySelector("#field-collabLeft")!, file);
      await act(async () => {});
      expect(onImageFile).toHaveBeenCalledWith(file);
      expect(onValue).toHaveBeenCalledWith(
        expect.objectContaining({ id: "collabLeft" }), "asset-42");
    });

    it("clears back to no asset", () => {
      const onValue = vi.fn();
      const cfg = defaultConfig();
      (cfg.collabCenter as { image?: string }).image = "asset-7";
      renderList({
        master: lolevMaster(), enabledVariants: ["collab"], cfg,
        onValue, onVariant: vi.fn(),
      });
      const clear = container.querySelector("#field-collabCenter-clear") as HTMLButtonElement;
      expect(clear).not.toBeNull();
      act(() => { clear.click(); });
      expect(onValue).toHaveBeenCalledWith(
        expect.objectContaining({ id: "collabCenter" }), "");
    });
  });
});
