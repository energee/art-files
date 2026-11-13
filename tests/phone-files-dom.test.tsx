// phone-files-dom.test.tsx — Open Master on a phone (phone layout, Phase 5).
// A phone's file picker can grey out a .master it has no type for, so on a
// touch screen the Open Master fallback input lists every file and the loader
// is the check: a wrong file is refused with a message and the document stays.
// Closing the picker with no file changes nothing, and a browser that refuses
// every storage write (private browsing, a full quota) still opens the master.
// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { setViewport } from "./viewport";
import { mountToaster, toastTitles, unmountToaster } from "./real-timer-toaster";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("../src/components/PreviewCompare", () => ({ PreviewCompare: () => null }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
}));
const { DocumentEditor } = await import("../src/App");

let container: HTMLDivElement;
let root: Root;
const realMatchMedia = window.matchMedia.bind(window);
/** A finger is the primary pointer: (pointer: coarse) matches. */
const coarse = () => vi.spyOn(window, "matchMedia").mockImplementation(
  (q: string) => realMatchMedia(q === "(pointer: coarse)" ? "(min-width: 0px)" : q));

const mount = async (width: number, height: number) => {
  setViewport(width, height);
  await mountToaster();
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
  await unmountToaster();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  setViewport(1024, 768);
});

/** Open Master's fallback: the editor's one file input outside an image well. */
const fallback = () => [...container.querySelectorAll('input[type="file"]')]
  .find((input) => !input.closest("[data-file-drop]")) as HTMLInputElement;
/** Answer the fallback's picker with `file`, or close it with none. */
const choose = (file: File | null) => act(async () => {
  Object.defineProperty(fallback(), "files", { value: file ? [file] : [], configurable: true });
  fallback().dispatchEvent(new Event(file ? "change" : "cancel", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));
});
const masterName = () => container.querySelector("#master-picker")!.textContent;
const lolev = () => new File([readFileSync(join(import.meta.dirname, "../masters/lolev.master"))], "lolev.master");
const photo = () => new File([readFileSync(join(import.meta.dirname, "../docs/audits/2026-10-26-evidence/fixtures/dark.png"))], "photo.png", { type: "image/png" });

it("with a mouse the Open Master fallback asks for a .master", async () => {
  await mount(1280, 800);
  expect(fallback().getAttribute("accept")).toBe(".master");
});

it("on a touch screen the Open Master fallback lists every file", async () => {
  coarse();
  await mount(390, 844);
  expect(fallback().hasAttribute("accept")).toBe(false);
});

it("on a touch screen a .master picked from every file opens", async () => {
  coarse();
  await mount(390, 844);
  await choose(lolev());
  await vi.waitFor(() => expect(masterName()).toContain("Lolev"));
});

// Review Focus 1
it("a wrong file picked on a touch screen is refused with a message, and the master stays", async () => {
  coarse();
  await mount(390, 844);
  const before = masterName();
  await choose(photo());
  await vi.waitFor(() => expect(toastTitles()).toContain("Could not open master: Not a .master file: missing master.json"));
  expect(masterName()).toBe(before);
});

// Review Focus 2
it("a picker closed with no file changes nothing", async () => {
  coarse();
  await mount(390, 844);
  const before = masterName();
  await choose(null);
  expect(toastTitles()).toEqual([]);
  expect(masterName()).toBe(before);
});

// Review Focus 5
it("with storage refused, Open Master still switches", async () => {
  coarse();
  await mount(390, 844);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
  vi.stubGlobal("indexedDB", undefined);
  await choose(lolev());
  await vi.waitFor(() => expect(masterName()).toContain("Lolev"));
  expect(toastTitles().filter((title) => title?.startsWith("Could not"))).toEqual([]);
});
