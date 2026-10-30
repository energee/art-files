// app-ux-commands-dom.test.tsx — the editor's command table and header, end
// to end: ⌘= (or ⌘+) / ⌘- / ⌘0 zoom the preview; the palette offers Add …
// Layer and Remove Layer, and Delete/Backspace removes the selection outside
// a text field or a focused button; the Layers list marks an invalid layer
// with an error dot (what an export on a blocked label says is in
// export-blocked-toast-dom.test.tsx); the PDF exports don't wait for the
// preview; and the master library is re-read from localStorage only when it
// changes, not per render.
// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { packLabel } from "../src/model/files";
import { mountToaster, settle, shown, toastTitles, unmountToaster } from "./real-timer-toaster";

const counts = vi.hoisted(() => ({ masterIndex: 0 }));
// The preview's font load never settles here (unless a test makes it fail),
// so the preview stays "rendering" throughout.
const fonts = vi.hoisted(() => ({ pending: new Promise<never>(() => {}), fail: false, loads: 0 }));
vi.mock("../src/masterCache", () => ({ cacheMaster: async () => {}, cachedMaster: async () => null, dropCachedMaster: async () => {} }));
vi.mock("../src/masters", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/masters")>();
  return { ...real, masterIndex: () => { counts.masterIndex++; return real.masterIndex(); } };
});
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("../src/components/PreviewCompare", () => ({ SNAP_PT: 6, PreviewCompare: () => null }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: () => {
    fonts.loads++;
    return fonts.fail ? Promise.reject(new Error("font file is gone")) : fonts.pending;
  },
  labelFontCss: () => "sans-serif",
}));
const { DocumentEditor } = await import("../src/App");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView ??= () => undefined;

const editorProps = (): ComponentProps<typeof DocumentEditor> => ({
  active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta: vi.fn(),
  saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
  onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
  onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
});

let cleanup: (() => Promise<void>) | null = null;
beforeEach(() => { localStorage.clear(); counts.masterIndex = 0; fonts.fail = false; fonts.loads = 0; });
afterEach(async () => { await cleanup?.(); cleanup = null; await unmountToaster(); document.body.replaceChildren(); localStorage.clear(); });

async function mount(over: Partial<ComponentProps<typeof DocumentEditor>> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const props = { ...editorProps(), ...over };
  await act(async () => { root.render(createElement(DocumentEditor, props)); });
  cleanup = async () => { await act(async () => root.unmount()); container.remove(); };
  return { container, rerender: (p: Partial<ComponentProps<typeof DocumentEditor>>) =>
    act(async () => { root.render(createElement(DocumentEditor, { ...props, ...p })); }) };
}

const press = async (init: KeyboardEventInit, target: EventTarget = document.body) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  await act(async () => { target.dispatchEvent(event); });
  return event.defaultPrevented;
};
const zoomPct = (c: HTMLElement) => Number((c.querySelector('[aria-label="Zoom percentage"]') as HTMLInputElement).value);
const rowSelected = (c: HTMLElement, id: string) =>
  c.querySelector(`[data-layer-id="${id}"] [data-slot="sidebar-menu-button"]`)?.getAttribute("aria-pressed") === "true";

/** Open the ⌘K palette and return its rows' text. */
async function paletteRows(): Promise<string[]> {
  await press({ key: "k", metaKey: true });
  await vi.waitFor(() => expect(document.querySelector("[data-slot=command-item]")).not.toBeNull(), { timeout: 30000 });
  return [...document.querySelectorAll("[data-slot=command-item]")].map((el) => el.textContent ?? "");
}

it("zooms the preview in, out and back to fit with ⌘=, ⌘- and ⌘0", async () => {
  const { container } = await mount();
  expect(zoomPct(container)).toBe(100);
  expect(await press({ key: "=", metaKey: true })).toBe(true);
  expect(zoomPct(container)).toBeGreaterThan(100);
  const zoomed = zoomPct(container);
  await press({ key: "=", metaKey: true });
  expect(zoomPct(container)).toBeGreaterThan(zoomed);
  await press({ key: "-", metaKey: true });
  expect(zoomPct(container)).toBe(zoomed);
  await press({ key: "0", metaKey: true });
  expect(zoomPct(container)).toBe(100);
  // Fitted is the floor: zooming out from it stays fitted.
  await press({ key: "-", metaKey: true });
  expect(zoomPct(container)).toBe(100);
});

