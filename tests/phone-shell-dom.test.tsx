// phone-shell-dom.test.tsx — the phone shell (phone layout, Phase 2): Layers,
// the header, the inspector and the preview toolbar, placed by size. On a
// phone (under 768px wide or under 500px tall) Layers starts closed, slides
// over the preview with a backdrop and no resize handle, and closes on a pick,
// an Add layer or Escape; the header gets Undo and Redo; under 768px wide the
// inspector rises from the bottom. On a desktop all of it stays as it was.
// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { setViewport } from "./viewport";

// Same mounting as inspector-escape-dom.test.tsx: the Lolev fixture master,
// with the canvas-heavy views stubbed out.
vi.mock("../src/model/starterLayers", async () => ({ starterMaster: (await import("./fixtures/lolevMaster")).lolevMaster }));
/** The preview's onPick, so a test can pick a layer as a canvas tap does. */
const preview = vi.hoisted(() => ({ pick: (_id: string | null, _mods: object) => {} }));
vi.mock("../src/components/PreviewCompare", () => ({
  PreviewCompare: (p: { onPick: typeof preview.pick }) => { preview.pick = p.onPick; return null; },
}));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
}));
import { DocumentEditor } from "../src/App";

let container: HTMLDivElement;
let root: Root;

const mount = async (width: number, height: number) => {
  setViewport(width, height);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(DocumentEditor, {
      active: true, fileToOpen: null, onOpenSettled: vi.fn(), onMeta: vi.fn(),
      saveSlot: { current: null }, render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(),
      onOpenProject: vi.fn(), onNewTab: vi.fn(), onCloseTab: vi.fn(),
      onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(),
    }));
  });
};

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  localStorage.clear();
  setViewport(1024, 768);
  vi.restoreAllMocks();
});

const sidebar = () => container.querySelector('[data-slot="sidebar"]')!;
const slot = (name: string) => container.querySelector(`[data-slot="${name}"]`);
const rowButton = (id = "barcode") =>
  container.querySelector(`[data-layer-id="${id}"] [data-slot="sidebar-menu-button"]`) as HTMLButtonElement;
const tap = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });
const openLayers = () => tap(slot("sidebar-trigger"));
const headerButton = (name: string) => container.querySelector(`header button[aria-label="${name}"]`) as HTMLButtonElement | null;
const realMatchMedia = window.matchMedia.bind(window);
/** A finger is the primary pointer: (pointer: coarse) matches. */
const coarse = () => vi.spyOn(window, "matchMedia").mockImplementation(
  (q: string) => realMatchMedia(q === "(pointer: coarse)" ? "(min-width: 0px)" : q));
const power = () => container.querySelector('[data-layer-id="collabLead"] button[aria-label$=": enabled"]') as HTMLButtonElement;

it("starts with Layers closed on a phone", async () => {
  await mount(390, 844);
  expect(sidebar().getAttribute("data-state")).toBe("collapsed");
});

it("starts with Layers open on a desktop", async () => {
  await mount(1280, 800);
  expect(sidebar().getAttribute("data-state")).toBe("expanded");
});

it("on a phone, Layers overlays the preview with a backdrop and no resize handle", async () => {
  await mount(390, 844);
  await openLayers();
  expect(sidebar().getAttribute("data-state")).toBe("expanded");
  expect(slot("sidebar-gap")).toBeNull();
  expect(slot("sidebar-resize-handle")).toBeNull();
  expect(slot("sidebar-backdrop")).not.toBeNull();
});

it("tapping a layer on a phone selects it, opens the inspector and closes Layers", async () => {
  await mount(390, 844);
  await openLayers();
  await tap(rowButton());
  expect(rowButton().getAttribute("data-active")).not.toBeNull();
  expect(document.querySelector("#barcode-content")).not.toBeNull();
  expect(sidebar().getAttribute("data-state")).toBe("collapsed");
});

it("a pick that closes Layers on a phone moves focus to the Layers toggle", async () => {
  await mount(390, 844);
  await openLayers();
  await act(async () => { rowButton().focus(); });
  await tap(rowButton());
  expect(document.activeElement).not.toBe(document.body);
  expect(document.activeElement).toBe(slot("sidebar-trigger"));
});

