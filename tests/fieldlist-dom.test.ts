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
import { visibleFieldsOf } from "../src/model/document";
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

type FieldListProps = Parameters<typeof FieldList>[0];
function renderList(
  props: Omit<FieldListProps, "onImageFile" | "onImageClear" | "onImageError">
    & Partial<Pick<FieldListProps, "onImageFile" | "onImageClear" | "onImageError">>,
) {
  act(() => {
    root.render(createElement(FieldList, {
      onImageFile: vi.fn(async () => "asset-x"),
      onImageClear: vi.fn(),
      onImageError: vi.fn(),
      ...props,
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

const lolevFields = (enabledVariants: string[] = []) =>
  visibleFieldsOf(lolevMaster(), enabledVariants);

describe("FieldList", () => {
  it("lists the master's fields with current values and no variant controls", () => {
    const cfg = defaultConfig();
    cfg.beerName = "Peregrine";
    renderList({
      fields: lolevFields(), cfg,
      onValue: vi.fn(),
    });
    const nameInput = container.querySelector("#field-name") as HTMLInputElement;
    expect(nameInput.value).toBe("Peregrine");
    expect(container.querySelector("#variant-collab")).toBeNull();
  });

  it("edits write through onValue", () => {
    const onValue = vi.fn();
    renderList({
      fields: lolevFields(), cfg: defaultConfig(),
      onValue,
    });
    change(container.querySelector("#field-name")!, "Kestrel");
    expect(onValue).toHaveBeenCalledWith(expect.objectContaining({ id: "name" }), "Kestrel");
  });

  it("shows a validation error for a bad code value", () => {
    const cfg = defaultConfig();
    cfg.upc = "123";
    renderList({
      fields: lolevFields(), cfg,
      onValue: vi.fn(),
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
        fields: lolevFields(["collab"]), cfg: defaultConfig(),
        onValue: vi.fn(),
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
        fields: lolevFields(["collab"]), cfg: defaultConfig(),
        onValue, onImageFile,
      });
      const file = png();
      drop(container.querySelector("#field-collabLeft")!, file);
      await act(async () => {});
      expect(onImageFile).toHaveBeenCalledWith(file, expect.objectContaining({ id: "collabLeft" }));
      expect(onValue).toHaveBeenCalledWith(
        expect.objectContaining({ id: "collabLeft" }), "asset-42");
    });

    // Finding #17: dropping a corrupt raster makes onImageFile's promise
    // reject (createImageBitmap failing) AFTER the file input's value is
    // already reset — the row's onChange used to fire this with no .catch at
    // all, so the rejection went nowhere but an unhandled-rejection warning
    // and the user saw nothing happen. It must now reach onImageError.
    it("surfaces an onImageFile rejection through onImageError, not an unhandled rejection", async () => {
      const onValue = vi.fn();
      const onImageError = vi.fn();
      const boom = new Error("could not decode image");
      const onImageFile = vi.fn(async () => { throw boom; });
      renderList({
        fields: lolevFields(["collab"]), cfg: defaultConfig(),
        onValue, onImageFile, onImageError,
      });
      drop(container.querySelector("#field-collabLeft")!, png());
      await act(async () => {});
      expect(onImageError).toHaveBeenCalledWith(boom);
      expect(onValue).not.toHaveBeenCalled();
    });

    it("clears back to no asset, releasing the old asset id (finding #16)", () => {
      const onValue = vi.fn();
      const onImageClear = vi.fn();
      const cfg = defaultConfig();
      (cfg.collabCenter as { image?: string }).image = "asset-7";
      renderList({
        fields: lolevFields(["collab"]), cfg,
        onValue, onImageClear,
      });
      const clear = container.querySelector("#field-collabCenter-clear") as HTMLButtonElement;
      expect(clear).not.toBeNull();
      act(() => { clear.click(); });
      expect(onImageClear).toHaveBeenCalledWith(expect.objectContaining({ id: "collabCenter" }));
      expect(onValue).toHaveBeenCalledWith(
        expect.objectContaining({ id: "collabCenter" }), "");
    });

    // Final-review MUST-FIX: the well used to give NO sign a file had loaded
    // beyond the "Clear" button appearing — a filler swapping two partner
    // logos couldn't tell which slot held which. A loaded field now surfaces
    // its filename and a thumbnail (imageFileOf, looked up off App's
    // customImages store); an empty one shows neither.
    it("shows the loaded file's name and thumbnail", () => {
      const cfg = defaultConfig();
      (cfg.collabCenter as { image?: string }).image = "asset-7";
      renderList({
        fields: lolevFields(["collab"]), cfg,
        onValue: vi.fn(),
        imageFileOf: (id) => id === "asset-7"
          ? { name: "acme-logo.png", previewUrl: "blob:acme-logo" }
          : undefined,
      });
      expect(container.textContent).toMatch(/acme-logo\.png/);
      const thumb = container.querySelector("img");
      expect(thumb).not.toBeNull();
      expect(thumb!.getAttribute("src")).toBe("blob:acme-logo");
    });

    it("shows neither a name nor a thumbnail when no file is loaded", () => {
      renderList({
        fields: lolevFields(["collab"]), cfg: defaultConfig(),
        onValue: vi.fn(),
        imageFileOf: () => ({ name: "should-not-show.png", previewUrl: "blob:unused" }),
      });
      expect(container.textContent).not.toMatch(/should-not-show\.png/);
      expect(container.querySelector("img")).toBeNull();
    });
  });
});