// ⌘+ is Zoom In too: "+" is Shift+= on a US keyboard and its own key on
// many others, and it is the zoom-in key every other app answers to.
it("zooms in with ⌘+ as well as ⌘=", async () => {
  const { container } = await mount();
  expect(await press({ key: "+", metaKey: true, shiftKey: true })).toBe(true);
  expect(zoomPct(container)).toBeGreaterThan(100);
  const zoomed = zoomPct(container);
  await press({ key: "+", metaKey: true });
  expect(zoomPct(container)).toBeGreaterThan(zoomed);
});

it("leaves the zoom keys to the tab behind an open dialog", async () => {
  const { container } = await mount();
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("data-slot", "dialog-content");
  document.body.appendChild(dialog);
  await press({ key: "=", metaKey: true });
  expect(zoomPct(container)).toBe(100);
});

it("removes the selected layer with Delete or Backspace, but not while typing", async () => {
  const { container } = await mount();
  const select = (id: string) => act(async () => {
    (container.querySelector(`[data-layer-id="${id}"] [data-slot="sidebar-menu-button"]`) as HTMLElement).click();
  });
  await select("barcode");
  expect(rowSelected(container, "barcode")).toBe(true);
  const input = document.createElement("input");
  container.appendChild(input);
  input.focus();
  expect(await press({ key: "Backspace" }, input)).toBe(false);
  expect(container.querySelector('[data-layer-id="barcode"]')).not.toBeNull();
  input.remove();
  // A focused button (a toolbar control, a toast's action) owns the key too.
  const button = document.createElement("button");
  container.appendChild(button);
  button.focus();
  expect(await press({ key: "Backspace" }, button)).toBe(false);
  expect(container.querySelector('[data-layer-id="barcode"]')).not.toBeNull();
  button.remove();
  expect(await press({ key: "Delete" })).toBe(true);
  expect(container.querySelector('[data-layer-id="barcode"]')).toBeNull();
  await select("qr");
  await press({ key: "Backspace" });
  expect(container.querySelector('[data-layer-id="qr"]')).toBeNull();
  // Nothing selected: the key is left alone.
  expect(await press({ key: "Delete" })).toBe(false);
});

it("offers Add … Layer and Remove Layer in the palette", async () => {
  await mount();
  const rows = await paletteRows();
  for (const label of ["Add Text Layer", "Add Image Layer", "Add Barcode Layer", "Add QR Layer", "Remove Layer"])
    expect(rows.some((r) => r.startsWith(label)), label).toBe(true);
});

// The PDF builds load their own fonts and full-size art; the preview's
// render source is not an input, so the exports don't wait for it.
it("offers the combined PDF and its As… row while the preview is still rendering", async () => {
  await mount();
  await paletteRows();
  const items = [...document.querySelectorAll<HTMLElement>("[data-slot=command-item]")];
  for (const label of ["Export PDF", "Export PDF As…", "Export PSD", "Export PSD As…"]) {
    const shortcut = (el: HTMLElement) => el.querySelector("[data-slot=command-shortcut]")?.textContent ?? "";
    const row = items.find((el) => el.textContent?.replace(shortcut(el), "") === label);
    expect(row, label).toBeDefined();
    expect(row!.getAttribute("data-disabled"), label).not.toBe("true");
  }
  expect(items.some((el) => el.textContent?.startsWith("Export PDFs"))).toBe(false);
  expect(items.some((el) => el.textContent?.startsWith("Export PSDs"))).toBe(false);
});

// Settings → Two-file export: ⌘E / ⇧⌘E move to the pairs, the single PDF
// plates show, and the one-file exports go.
it("with two-file export on, ⌘E and ⇧⌘E export the pairs", async () => {
  await mount({ render: { ...DEFAULT_RENDER, twoFilePdfExport: true } });
  await paletteRows();
  const rows = paletteGroups().Export;
  expect(rows.map((r) => r.replace(/(⇧?⌘|Ctrl).*$/, ""))).toEqual([
    "Export PDFs", "Export PDFs As…", "Export Artwork PDF", "Export Mask PDF", "Export PSDs", "Export PSDs As…",
  ]);
  expect(rows[0]).toMatch(/^Export PDFs.+E$/);
  expect(rows[4]).toMatch(/^Export PSDs.+E$/);
});

it("shows a failed preview build's bare reason in one toast", async () => {
  fonts.fail = true;
  await mountToaster();
  await mount();
  await shown("font file is gone");
  // Asset assembly is debounced (150 ms) and loads the fonts again, failing the
  // same way: wait for that attempt, then let a duplicate toast land too.
  await vi.waitFor(() => expect(fonts.loads).toBeGreaterThanOrEqual(2));
  await settle();
  expect(toastTitles()).toEqual(["font file is gone"]);
}, 30_000);