it("a modifier click on a row keeps Layers open on a phone, for multi-select", async () => {
  await mount(390, 844);
  await openLayers();
  for (const mod of ["shiftKey", "metaKey", "ctrlKey"] as const) {
    await act(async () => { rowButton().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, [mod]: true })); });
    expect(sidebar().getAttribute("data-state")).toBe("expanded");
  }
});

it("tapping a row's eye on a phone keeps Layers open", async () => {
  await mount(390, 844);
  await openLayers();
  // The eye is labelled "<name>: enabled"; the name button also has aria-pressed.
  const eye = container.querySelector('[data-layer-id="barcode"] button[aria-label$=": enabled"]');
  const before = eye!.getAttribute("aria-pressed");
  await tap(eye);
  expect(eye!.getAttribute("aria-pressed")).not.toBe(before);
  expect(sidebar().getAttribute("data-state")).toBe("expanded");
});

it("a long-press (contextmenu) on a row keeps Layers open", async () => {
  await mount(390, 844);
  await openLayers();
  await act(async () => { rowButton().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
  expect(sidebar().getAttribute("data-state")).toBe("expanded");
});

const pressed = (id: string) => rowButton(id).getAttribute("aria-pressed") === "true";
const startSelecting = (id: string) => act(async () => {
  rowButton(id).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
  await Promise.resolve();
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent?.trim() === "Select")!.click();
  await Promise.resolve();
});

it("Select in a row's menu starts selection mode: taps toggle rows and Layers stays open", async () => {
  coarse();
  await mount(390, 844);
  await openLayers();
  await startSelecting("barcode");
  await tap(rowButton("name"));
  expect([pressed("barcode"), pressed("name")]).toEqual([true, true]);
  expect(sidebar().getAttribute("data-state")).toBe("expanded");
  await tap(rowButton("barcode"));
  expect([pressed("barcode"), pressed("name")]).toEqual([false, true]);
  expect(sidebar().getAttribute("data-state")).toBe("expanded");
});

it("clearing the selection ends selection mode", async () => {
  coarse();
  await mount(390, 844);
  await openLayers();
  await startSelecting("barcode");
  await tap(rowButton("barcode")); // the last selected row: the selection empties
  expect(pressed("barcode")).toBe(false);
  expect(sidebar().getAttribute("data-state")).toBe("expanded");
  await tap(rowButton("name"));
  expect(pressed("name")).toBe(true);
  expect(sidebar().getAttribute("data-state")).toBe("collapsed");
});

// Review Focus 3
it("closing Layers ends selection mode; the next tap picks one layer and closes Layers", async () => {
  coarse();
  await mount(390, 844);
  await openLayers();
  await startSelecting("barcode");
  await tap(rowButton("name"));
  await tap(slot("sidebar-backdrop"));
  await openLayers();
  await tap(rowButton("description"));
  expect([pressed("barcode"), pressed("name"), pressed("description")]).toEqual([false, false, true]);
  expect(sidebar().getAttribute("data-state")).toBe("collapsed");
});

// Review Focus 5
it("rotating the phone keeps selection mode, the selection and Layers open", async () => {
  coarse();
  await mount(390, 844);
  await openLayers();
  await startSelecting("barcode");
  await act(async () => { setViewport(844, 390); });
  expect(sidebar().getAttribute("data-state")).toBe("expanded");
  expect(pressed("barcode")).toBe(true);
  await tap(rowButton("name"));
  expect([pressed("barcode"), pressed("name")]).toEqual([true, true]);
  expect(sidebar().getAttribute("data-state")).toBe("expanded");
});

const rowIds = () => [...container.querySelectorAll<HTMLElement>("[data-layer-id]")].map((r) => r.dataset.layerId!);
const pickedIds = () => rowIds().filter(pressed);
const addLayer = async () => {
  const trigger = container.querySelector('[aria-label="Add layer"]') as HTMLElement;
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"])
      trigger.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
    trigger.click();
    await Promise.resolve();
  });
  await tap([...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.trim() === "Text")!);
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
};

it("undoing the add of the only selected layer ends selection mode", async () => {
  coarse();
  await mount(1024, 768);
  await addLayer();
  const [added] = pickedIds();
  await startSelecting(added);
  await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true })); });
  expect(rowIds()).not.toContain(added);
  await tap(rowButton("name"));
  await tap(rowButton("description"));
  expect(pickedIds()).toEqual(["description"]);
});

