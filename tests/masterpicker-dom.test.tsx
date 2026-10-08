// masterpicker-dom.test.tsx — DOM behavior of MasterPicker
// (src/components/MasterPicker.tsx): the Design sidebar's "Master: Lolev ▾"
// selector. Choosing another library master previews the rebind
// (model/rebindLayers.ts) — the counts of what would move to the bench — and
// must NOT call onMaster until the inline "Continue" is pressed.
// Scoped to a DOM environment per-file, matching tests/fieldlist-dom.test.ts's
// setup — no @testing-library/react in this repo, so this drives real DOM
// nodes through react-dom/client + act, the same as that suite.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MasterPicker } from "../src/components/MasterPicker";
import { lolevMaster } from "../src/model/lolevLayers";
import type { LabelFile, Master } from "../src/model/layers";

// React only honours act() when the environment opts in (see
// fieldlist-dom.test.ts for the same line).
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

/** A different brewery's master: no variants, so binding onto it always
 *  benches the shipped master's "collab" variant — a guaranteed non-empty
 *  preview for the assertion below. */
const otherMaster: Master = { ...lolevMaster(), id: "other", name: "Other Brewery", variants: [] };

const label: LabelFile = {
  formatVersion: 3, masterId: "lolev", enabledVariants: ["collab"],
  values: { name: [{ text: "Peregrine", fill: "#F3CD80", layer: "metallic" }] },
};

function renderPicker(props: Partial<Parameters<typeof MasterPicker>[0]> = {}) {
  const full: Parameters<typeof MasterPicker>[0] = {
    master: lolevMaster(), label,
    library: { lolev: { name: "Lolev" }, other: { name: "Other Brewery" } },
    resolve: vi.fn().mockResolvedValue({ master: otherMaster, assets: {} }),
    onMaster: vi.fn(), onNewVariant: vi.fn().mockReturnValue("variant-2"),
    onRenameVersion: vi.fn(), onRemoveVersion: vi.fn(), onSaveMaster: vi.fn(), onForget: vi.fn().mockResolvedValue(vi.fn()),
    masterDirty: true, version: null, onVersion: vi.fn(),
    ...props,
  };
  act(() => { root.render(createElement(MasterPicker, full)); });
  return full;
}

const trigger = () => container.querySelector("#master-picker") as HTMLButtonElement;
const openMenu = () => act(() => { trigger().click(); });
/** The menu item (or any button) whose visible text STARTS with `text` — the
 *  library rows may append an ellipsis while resolving. */
const itemStarting = (text: string) =>
  Array.from(document.querySelectorAll<HTMLElement>("button, [role=option]"))
    .find((b) => (b.getAttribute("aria-label") ?? b.textContent)?.trim().startsWith(text)) as HTMLButtonElement | undefined;

