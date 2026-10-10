// app-ux-commands-dom.test.tsx — the editor's command table and header, end
// to end: ⌘= / ⌘- / ⌘0 zoom the preview; the palette offers Add … Layer and
// Remove Layer, and Delete/Backspace removes the selection outside a text
// field; a blocked export's header note is a polite status whose text selects
// the first invalid layer, which the Layers list marks with an error dot; the
// PDF export entries say "rendering…" until the preview is ready; and the
// master library is not re-read from localStorage on every render.
// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { packLabel } from "../src/model/files";

const counts = vi.hoisted(() => ({ masterIndex: 0 }));
// The preview's font load never settles here, so the preview stays
// "rendering" for the whole file and the PDF exports keep their note.
const fontsPending = vi.hoisted(() => new Promise<never>(() => {}));
vi.mock("../src/masterCache", () => ({ cacheMaster: async () => {}, cachedMaster: async () => null }));
vi.mock("../src/masters", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/masters")>();
  return { ...real, masterIndex: () => { counts.masterIndex++; return real.masterIndex(); } };
});
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("../src/components/PreviewCompare", () => ({ SNAP_PT: 6, PreviewCompare: () => null }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: () => fontsPending,
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
beforeEach(() => { localStorage.clear(); counts.masterIndex = 0; });
afterEach(async () => { await cleanup?.(); cleanup = null; document.body.replaceChildren(); localStorage.clear(); });

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
  expect(await press({ key: "Delete" })).toBe(true);
  expect(container.querySelector('[data-layer-id="barcode"]')).toBeNull();
  await select("qr");
  await press({ key: "Backspace" });
  expect(container.querySelector('[data-layer-id="qr"]')).toBeNull();
  // Nothing selected: the key is left alone.
  expect(await press({ key: "Delete" })).toBe(false);
});

it("offers Add … Layer and Remove Layer in the palette, and the PDF exports wait for the preview", async () => {
  await mount();
  const rows = await paletteRows();
  for (const label of ["Add Text Layer", "Add Image Layer", "Add Barcode Layer", "Add QR Layer", "Remove Layer"])
    expect(rows.some((r) => r.startsWith(label)), label).toBe(true);
  expect(rows.some((r) => r.startsWith("Export PDFs (rendering…)"))).toBe(true);
  expect(rows.some((r) => r.startsWith("Export PSDs (rendering"))).toBe(false);
});

it("adds a layer from the palette", async () => {
  const { container } = await mount();
  const before = container.querySelectorAll("[data-layer-id]").length;
  await paletteRows();
  const add = [...document.querySelectorAll<HTMLElement>("[data-slot=command-item]")]
    .find((el) => el.textContent?.startsWith("Add QR Layer"))!;
  await act(async () => { add.click(); });
  expect(container.querySelectorAll("[data-layer-id]").length).toBe(before + 1);
});

it("makes the blocked-export note a polite status that selects the invalid layer", async () => {
  const bytes = packLabel({ formatVersion: 3, masterId: "lolev", enabledVariants: [], values: { barcode: "123" } }, {});
  const { container } = await mount({ fileToOpen: { seq: 1, file: new File([bytes as unknown as BlobPart], "bad.label") } });
  await vi.waitFor(() => expect(container.querySelector("[data-blocked-export]")).not.toBeNull());
  const note = container.querySelector("[data-blocked-export]")!;
  // Not re-announced as an alert on every keystroke that keeps it invalid.
  expect(note.closest('[role="alert"]')).toBeNull();
  expect(note.closest('[role="status"]')).not.toBeNull();
  expect(note.textContent).toContain("Barcode");
  // The Layers list marks the invalid row.
  expect(container.querySelector('[data-layer-id="barcode"] [aria-label="Invalid value"]')).not.toBeNull();
  expect(container.querySelector('[data-layer-id="name"] [aria-label="Invalid value"]')).toBeNull();
  expect(rowSelected(container, "barcode")).toBe(false);
  await act(async () => { (note as HTMLElement).click(); });
  expect(rowSelected(container, "barcode")).toBe(true);
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
