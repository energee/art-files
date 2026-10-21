// masterpicker-dom.test.tsx — DOM behavior of MasterPicker
// (src/components/MasterPicker.tsx): the Design sidebar's "Master: Lolev ▾"
// selector. Choosing another library master previews the rebind
// (model/rebindLayers.ts) — the counts of what would move to the bench — and
// must NOT call onMaster until the inline "Continue" is pressed; a rebind
// that would bench nothing commits at once. File → Open Master's `offer`
// shows the same card and runs its own commit on Continue.
// Scoped to a DOM environment per-file, matching tests/fieldlist-dom.test.ts's
// setup — no @testing-library/react in this repo, so this drives real DOM
// nodes through react-dom/client + act, the same as that suite.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { MasterPicker, entryDetails } from "../src/components/MasterPicker";
import { lolevMaster } from "../src/model/lolevLayers";
import type { LabelFile, Master } from "../src/model/layers";

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
    onRenameVersion: vi.fn(), onRemoveVersion: vi.fn(), onSaveMaster: vi.fn(), saveLabel: "Save Master…", onForget: vi.fn().mockResolvedValue(vi.fn()),
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

  // Nothing would be benched, so there is nothing to confirm: the switch
  // commits at once (⌘Z undoes it like any other edit).
  it("switches straight to a master that would bench nothing", async () => {
    const onMaster = vi.fn();
    const same: Master = { ...lolevMaster(), id: "other", name: "Other Brewery" };
    const resolve = vi.fn().mockResolvedValue({ master: same, assets: {} });
    renderPicker({ onMaster, resolve, label: { ...label, enabledVariants: [] } });
    openMenu();
    await act(async () => {
      itemStarting("Other Brewery")!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector("#master-picker-preview")).toBeNull();
    expect(onMaster).toHaveBeenCalledWith(same, {});
  });

  // With no preview there is no Continue to disable, so the Select itself
  // stays disabled until the switch lands: a second pick in that window was
  // silently dropped by commit's guard.
  it("keeps the picker disabled while a switch with nothing to confirm commits", async () => {
    let finish!: () => void;
    const onMaster = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const same: Master = { ...lolevMaster(), id: "other", name: "Other Brewery" };
    const resolve = vi.fn().mockResolvedValue({ master: same, assets: {} });
    renderPicker({ onMaster, resolve, label: { ...label, enabledVariants: [] } });
    openMenu();
    await act(async () => {
      itemStarting("Other Brewery")!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const trigger = () => container.querySelector("#master-picker") as HTMLButtonElement;
    expect(onMaster).toHaveBeenCalledTimes(1);
    expect(trigger().disabled).toBe(true);
    await act(async () => { finish(); await Promise.resolve(); });
    expect(trigger().disabled).toBe(false);
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

  // File → Open Master hands the picker a switch that would hide values:
  // the same card, but Continue runs the opener's own commit (it binds the
  // file only then), and Cancel runs nothing.
  // Keeps the variant, drops the "name" layer: hides exactly 1 filled field.
  const nameless: Master = { ...lolevMaster(), id: "other", name: "Other Brewery",
    layers: lolevMaster().layers.filter((l) => l.id !== "name") };
  const offer = (commit = vi.fn(async () => {})) => ({ target: nameless, assets: {}, commit });

  it("previews an opened master and runs its own commit on Continue, not onMaster", async () => {
    const onMaster = vi.fn();
    const props = renderPicker({ onMaster });
    const o = offer();
    act(() => { root.render(createElement(MasterPicker, { ...props, offer: o })); });
    const preview = container.querySelector("#master-picker-preview");
    expect(preview?.textContent).toContain('Switching to "Other Brewery" hides 1 filled field');
    // Focus lands on Cancel: the command ran from a menu, so focus is elsewhere.
    expect(document.activeElement?.textContent).toBe("Cancel");
    await act(async () => {
      (container.querySelector("#master-picker-continue") as HTMLButtonElement).click();
    });
    expect(o.commit).toHaveBeenCalledOnce();
    expect(onMaster).not.toHaveBeenCalled();
    expect(container.querySelector("#master-picker-preview")).toBeNull();
  });

  it("Cancel on an opened master commits nothing and reports the offer done", () => {
    const onOfferDone = vi.fn();
    const props = renderPicker({ onOfferDone });
    const o = offer();
    act(() => { root.render(createElement(MasterPicker, { ...props, offer: o })); });
    expect(container.querySelector("#master-picker-preview")).not.toBeNull();
    act(() => { (document.activeElement as HTMLButtonElement).click(); });
    expect(container.querySelector("#master-picker-preview")).toBeNull();
    expect(o.commit).not.toHaveBeenCalled();
    expect(props.onMaster).not.toHaveBeenCalled();
    expect(onOfferDone).toHaveBeenCalledOnce();
    // Cancel unmounted itself: focus goes back to the picker's trigger.
    expect(document.activeElement).toBe(trigger());
    // A re-render with the same offer does not bring the card back.
    act(() => { root.render(createElement(MasterPicker, { ...props, offer: o })); });
    expect(container.querySelector("#master-picker-preview")).toBeNull();
  });

  // App withdraws the offer when another switch lands (a second Open Master
  // that hides nothing): the card must not keep offering the old commit.
  it("closes an opened master's card when the offer is withdrawn", () => {
    const props = renderPicker();
    act(() => { root.render(createElement(MasterPicker, { ...props, offer: offer() })); });
    expect(container.querySelector("#master-picker-preview")).not.toBeNull();
    act(() => { root.render(createElement(MasterPicker, { ...props, offer: null })); });
    expect(container.querySelector("#master-picker-preview")).toBeNull();
  });

  // Removing the card's master from the library withdraws the card: a
  // Continue would otherwise put the master straight back.
  it("closes the card when its master is removed from the library", async () => {
    const onOfferDone = vi.fn();
    const props = renderPicker({
      onOfferDone, library: { lolev: { name: "Lolev" }, other: { name: "Other Brewery", inLibrary: true } },
    });
    const o = offer();
    act(() => { root.render(createElement(MasterPicker, { ...props, offer: o })); });
    expect(container.querySelector("#master-picker-preview")).not.toBeNull();
    openMenu();
    const x = document.querySelector('[aria-label="Remove Other Brewery from the library"]') as HTMLButtonElement;
    await act(async () => {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        x.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      }
      await Promise.resolve();
    });
    expect(props.onForget).toHaveBeenCalledWith("other");
    expect(container.querySelector("#master-picker-preview")).toBeNull();
    expect(onOfferDone).toHaveBeenCalledOnce();
    expect(o.commit).not.toHaveBeenCalled();
  });

  // The counts follow edits made while the card is open, not the label as
  // it was when the card opened.
  it("recounts what the switch hides when the label changes under the card", () => {
    const props = renderPicker();
    const o = offer();
    act(() => { root.render(createElement(MasterPicker, { ...props, offer: o })); });
    const line = () => container.querySelector("#master-picker-preview")?.textContent;
    expect(line()).toContain("hides 1 filled field");
    const cleared = { ...label, values: {} };
    act(() => { root.render(createElement(MasterPicker, { ...props, label: cleared, offer: o })); });
    expect(line()).toContain("hides nothing");
  });

  it("returns focus to the trigger when a pick's preview is cancelled", async () => {
    renderPicker();
    openMenu();
    await act(async () => {
      itemStarting("Other Brewery")!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const cancel = [...container.querySelectorAll("#master-picker-preview button")].find((b) => b.textContent === "Cancel") as HTMLButtonElement;
    act(() => { cancel.click(); });
    expect(document.activeElement).toBe(trigger());
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

  it("says a deleted variant comes back with Undo (#426)", () => {
    // isMacOS() reads the user agent; happy-dom's is Linux (Ctrl+Z).
    const ua = vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Macintosh");
    onTestFinished(() => ua.mockRestore());
    const props = renderPicker({ version: "collab" });
    act(() => { (container.querySelector("#variant-remove") as HTMLButtonElement).click(); });
    // App's delete drops the variant from the master and the version.
    const without = { ...props.master, variants: [] };
    act(() => { root.render(createElement(MasterPicker, { ...props, master: without, version: null })); });
    const status = () => container.querySelector('[role="status"]')!.textContent!;
    expect(status()).toContain("Deleted “Collab”");
    expect(status()).toContain("⌘Z");
    // ⌘Z puts it back; the note goes with it.
    act(() => { root.render(createElement(MasterPicker, props)); });
    expect(status()).toBe("");
  });

  it("drops the delete note once another master replaces the one the delete left (#426)", () => {
    const props = renderPicker({ version: "collab" });
    act(() => { (container.querySelector("#variant-remove") as HTMLButtonElement).click(); });
    const without = { ...props.master, variants: [] };
    act(() => { root.render(createElement(MasterPicker, { ...props, master: without, version: null })); });
    const status = () => container.querySelector('[role="status"]')!.textContent!;
    expect(status()).toContain("Deleted “Collab”");
    // File → Open (or any later master edit) brings a different master that
    // also lacks the variant; Open resets the history, so ⌘Z can't help.
    const opened = { ...props.master, id: "other", variants: [] };
    act(() => { root.render(createElement(MasterPicker, { ...props, master: opened, version: null })); });
    expect(status()).toBe("");
  });

  it("opens the Save Master review from the picker, for the named version", () => {
    const onSaveMaster = vi.fn();
    renderPicker({ version: "collab", onSaveMaster, saveLabel: "Save Variant…" });
    const save = container.querySelector("#variant-save") as HTMLButtonElement;
    // The File menu's own wording for the same command (App passes it).
    expect(save.textContent).toBe("Save Variant…");
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
    // The note took the focused Undo with it: focus lands on the picker.
    expect(document.activeElement).toBe(trigger());
  });

  // Every open tab keeps its editor mounted (TabsShell hides inactive ones), so
  // the page holds one #master-picker per tab: Undo must focus its own picker,
  // not the first one in the document.
  it("Undo focuses its own picker when another tab's picker comes first", async () => {
    const otherTab = document.createElement("button");
    otherTab.id = "master-picker";
    document.body.prepend(otherTab);
    try {
      renderPicker({
        library: { lolev: { name: "Lolev" }, other: { name: "Other Brewery", inLibrary: true } },
      });
      openMenu();
      const x = document.querySelector('[aria-label="Remove Other Brewery from the library"]') as HTMLButtonElement;
      await act(async () => { x.click(); await Promise.resolve(); });
      const undoButton = container.querySelector("#master-picker-removed button") as HTMLButtonElement;
      await act(async () => { undoButton.click(); await Promise.resolve(); });
      expect(document.activeElement).toBe(trigger());
    } finally {
      otherTab.remove();
    }
  });

  // A second press while the first removal is still running would snapshot a
  // row that is already gone, and its empty undo would replace the real one.
  it("ignores a second remove of the same master while the first is running", async () => {
    let finish: (undo: () => Promise<void>) => void = () => {};
    const onForget = vi.fn(() => new Promise<() => Promise<void>>((r) => { finish = r; }));
    renderPicker({
      onForget,
      library: { lolev: { name: "Lolev" }, other: { name: "Other Brewery", inLibrary: true } },
    });
    openMenu();
    const x = document.querySelector('[aria-label="Remove Other Brewery from the library"]') as HTMLButtonElement;
    await act(async () => { x.click(); x.click(); await Promise.resolve(); });
    expect(onForget).toHaveBeenCalledTimes(1);
    await act(async () => { finish(vi.fn()); await Promise.resolve(); });
  });

  // One removal finishing must not clear another's double-press guard.
  it("still ignores a second remove of one master after another removal finishes", async () => {
    const finish: Record<string, (undo: () => Promise<void>) => void> = {};
    const onForget = vi.fn((id: string) => new Promise<() => Promise<void>>((r) => { finish[id] = r; }));
    renderPicker({
      onForget,
      library: {
        lolev: { name: "Lolev" },
        a: { name: "A", inLibrary: true },
        b: { name: "B", inLibrary: true },
      },
    });
    openMenu();
    const x = (name: string) => document.querySelector(`[aria-label="Remove ${name} from the library"]`) as HTMLButtonElement;
    await act(async () => { x("A").click(); x("B").click(); await Promise.resolve(); });
    await act(async () => { finish.a(vi.fn()); await Promise.resolve(); });
    await act(async () => { x("B").click(); await Promise.resolve(); });
    expect(onForget).toHaveBeenCalledTimes(2);
    await act(async () => { finish.b(vi.fn()); await Promise.resolve(); });
  });

  // A live region inserted with its text is often not announced: the status
  // container is there before the removal and only its contents change.
  it("announces a removal through a live region that was already mounted", async () => {
    renderPicker({
      library: { lolev: { name: "Lolev" }, other: { name: "Other Brewery", inLibrary: true } },
    });
    const regions = [...container.querySelectorAll('[role="status"]')];
    openMenu();
    const x = document.querySelector('[aria-label="Remove Other Brewery from the library"]') as HTMLButtonElement;
    await act(async () => { x.click(); await Promise.resolve(); });
    expect(regions.some((r) => r.isConnected && r.textContent?.includes("The file stays where it is."))).toBe(true);
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

  it("labels the current master and the others, each row with its file and last use", () => {
    renderPicker({ library: {
      lolev: { name: "Lolev", builtIn: true },
      other: { name: "Lolev", inLibrary: true, path: "/Users/x/Labels/collab.master", lastSeen: "2026-10-01T12:00:00Z" },
    } });
    openMenu();
    const text = document.body.textContent ?? "";
    expect(text).toContain("Current master");
    expect(text).toContain("Other masters");
    // Two masters named "Lolev" are told apart by file.
    expect(text).toContain("collab.master · Used");
    expect(text).toContain("Built in");
  });

  it("entryDetails: Built in only for the shipped master, folder on a shared file name", () => {
    const d = entryDetails([
      ["lolev", { name: "Lolev", builtIn: true }],
      ["fork", { name: "Fork", path: "", lastSeen: "nope" }],
      ["a", { name: "Lolev", path: "/Users/x/Labels/lolev.master" }],
      ["b", { name: "Lolev", path: "C:\\Shared\\lolev.master", lastSeen: "2026-10-01T12:00:00Z" }],
    ]);
    expect(d.lolev).toBe("Built in");
    expect(d.fork).toBe("No file");
    expect(d.a).toBe("lolev.master — Labels");
    expect(d.b).toMatch(/^lolev\.master — Shared · Used /);
  });

  it("gives each master row its name as the option label, apart from the detail", () => {
    renderPicker({ library: { lolev: { name: "Lolev" }, other: { name: "Other Brewery", path: "/x/o.master" } } });
    openMenu();
    const row = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes("o.master"))!;
    expect(row.textContent).toContain("Other Brewery, o.master");
  });

});