it("removing the whole selection from the row menu ends selection mode", async () => {
  coarse();
  await mount(390, 844);
  await openLayers();
  await startSelecting("barcode");
  await tap(rowButton("name"));
  await act(async () => {
    rowButton("name").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    await Promise.resolve();
  });
  await tap([...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.trim().startsWith("Remove"))!);
  expect(rowIds()).not.toContain("barcode");
  await tap(rowButton("description"));
  expect(pickedIds()).toEqual(["description"]);
  expect(sidebar().getAttribute("data-state")).toBe("collapsed");
});

it("Add layer in selection mode ends it", async () => {
  coarse();
  await mount(390, 844);
  await openLayers();
  await startSelecting("barcode");
  await addLayer();
  await openLayers();
  await tap(rowButton("name"));
  expect(pickedIds()).toEqual(["name"]);
  expect(sidebar().getAttribute("data-state")).toBe("collapsed");
});

it("on a touch tablet, Select works with Layers docked, and a canvas pick ends the mode", async () => {
  coarse();
  await mount(1024, 768);
  await startSelecting("barcode");
  await tap(rowButton("name"));
  await tap(rowButton("description"));
  expect(pickedIds().sort()).toEqual(["barcode", "description", "name"]);
  expect(sidebar().getAttribute("data-state")).toBe("expanded");
  await act(async () => { preview.pick("name", {}); });
  expect(pickedIds()).toEqual(["name"]);
  await tap(rowButton("barcode"));
  expect(pickedIds()).toEqual(["barcode"]);
});

it("a Shift-click in selection mode still selects a range", async () => {
  coarse();
  await mount(390, 844);
  await openLayers();
  const ids = rowIds();
  await startSelecting(ids[1]);
  await act(async () => { rowButton(ids[3]).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true })); });
  expect(pickedIds()).toEqual(ids.slice(1, 4));
});

