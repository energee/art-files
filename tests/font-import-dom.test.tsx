// font-import-dom.test.tsx — Import Font… in the inspector's Font menu (font
// import task 10), driven through the whole editor so undo is real: choosing
// it picks font files, sets the selected text layer's family to the imported
// id in one undo step and lists the family in the menu; a refused file leaves
// the layer as it was and says why in a toast; a cancelled picker changes
// nothing. The browser's open picker is stubbed; the real font gate's registry
// runs and only face loading is stubbed. Task 14 made the menu a searchable
// popover list: the web build has no System Fonts group, and on desktop
// (isTauri and invoke mocked) it lists installed families, filters as you
// type, and picking one imports it onto the layer in one undo step.
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
const tauri = vi.hoisted(() => ({ desktop: false, invoke: (() => {}) as (cmd: string, args?: unknown) => unknown }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => tauri.desktop,
  invoke: async (cmd: string, args?: unknown) => tauri.invoke(cmd, args),
}));
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
const SVN_REGULAR = new Uint8Array(readFileSync("tests/fixtures/fonts/SVN-Poppins-Regular.ttf"));

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  root = container = undefined;
  await unmountToaster();
  vi.unstubAllGlobals();
  tauri.desktop = false;
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
const shownFont = () => fontTrigger()!.querySelector('[data-slot="font-value"]')!.textContent;
const options = () => Array.from(document.querySelectorAll('[role="option"]'));
const systemRows = () => Array.from(Array.from(document.querySelectorAll("[cmdk-group]"))
  .find((g) => g.querySelector("[cmdk-group-heading]")?.textContent === "System Fonts")
  ?.querySelectorAll('[role="option"]') ?? []);
const groupHeadings = () => Array.from(document.querySelectorAll("[cmdk-group-heading]"), (el) => el.textContent);

/** Open the Font list. */
async function openFonts() {
  await act(async () => { fontTrigger()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await vi.waitFor(() => expect(options().length).toBeGreaterThan(0));
}

/** Open the Font list and choose the option whose text is `label`. */
async function choose(label: string) {
  if (!options().length) await openFonts();
  const option = options().find((el) => el.textContent === label);
  expect(option, `option ${label}`).toBeDefined();
  await act(async () => { option!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

/** Type `text` into the open list's search field. */
async function search(text: string) {
  const input = document.querySelector("[cmdk-input]") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
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

  await openFonts();
  expect(options().map((el) => el.textContent)).toEqual(
    ["Default (Poppins)", "Poppins", "Barlow Condensed", "SVN-Poppins", "Import Font…"]);
  expect(groupHeadings()).toEqual([]); // the web build lists no system fonts
  await choose("SVN-Poppins"); // closes the menu without an Escape, which would clear the selection

  await pressUndo();
  expect(shownFont()).toBe("Default (Poppins)");
}, 30_000);

it("on desktop lists system families, filters by typing, and imports a picked one in one undo step", async () => {
  tauri.desktop = true;
  const reads: string[] = [];
  tauri.invoke = (cmd, args) => {
    if (cmd === "list_system_fonts") {
      return [
        { family: "Arial", postscript: "ArialMT", weight: 400, path: "/Library/Fonts/Arial.ttf" },
        { family: "SVN-Poppins", postscript: "SVN-Poppins-Regular", weight: 400, path: "/Library/Fonts/SVN-Poppins-Regular.ttf" },
        { family: "SVN-Poppins", postscript: "SVN-Poppins-Bold", weight: 700, path: "/Library/Fonts/SVN-Poppins-Bold.ttf" },
      ];
    }
    if (cmd === "read_system_font") {
      const { path } = args as { path: string };
      reads.push(path);
      return (path.endsWith("Bold.ttf") ? SVN_BOLD : SVN_REGULAR).slice().buffer;
    }
    return undefined;
  };
  await mountWithNameSelected();
  await openFonts();
  await vi.waitFor(() => expect(groupHeadings()).toEqual(["System Fonts"]));
  // Below the file's fonts (which may hold an earlier test's import: the
  // registry lasts the session) and Import Font….
  const texts = options().map((el) => el.textContent);
  expect(texts.slice(0, 3)).toEqual(["Default (Poppins)", "Poppins", "Barlow Condensed"]);
  expect(texts.slice(-3)).toEqual(["Import Font…", "Arial", "SVN-Poppins"]);
  // Each name is drawn in its own font; Import Font… is not a font.
  const face = (label: string) =>
    options().find((el) => el.textContent === label)?.querySelector<HTMLElement>("span[style]")?.style.fontFamily ?? "";
  // (labelFontCss is stubbed to "sans-serif" in this file; the real CSS
  // names are covered by fonts-load.test.ts.)
  expect(face("Barlow Condensed")).toBe("sans-serif");
  expect(face("Default (Poppins)")).toBe("sans-serif");
  expect(face("Arial")).toMatch(/^"?Arial"?, system-ui, sans-serif$/);
  expect(face("Import Font…")).toBe("");

  await search("svn");
  await vi.waitFor(() => expect(systemRows().map((el) => el.textContent)).toEqual(["SVN-Poppins"]));
  expect(options().map((el) => el.textContent)).not.toContain("Poppins");
  expect(options().map((el) => el.textContent)).not.toContain("Import Font…");

  await act(async () => { systemRows()[0].dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await vi.waitFor(() => expect(shownFont()).toBe("SVN-Poppins"), { timeout: 10_000 });
  expect(reads.sort()).toEqual(["/Library/Fonts/SVN-Poppins-Bold.ttf", "/Library/Fonts/SVN-Poppins-Regular.ttf"]);

  await pressUndo();
  expect(shownFont()).toBe("Default (Poppins)");
}, 30_000);