it("adds a layer from the palette", async () => {
  const { container } = await mount();
  const before = container.querySelectorAll("[data-layer-id]").length;
  await paletteRows();
  const add = [...document.querySelectorAll<HTMLElement>("[data-slot=command-item]")]
    .find((el) => el.textContent?.startsWith("Add QR Layer"))!;
  await act(async () => { add.click(); });
  expect(container.querySelectorAll("[data-layer-id]").length).toBe(before + 1);
});

const badLabel = () => {
  const bytes = packLabel({ formatVersion: 3, masterId: "lolev", enabledVariants: [], values: { barcode: "123" } }, {});
  return { seq: 1, file: new File([bytes as unknown as BlobPart], "bad.label") };
};

it("marks the invalid layer's row in the Layers list", async () => {
  const { container, rerender } = await mount();
  await rerender({ fileToOpen: badLabel() });
  await vi.waitFor(() => expect(container.querySelector('[data-layer-id="barcode"] [aria-label="Invalid value"]')).not.toBeNull());
  expect(container.querySelector('[data-layer-id="name"] [aria-label="Invalid value"]')).toBeNull();
  // The marking is passive: nothing selects the layer until the user (or the
  // blocked export's Show layer action) does.
  expect(rowSelected(container, "barcode")).toBe(false);
});

// A per-beer override is this label's, saved by ⌘S: the picker's pink
// Save Master… button stays hidden, while File → Save Master… stays enabled
// so the override can still be promoted.
it("hides the picker's Save Master button for an override-only label", async () => {
  const onOpenSettled = vi.fn();
  const { container, rerender } = await mount({ onOpenSettled });
  const bytes = packLabel({ formatVersion: 3, masterId: "lolev", enabledVariants: [], values: {}, overrides: { name: { x: 10 } } }, {});
  await rerender({ fileToOpen: { seq: 1, file: new File([bytes as unknown as BlobPart], "moved.label") } });
  await vi.waitFor(() => expect(onOpenSettled).toHaveBeenCalled());
  expect(container.querySelector("#variant-save")).toBeNull();
  await paletteRows();
  expect(paletteRow("Save Master…").getAttribute("data-disabled")).not.toBe("true");
});

it("reads the master library once, not on every render", async () => {
  await mount();
  await vi.waitFor(() => expect(counts.masterIndex).toBeGreaterThan(0));
  const reads = counts.masterIndex;
  for (let i = 0; i < 4; i++) await press({ key: "r" }); // re-render: rulers on/off
  expect(counts.masterIndex).toBe(reads);
});

it("re-reads the library when its tab comes back to the front", async () => {
  const { container, rerender } = await mount();
  await rerender({ active: false });
  const { rememberMaster } = await import("../src/masters");
  const { lolevMaster } = await import("../src/model/lolevLayers");
  await rememberMaster({ ...lolevMaster(), id: "master-other", name: "Another Brewery" }, "other.master");
  await rerender({ active: true });
  await act(async () => { (container.querySelector("#master-picker") as HTMLElement).click(); });
  expect([...document.querySelectorAll("[role=option]")].some((o) => o.textContent?.includes("Another Brewery"))).toBe(true);
});

// The library memo re-reads storage only when refreshLibrary bumps it, so
// every path that changes the library must bump it: here Remove and its Undo.
it("re-lists a master the picker removed and then put back", async () => {
  const { rememberMaster } = await import("../src/masters");
  const { lolevMaster } = await import("../src/model/lolevLayers");
  await rememberMaster({ ...lolevMaster(), id: "master-other", name: "Another Brewery" }, "other.master", undefined, { applied: false });
  const { container } = await mount();
  const listed = () => [...document.querySelectorAll("[role=option]")].some((o) => o.textContent?.includes("Another Brewery"));
  const openPicker = () => act(async () => { (container.querySelector("#master-picker") as HTMLElement).click(); });
  await openPicker();
  expect(listed()).toBe(true);
  const x = document.querySelector('[aria-label="Remove Another Brewery from the library"]') as HTMLElement;
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
      x.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Undo")).toBe(true));
  await vi.waitFor(() => expect(listed()).toBe(false));
  const undo = [...container.querySelectorAll("button")].find((b) => b.textContent === "Undo")!;
  await act(async () => { undo.click(); });
  await openPicker();
  await vi.waitFor(() => expect(listed()).toBe(true));
});

