// @vitest-environment happy-dom
// export-blocked-toast-dom.test.tsx — a blocked label explains itself where you
// try to export. Every export command stays enabled while the label is invalid
// (it greys out only while an export runs); choosing one builds nothing and
// shows the "Can't export yet" error toast with the reason and a Show layer
// action, which opens a collapsed Layers sidebar and selects the invalid layer.
// The toast stays until it is dismissed or the label stops being blocked, a
// repeat attempt replaces it, and the invisible status region still announces
// when a label becomes blocked. The real editor runs on real timers with the
// real <Toaster /> beside it (tests/real-timer-toaster.ts).
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { packLabel } from "../src/model/files";
import { headerMessages, mountToaster, settle, shown, toastTitles, unmountToaster } from "./real-timer-toaster";

// An export that starts asks for the fonts first; one that never settles shows
// that a build began without waiting for a PDF to be made.
const build = vi.hoisted(() => ({ loadFonts: vi.fn(() => new Promise<never>(() => {})) }));
vi.mock("../src/masterCache", () => ({ cacheMaster: async () => {}, cachedMaster: async () => null, dropCachedMaster: async () => {} }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("../src/components/PreviewCompare", () => ({ SNAP_PT: 6, PreviewCompare: () => null }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: () => new Promise<never>(() => {}),
  labelFontCss: () => "sans-serif",
  FONT_URLS: { poppins: {} },
}));
vi.mock("../src/pdf/fonts", () => ({ loadFonts: build.loadFonts }));
// Loaded once up front so an export that does start finds the module ready.
await import("../src/pdf/build");
const { DocumentEditor } = await import("../src/App");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView ??= () => undefined;

const pick = vi.fn();
let cleanup: (() => Promise<void>) | null = null;
beforeEach(() => { localStorage.clear(); vi.stubGlobal("showSaveFilePicker", pick); });
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  await unmountToaster();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
});

type EditorProps = ComponentProps<typeof DocumentEditor>;
async function mount(over: Partial<EditorProps> = {}) {
  await mountToaster();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const props: EditorProps = {
    active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta: vi.fn(),
    saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
    onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
    onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(), ...over,
  };
  await act(async () => { root.render(createElement(DocumentEditor, props)); });
  cleanup = async () => { await act(async () => root.unmount()); container.remove(); };
  return { container, rerender: (p: Partial<EditorProps>) =>
    act(async () => { root.render(createElement(DocumentEditor, { ...props, ...p })); }) };
}

const press = async (init: KeyboardEventInit) => {
  await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
};
const rowSelected = (c: HTMLElement, id: string) =>
  c.querySelector(`[data-layer-id="${id}"] [data-slot="sidebar-menu-button"]`)?.getAttribute("aria-pressed") === "true";
const sidebarState = (c: HTMLElement) => c.querySelector("[data-slot=sidebar]")!.getAttribute("data-state");
const description = () => document.querySelector("[data-sonner-toast] [data-description]")?.textContent;
const showLayer = () => [...document.querySelectorAll("button")].find((b) => b.textContent === "Show layer")!;
/** The invisible status region's reason: what a screen reader hears. */
const reasonOf = (c: HTMLElement) =>
  c.querySelector("[data-export-blocked-status]")!.textContent!.replace(/^Export blocked: /, "");

const badLabel = () => {
  const bytes = packLabel({ formatVersion: 3, masterId: "lolev", enabledVariants: [], values: { barcode: "123" } }, {});
  return { seq: 1, file: new File([bytes as unknown as BlobPart], "bad.label") };
};
/** A mounted editor on a label with an invalid barcode. */
async function mountBlocked() {
  const editor = await mount();
  await editor.rerender({ fileToOpen: badLabel() });
  await vi.waitFor(() => expect(reasonOf(editor.container)).toContain("Barcode"));
  return editor;
}

