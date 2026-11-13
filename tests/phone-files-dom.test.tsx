// phone-files-dom.test.tsx — Open Master on a phone (phone layout, Phase 5).
// A phone's file picker can grey out a .master it has no type for, so on a
// touch screen the Open Master fallback input lists every file and the loader
// is the check: a wrong file is refused with a message and the document stays.
// Closing the picker with no file changes nothing, and a browser that refuses
// every storage write (private browsing, a full quota) still opens the master.
// Open Label gets the same wrong-file and cancel checks through the real shell.
// A file far bigger than any .label or .master (a video, one tap away once the
// chooser lists every file) is refused by its size before a byte is read, on
// every route that reads a picked file.
// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { packLabel } from "../src/model/files";
import type { Command } from "../src/components/CommandMenu";
import { setViewport } from "./viewport";
import { mountToaster, toastTitles, unmountToaster } from "./real-timer-toaster";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("../src/components/PreviewCompare", () => ({ PreviewCompare: () => null }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/components/DesktopUpdater", () => ({ DesktopUpdater: () => null }));
/** The editor's menu commands, to run Open Master… through its picker. */
const menu = vi.hoisted(() => ({ actions: [] as Command[] }));
vi.mock("../src/components/AppMenu", () => ({ AppMenu: (p: { actions: Command[] }) => { menu.actions = p.actions; return null; } }));
vi.mock("../src/fonts", () => ({
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
}));
const { DocumentEditor } = await import("../src/App");
const { default: TabsShell } = await import("../src/TabsShell");

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

/** A 300 MiB file that is never read: its size is stubbed, and reading it fails the test. */
const huge = (name: string) => {
  const file = new File([], name);
  Object.defineProperty(file, "size", { value: 300 * 1024 * 1024 });
  const read = vi.fn(() => { throw new Error("the oversized file was read"); });
  file.arrayBuffer = read;
  return { file, read };
};
const TOO_LARGE = (name: string) =>
  `Archive is too large: "${name}" exceeds the 128 MiB file or 256 MiB total limit.`;

it("an oversized file picked for Open Master on a touch screen is refused unread", async () => {
  coarse();
  await mount(390, 844);
  const before = masterName();
  const { file, read } = huge("movie.mov");
  await choose(file);
  await vi.waitFor(() => expect(toastTitles()).toContain(`Could not open master: ${TOO_LARGE("movie.mov")}`));
  expect(read).not.toHaveBeenCalled();
  expect(masterName()).toBe(before);
});

it("an oversized file from Open Master's picker is refused unread", async () => {
  await mount(1280, 800);
  const before = masterName();
  const { file, read } = huge("movie.mov");
  vi.stubGlobal("showOpenFilePicker", async () => [{ name: "movie.mov", getFile: async () => file }]);
  await act(async () => { menu.actions.find((c) => c.id === "master-open")!.run(); });
  await vi.waitFor(() => expect(toastTitles()).toContain(`Could not open master: ${TOO_LARGE("movie.mov")}`));
  expect(read).not.toHaveBeenCalled();
  expect(masterName()).toBe(before);
});

// ---- Open Label, through the real shell and editor
/** Mount the whole app shell on a touch screen at phone size. */
const mountShell = async () => {
  coarse();
  setViewport(390, 844);
  await mountToaster();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(TabsShell)); });
};
/** Open Label's fallback: the shell's file input. */
const labelInput = () => container.querySelector('input[type="file"].hidden') as HTMLInputElement;
/** Answer Open Label's picker with `file`, or close it with none. */
const chooseLabel = (file: File | null) => act(async () => {
  Object.defineProperty(labelInput(), "files", { value: file ? [file] : [], configurable: true });
  labelInput().dispatchEvent(new Event(file ? "change" : "cancel", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));
});
const tabNames = () => [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
const peregrine = () => new File([packLabel({
  formatVersion: 3, masterId: "starter", enabledVariants: [],
  values: { name: [{ text: "Peregrine", fill: "#F3CD80", layer: "metallic" }] },
}, {}) as unknown as BlobPart], "peregrine.label");

it("on a touch screen the Open Label fallback lists every file, in the real shell", async () => {
  await mountShell();
  expect(labelInput().hasAttribute("accept")).toBe(false);
});

// Review Focus 1
it("a .master picked for Open Label on a touch screen is refused naming the file, and the tabs stay", async () => {
  await mountShell();
  const before = tabNames();
  await chooseLabel(lolev());
  await vi.waitFor(() => expect(toastTitles()).toContain(
    "Could not open lolev.master: Not a .label file: missing label.json/config.json"), { timeout: 5000 });
  expect(tabNames()).toEqual(before);
}, 15_000);

// Review Focus 2
it("Open Label closed with no file changes nothing, and the next Open still opens", async () => {
  await mountShell();
  const before = tabNames();
  await chooseLabel(null);
  expect(toastTitles()).toEqual([]);
  expect(tabNames()).toEqual(before);
  await chooseLabel(peregrine());
  await vi.waitFor(() => expect(tabNames().some((name) => name?.includes("Peregrine"))).toBe(true), { timeout: 5000 });
}, 15_000);

it("an oversized file picked for Open Label is refused unread, naming it, and the tabs stay", async () => {
  await mountShell();
  const before = tabNames();
  const { file, read } = huge("movie.mov");
  await chooseLabel(file);
  await vi.waitFor(() => expect(toastTitles().some((title) => title?.includes(TOO_LARGE("movie.mov")))).toBe(true), { timeout: 5000 });
  expect(read).not.toHaveBeenCalled();
  expect(tabNames()).toEqual(before);
}, 15_000);