it("in selection mode a long-press on an unselected row picks it alone and the mode stays; Select is announced", async () => {
  coarse();
  await mount(390, 844);
  await openLayers();
  await startSelecting("barcode");
  expect(container.querySelector('[data-add-layer]')!.closest('[data-slot="sidebar-group"]')!.querySelector('[role="status"]')!.textContent).toBe("Selecting layers. Tap a layer to add or remove it.");
  await tap(rowButton("name"));
  await act(async () => {
    rowButton("description").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    await Promise.resolve();
  });
  expect(pickedIds()).toEqual(["description"]);
  await act(async () => { document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(document.querySelector('[role="menu"]')).toBeNull();
  await tap(rowButton("name"));
  expect(pickedIds().sort()).toEqual(["description", "name"]);
  expect(sidebar().getAttribute("data-state")).toBe("expanded");
});

it("a mouse's row menu on a phone-sized window offers no Select", async () => {
  await mount(390, 844);
  await openLayers();
  await act(async () => {
    rowButton("barcode").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
  expect([...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent?.trim())).not.toContain("Select");
});

it("tapping the backdrop closes Layers", async () => {
  await mount(390, 844);
  await openLayers();
  // A real tap's mousedown would move focus to the page before the click
  // closes Layers; held off, closeLayers can hand it to the toggle.
  const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  slot("sidebar-backdrop")!.dispatchEvent(press);
  expect(press.defaultPrevented).toBe(true);
  await tap(slot("sidebar-backdrop"));
  expect(sidebar().getAttribute("data-state")).toBe("collapsed");
  expect(slot("sidebar-backdrop")).toBeNull();
});

it("keeps a desktop's Layers beside the preview, resizable, and open after a pick", async () => {
  await mount(1280, 800);
  expect(slot("sidebar-gap")).not.toBeNull();
  expect(slot("sidebar-resize-handle")).not.toBeNull();
  expect(slot("sidebar-backdrop")).toBeNull();
  expect(slot("sidebar-container")!.className).not.toContain("z-40");
  expect(slot("sidebar-container")!.className).not.toContain("[--sidebar-width:85vw]");
  await tap(rowButton());
  expect(sidebar().getAttribute("data-state")).toBe("expanded");
});

// Review Focus 5: a width saved on a desktop browser, wide or narrow, never sizes the overlay.
it.each(["520", "180", null])("makes the overlay 85vw wide whatever width was saved (saved: %s)", async (saved) => {
  if (saved) localStorage.setItem("sidebar_width", saved);
  await mount(390, 844);
  await openLayers();
  expect(slot("sidebar-container")!.className).toContain("[--sidebar-width:85vw]");
  expect(localStorage.getItem("sidebar_width")).toBe(saved);
});

it("gives a phone header Undo and Redo buttons that run the history", async () => {
  await mount(390, 844);
  expect(headerButton("Undo")!.disabled).toBe(true);
  expect(headerButton("Redo")!.disabled).toBe(true);
  await openLayers();
  await tap(power());
  expect(power().getAttribute("aria-pressed")).toBe("true");
  await tap(headerButton("Undo"));
  expect(power().getAttribute("aria-pressed")).toBe("false");
  await tap(headerButton("Redo"));
  expect(power().getAttribute("aria-pressed")).toBe("true");
});

it("keeps undo and redo out of a desktop header", async () => {
  await mount(1280, 800);
  expect(headerButton("Undo")).toBeNull();
  expect(headerButton("Redo")).toBeNull();
});

const sheet = () => document.querySelector('[data-slot="sheet-content"]')!;
const section = () => container.querySelector('[data-slot="sidebar-inset"] section')!;
const pane = () => section().firstElementChild!;
const toolbar = () => pane().nextElementSibling!;
const undoGroup = () => headerButton("Undo")!.parentElement!;
const nameBox = () => document.querySelector("#barcode-name") as HTMLInputElement;

it("raises the inspector from the bottom on an upright phone and keeps it right on a sideways one", async () => {
  await mount(390, 844);
  await openLayers();
  await tap(rowButton());
  expect(sheet().getAttribute("data-side")).toBe("bottom");
  expect(sheet().className).toContain("overflow-y-auto"); // Review Focus 4: the sheet scrolls to the focused field
  // The bottom reservation sits on the section, so the toolbar (the pane's
  // next sibling) rests on top of the sheet and the pane stays the preview.
  // Sheet and reservation read the one variable, so they never disagree.
  expect(sheet().className).toContain("data-[side=bottom]:h-(--bottom-sheet-height)");
  expect(section().className).toContain("mb-(--bottom-sheet-height)");
  expect(pane().className).not.toContain("--bottom-sheet-height");
  expect(pane().className).not.toContain("mr-[300px]");
  await act(async () => setViewport(844, 390));
  expect(sheet().getAttribute("data-side")).toBe("right");
  expect(pane().className).toContain("mr-[300px]");
  expect(section().className).not.toContain("--bottom-sheet-height");
});

// The bottom sheet is 45svh but yields on a short screen, down to 180px, to
// keep the preview pane 150px tall (src/index.css says what the 345 is).
it("defines the bottom sheet's height once, yielding to the preview on a short screen", () => {
  const css = readFileSync(join(__dirname, "../src/index.css"), "utf8");
  expect(css).toContain("--bottom-sheet-height: clamp(180px, calc(100svh - 345px), 45svh);");
});

it("keeps the preview toolbar inside the element that makes room for the bottom sheet", async () => {
  await mount(390, 844);
  await openLayers();
  await tap(rowButton());
  expect(toolbar().querySelector('input[aria-label="Zoom percentage"]')).not.toBeNull();
  expect(toolbar().closest("section")).toBe(section());
  expect(section().className).toContain("mb-(--bottom-sheet-height)");
  expect(toolbar().className).not.toContain("--bottom-sheet-height");
});

// The right-hand sheet on a sideways phone covers the header's right end.
it("puts Undo and Redo at the header's right end only when the inspector is at the bottom", async () => {
  await mount(844, 390);
  await openLayers();
  await tap(rowButton());
  expect(sheet().getAttribute("data-side")).toBe("right");
  expect(undoGroup().className).not.toContain("ml-auto");
  await act(async () => setViewport(390, 844));
  expect(sheet().getAttribute("data-side")).toBe("bottom");
  expect(undoGroup().className).toContain("ml-auto");
});

it("keeps the desktop inspector on the right with the pane's right margin", async () => {
  await mount(1280, 800);
  await tap(rowButton());
  expect(sheet().getAttribute("data-side")).toBe("right");
  expect(pane().className).toContain("mr-[300px]");
});

// Review Focus 3: rotating the phone, or resizing across 768px, mid-edit.
it("keeps the selection, the open inspector, a half-typed field and undo across a layout switch", async () => {
  await mount(1280, 800);
  await tap(power());
  await tap(rowButton());
  const name = nameBox();
  await act(async () => {
    name.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Draft");
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  for (const [width, height, side] of [[390, 844, "bottom"], [844, 390, "right"], [1280, 800, "right"]] as const) {
    await act(async () => setViewport(width, height));
    expect(nameBox()).toBe(name);                 // same element: the inspector did not remount
    expect(name.value).toBe("Draft");
    expect(document.activeElement).toBe(name);
    expect(rowButton().getAttribute("data-active")).not.toBeNull();
    expect(sheet().getAttribute("data-side")).toBe(side);
  }
  await act(async () => setViewport(390, 844));
  await act(async () => { name.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
  await tap(headerButton("Undo"));
  expect(power().getAttribute("aria-pressed")).toBe("false");
});

// Carry-over from Task 2.3's review: Layers (z-40) must open over the
// inspector sheet, not under it, and a pick there must still work. happy-dom
// has no hit-testing, so this only checks the z classes; the real stacking
// is verified by measurement in Task 2.7.
it("opens Layers over the open inspector on a phone and lets a row be picked", async () => {
  await mount(390, 844);
  await openLayers();
  await tap(rowButton());
  expect(sheet().className).toContain("z-30");
  expect(sheet().className).not.toContain("z-50");
  await openLayers();
  expect(slot("sidebar-container")!.className).toContain("z-40");
  await tap(rowButton("collabLead"));
  expect(rowButton("collabLead").getAttribute("data-active")).not.toBeNull();
  expect(sheet().getAttribute("data-side")).toBe("bottom");
  expect(sidebar().getAttribute("data-state")).toBe("collapsed");
});

// Desktop safety: at 1024px the sheet stays on the right at the stock z-50;
// its only new class, data-[side=bottom]:h-(--bottom-sheet-height), is inert on the right.
it("leaves the desktop sheet on the right at the stock z-50", async () => {
  await mount(1024, 768);
  await tap(rowButton());
  expect(sheet().getAttribute("data-side")).toBe("right");
  expect(sheet().className).toContain("z-50");
  expect(sheet().className).not.toContain("z-30");
  expect(sheet().className).toContain("data-[side=right]:w-[300px]");
  expect(section().className).not.toContain("--bottom-sheet-height");
});

// The preview toolbar makes the same room as the pane: a right margin for the
// right-hand sheet (desktop, sideways phone), none on an upright phone.
it.each([[1280, 800, true], [390, 844, false], [844, 390, true]] as const)(
  "gives the preview toolbar the sheet's right margin at %ix%i only when the sheet is on the right",
  async (width, height, margin) => {
    await mount(width, height);
    if (sidebar().getAttribute("data-state") === "collapsed") await openLayers();
    await tap(rowButton());
    expect(toolbar().className.includes("mr-[300px]")).toBe(margin);
  });

// Task 2.6: on a phone the toolbar wraps onto a second row instead of
// scrolling; a desktop keeps one row.
it.each([[390, 844, true], [844, 390, true], [1280, 800, false], [1024, 768, false]] as const)(
  "wraps the preview toolbar at %ix%i only on a phone",
  async (width, height, wraps) => {
    await mount(width, height);
    expect(toolbar().className.includes("flex-wrap")).toBe(wraps);
    // A wrapped second row needs the height released with or without touch:
    // a phone-sized window driven by a mouse has no touch:h-auto.
    expect(toolbar().className.split(" ").includes("h-8")).toBe(!wraps);
  });

// A phone held sideways is a phone by height alone (under 500px tall).
it("on a sideways phone, Layers is an overlay whose backdrop hides from screen readers and a pick closes it", async () => {
  await mount(844, 390);
  await openLayers();
  expect(slot("sidebar-gap")).toBeNull();
  expect(slot("sidebar-backdrop")!.getAttribute("aria-hidden")).toBe("true");
  await tap(rowButton());
  expect(sidebar().getAttribute("data-state")).toBe("collapsed");
});

it("closes Layers on a phone after Add layer, with the new layer selected", async () => {
  await mount(390, 844);
  await openLayers();
  const trigger = container.querySelector('[aria-label="Add layer"]') as HTMLElement;
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"])
      trigger.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
    trigger.click();
    await Promise.resolve();
  });
  const text = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.trim() === "Text") as HTMLElement;
  await act(async () => { text.focus(); });
  await tap(text);
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  expect(sidebar().getAttribute("data-state")).toBe("collapsed");
  expect(sheet().getAttribute("data-side")).toBe("bottom");
  // The menu would hand focus back to Add layer, inside the closed panel.
  expect(document.activeElement).toBe(slot("sidebar-trigger"));
});

it("keeps a desktop's Layers open after Add layer", async () => {
  await mount(1280, 800);
  const trigger = container.querySelector('[aria-label="Add layer"]') as HTMLElement;
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"])
      trigger.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
    trigger.click();
    await Promise.resolve();
  });
  const text = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.trim() === "Text");
  await tap(text!);
  expect(sidebar().getAttribute("data-state")).toBe("expanded");
});

// The header buttons commit a field's held typing first, as the ⌘ commands
// do (commitFieldDraft): Undo then takes back that typing, and Redo brings it
// back. Without the commit, Undo stepped over it and the later blur's commit
// wiped the redo.
it("header Undo on a phone commits a field's held typing, then undoes it, and Redo restores it", async () => {
  await mount(390, 844);
  await openLayers();
  await tap(power());
  // Past the 500ms window, so the rename is a step of its own.
  await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
  await openLayers();
  await tap(rowButton());
  const name = nameBox();
  const before = name.value;
  await act(async () => {
    name.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Draft");
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await tap(headerButton("Undo"));
  expect(nameBox().value).toBe(before);
  expect(power().getAttribute("aria-pressed")).toBe("true");
  await tap(headerButton("Redo"));
  expect(nameBox().value).toBe("Draft");
});

it.each([[390, 844], [1280, 800]] as const)("the Layers toggle reports whether Layers is open at %ix%i", async (width, height) => {
  await mount(width, height);
  const toggle = slot("sidebar-trigger")!;
  const open = sidebar().getAttribute("data-state") === "expanded";
  expect(toggle.getAttribute("aria-expanded")).toBe(String(open));
  await openLayers();
  expect(toggle.getAttribute("aria-expanded")).toBe(String(!open));
});

const escapeOn = (target: EventTarget) => act(async () => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
});

it("Escape closes the Layers overlay on a phone and keeps the selection and the inspector", async () => {
  await mount(390, 844);
  await openLayers();
  await tap(rowButton());
  await openLayers();
  await act(async () => { rowButton("collabLead").focus(); });
  await escapeOn(rowButton("collabLead"));
  expect(sidebar().getAttribute("data-state")).toBe("collapsed");
  expect(rowButton().getAttribute("data-active")).not.toBeNull();
  expect(sheet().getAttribute("data-side")).toBe("bottom");
  expect(document.activeElement).toBe(slot("sidebar-trigger"));
});

it("Escape leaves a desktop's Layers open", async () => {
  await mount(1280, 800);
  await escapeOn(document.body);
  expect(sidebar().getAttribute("data-state")).toBe("expanded");
});

// Escape that something inside Layers owns stays there: an open menu, the
// inline rename box, a text field, a list drag, or a modal dialog.
it("Escape in an open menu, the rename box or a text field leaves Layers open", async () => {
  await mount(390, 844);
  await openLayers();
  const trigger = container.querySelector('[aria-label="Add layer"]') as HTMLElement;
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"])
      trigger.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
    trigger.click();
    await Promise.resolve();
  });
  const item = document.querySelector('[role="menu"] [role="menuitem"]')!;
  await escapeOn(item);
  expect(sidebar().getAttribute("data-state")).toBe("expanded");

  await act(async () => { rowButton().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
  const rename = container.querySelector('[data-layer-id="barcode"] input') as HTMLInputElement;
  expect(rename).not.toBeNull();
  await escapeOn(rename);
  expect(sidebar().getAttribute("data-state")).toBe("expanded");

  const field = document.createElement("input");
  slot("sidebar-content")!.appendChild(field);
  await escapeOn(field);
  expect(sidebar().getAttribute("data-state")).toBe("expanded");
});

it("Escape that cancels a Layers drag leaves Layers open", async () => {
  await mount(390, 844);
  await openLayers();
  const button = rowButton();
  button.setPointerCapture = vi.fn();
  await act(async () => { button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0 })); });
  await escapeOn(button);
  expect(sidebar().getAttribute("data-state")).toBe("expanded");
});