describe("MasterPicker", () => {
  it("names the current master on the trigger", () => {
    renderPicker();
    expect(trigger().textContent).toContain("Lolev");
  });

  it("previews the rebind and does not commit until Continue is pressed", async () => {
    const onMaster = vi.fn();
    const resolve = vi.fn().mockResolvedValue({ master: otherMaster, assets: {} });
    renderPicker({ onMaster, resolve });
    openMenu();
    await act(async () => {
      itemStarting("Other Brewery")!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(resolve).toHaveBeenCalledWith("other");
    const preview = container.querySelector("#master-picker-preview");
    expect(preview).not.toBeNull();
    expect(preview!.textContent).toContain("variant");
    expect(onMaster).not.toHaveBeenCalled();

    await act(async () => {
      (container.querySelector("#master-picker-continue") as HTMLButtonElement).click();
    });
    expect(onMaster).toHaveBeenCalledWith(otherMaster, {});
  });

  // onMaster awaits the index write and the asset decode; a second Continue
  // in that window rebound the label twice.
  it("commits once however often Continue is pressed while it runs", async () => {
    let finish!: () => void;
    const onMaster = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderPicker({ onMaster });
    openMenu();
    await act(async () => {
      itemStarting("Other Brewery")!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const button = () => container.querySelector("#master-picker-continue") as HTMLButtonElement;
    await act(async () => { button().click(); });
    await act(async () => { button().click(); });
    expect(onMaster).toHaveBeenCalledOnce();
    await act(async () => { finish(); });
  });

  it("lists the current master's variants as versions of it", () => {
    const onVersion = vi.fn();
    const resolve = vi.fn();
    renderPicker({ onVersion, resolve });
    openMenu();
    act(() => { itemStarting("Collab")!.click(); });
    expect(onVersion).toHaveBeenCalledWith("collab");
    // Switching version is not a rebind — nothing is resolved or benched.
    expect(resolve).not.toHaveBeenCalled();
  });

  it("names the version being edited on the trigger", () => {
    renderPicker({ version: "collab" });
    expect(trigger().textContent).toContain("Collab");
  });

  it("switches back to the base master without rebinding onto itself", () => {
    const onVersion = vi.fn();
    const resolve = vi.fn();
    renderPicker({ version: "collab", onVersion, resolve });
    openMenu();
    act(() => { itemStarting("Lolev")!.click(); });
    expect(onVersion).toHaveBeenCalledWith(null);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("creates a variant from the foot of the menu, without picking a master", () => {
    const onNewVariant = vi.fn();
    const onMaster = vi.fn();
    const resolve = vi.fn();
    renderPicker({ onNewVariant, onMaster, resolve });
    openMenu();
    act(() => { itemStarting("New Variant")!.click(); });
    expect(onNewVariant).toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(onMaster).not.toHaveBeenCalled();
  });

  it("opens a name field on the new variant and commits the rename", () => {
    const onRenameVersion = vi.fn();
    renderPicker({ onRenameVersion });
    openMenu();
    act(() => { itemStarting("New Variant")!.click(); });
    const input = container.querySelector('input[aria-label="Variant name"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = "  Collab  ";
    act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(onRenameVersion).toHaveBeenCalledWith("variant-2", "Collab");
  });

  it("deletes the variant being edited from the picker", () => {
    const onRemoveVersion = vi.fn();
    renderPicker({ version: "collab", onRemoveVersion });
    act(() => { (container.querySelector("#variant-remove") as HTMLButtonElement).click(); });
    expect(onRemoveVersion).toHaveBeenCalledWith("collab");
  });

  it("opens the Save Master review from the picker, for the named version", () => {
    const onSaveMaster = vi.fn();
    renderPicker({ version: "collab", onSaveMaster });
    const save = container.querySelector("#variant-save") as HTMLButtonElement;
    expect(save.textContent).toContain("Variant");
    act(() => { save.click(); });
    expect(onSaveMaster).toHaveBeenCalled();
  });

  it("cannot save when nothing would be written", () => {
    renderPicker({ masterDirty: false });
    expect((container.querySelector("#variant-save") as HTMLButtonElement).disabled).toBe(true);
  });

  it("removes a remembered master from its own row, without picking it", async () => {
    const onForget = vi.fn().mockResolvedValue(vi.fn());
    const onMaster = vi.fn();
    const resolve = vi.fn();
    renderPicker({
      onForget, onMaster, resolve,
      library: { lolev: { name: "Lolev" }, other: { name: "Other Brewery", inLibrary: true } },
    });
    openMenu();
    const x = document.querySelector('[aria-label="Remove Other Brewery from the library"]') as HTMLButtonElement;
    await act(async () => {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        x.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      }
      await Promise.resolve();
    });
    expect(onForget).toHaveBeenCalledTimes(1);
    expect(onForget).toHaveBeenCalledWith("other");
    expect(resolve).not.toHaveBeenCalled();
    expect(onMaster).not.toHaveBeenCalled();
  });

  it("removes the highlighted remembered master with Delete, for keyboard users", async () => {
    const onForget = vi.fn().mockResolvedValue(vi.fn());
    const onMaster = vi.fn();
    renderPicker({
      onForget, onMaster,
      library: { lolev: { name: "Lolev" }, other: { name: "Other Brewery", inLibrary: true } },
    });
    openMenu();
    const row = document.querySelector('[aria-label="Remove Other Brewery from the library"]')!.closest('[role="option"]') as HTMLElement;
    expect(row.getAttribute("aria-keyshortcuts")).toBe("Delete");
    const press = (key: string, repeat = false) => act(async () => {
      row.dispatchEvent(new KeyboardEvent("keydown", { key, repeat, bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await press("Backspace");
    await press("Delete", true);
    expect(onForget).not.toHaveBeenCalled();
    await press("Delete");
    expect(onForget).toHaveBeenCalledTimes(1);
    expect(onForget).toHaveBeenCalledWith("other");
    expect(onMaster).not.toHaveBeenCalled();
  });

  // #402: a removal says, in plain view, that the file is untouched, and
  // can be undone without browsing back to the file.
  it("says the file stays after a removal, and Undo puts the master back", async () => {
    const undo = vi.fn().mockResolvedValue(undefined);
    const onForget = vi.fn().mockResolvedValue(undo);
    renderPicker({
      onForget,
      library: { lolev: { name: "Lolev" }, other: { name: "Other Brewery", inLibrary: true } },
    });
    openMenu();
    const x = document.querySelector('[aria-label="Remove Other Brewery from the library"]') as HTMLButtonElement;
    await act(async () => { x.click(); await Promise.resolve(); });
    const note = container.querySelector("#master-picker-removed") as HTMLElement;
    expect(note.textContent).toContain("Removed \u201cOther Brewery\u201d from the library");
    expect(note.textContent).toContain("The file stays where it is.");
    const undoButton = note.querySelector("button") as HTMLButtonElement;
    expect(undoButton.textContent).toBe("Undo");
    await act(async () => { undoButton.click(); await Promise.resolve(); });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(container.querySelector("#master-picker-removed")).toBeNull();
  });

  it("shows no remove button on a master the library does not remember", () => {
    renderPicker({ library: { lolev: { name: "Lolev" }, other: { name: "Other Brewery", inLibrary: false } } });
    openMenu();
    expect(document.querySelector('[aria-label^="Remove "]')).toBeNull();
  });

  it("offers nothing but the library — file verbs live in the File menu", () => {
    renderPicker();
    expect(itemStarting("Open Master")).toBeUndefined();
    expect(itemStarting("Duplicate as new master")).toBeUndefined();
  });
});