/** Type into a React-controlled input the way the browser does. */
const typeInto = (input: HTMLInputElement, text: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

/** File → Export, the submenu the export rows live in. */
async function openExportMenu(container: HTMLElement) {
  const file = [...container.querySelectorAll("[data-slot=menubar-trigger]")].find((el) => el.textContent === "File") as HTMLElement;
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) file.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
    file.click();
    await Promise.resolve();
  });
  const exportRow = [...document.querySelectorAll("[data-slot=menubar-sub-trigger]")].find((el) => el.textContent?.startsWith("Export")) as HTMLElement;
  await act(async () => {
    exportRow.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await Promise.resolve();
  });
}
const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>("[role=menuitem]")]
  .find((el) => el.textContent?.replace(/(⇧?⌘|Ctrl).*$/, "") === label)!;

for (const [name, init] of [["⌘E", { key: "e", metaKey: true }], ["⇧⌘E", { key: "E", metaKey: true, shiftKey: true }]] as const) {
  it(`${name} while blocked shows Can't export yet with the reason and builds nothing`, async () => {
    const { container } = await mountBlocked();
    await press(init);
    await shown("Can't export yet");
    expect(toastTitles()).toEqual(["Can't export yet"]);
    expect(document.querySelector("[data-sonner-toast]")!.getAttribute("data-type")).toBe("error");
    expect(reasonOf(container)).toContain("Barcode");
    expect(description()).toBe(reasonOf(container));
    await settle();
    expect(build.loadFonts).not.toHaveBeenCalled();
    expect(pick).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Building");
  }, 30_000);
}

it("Export PDF in the menu is enabled while blocked and shows the same toast", async () => {
  const { container } = await mountBlocked();
  await openExportMenu(container);
  const row = menuItem("Export PDF");
  expect(row.hasAttribute("data-disabled")).toBe(false);
  expect(row.getAttribute("aria-disabled")).not.toBe("true");
  await act(async () => { row.click(); });
  await shown("Can't export yet");
  expect(toastTitles()).toEqual(["Can't export yet"]);
  expect(description()).toBe(reasonOf(container));
  expect(build.loadFonts).not.toHaveBeenCalled();
}, 30_000);

it("the export rows are still disabled while an export is running", async () => {
  const { container } = await mount();
  await press({ key: "e", metaKey: true });
  await vi.waitFor(() => expect(build.loadFonts).toHaveBeenCalled());
  await openExportMenu(container);
  expect(menuItem("Export PDF").hasAttribute("data-disabled")).toBe(true);
  expect(toastTitles()).toEqual([]);
}, 30_000);

it("pressing ⌘E twice leaves one toast", async () => {
  await mountBlocked();
  await press({ key: "e", metaKey: true });
  await shown("Can't export yet");
  await press({ key: "e", metaKey: true });
  await settle();
  expect(toastTitles()).toEqual(["Can't export yet"]);
}, 30_000);

it("belongs to its tab: hidden while the tab is behind, back with it", async () => {
  const { container, rerender } = await mountBlocked();
  await press({ key: "e", metaKey: true });
  await shown("Can't export yet");

  await rerender({ active: false });
  await vi.waitFor(() => expect(toastTitles()).toEqual([]), { timeout: 5_000 });
  await rerender({ active: true });
  await shown("Can't export yet");
  expect(toastTitles()).toEqual(["Can't export yet"]);
  expect(description()).toBe(reasonOf(container));
}, 30_000);

it("Show layer opens a collapsed Layers sidebar and selects the invalid layer", async () => {
  const { container } = await mountBlocked();
  await press({ key: "b", metaKey: true });
  expect(sidebarState(container)).toBe("collapsed");
  expect(rowSelected(container, "barcode")).toBe(false);
  await press({ key: "e", metaKey: true });
  await shown("Show layer");
  await act(async () => { showLayer().click(); });
  expect(sidebarState(container)).toBe("expanded");
  expect(rowSelected(container, "barcode")).toBe(true);
}, 30_000);