it("Escape with a modal dialog open leaves Layers open", async () => {
  await mount(390, 844);
  await openLayers();
  const dialog = document.createElement("div");
  dialog.setAttribute("data-slot", "dialog-content");
  document.body.appendChild(dialog);
  try {
    await escapeOn(document.body);
    expect(sidebar().getAttribute("data-state")).toBe("expanded");
  } finally { dialog.remove(); }
});

// Open Layers on a phone covers the editor: what it covers goes inert, so the
// keyboard and the screen reader stay in Layers. Its toggle stays reachable.
const inert = (el: Element | null | undefined) => !!el?.closest("[inert]");
const menuButton = () => [...container.querySelectorAll("header button")].find((b) => b.textContent?.trim() === "Menu");
/** Every element this change made inert. (A collapsed sidebar's own panel is
 *  inert by design, sidebar.tsx; that one is not counted.) */
const inertLeft = () => [...document.querySelectorAll("[inert]")].filter((el) => el.getAttribute("data-slot") !== "sidebar-container");
/** What Tab can land on, in document order: focusable, not disabled, not
 *  tabindex -1, not hidden, not inside anything inert. */
const tabStops = () => [...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex], [contenteditable='true']")]
  .filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && !el.closest("[hidden], [inert]")
    && !(el instanceof HTMLInputElement && el.type === "hidden"));
