// phone-shell-dom.test.tsx — Layers on a phone (phone layout, Task 2.3).
// On a phone Layers starts closed, slides over the preview with a backdrop
// and no resize handle, and closes when a layer is picked; on a desktop it
// stays beside the preview, resizable, and open after a pick.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { setViewport } from "./viewport";

// Same mounting as inspector-escape-dom.test.tsx: the Lolev fixture master,
// with the canvas-heavy views stubbed out.
vi.mock("../src/model/starterLayers", async () => ({ starterMaster: (await import("./fixtures/lolevMaster")).lolevMaster }));
vi.mock("../src/components/PreviewCompare", () => ({ PreviewCompare: () => null }));
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
});

const sidebar = () => container.querySelector('[data-slot="sidebar"]')!;
const slot = (name: string) => container.querySelector(`[data-slot="${name}"]`);
const rowButton = (id = "barcode") =>
  container.querySelector(`[data-layer-id="${id}"] [data-slot="sidebar-menu-button"]`) as HTMLButtonElement;
const tap = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });
const openLayers = () => tap(slot("sidebar-trigger"));
const headerButton = (name: string) => container.querySelector(`header button[aria-label="${name}"]`) as HTMLButtonElement | null;
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

it("tapping the backdrop closes Layers", async () => {
  await mount(390, 844);
  await openLayers();
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
  expect(slot("sidebar-container")!.className).not.toContain("max-w-[85vw]");
  await tap(rowButton());
  expect(sidebar().getAttribute("data-state")).toBe("expanded");
});

// Review Focus 5: a width saved on a desktop browser never makes the overlay wider than the phone.
it("caps the overlay at 85% of the screen whatever width was saved", async () => {
  localStorage.setItem("sidebar_width", "520");
  await mount(390, 844);
  await openLayers();
  expect(slot("sidebar-container")!.className).toContain("max-w-[85vw]");
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
