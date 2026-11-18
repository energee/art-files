// font-import-dom.test.tsx — Import Font… in the inspector's Font menu (font
// import task 10), driven through the whole editor so undo is real: choosing
// it picks font files, sets the selected text layer's family to the imported
// id in one undo step and lists the family in the menu; a refused file leaves
// the layer as it was and says why in a toast; a cancelled picker changes
// nothing. The browser's open picker is stubbed; the real font gate's registry
// runs and only face loading is stubbed.
// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_RENDER } from "../src/settings";
import { mountToaster, settle, shown, toastTitles, unmountToaster } from "./real-timer-toaster";

vi.mock("../src/model/starterLayers", async () => ({ starterMaster: (await import("./fixtures/lolevMaster")).lolevMaster }));
vi.mock("../src/recovery", () => ({ keepRecovery: async () => true, dropRecovery: async () => {}, discardCount: () => 0 }));
vi.mock("../src/masterCache", () => ({ cacheMaster: async () => {}, cachedMaster: async () => null }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("../src/components/PreviewCompare", () => ({ PreviewCompare: () => null }));
vi.mock("../src/components/CanView", () => ({ CanView: () => null }));
vi.mock("../src/components/Rulers", () => ({ Rulers: () => null }));
vi.mock("../src/fonts", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/fonts")>(),
  loadLabelFaces: async () => (text: string, size: number) => text.length * size * 0.55,
  labelFontCss: () => "sans-serif",
}));

const { DocumentEditor } = await import("../src/App");

const SVN_BOLD = new Uint8Array(readFileSync("tests/fixtures/fonts/SVN-Poppins-Bold.ttf"));

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  root = container = undefined;
  await unmountToaster();
  vi.unstubAllGlobals();
});

/** Mount one editor on its starter master and select the "name" text layer. */
async function mountWithNameSelected() {
  await mountToaster();
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const props = {
    active: true, onMeta: vi.fn(), saveSlot: { current: null },
    render: { ...DEFAULT_RENDER }, onRenderChange: vi.fn(), onOpenProject: vi.fn(), onNewTab: vi.fn(),
    onCloseTab: vi.fn(), onCheckForUpdates: vi.fn(), tabStripHost: vi.fn(), recoveryKey: "now:1",
  } as unknown as ComponentProps<typeof DocumentEditor>;
  await act(async () => { root!.render(createElement(DocumentEditor, props)); });
  const row = () => container!.querySelector('[data-layer-id="name"] [data-slot="sidebar-menu-button"]') as HTMLElement | null;
  await vi.waitFor(() => expect(row()).not.toBeNull(), { timeout: 10_000 });
  await act(async () => { row()!.click(); });
  await vi.waitFor(() => expect(fontTrigger()).not.toBeNull());
}

const fontTrigger = () => document.querySelector('[aria-label="Font"]') as HTMLElement | null;
const shownFont = () => fontTrigger()!.querySelector('[data-slot="select-value"]')!.textContent;
const options = () => Array.from(document.querySelectorAll('[role="option"]'));

/** Open the Font menu and choose the option whose text is `label`. */
async function choose(label: string) {
  await act(async () => { fontTrigger()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  const option = options().find((el) => el.textContent === label);
  expect(option, `option ${label}`).toBeDefined();
  await act(async () => {
    option!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
    option!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** A browser open picker that hands back these files (or rejects with `error`). */
function picker(files: { name: string; bytes: Uint8Array }[], error?: unknown) {
  const pick = vi.fn(async () => {
    if (error) throw error;
    return files.map((f) => ({ name: f.name, getFile: async () => new File([f.bytes as BlobPart], f.name) }));
  });
  vi.stubGlobal("showOpenFilePicker", pick);
  return pick;
}

const pressUndo = () => act(async () => {
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }));
});

it("a cancelled picker changes nothing", async () => {
  await mountWithNameSelected();
  const pick = picker([], new DOMException("cancelled", "AbortError"));
  await choose("Import Font…");
  expect(pick).toHaveBeenCalledWith(expect.objectContaining({ multiple: true }));
  await settle();
  expect(shownFont()).toBe("Default (Poppins)");
  expect(toastTitles()).toEqual([]);
}, 30_000);

it("a refused file leaves the layer unchanged and says why", async () => {
  await mountWithNameSelected();
  picker([{ name: "notes.ttf", bytes: new TextEncoder().encode("not a font at all") }]);
  await choose("Import Font…");
  await shown("Could not import font: notes.ttf is not a TTF or OTF font file.");
  expect(shownFont()).toBe("Default (Poppins)");
}, 30_000);

it("imports a picked font onto the selected layer, lists it, and undoes in one step", async () => {
  await mountWithNameSelected();
  picker([{ name: "SVN-Poppins-Bold.ttf", bytes: SVN_BOLD }]);
  await choose("Import Font…");
  await vi.waitFor(() => expect(shownFont()).toBe("SVN-Poppins"), { timeout: 10_000 });

  await act(async () => { fontTrigger()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(options().map((el) => el.textContent)).toEqual(
    ["Default (Poppins)", "Poppins", "Barlow Condensed", "SVN-Poppins", "Import Font…"]);
  await choose("SVN-Poppins"); // closes the menu without an Escape, which would clear the selection

  await pressUndo();
  expect(shownFont()).toBe("Default (Poppins)");
}, 30_000);