/** Opens Layers with a layer selected, so the inspector is open behind it. */
const openOverSelection = async () => {
  await mount(390, 844);
  await openLayers();
  await tap(rowButton()); // selects (inspector opens) and closes Layers
  await openLayers();
};

it("with Layers open on a phone, only Layers and its toggle take focus", async () => {
  await openOverSelection();
  expect(inert(container.querySelector("section"))).toBe(true);
  expect(inert(document.querySelector('[data-slot="sheet-content"]'))).toBe(true);
  expect(inert(headerButton("Undo"))).toBe(true);
  expect(inert(menuButton())).toBe(true);
  expect(inert(slot("sidebar-trigger"))).toBe(false);
  expect(inert(rowButton())).toBe(false);
  await tap(slot("sidebar-backdrop"));
  expect(inertLeft()).toEqual([]);
  expect(inert(document.querySelector('[data-slot="sheet-content"]'))).toBe(false);
});

it("with Layers open on a phone, Tab from the toggle goes into Layers and never reaches the editor", async () => {
  await openOverSelection();
  const toggle = slot("sidebar-trigger") as HTMLElement;
  const panel = slot("sidebar-container")!;
  const stops = tabStops();
  // Only the toggle and the panel's own controls are left in the Tab order...
  expect(stops.filter((el) => el !== toggle && !panel.contains(el))).toEqual([]);
  expect(stops.length).toBeGreaterThan(1);
  // ...so the stop after the toggle, wrapping round, is in the panel.
  expect(panel.contains(stops[(stops.indexOf(toggle) + 1) % stops.length])).toBe(true);
});