/** The palette's rows grouped under their headings, in order. */
function paletteGroups(): Record<string, string[]> {
  return Object.fromEntries([...document.querySelectorAll("[data-slot=command-group]")].map((group) => [
    group.querySelector("[cmdk-group-heading]")?.textContent ?? "",
    [...group.querySelectorAll("[data-slot=command-item]")].map((el) => el.textContent ?? ""),
  ]));
}
const paletteRow = (text: string) => [...document.querySelectorAll<HTMLElement>("[data-slot=command-item]")]
  .find((el) => el.textContent?.startsWith(text))!;

it("names palette rows as the menus do, grouped by menu, with a check for what is on", async () => {
  await mount();
  await paletteRows();
  const groups = paletteGroups();
  expect(Object.keys(groups)).toEqual(["File", "Export", "Edit", "Layer", "View", "Units", "Appearance", "Other"]);
  expect(groups.File.map((r) => r.replace(/(⌘|Ctrl).*$/, ""))).toEqual([
    "New Tab", "Open Label…", "Close Tab", "Save Label", "Save Label As…",
    "Open Master…", "Save Master…", "Save Master As…",
  ]);
  expect(groups.Export.map((r) => r.replace(/(⇧?⌘|Ctrl).*$/, ""))).toEqual([
    "Export PDF", "Export PDF As…", "Export PSD", "Export PSD As…",
  ]);
  expect(groups.Layer.map((r) => r.replace(/⌫$/, ""))).toEqual([
    "Add Text Layer", "Add Image Layer", "Add Barcode Layer", "Add QR Layer", "Remove Layer",
  ]);
  expect(groups.View.slice(0, 9).map((r) => r.replace(/(⌘|Ctrl\+)?[0-9A-Z]$/, ""))).toEqual([
    "Label", "Mask", "Rendered", "Can", "One Can", "Four-Pack", "Layers", "Rulers", "Guides",
  ]);
  expect(groups.Units).toEqual(["Inches", "Millimetres", "Points", "Pixels"]);
  expect(groups.Appearance).toEqual(["System", "Light", "Dark"]);
  expect(groups.Other).toEqual(["New Variant"]);
  // State is a leading check, not a Show/Hide verb: the defaults are on.
  const on = [...document.querySelectorAll("[data-palette-check=on]")]
    .map((el) => el.closest("[data-slot=command-item]")?.textContent?.replace(/(Ctrl\+)?[0-9A-Z]$/, ""));
  expect(on).toEqual(["Label", "One Can", "Layers", "Rulers", "Guides", "Inches", "System"]);
  // A group with check rows reserves the check's space on its plain rows
  // too, so every title in it lines up; a group without them reserves none.
  expect(paletteRow("Zoom In").firstElementChild?.matches("svg.invisible[aria-hidden=true]")).toBe(true);
  expect(paletteRow("New Tab").firstElementChild?.matches("svg")).toBe(false);
});

it("finds a view or theme row by its old palette wording and its menu", async () => {
  await mount();
  await paletteRows();
  const input = document.querySelector("[data-slot=command-input]") as HTMLInputElement;
  const search = async (text: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return [...document.querySelectorAll("[data-slot=command-item]")].map((el) => el.textContent ?? "");
  };
  expect((await search("preview: mask")).some((r) => r.startsWith("Mask"))).toBe(true);
  expect((await search("hide rulers")).some((r) => r.startsWith("Rulers"))).toBe(true);
  expect((await search("view can")).some((r) => r.startsWith("Can"))).toBe(true);
  expect((await search("appearance dark"))).toEqual(["Dark"]);
  expect((await search("theme")).length).toBe(3);
});

it("toggles the Layers sidebar from the palette and names ⌘B on its trigger", async () => {
  const { container } = await mount();
  const sidebar = () => container.querySelector("[data-slot=sidebar]")!.getAttribute("data-state");
  expect(sidebar()).toBe("expanded");
  expect(container.querySelector("[data-slot=sidebar-trigger]")?.getAttribute("title")).toBe("Layers (Ctrl+B)");
  // Its accessible name matches the tooltip, not shadcn's "Toggle Sidebar".
  expect(container.querySelector("[data-slot=sidebar-trigger]")?.getAttribute("aria-label")).toBe("Layers");
  await paletteRows();
  await act(async () => { paletteRow("Layers").click(); });
  expect(sidebar()).toBe("collapsed");
  // ⌘B still goes through the provider's guarded listener.
  await press({ key: "b", metaKey: true });
  expect(sidebar()).toBe("expanded");
});

it("switches the appearance from the palette", async () => {
  await mount();
  await paletteRows();
  await act(async () => { paletteRow("Dark").click(); });
  expect(document.documentElement.dataset.theme).toBe("dark");
  await paletteRows();
  await act(async () => { paletteRow("System").click(); });
  expect(document.documentElement.dataset.theme).toBeUndefined();
});