// Sonner removes the toast after its action runs, which would drop focus onto
// the page, where Backspace is Remove Layer: Show layer focuses the layer's
// value field instead, so the key edits the field and the layer stays.
it("Show layer focuses the invalid layer's field, so Backspace cannot remove the layer", async () => {
  const { container } = await mountBlocked();
  await press({ key: "e", metaKey: true });
  await shown("Can't export yet");
  // A click focuses the button in most browsers; Sonner then remembers what held
  // focus before and hands it back when focus leaves the toasts. (happy-dom lets
  // a focus() win over that hand-back, as browsers do not, so this walks the
  // path rather than proving the blur in focusContentField.)
  const before = container.querySelector<HTMLElement>("[data-add-layer]")!;
  await act(async () => { before.focus(); showLayer().focus(); });
  expect(document.activeElement).toBe(showLayer());
  await act(async () => { showLayer().click(); });
  await vi.waitFor(() => expect(document.activeElement).toBe(document.querySelector("#barcode-content")), { timeout: 5_000 });
  await vi.waitFor(() => expect(toastTitles()).toEqual([]), { timeout: 5_000 });
  expect(document.activeElement).toBe(document.querySelector("#barcode-content"));

  await act(async () => {
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
  });
  expect(container.querySelector('[data-layer-id="barcode"]')).not.toBeNull();
}, 30_000);

// The toast region's own keys never reach Remove Layer: Alt+T focuses the
// toast list itself, which is no button.
it("Backspace from inside the toast region does not remove the selected layer", async () => {
  const { container } = await mountBlocked();
  await act(async () => {
    (container.querySelector('[data-layer-id="barcode"] [data-slot="sidebar-menu-button"]') as HTMLElement).click();
  });
  await press({ key: "e", metaKey: true });
  await shown("Can't export yet");
  await act(async () => {
    document.querySelector("[data-sonner-toaster]")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
  });
  expect(container.querySelector('[data-layer-id="barcode"]')).not.toBeNull();
}, 30_000);

it("fixing the value dismisses the toast, and the export then runs", async () => {
  const { container } = await mount();
  await act(async () => {
    (container.querySelector('[data-layer-id="barcode"] [data-slot="sidebar-menu-button"]') as HTMLElement).click();
  });
  const field = () => document.querySelector("#barcode-content") as HTMLInputElement;
  const good = field().value;
  await act(async () => { field().focus(); });
  await act(async () => { typeInto(field(), "ABC123"); });
  await act(async () => { field().blur(); });
  await vi.waitFor(() => expect(reasonOf(container)).toContain("Barcode"));

  await press({ key: "e", metaKey: true });
  await shown("Can't export yet");

  await act(async () => { field().focus(); });
  await act(async () => { typeInto(field(), good); });
  await act(async () => { field().blur(); });
  await vi.waitFor(() => expect(toastTitles()).toEqual([]), { timeout: 5_000 });
  expect(reasonOf(container)).toBe("");

  await press({ key: "e", metaKey: true });
  await vi.waitFor(() => expect(build.loadFonts).toHaveBeenCalled());
  expect(toastTitles()).toEqual([]);
}, 30_000);

it("screen readers still hear Export blocked: {reason}", async () => {
  const { container, rerender } = await mount();
  // The status region exists, empty, before the label is blocked: a live
  // region mounted already holding its text is not read at all.
  const region = container.querySelector("[data-export-blocked-status]")!;
  expect(region.getAttribute("role")).toBe("status");
  expect(region.textContent).toBe("");
  await rerender({ fileToOpen: badLabel() });
  await vi.waitFor(() => expect(region.textContent).toMatch(/^Export blocked: .*Barcode/));
  expect(container.querySelector("[data-export-blocked-status]")).toBe(region);
  // The header carries no blocked note any more: the cause is the row in Layers.
  expect(container.querySelector("[data-blocked-export]")).toBeNull();
  expect(toastTitles()).toEqual([]);
}, 30_000);

it("the header shows no message while export is blocked", async () => {
  await mountBlocked();
  await press({ key: "e", metaKey: true });
  await shown("Can't export yet");
  expect(headerMessages()).toHaveLength(0);
}, 30_000);