it("the Layers toggle stays operable with Layers open on a phone, and closing by it leaves nothing inert", async () => {
  await openOverSelection();
  expect(inertLeft().length).toBeGreaterThan(0);
  await act(async () => { (slot("sidebar-trigger") as HTMLElement).focus(); });
  expect(document.activeElement).toBe(slot("sidebar-trigger"));
  await openLayers();
  expect(sidebar().getAttribute("data-state")).toBe("collapsed");
  expect(inertLeft()).toEqual([]);
});

it("closing Layers by Escape leaves nothing inert", async () => {
  await openOverSelection();
  expect(inertLeft().length).toBeGreaterThan(0);
  await act(async () => { (slot("sidebar-trigger") as HTMLElement).focus(); });
  await escapeOn(slot("sidebar-trigger")!);
  expect(sidebar().getAttribute("data-state")).toBe("collapsed");
  expect(inertLeft()).toEqual([]);
});

it("closing Layers by a row tap leaves nothing inert", async () => {
  await openOverSelection();
  expect(inertLeft().length).toBeGreaterThan(0);
  await tap(rowButton("collabLead"));
  expect(sidebar().getAttribute("data-state")).toBe("collapsed");
  expect(inertLeft()).toEqual([]);
});

it("Layers left open as the window grows past a phone leaves nothing inert", async () => {
  await openOverSelection();
  // Turned sideways first: still a phone, so still inert. (happy-dom's
  // matchMedia misses the direct jump from 390x844 to 1280x800; with the
  // sideways step between, it reports the change as a browser does.)
  await act(async () => setViewport(844, 390));
  expect(inertLeft().length).toBeGreaterThan(0);
  await act(async () => setViewport(1280, 800));
  expect(slot("sidebar-backdrop")).toBeNull();
  expect(sidebar().getAttribute("data-state")).toBe("expanded");
  expect(document.querySelectorAll("[inert]")).toHaveLength(0);
});

it("leaves nothing inert on a desktop with Layers open", async () => {
  await mount(1280, 800);
  expect(sidebar().getAttribute("data-state")).toBe("expanded");
  expect(document.querySelectorAll("[inert]")).toHaveLength(0);
});

// Every way of closing Layers runs App's closeLayers, so focus inside the
// panel moves to the Layers toggle instead of falling to the page as the
// panel goes inert.
const cmdB = () => act(async () => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true, cancelable: true }));
});
it.each([
  ["the backdrop", () => tap(slot("sidebar-backdrop"))],
  ["the Layers toggle", () => openLayers()],
  ["⌘B", cmdB],
])("closing Layers on a phone by %s moves focus from a row to the Layers toggle", async (_how, close) => {
  await mount(390, 844);
  await openLayers();
  await act(async () => { rowButton().focus(); });
  await close();
  expect(sidebar().getAttribute("data-state")).toBe("collapsed");
  expect(document.activeElement).toBe(slot("sidebar-trigger"));
});

it("⌘B still collapses and reopens a desktop's docked Layers", async () => {
  await mount(1280, 800);
  await act(async () => { rowButton().focus(); });
  await cmdB();
  expect(sidebar().getAttribute("data-state")).toBe("collapsed");
  expect(slot("sidebar-gap")).not.toBeNull();
  expect(slot("sidebar-backdrop")).toBeNull();
  expect(document.activeElement).not.toBe(document.body);
  await cmdB();
  expect(sidebar().getAttribute("data-state")).toBe("expanded");
});

// One slightly-off finger must not lose a selection built tap by tap.
const titleOfLayers = () => container.querySelector('[data-add-layer]')!.closest('[data-slot="sidebar-group"]')!;
it("in selection mode a tap on the panel's background keeps the selection and the mode", async () => {
  coarse();
  await mount(390, 844);
  await openLayers();
  await startSelecting("barcode");
  await tap(rowButton("name"));
  await tap(titleOfLayers());
  expect(pickedIds().sort()).toEqual(["barcode", "name"]);
  await tap(rowButton("description"));
  expect(pickedIds().sort()).toEqual(["barcode", "description", "name"]);
  expect(sidebar().getAttribute("data-state")).toBe("expanded");
});

it("outside selection mode a tap on the panel's background deselects", async () => {
  await mount(1280, 800);
  await tap(rowButton("barcode"));
  expect(pickedIds()).toEqual(["barcode"]);
  await tap(titleOfLayers());
  expect(pickedIds()).toEqual([]);
});

it("announces when selection mode ends", async () => {
  coarse();
  await mount(390, 844);
  await openLayers();
  await startSelecting("barcode");
  const status = titleOfLayers().querySelector('[role="status"]')!;
  expect(status.textContent).toBe("Selecting layers. Tap a layer to add or remove it.");
  await act(async () => { preview.pick("name", {}); });
  expect(status.textContent).toBe("Selection finished.");
});
